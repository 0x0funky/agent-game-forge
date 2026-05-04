import { useEffect, useRef, useState } from 'react';
import type { AgentInfo, Project } from '@ogf/contracts';
import { I } from './icons.js';

export type Theme = 'dark' | 'light';
export type Density = 'compact' | 'regular' | 'comfy';

interface Props {
  agent: AgentInfo | null;
  agentLoading: boolean;
  project: Project | null;
  projects: Project[];
  onSelectProject: (p: Project) => void;
  onOpenProject: () => void;
  /** Remove a project from OGF's recent list. Files on disk are NOT touched. */
  onDeleteProject?: (p: Project) => void;
  theme: Theme;
  onToggleTheme: () => void;
  density: Density;
  onCycleDensity: () => void;
  onPlay?: () => void;
  isPlaying?: boolean;
}

export function Header(props: Props) {
  const agentState = props.agent?.available
    ? 'ok'
    : props.agentLoading
    ? 'off'
    : 'error';
  const stateLabel = agentState === 'ok' ? 'Codex' : agentState === 'error' ? 'Codex offline' : 'detecting…';

  return (
    <header className="hdr">
      <div className="hdr-left">
        <div className="logo">
          <img
            className="logo-mark"
            src="/ogf-logo-64.png"
            srcSet="/ogf-logo-32.png 1x, /ogf-logo-64.png 2x, /ogf-logo-128.png 4x"
            alt=""
            width={22}
            height={22}
          />
          <img
            className="logo-title"
            src="/ogf-title-222.png"
            srcSet="/ogf-title-111.png 1x, /ogf-title-222.png 2x, /ogf-title-333.png 3x"
            alt="Agent Game Forge"
            width={111}
            height={22}
          />
        </div>
        <div style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 4px' }} />
        <ProjectSwitcher
          project={props.project}
          projects={props.projects}
          onSelect={props.onSelectProject}
          onOpen={props.onOpenProject}
          onDelete={props.onDeleteProject}
        />
      </div>

      <div className="cmdk" role="button">
        {I.search}
        <span>Search files, scenes, ask Codex…</span>
        <span className="kbd">⌘K</span>
      </div>

      <div className="hdr-right">
        <button className="agent-pill" data-state={agentState} title={props.agent?.path ?? 'Codex agent status'}>
          <span className="dot" />
          {stateLabel}
          {props.agent?.version && <span className="ver">{props.agent.version.replace(/^codex-cli\s*/, 'v')}</span>}
        </button>
        <button className="btn btn-primary" onClick={props.onPlay} disabled={!props.project} title={props.project ? 'Play / build preview' : 'No project open'}>
          {props.isPlaying ? I.stop : I.play}
          {props.isPlaying ? 'Stop' : 'Play'}
        </button>
        <button className="btn" disabled title="Coming soon">
          {I.build}
          Build
        </button>
        <div style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 2px' }} />
        <button
          className="btn btn-icon btn-ghost"
          title={props.theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
          onClick={props.onToggleTheme}
        >
          {props.theme === 'dark' ? I.sun : I.moon}
        </button>
        <button
          className="btn btn-sm btn-ghost"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}
          title={`Density · ${props.density} (click to cycle)`}
          onClick={props.onCycleDensity}
        >
          {props.density.slice(0, 1).toUpperCase()}
        </button>
        <button className="btn btn-icon btn-ghost" title="More">
          {I.more}
        </button>
      </div>
    </header>
  );
}

function ProjectSwitcher(props: {
  project: Project | null;
  projects: Project[];
  onSelect: (p: Project) => void;
  onOpen: () => void;
  onDelete?: (p: Project) => void;
}) {
  const [open, setOpen] = useState(false);
  // Two-click confirm: first × click sets this to the project's path; second
  // click on the SAME × executes. Clicking anywhere else (or another row)
  // clears it. Avoids native confirm() per OGF UX rules.
  const [confirmingPath, setConfirmingPath] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  // Reset the confirm state whenever the dropdown closes — a stale red
  // 'remove?' button shouldn't be there next time the user opens it.
  useEffect(() => {
    if (!open) setConfirmingPath(null);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="proj-switch" onClick={() => setOpen((v) => !v)} title={props.project?.path}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="2" y="2" width="10" height="10" rx="2" fill="oklch(0.78 0.16 var(--accent-h) / 0.18)" stroke="oklch(0.78 0.16 var(--accent-h))" strokeWidth="1" />
          <circle cx="7" cy="7" r="2" fill="oklch(0.78 0.16 var(--accent-h))" />
        </svg>
        <span className="label">Project</span>
        <span className="name">{props.project?.name ?? 'none'}</span>
        <span className="caret">{I.caret}</span>
      </button>
      {open && (
        <div className="proj-dropdown">
          {props.projects.length === 0 && (
            <div className="proj-dropdown-empty">No recent projects</div>
          )}
          {props.projects.map((p) => {
            const confirming = confirmingPath === p.path;
            return (
              <div
                key={p.path}
                className={`proj-dropdown-item ${props.project?.path === p.path ? 'active' : ''}`}
                onClick={() => {
                  // Selecting a row also cancels any pending delete confirm.
                  setConfirmingPath(null);
                  props.onSelect(p);
                  setOpen(false);
                }}
                title={p.path}
              >
                <div className="proj-dropdown-row">
                  <div className="proj-dropdown-text">
                    <div className="proj-dropdown-name">{p.name}</div>
                    <div className="proj-dropdown-sub">
                      {p.engine} · {p.path}
                    </div>
                  </div>
                  {props.onDelete && (
                    <button
                      type="button"
                      className={`proj-dropdown-delete ${confirming ? 'confirming' : ''}`}
                      title={
                        confirming
                          ? 'Click again to confirm. Files on disk are NOT deleted.'
                          : 'Remove from OGF (files on disk are kept)'
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirming) {
                          props.onDelete!(p);
                          setConfirmingPath(null);
                        } else {
                          setConfirmingPath(p.path);
                        }
                      }}
                    >
                      {confirming ? 'remove?' : '×'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          <div className="proj-dropdown-divider" />
          <div
            className="proj-dropdown-item action"
            onClick={() => {
              props.onOpen();
              setOpen(false);
            }}
          >
            + Open folder…
          </div>
        </div>
      )}
    </div>
  );
}
