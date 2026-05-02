import type { PendingSliceEntry } from '@ogf/contracts';
import { I } from './icons.js';
import { useDialog } from '../lib/dialog.js';

interface Props {
  pending: PendingSliceEntry[];
  onClose: () => void;
  onApplyAll: (prompt: string) => void;
  onClearAll: () => void;
  onDiscardOne: (sidecarPath: string) => void;
}

export function PendingChangesModal(props: Props) {
  const { confirm: askConfirm } = useDialog();
  return (
    <div className="modal-scrim" onClick={props.onClose}>
      <div
        className="modal"
        style={{ height: 'min(680px, 90vh)', width: 'min(820px, 100%)', display: 'grid', gridTemplateRows: '48px 1fr 56px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span style={{ color: 'var(--accent)' }}>{I.scissors}</span>
          <span className="title">Pending slicing changes</span>
          <span className="sub">
            {props.pending.length} sheet{props.pending.length === 1 ? '' : 's'} edited locally · not yet applied to engine
          </span>
          <button className="close" onClick={props.onClose}>{I.close}</button>
        </div>

        <div className="pending-list">
          {props.pending.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>
              No pending changes.
            </div>
          )}
          {props.pending.map((p) => (
            <div key={p.sidecarPath} className="pending-row">
              <div className="pending-row-head">
                <code className="pending-source">{p.sourcePath}</code>
                <span className="pill" title="Slicing in OGF metadata">
                  {p.cols}×{p.rows} · {p.fps}fps · {p.anchor}
                </span>
                <button
                  className="btn btn-sm btn-ghost"
                  title="Discard this change (delete its .ogf-slice.json sidecar)"
                  onClick={async () => {
                    const ok = await askConfirm({
                      title: 'Discard pending slicing?',
                      body: p.sourcePath,
                      danger: true,
                      confirmLabel: 'Discard',
                    });
                    if (ok) props.onDiscardOne(p.sidecarPath);
                  }}
                >
                  {I.close} discard
                </button>
              </div>
              <dl className="kv" style={{ marginTop: 8, gridTemplateColumns: '90px 1fr' }}>
                <dt>Frame</dt>
                <dd>
                  {p.frameW ?? '?'} × {p.frameH ?? '?'}
                  {(p.padding > 0 || p.offsetX !== 0 || p.offsetY !== 0) && (
                    <>
                      {' · '}padding {p.padding}, offset ({p.offsetX}, {p.offsetY})
                    </>
                  )}
                </dd>
                <dt>Sidecar</dt>
                <dd style={{ color: 'var(--ink-3)', fontSize: 11 }}>{p.sidecarPath}</dd>
                <dt>Used in</dt>
                <dd>
                  {p.usages.length === 0 ? (
                    <span style={{ color: 'var(--ink-3)' }}>(no references found)</span>
                  ) : (
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {p.usages.map((u, i) => (
                        <li key={i} style={{ fontSize: 11, color: 'var(--ink-2)' }}>
                          <code style={{ color: 'var(--ink-1)' }}>{u.file}:{u.line}</code>
                          <span style={{ marginLeft: 8, opacity: 0.7 }}>
                            {u.snippet.length > 80 ? u.snippet.slice(0, 80) + '…' : u.snippet}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </dl>
            </div>
          ))}
        </div>

        <div className="modal-foot">
          <span className="info">
            <span style={{ color: 'var(--ink-2)' }}>
              Applying via Codex: builds one prompt covering all entries and sends it to the agent.
              {' '}You review and Send.
            </span>
          </span>
          <span className="grow" />
          <button
            className="btn btn-sm"
            onClick={props.onClearAll}
            disabled={props.pending.length === 0}
            title="Discard all pending changes (deletes .ogf-slice.json sidecars; underlying Godot files untouched)"
          >
            {I.retry} Revert all
          </button>
          <button className="btn btn-sm" onClick={props.onClose}>
            Cancel
          </button>
          <button
            className="btn btn-sm btn-primary"
            disabled={props.pending.length === 0}
            onClick={() => props.onApplyAll(buildBatchPrompt(props.pending))}
          >
            {I.spark} Apply all via Codex
          </button>
        </div>
      </div>
    </div>
  );
}

export function buildBatchPrompt(pending: PendingSliceEntry[]): string {
  const lines: string[] = [
    '# Apply pending sprite slicing changes',
    '',
    `I have ${pending.length} sprite sheet${pending.length === 1 ? '' : 's'} whose slicing config was edited locally in OGF.`,
    'For each, please update the relevant Godot config (typically `frame_cols` / `frame_rows` / `animation_fps`',
    'in scenes, scripts, or `.tres` files) so the game uses the new values.',
    '',
    'Plan first (list the exact edits you would make). After I confirm, apply them.',
    'Once applied successfully, delete the `.ogf-slice.json` sidecar for that sheet so OGF stops showing it as pending.',
    '',
    '## Pending changes',
    '',
  ];

  pending.forEach((p, i) => {
    lines.push(`### ${i + 1}. \`${p.sourcePath}\``);
    lines.push('');
    const detail = `**${p.cols} × ${p.rows}** at ${p.fps} fps · anchor: ${p.anchor}`;
    const extra = p.padding > 0 || p.offsetX !== 0 || p.offsetY !== 0
      ? ` · padding ${p.padding}, offset (${p.offsetX}, ${p.offsetY})`
      : '';
    lines.push(`Target slicing: ${detail}${extra}`);
    if (p.frameW && p.frameH) {
      lines.push(`Frame size: ${p.frameW} × ${p.frameH}px`);
    }
    lines.push(`Sidecar to delete after applying: \`${p.sidecarPath}\``);
    if (p.usages.length > 0) {
      lines.push('');
      lines.push('References:');
      for (const u of p.usages) {
        lines.push(`- \`${u.file}:${u.line}\`  ${u.snippet}`);
      }
    }
    lines.push('');
  });

  return lines.join('\n');
}
