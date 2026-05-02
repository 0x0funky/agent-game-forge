import { useEffect, useState } from 'react';
import { fsList, type FsListResult } from '../lib/api.js';
import { I } from './icons.js';

interface Props {
  /** Initial path to open at. If empty/undefined uses Windows root or homedir on Mac/Linux. */
  initialPath?: string;
  onCancel: () => void;
  onSelect: (path: string) => void;
}

const LS_LAST_BROWSE = 'ogf:lastBrowsePath';

export function FolderPickerModal(props: Props) {
  const [path, setPath] = useState<string>(
    () => props.initialPath ?? localStorage.getItem(LS_LAST_BROWSE) ?? '',
  );
  const [data, setData] = useState<FsListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualEntry, setManualEntry] = useState(false);
  const [manualPath, setManualPath] = useState('');

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fsList(path)
      .then((r) => {
        if (cancelled) return;
        setData(r);
        if (r.cwd) localStorage.setItem(LS_LAST_BROWSE, r.cwd);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  function navigate(p: string) {
    setManualEntry(false);
    setPath(p);
  }

  function chooseCurrent() {
    if (data?.cwd) props.onSelect(data.cwd);
  }

  function submitManual() {
    const t = manualPath.trim();
    if (t) props.onSelect(t);
  }

  return (
    <div className="modal-scrim" onClick={props.onCancel}>
      <div
        className="modal"
        style={{ height: 'min(620px, 90vh)', width: 'min(720px, 100%)', display: 'grid', gridTemplateRows: '48px auto 1fr 56px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span style={{ color: 'var(--accent)' }}>{I.folder}</span>
          <span className="title">Open project folder</span>
          <span className="sub">click to navigate · projects highlighted</span>
          <button className="close" onClick={props.onCancel}>{I.close}</button>
        </div>

        <div className="picker-bar">
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => navigate('')}
            title="Drive list / home"
          >
            {navigator.platform.toLowerCase().includes('win') ? '🖥' : '🏠'}
          </button>
          {data?.parent !== null && data?.parent !== undefined && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => navigate(data.parent ?? '')}
              title="Up one level"
            >
              ↑
            </button>
          )}
          <div className="picker-crumbs">
            {data?.parts.length === 0 && <span className="muted mono" style={{ fontSize: 11 }}>Drives</span>}
            {data?.parts.map((p, i) => (
              <span key={p.path}>
                <button
                  className="picker-crumb"
                  onClick={() => navigate(p.path)}
                >
                  {p.name}
                </button>
                {i < (data.parts.length - 1) && <span className="picker-crumb-sep">/</span>}
              </span>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setManualEntry((v) => !v);
              setManualPath(data?.cwd ?? '');
            }}
            title="Type a path manually"
          >
            ⌨
          </button>
        </div>

        {manualEntry && (
          <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 8 }}>
            <input
              autoFocus
              placeholder="D:\path\to\project"
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitManual();
                if (e.key === 'Escape') setManualEntry(false);
              }}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--line)',
                background: 'var(--bg-2)',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
              }}
            />
            <button className="btn btn-sm btn-primary" onClick={submitManual} disabled={!manualPath.trim()}>
              Open
            </button>
          </div>
        )}

        <div className="picker-list">
          {error && <div className="msg-sys err" style={{ margin: 12 }}>{I.warn} {error}</div>}
          {!error && !data && <div style={{ padding: 16, color: 'var(--ink-3)' }}>Loading…</div>}
          {data && data.entries.length === 0 && (
            <div style={{ padding: 16, color: 'var(--ink-3)', fontSize: 12 }}>(empty)</div>
          )}
          {data?.entries.map((e) => (
            <div
              key={e.path}
              className={`picker-row${e.engine ? ' is-project' : ''}`}
              onClick={() => navigate(e.path)}
              onDoubleClick={() => props.onSelect(e.path)}
              title={e.path}
            >
              <span className="picker-row-icon">{I.folder}</span>
              <span className="picker-row-name">{e.name}</span>
              {e.engine && (
                <span className={`pill engine ${e.engine}`} style={{ fontSize: 10, padding: '1px 8px' }}>
                  <span className="dot" /> {e.engine}
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="modal-foot">
          <span className="info">
            {data?.cwd ? (
              <>
                <span style={{ color: 'var(--ink-2)' }}>open: </span>
                <code style={{ color: 'var(--ink-1)' }}>{data.cwd}</code>
                {data.isProject && (
                  <span className={`pill engine ${data.engine}`} style={{ marginLeft: 8, fontSize: 10, padding: '1px 8px' }}>
                    <span className="dot" /> {data.engine}
                  </span>
                )}
              </>
            ) : (
              <span style={{ color: 'var(--ink-3)' }}>Pick a drive</span>
            )}
          </span>
          <span className="grow" />
          <button className="btn btn-sm" onClick={props.onCancel}>Cancel</button>
          <button
            className="btn btn-sm btn-primary"
            onClick={chooseCurrent}
            disabled={!data?.cwd}
            title={data?.isProject ? 'Open this project folder' : 'Open this folder (will be treated as unknown engine)'}
          >
            Open this folder
          </button>
        </div>
      </div>
    </div>
  );
}
