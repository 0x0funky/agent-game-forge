import { useEffect, useState } from 'react';
import type { PendingPack } from '@ogf/contracts';
import {
  applyPack as apiApplyPack,
  discardPack as apiDiscardPack,
  fetchFileContent,
} from '../lib/api.js';
import { useDialog } from '../lib/dialog.js';
import { I } from './icons.js';

interface Props {
  projectPath: string;
  packs: PendingPack[];
  onClose: () => void;
  /** Called after a pack has been applied or discarded so App can re-poll. */
  onPackResolved: () => void;
  /** Called with the layout-diff prompt when user opts to auto-update code
   *  after applying a pack whose layout changed. */
  onRequestCodeUpdate?: (prompt: string) => void;
}

interface PackPreview {
  /** sheet.png rendered as a data URL — both sides. */
  liveSheetUrl: string | null;
  stagingSheetUrl: string | null;
  loading: boolean;
}

export function PackReviewModal(props: Props) {
  const { confirm, notify } = useDialog();
  const [activeIdx, setActiveIdx] = useState(0);
  const [busy, setBusy] = useState<'apply' | 'discard' | null>(null);
  const [autoCodeUpdate, setAutoCodeUpdate] = useState(true);
  const [previews, setPreviews] = useState<Record<string, PackPreview>>({});

  const active = props.packs[activeIdx] ?? props.packs[0] ?? null;
  if (!active) {
    // Defensive — shouldn't happen since the bar only opens when packs > 0,
    // but if user discards last pack the parent will close us next render.
    return null;
  }

  // Lazy-load sheet.png previews for the active pack.
  useEffect(() => {
    if (!active) return;
    if (previews[active.packDir]) return;
    let cancelled = false;
    setPreviews((p) => ({
      ...p,
      [active.packDir]: { liveSheetUrl: null, stagingSheetUrl: null, loading: true },
    }));
    (async () => {
      const livePath = `${active.packDir}/sheet.png`;
      const stagingPath = `.ogf/regen/${active.packDir}/sheet.png`;
      const toUrl = async (relPath: string) => {
        try {
          const r = await fetchFileContent(props.projectPath, relPath);
          if (r.kind !== 'image' || !r.base64) return null;
          return `data:image/png;base64,${r.base64}`;
        } catch {
          return null;
        }
      };
      const [live, stage] = await Promise.all([toUrl(livePath), toUrl(stagingPath)]);
      if (cancelled) return;
      setPreviews((p) => ({
        ...p,
        [active.packDir]: { liveSheetUrl: live, stagingSheetUrl: stage, loading: false },
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, [active, props.projectPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = previews[active.packDir];
  const layoutChanged = layoutDiffers(active.liveLayout, active.stagingLayout);

  async function doApply() {
    if (!active || busy) return;
    setBusy('apply');
    try {
      const r = await apiApplyPack({ projectPath: props.projectPath, packDir: active.packDir });
      if (r.failed.length > 0) {
        notify({
          kind: 'warn',
          title: 'Some files failed to apply',
          body: r.failed
            .slice(0, 5)
            .map((f) => `${f.relPath}: ${f.err}`)
            .join('\n'),
        });
      }
      // Fire follow-up code-update turn if layout changed.
      if (autoCodeUpdate && layoutChanged && props.onRequestCodeUpdate) {
        const prompt = buildCodeUpdatePrompt(active);
        props.onRequestCodeUpdate(prompt);
      }
      props.onPackResolved();
      // If there are more packs to review, advance; otherwise close.
      if (props.packs.length > 1) {
        setActiveIdx((i) => Math.min(i, props.packs.length - 2));
      } else {
        props.onClose();
      }
    } catch (err) {
      notify({
        kind: 'error',
        title: 'Apply failed',
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  }

  async function doDiscard() {
    if (!active || busy) return;
    const ok = await confirm({
      title: 'Discard pack?',
      body: `This deletes the staged ${active.fileCount} files for ${active.packDir}. The live folder is untouched.`,
      confirmLabel: 'Discard',
      danger: true,
    });
    if (!ok) return;
    setBusy('discard');
    try {
      await apiDiscardPack({ projectPath: props.projectPath, packDir: active.packDir });
      props.onPackResolved();
      if (props.packs.length > 1) {
        setActiveIdx((i) => Math.min(i, props.packs.length - 2));
      } else {
        props.onClose();
      }
    } catch (err) {
      notify({
        kind: 'error',
        title: 'Discard failed',
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  }

  // Parse entity / action from packDir like "assets/sprites/scout/idle".
  const segs = active.packDir.split('/');
  const action = segs[segs.length - 1];
  const entity = segs[segs.length - 2];

  return (
    <div className="modal-scrim" onClick={busy ? undefined : props.onClose}>
      <div
        className="modal pack-review-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span style={{ color: 'var(--accent)' }}>{I.refresh}</span>
          <span className="title">Review pack: {entity} / {action}</span>
          <span className="sub">
            {props.packs.length > 1 && (
              <>{activeIdx + 1} of {props.packs.length} pending · </>
            )}
            {active.fileCount} files
          </span>
          <button className="close" onClick={busy ? undefined : props.onClose}>
            {I.close}
          </button>
        </div>

        <div className="modal-body pack-review-body">
          {/* Pack switcher when multiple are pending */}
          {props.packs.length > 1 && (
            <div className="pack-switcher">
              {props.packs.map((p, i) => (
                <button
                  key={p.packDir}
                  className={`pack-switcher-btn ${i === activeIdx ? 'active' : ''}`}
                  onClick={() => setActiveIdx(i)}
                >
                  {p.packDir.split('/').slice(-2).join(' / ')}
                </button>
              ))}
            </div>
          )}

          {/* Sheet diff side-by-side */}
          <div className="pack-compare">
            <figure className="pack-side">
              <figcaption>Original</figcaption>
              {preview?.loading && <div className="muted mono">loading…</div>}
              {preview && !preview.loading && preview.liveSheetUrl && (
                <img
                  src={preview.liveSheetUrl}
                  alt="original"
                  style={{ imageRendering: 'pixelated' }}
                />
              )}
              {preview && !preview.loading && !preview.liveSheetUrl && (
                <div className="muted mono">no live sheet</div>
              )}
            </figure>
            <figure className="pack-side pack-side-new">
              <figcaption>New</figcaption>
              {preview?.loading && <div className="muted mono">loading…</div>}
              {preview && !preview.loading && preview.stagingSheetUrl && (
                <img
                  src={preview.stagingSheetUrl}
                  alt="new"
                  style={{ imageRendering: 'pixelated' }}
                />
              )}
              {preview && !preview.loading && !preview.stagingSheetUrl && (
                <div className="muted mono">no staging sheet</div>
              )}
            </figure>
          </div>

          {/* Layout diff table */}
          <div className="pack-layout-diff">
            <div className="pack-layout-row pack-layout-head">
              <span></span>
              <span>Original</span>
              <span>New</span>
            </div>
            <LayoutRow label="Frames" live={active.liveLayout?.frames} stage={active.stagingLayout?.frames} />
            <LayoutRow
              label="Grid"
              live={fmtGrid(active.liveLayout)}
              stage={fmtGrid(active.stagingLayout)}
              isString
            />
            <LayoutRow label="Cell size" live={active.liveLayout?.cellSize} stage={active.stagingLayout?.cellSize} suffix="px" />
            <LayoutRow label="FPS" live={active.liveLayout?.fps} stage={active.stagingLayout?.fps} />
            <LayoutRow
              label="Anchor"
              live={active.liveLayout?.anchor}
              stage={active.stagingLayout?.anchor}
              isString
            />
          </div>

          {layoutChanged && (
            <label className="pack-auto-update">
              <input
                type="checkbox"
                checked={autoCodeUpdate}
                onChange={(e) => setAutoCodeUpdate(e.target.checked)}
              />
              <span>
                Layout changed — auto-fire a follow-up turn to patch slicing
                in code/data after apply
              </span>
            </label>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn btn-sm" onClick={doDiscard} disabled={busy !== null}>
            {busy === 'discard' ? 'Discarding…' : 'Discard pack'}
          </button>
          <span className="grow" />
          <button
            className="btn btn-sm btn-primary"
            onClick={doApply}
            disabled={busy !== null}
          >
            {busy === 'apply' ? 'Applying…' : `Apply pack (${active.fileCount} files)`}
          </button>
        </div>
      </div>
    </div>
  );
}

function LayoutRow({
  label,
  live,
  stage,
  suffix = '',
  isString = false,
}: {
  label: string;
  live: number | string | null | undefined;
  stage: number | string | null | undefined;
  suffix?: string;
  isString?: boolean;
}) {
  const liveStr = live === null || live === undefined ? '—' : isString ? String(live) : `${live}${suffix}`;
  const stageStr = stage === null || stage === undefined ? '—' : isString ? String(stage) : `${stage}${suffix}`;
  const changed = liveStr !== stageStr && liveStr !== '—' && stageStr !== '—';
  return (
    <div className={`pack-layout-row ${changed ? 'changed' : ''}`}>
      <span className="pack-layout-label">{label}</span>
      <span className="mono">{liveStr}</span>
      <span className="mono">
        {stageStr}
        {changed && <span className="pill" style={{ marginLeft: 6 }}>changed</span>}
      </span>
    </div>
  );
}

function fmtGrid(layout: PendingPack['liveLayout']): string | null {
  if (!layout || !layout.cols || !layout.rows) return null;
  return `${layout.cols}×${layout.rows}`;
}

function layoutDiffers(
  a: PendingPack['liveLayout'],
  b: PendingPack['liveLayout'],
): boolean {
  if (!a || !b) return false; // unknown — don't claim a change
  return (
    a.cols !== b.cols ||
    a.rows !== b.rows ||
    a.frames !== b.frames ||
    a.cellSize !== b.cellSize ||
    a.fps !== b.fps
  );
}

function buildCodeUpdatePrompt(pack: PendingPack): string {
  const segs = pack.packDir.split('/');
  const action = segs[segs.length - 1];
  const entity = segs[segs.length - 2];
  const lines: string[] = [];
  lines.push(
    `The user just applied a regenerated animation pack for **${entity} / ${action}** at \`${pack.packDir}/\`.`,
  );
  lines.push('');
  lines.push('The new layout differs from the previous one:');
  lines.push('');
  lines.push('| Field | Was | Now |');
  lines.push('|-------|-----|-----|');
  const rows: Array<[string, unknown, unknown]> = [
    ['frames', pack.liveLayout?.frames, pack.stagingLayout?.frames],
    [
      'grid',
      pack.liveLayout && pack.liveLayout.cols && pack.liveLayout.rows
        ? `${pack.liveLayout.cols}×${pack.liveLayout.rows}`
        : '?',
      pack.stagingLayout && pack.stagingLayout.cols && pack.stagingLayout.rows
        ? `${pack.stagingLayout.cols}×${pack.stagingLayout.rows}`
        : '?',
    ],
    ['cell_size (px)', pack.liveLayout?.cellSize, pack.stagingLayout?.cellSize],
    ['fps', pack.liveLayout?.fps, pack.stagingLayout?.fps],
  ];
  for (const [field, was, now] of rows) {
    const wasStr = was === null || was === undefined ? '?' : String(was);
    const nowStr = now === null || now === undefined ? '?' : String(now);
    if (wasStr !== nowStr) lines.push(`| ${field} | ${wasStr} | ${nowStr} |`);
  }
  lines.push('');
  lines.push(
    `Update the slicing config wherever this pack is referenced in the project so the engine renders the new layout. Likely places to look:`,
  );
  lines.push(
    `- \`data/enemies.json\` / \`data/towers.json\` / \`data/heroes.json\` etc. — the catalog row for \`${entity}\`. Look for fields like \`displayW\`, \`displayH\`, \`animations.${action}.frames\`, \`frameW\`, \`frameH\`, \`fps\`, \`cols\`, \`rows\`.`,
  );
  lines.push(
    `- \`src/**/*.js\` — search for \`${entity}\` references and the previous numeric values (\`${pack.liveLayout?.cellSize ?? '?'}\`, \`${pack.liveLayout?.frames ?? '?'}\`, \`${pack.liveLayout?.fps ?? '?'}\`) wherever this sheet is loaded.`,
  );
  lines.push(
    `- \`${pack.packDir}/sheet.ogf-slice.json\` if it exists — the OGF-side slice sidecar.`,
  );
  lines.push('');
  lines.push(
    "Stay focused. ONLY patch slicing config tied to this entity / action. Don't restyle the catalog, don't tune stats, don't touch unrelated entities. Show the diff for review.",
  );
  return lines.join('\n');
}
