import { useMemo, useState } from 'react';

/** Generic JSON Table Editor.
 *  Recognizes array-of-objects (root or first-level field) and renders an
 *  editable grid. When entries have a time-like field (delay / time /
 *  start_at), a 'timeline' view is also offered.
 *
 *  Save flow: this component never writes to disk itself — it computes the
 *  next JSON text and calls onContentChange. The host (FileEditor) owns the
 *  dirty / save lifecycle, just like for plain text edits. */

interface Props {
  content: string;
  projectPath: string;
  relPath: string;
  onContentChange: (next: string) => void;
}

type ColumnType = 'string' | 'number' | 'boolean' | 'image' | 'json' | 'point';

interface ColumnSpec {
  key: string;
  type: ColumnType;
}

interface TableData {
  rows: Record<string, unknown>[];
  columns: ColumnSpec[];
  timeKey: string | null;
  arrayPath: string[];
}

const TIME_KEYS = ['delay', 'time', 'start_at', 'startAt', 'at', 't', 'timestamp'];
const IMAGE_EXT_RE = /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i;
const RES_PREFIX_RE = /^res:\/\//i;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isArrayOfObjects(v: unknown): v is Record<string, unknown>[] {
  return Array.isArray(v) && v.length > 0 && v.every(isPlainObject);
}

function detectColumnType(rows: Record<string, unknown>[], key: string): ColumnType {
  let allNumber = true;
  let allBoolean = true;
  let allString = true;
  let allImage = true;
  let allJson = true;
  let allPoint = true;
  let nonEmpty = 0;
  for (const r of rows) {
    const v = r[key];
    if (v === undefined || v === null || v === '') continue;
    nonEmpty++;
    if (typeof v !== 'number') allNumber = false;
    if (typeof v !== 'boolean') allBoolean = false;
    if (typeof v !== 'string') {
      allString = false;
      allImage = false;
    } else {
      const looksImage = IMAGE_EXT_RE.test(v) || (RES_PREFIX_RE.test(v) && IMAGE_EXT_RE.test(v));
      if (!looksImage) allImage = false;
    }
    if (typeof v !== 'object') allJson = false;
    // Point-like: { x, y } object
    if (
      typeof v !== 'object' ||
      v === null ||
      Array.isArray(v) ||
      typeof (v as Record<string, unknown>).x !== 'number' ||
      typeof (v as Record<string, unknown>).y !== 'number'
    ) {
      allPoint = false;
    }
  }
  if (nonEmpty === 0) return 'string';
  if (allNumber) return 'number';
  if (allBoolean) return 'boolean';
  if (allImage) return 'image';
  if (allPoint) return 'point';
  if (allJson) return 'json';
  void allString;
  return 'string';
}

function buildTableFromArray(arr: Record<string, unknown>[], path: string[]): TableData {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of arr) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  const columns: ColumnSpec[] = keys.map((key) => ({
    key,
    type: detectColumnType(arr, key),
  }));
  const timeKey = TIME_KEYS.find((k) => seen.has(k)) ?? null;
  // If we have a time key, sort it to the front for nicer display.
  if (timeKey) {
    const idx = columns.findIndex((c) => c.key === timeKey);
    if (idx > 0) {
      const [c] = columns.splice(idx, 1);
      columns.unshift(c);
    }
  }
  return { rows: arr, columns, timeKey, arrayPath: path };
}

interface ArrayCandidate {
  path: string[];
  label: string;
  length: number;
  data: Record<string, unknown>[];
}

interface DetectResult {
  /** Every array-of-objects found at the top level (or root itself). Empty
   *  if the JSON has no editable arrays. The TableEditor lets the user pick
   *  which one is active when there's more than one (e.g. enemies.json
   *  with both `wild` and `marshWild`). */
  arrays: ArrayCandidate[];
  /** Set when the JSON parses but isn't table-shaped at all. */
  reason?: string;
}

