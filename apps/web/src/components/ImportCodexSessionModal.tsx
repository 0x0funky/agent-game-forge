import { useEffect, useState } from 'react';
import type { CodexSessionSummary } from '../lib/api.js';
import { fetchCodexSessions, importCodexSession } from '../lib/api.js';
import { useDialog } from '../lib/dialog.js';
import { I } from './icons.js';

interface Props {
  projectPath: string;
  onClose: () => void;
  /** Called after a session is imported so parent can refresh conversation list + switch to it. */
  onImported: (conversationId: string) => void;
}

export function ImportCodexSessionModal(props: Props) {
  const { notify } = useDialog();
  const [sessions, setSessions] = useState<CodexSessionSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchCodexSessions(props.projectPath)
      .then((r) => setSessions(r.sessions))
      .catch((e) =>
        notify({ kind: 'error', title: 'Could not load sessions', body: e instanceof Error ? e.message : String(e) }),
      )
      .finally(() => setLoading(false));
  }, [props.projectPath]);

  async function doImport(s: CodexSessionSummary) {
    setImporting(s.id);
    try {
      const r = await importCodexSession({
        projectPath: props.projectPath,
        sessionId: s.id,
        replay: true,
        title: s.firstPrompt ? s.firstPrompt.slice(0, 60) : `Codex ${s.id.slice(0, 8)}`,
      });
      notify({
        kind: 'success',
        title: 'Session imported',
        body: `${r.importedCount} messages restored. Codex will resume with full memory.`,
      });
      props.onImported(r.conversation.id);
    } catch (e) {
      notify({ kind: 'error', title: 'Import failed', body: e instanceof Error ? e.message : String(e) });
    } finally {
      setImporting(null);
    }
  }

  return (
    <div className="modal-scrim" onClick={props.onClose}>
      <div
        className="modal"
        style={{ height: 'min(640px, 88vh)', width: 'min(760px, 100%)', display: 'grid', gridTemplateRows: '48px 1fr 48px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span style={{ color: 'var(--accent)' }}>{I.branch}</span>
          <span className="title">Import Codex session</span>
          <span className="sub">{props.projectPath}</span>
          <button className="close" onClick={props.onClose}>{I.close}</button>
        </div>

        <div style={{ overflow: 'auto', background: 'var(--bg-0)', padding: '8px 0' }}>
          {loading && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>
              Scanning Codex sessions…
            </div>
          )}
          {!loading && sessions?.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-2)', fontSize: 13 }}>
              <div style={{ marginBottom: 8 }}>{I.spark}</div>
              No Codex sessions found for this project folder.
              <br />
              <span style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 8, display: 'block' }}>
                Sessions are stored in <code>~/.codex/sessions/</code> and matched by cwd.
              </span>
            </div>
          )}
          {!loading && sessions && sessions.length > 0 && sessions.map((s) => (
            <div
              key={s.id}
              className="import-session-row"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                alignItems: 'start',
                gap: 12,
                padding: '12px 16px',
                borderBottom: '1px solid var(--line)',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>
                    {s.id.slice(0, 18)}…
                  </code>
                  <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                    {formatDate(s.startedAt)}
                  </span>
                  {s.cliVersion && (
                    <span style={{ fontSize: 10, color: 'var(--ink-3)', background: 'var(--bg-2)', padding: '1px 6px', borderRadius: 3 }}>
                      v{s.cliVersion}
                    </span>
                  )}
                </div>
                {s.firstPrompt && (
                  <div style={{
                    fontSize: 12.5,
                    color: 'var(--ink-1)',
                    background: 'var(--bg-2)',
                    padding: '6px 10px',
                    borderRadius: 4,
                    borderLeft: '2px solid var(--accent-line)',
                    marginBottom: 6,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 72,
                    overflow: 'hidden',
                  }}>
                    {s.firstPrompt}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
                  <span>{s.userMsgCount ?? '?'} user msgs</span>
                  <span>{s.agentMsgCount ?? '?'} agent msgs</span>
                  <span>{formatSize(s.fileSize)} rollout</span>
                </div>
              </div>
              <button
                className="btn btn-sm btn-primary"
                disabled={importing === s.id}
                onClick={() => void doImport(s)}
              >
                {importing === s.id ? 'Importing…' : 'Import'}
              </button>
            </div>
          ))}
        </div>

        <div className="modal-foot" style={{ fontSize: 12, color: 'var(--ink-2)' }}>
          <span>
            Importing replays user + agent text into OGF. Codex will resume with full rollout memory.
          </span>
          <span className="grow" />
          <button className="btn btn-sm" onClick={props.onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('zh-TW', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso.slice(0, 16).replace('T', ' '); }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
