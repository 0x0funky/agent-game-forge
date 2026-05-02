import type { AgentInfo, Project } from '@ogf/contracts';

interface Props {
  agent: AgentInfo | null;
  project: Project | null;
  filesChanged: number;
  isStreaming: boolean;
  lastRunLabel?: string;
}

export function StatusBar(props: Props) {
  const codexLabel = props.agent?.version ? props.agent.version.replace(/^codex-cli\s*/, 'Codex ') : 'Codex —';
  const engineLabel = props.project ? engineDisplay(props.project.engine) : 'no project';
  const projectPath = props.project?.path ?? '';

  return (
    <div className="statusbar">
      <span className="group" title={props.agent?.path ?? 'Codex agent'}>
        <span className="dot" />
        <span>{codexLabel}</span>
      </span>
      {props.project && (
        <span className="group">
          <span style={{ color: 'var(--accent)' }}>{engineLabel}</span>
        </span>
      )}
      <span className="group">
        <span>{props.filesChanged} files changed</span>
      </span>
      <span className="group">
        <span>last run {props.lastRunLabel ?? '—'}</span>
      </span>
      {props.isStreaming && (
        <span className="group" style={{ color: 'var(--accent)' }}>
          <span
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--accent)',
              boxShadow: '0 0 6px var(--accent)',
              animation: 'pulse 1s ease-in-out infinite',
            }}
          />
          generating…
        </span>
      )}
      <span className="right">
        <span className="group">UTF-8</span>
        <span className="group">LF</span>
        {projectPath && <span className="group" title={projectPath}>{shortenPath(projectPath)}</span>}
      </span>
    </div>
  );
}

function engineDisplay(engine: string): string {
  if (engine === 'godot') return 'Godot';
  if (engine === 'unity') return 'Unity';
  if (engine === 'web') return 'Web';
  return 'unknown';
}

function shortenPath(p: string): string {
  const norm = p.replace(/\\/g, '/');
  const parts = norm.split('/').filter(Boolean);
  if (parts.length <= 3) return norm;
  return '…/' + parts.slice(-2).join('/');
}