function detectTable(content: string): DetectResult {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (err) {
    return {
      arrays: [],
      reason: `JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (isArrayOfObjects(data)) {
    return {
      arrays: [{ path: [], label: '(root)', length: data.length, data }],
    };
  }
  if (isPlainObject(data)) {
    const arrays: ArrayCandidate[] = [];
    for (const [k, v] of Object.entries(data)) {
      if (isArrayOfObjects(v)) {
        arrays.push({ path: [k], label: k, length: v.length, data: v });
      }
    }
    if (arrays.length > 0) return { arrays };
  }
  return { arrays: [], reason: 'No array-of-objects found.' };
}

function getAtPath<T>(root: unknown, path: string[]): T {
  let cur: unknown = root;
  for (const p of path) {
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur as T;
}

function setAtPath(root: Record<string, unknown>, path: string[], value: unknown): void {
  if (path.length === 0) return;
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < path.length - 1; i++) {
    cur = cur[path[i]] as Record<string, unknown>;
  }
  cur[path[path.length - 1]] = value;
}

function emitNextContent(
  prevContent: string,
  arrayPath: string[],
  mutator: (arr: Record<string, unknown>[]) => Record<string, unknown>[],
): string {
  const data = JSON.parse(prevContent);
  if (arrayPath.length === 0) {
    const next = mutator(data as Record<string, unknown>[]);
    return JSON.stringify(next, null, 2);
  }
  const arr = getAtPath<Record<string, unknown>[]>(data, arrayPath);
  const next = mutator(arr);
  setAtPath(data as Record<string, unknown>, arrayPath, next);
  return JSON.stringify(data, null, 2);
}

function defaultValueForType(t: ColumnType): unknown {
  if (t === 'number') return 0;
  if (t === 'boolean') return false;
  if (t === 'point') return { x: 0, y: 0 };
  if (t === 'json') return null;
  return '';
}

// =============== Component ===============

export function TableEditor(props: Props) {
  const detect = useMemo(() => detectTable(props.content), [props.content]);
  const [view, setView] = useState<'table' | 'timeline'>('table');
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  // When the file has multiple arrays (e.g. wild + marshWild), let the user
  // tab between them. Default to the first; reset whenever the array set
  // changes (file edit, switching files).
  const [activeIdx, setActiveIdx] = useState(0);
  const arraysKey = detect.arrays.map((a) => a.label).join('|');
  useMemo(() => {
    if (activeIdx >= detect.arrays.length) setActiveIdx(0);
    // intentionally not depending on activeIdx — only reset when the array
    // shape itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arraysKey]);

  if (detect.arrays.length === 0) {
    return (
      <div className="table-editor-empty">
        Not a table-shaped JSON. {detect.reason}
      </div>
    );
  }

  const active = detect.arrays[Math.min(activeIdx, detect.arrays.length - 1)];
  const table = buildTableFromArray(active.data, active.path);
  const { rows, columns, timeKey, arrayPath } = table;

  function commit(mutator: (arr: Record<string, unknown>[]) => Record<string, unknown>[]) {
    const next = emitNextContent(props.content, arrayPath, mutator);
    props.onContentChange(next);
  }

  function updateCell(rowIndex: number, key: string, value: unknown) {
    commit((arr) => {
      const next = arr.map((r, i) => (i === rowIndex ? { ...r, [key]: value } : r));
      return next;
    });
  }

  function addRow() {
    commit((arr) => {
      const blank: Record<string, unknown> = {};
      for (const col of columns) blank[col.key] = defaultValueForType(col.type);
      return [...arr, blank];
    });
    setSelectedRow(rows.length); // points to new row after re-detect
  }

  function deleteRow(rowIndex: number) {
    commit((arr) => arr.filter((_, i) => i !== rowIndex));
    if (selectedRow === rowIndex) setSelectedRow(null);
  }

  function moveRow(rowIndex: number, dir: -1 | 1) {
    const target = rowIndex + dir;
    if (target < 0 || target >= rows.length) return;
    commit((arr) => {
      const next = [...arr];
      const [r] = next.splice(rowIndex, 1);
      next.splice(target, 0, r);
      return next;
    });
    setSelectedRow(target);
  }

  return (
    <div className="table-editor">
      {detect.arrays.length > 1 && (
        <div className="table-editor-tabs" role="tablist">
          {detect.arrays.map((a, i) => (
            <button
              key={a.label}
              role="tab"
              aria-selected={i === activeIdx}
              className={`table-editor-tab ${i === activeIdx ? 'active' : ''}`}
              onClick={() => {
                setActiveIdx(i);
                setSelectedRow(null);
              }}
              title={`Edit ${a.label} (${a.length} entries)`}
            >
              <span className="mono">{a.label}</span>
              <span className="muted"> · {a.length}</span>
            </button>
          ))}
        </div>
      )}
      <div className="table-editor-toolbar">
        <span className="mono">
          {arrayPath.length > 0 ? `.${arrayPath.join('.')}` : '(root array)'}
        </span>
        <span className="muted">{rows.length} rows · {columns.length} columns</span>
        <span style={{ flex: 1 }} />
        {timeKey && (
          <div className="view-toggle">
            <button
              className={`view-toggle-btn ${view === 'table' ? 'active' : ''}`}
              onClick={() => setView('table')}
            >
              table
            </button>
            <button
              className={`view-toggle-btn ${view === 'timeline' ? 'active' : ''}`}
              onClick={() => setView('timeline')}
              title={`Timeline by '${timeKey}'`}
            >
              timeline
            </button>
          </div>
        )}
        <button className="btn btn-sm btn-primary" onClick={addRow}>+ row</button>
      </div>

      {view === 'table' && (
        <TableView
          rows={rows}
          columns={columns}
          selectedRow={selectedRow}
          onSelectRow={setSelectedRow}
          onUpdateCell={updateCell}
          onDeleteRow={deleteRow}
          onMoveRow={moveRow}
          projectPath={props.projectPath}
        />
      )}

      {view === 'timeline' && timeKey && (
        <TimelineView
          rows={rows}
          columns={columns}
          timeKey={timeKey}
          selectedRow={selectedRow}
          onSelectRow={setSelectedRow}
          onUpdateCell={updateCell}
        />
      )}
    </div>
  );
}

// =============== Table view ===============

function TableView({
  rows,
  columns,
  selectedRow,
  onSelectRow,
  onUpdateCell,
  onDeleteRow,
  onMoveRow,
  projectPath,
}: {
  rows: Record<string, unknown>[];
  columns: ColumnSpec[];
  selectedRow: number | null;
  onSelectRow: (i: number | null) => void;
  onUpdateCell: (i: number, k: string, v: unknown) => void;
  onDeleteRow: (i: number) => void;
  onMoveRow: (i: number, dir: -1 | 1) => void;
  projectPath: string;
}) {
  return (
    <div className="table-editor-scroll">
      <table className="table-editor-table">
        <thead>
          <tr>
            <th className="row-num">#</th>
            {columns.map((c) => (
              <th key={c.key} className={`col-${c.type}`}>
                <span className="col-name">{c.key}</span>
                <span className="col-type">{c.type}</span>
              </th>
            ))}
            <th className="row-actions"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className={selectedRow === i ? 'selected' : ''}
              onClick={() => onSelectRow(i)}
            >
              <td className="row-num">{i}</td>
              {columns.map((c) => (
                <td key={c.key} className={`col-${c.type}`}>
                  <CellEditor
                    type={c.type}
                    value={row[c.key]}
                    onChange={(v) => onUpdateCell(i, c.key, v)}
                    projectPath={projectPath}
                  />
                </td>
              ))}
              <td className="row-actions">
                <button
                  className="row-btn"
                  title="Move up"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMoveRow(i, -1);
                  }}
                  disabled={i === 0}
                >
                  ↑
                </button>
                <button
                  className="row-btn"
                  title="Move down"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMoveRow(i, 1);
                  }}
                  disabled={i === rows.length - 1}
                >
                  ↓
                </button>
                <button
                  className="row-btn danger"
                  title="Delete row"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteRow(i);
                  }}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// =============== Cell editors ===============

function CellEditor({
  type,
  value,
  onChange,
  projectPath,
}: {
  type: ColumnType;
  value: unknown;
  onChange: (v: unknown) => void;
  projectPath: string;
}) {
  if (type === 'number') {
    return (
      <input
        type="number"
        className="cell-input"
        value={typeof value === 'number' ? value : ''}
        onChange={(e) => {
          const v = e.target.value === '' ? null : Number(e.target.value);
          onChange(v);
        }}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }
  if (type === 'boolean') {
    return (
      <input
        type="checkbox"
        className="cell-checkbox"
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }
  if (type === 'image') {
    return <ImageCell value={typeof value === 'string' ? value : ''} onChange={onChange} projectPath={projectPath} />;
  }
  if (type === 'point') {
    const p = (value as { x?: number; y?: number } | null) ?? { x: 0, y: 0 };
    return (
      <span className="cell-point">
        <input
          type="number"
          className="cell-input cell-point-input"
          value={p.x ?? 0}
          onChange={(e) => onChange({ ...p, x: Number(e.target.value) })}
          onClick={(e) => e.stopPropagation()}
        />
        <span className="muted">,</span>
        <input
          type="number"
          className="cell-input cell-point-input"
          value={p.y ?? 0}
          onChange={(e) => onChange({ ...p, y: Number(e.target.value) })}
          onClick={(e) => e.stopPropagation()}
        />
      </span>
    );
  }
  if (type === 'json') {
    return (
      <span className="cell-json mono" title={JSON.stringify(value)}>
        {(() => {
          if (Array.isArray(value)) return `[…${value.length}]`;
          if (value && typeof value === 'object') return `{…${Object.keys(value).length}}`;
          return String(value ?? '');
        })()}
      </span>
    );
  }
  // string
  return (
    <input
      type="text"
      className="cell-input"
      value={typeof value === 'string' ? value : value == null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function ImageCell({
  value,
  onChange,
  projectPath,
}: {
  value: string;
  onChange: (v: unknown) => void;
  projectPath: string;
}) {
  const rel = value.replace(/^res:\/\//i, '');
  const [src, setSrc] = useState<string | null>(null);
  if (rel && !src) {
    fetch(
      `/api/files/content?projectPath=${encodeURIComponent(projectPath)}&relPath=${encodeURIComponent(rel)}`,
    )
      .then((r) => r.json())
      .then((j) => {
        if (j?.base64) {
          const ext = rel.split('.').pop()?.toLowerCase() ?? 'png';
          const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
          setSrc(`data:${mime};base64,${j.base64}`);
        }
      })
      .catch(() => {});
  }
  return (
    <span className="cell-image">
      {rel && (
        <span className="cell-image-thumb">
          {src ? (
            <img src={src} alt="" />
          ) : (
            <span className="cell-image-placeholder">{rel ? '⌛' : ''}</span>
          )}
        </span>
      )}
      <input
        type="text"
        className="cell-input cell-image-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        placeholder="res://path/to/image.png"
      />
    </span>
  );
}

// =============== Timeline view ===============

function TimelineView({
  rows,
  columns,
  timeKey,
  selectedRow,
  onSelectRow,
  onUpdateCell,
}: {
  rows: Record<string, unknown>[];
  columns: ColumnSpec[];
  timeKey: string;
  selectedRow: number | null;
  onSelectRow: (i: number | null) => void;
  onUpdateCell: (i: number, k: string, v: unknown) => void;
}) {
  // Timeline visualizes entries as chips along a horizontal time axis. Drag a
  // chip horizontally to update its time. Click to select; details shown in
  // the bottom panel.
  const times = rows.map((r) => Number(r[timeKey] ?? 0));
  // Cumulative case: when entries have small per-entry deltas (e.g. waves
  // 'delay' is "time from previous wave"), unroll to absolute time on display.
  const isDeltaLike = times.every((t) => t >= 0 && t < 30);
  const absoluteTimes = isDeltaLike ? cumulative(times) : times;
  const maxT = Math.max(1, ...absoluteTimes);
  // Add 10% headroom on the right
  const span = maxT * 1.1;

  // Pick a primary label column: prefer 'id'/'name'/'type'; else first non-time string column
  const labelKey =
    columns.find((c) => ['id', 'name', 'type', 'label'].includes(c.key))?.key ??
    columns.find((c) => c.type === 'string' && c.key !== timeKey)?.key ??
    null;

  function onDrag(rowIndex: number, e: React.MouseEvent<HTMLDivElement>) {
    e.stopPropagation();
    const rail = (e.currentTarget.parentElement as HTMLElement | null);
    if (!rail) return;
    const railRect = rail.getBoundingClientRect();
    const startX = e.clientX;
    const startTime = Number(rows[rowIndex][timeKey] ?? 0);

    function move(ev: MouseEvent) {
      const dx = ev.clientX - startX;
      const dT = (dx / railRect.width) * span;
      let next = startTime + dT;
      next = Math.max(0, Math.round(next * 100) / 100);
      onUpdateCell(rowIndex, timeKey, next);
    }
    function up() {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  return (
    <div className="timeline-view">
      <div className="timeline-rail">
        {/* tick marks every ~unit second */}
        {Array.from({ length: 11 }).map((_, i) => (
          <div
            key={i}
            className="timeline-tick"
            style={{ left: `${(i / 10) * 100}%` }}
          >
            <span className="timeline-tick-label">{((i / 10) * span).toFixed(1)}s</span>
          </div>
        ))}
        {rows.map((row, i) => {
          const t = absoluteTimes[i];
          const left = `${(t / span) * 100}%`;
          const label =
            labelKey && row[labelKey] != null
              ? String(row[labelKey])
              : `#${i}`;
          return (
            <div
              key={i}
              className={`timeline-chip ${selectedRow === i ? 'selected' : ''}`}
              style={{ left }}
              onClick={(e) => {
                e.stopPropagation();
                onSelectRow(i);
              }}
              onMouseDown={(e) => {
                if (e.button === 0) onDrag(i, e);
              }}
              title={`${label} @ ${t.toFixed(2)}s`}
            >
              <span className="timeline-chip-time mono">
                {Number(row[timeKey] ?? 0).toFixed(2)}
              </span>
              <span className="timeline-chip-label">{label}</span>
            </div>
          );
        })}
      </div>
      {selectedRow !== null && rows[selectedRow] && (
        <div className="timeline-detail">
          <div className="timeline-detail-title">Entry #{selectedRow}</div>
          {columns.map((c) => (
            <div className="timeline-detail-row" key={c.key}>
              <span className="muted">{c.key}</span>
              <CellEditor
                type={c.type}
                value={rows[selectedRow][c.key]}
                onChange={(v) => onUpdateCell(selectedRow, c.key, v)}
                projectPath=""
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function cumulative(arr: number[]): number[] {
  let s = 0;
  return arr.map((x) => (s = s + x));
}
