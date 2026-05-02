import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GodotDetectResponse } from '@ogf/contracts';
import {
  detectGodot,
  fetchActiveGodotRun,
  startGodot,
  stopGodot,
  subscribeGodotRun,
  type GodotStreamEvent,
} from '../lib/api.js';
import { I } from './icons.js';

interface Props {
  projectPath: string;
  /** Default scene from project.godot. */
  mainScene: string | null;
  /** Click an error line → jump to that .gd file at that line. */
  onJumpTo?: (relPath: string, line: number) => void;
}

interface ConsoleLine {
  id: number;
  channel: 'stdout' | 'stderr' | 'system';
  level: 'info' | 'warning' | 'error' | 'system';
  text: string;
  jump?: { relPath: string; line: number };
}

const RES_LINE_RE = /res:\/\/([^"\s)]+\.gd):(\d+)/i;
const MAX_LINES = 4000;

function classifyLine(channel: 'stdout' | 'stderr', text: string): ConsoleLine['level'] {
  if (/^\s*(SCRIPT\s+)?ERROR[:\s]/i.test(text)) return 'error';
  if (/^\s*WARNING[:\s]/i.test(text)) return 'warning';
  return channel === 'stderr' ? 'error' : 'info';
}

function parseJump(text: string): ConsoleLine['jump'] {
  const m = RES_LINE_RE.exec(text);
  if (!m) return undefined;
  return { relPath: m[1].replace(/\\/g, '/'), line: Number(m[2]) };
}

export function PlayPane(props: Props) {
  const [godot, setGodot] = useState<GodotDetectResponse | null>(null);
  const [godotLoading, setGodotLoading] = useState(true);
  const [runId, setRunId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState<'all' | 'errors'>('all');
  const lineCounterRef = useRef(0);
  const consoleRef = useRef<HTMLDivElement | null>(null);
  const stdoutBufferRef = useRef('');
  const stderrBufferRef = useRef('');
  const lastError = useMemo(
    () => [...lines].reverse().find((l) => l.level === 'error') ?? null,
    [lines],
  );

  // -------- Detect Godot on mount --------
  useEffect(() => {
    let cancelled = false;
    setGodotLoading(true);
    detectGodot()
      .then((r) => {
        if (!cancelled) setGodot(r);
      })
      .catch(() => {
        if (!cancelled) setGodot({ available: false });
      })
      .finally(() => {
        if (!cancelled) setGodotLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // -------- Reconnect to active run for this project on mount/project change --------
  useEffect(() => {
    let cancelled = false;
    fetchActiveGodotRun(props.projectPath)
      .then((r) => {
        if (cancelled || !r.runId) return;
        attachToRun(r.runId);
      })
      .catch(() => {
        // ignore
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.projectPath]);

  // -------- Auto-scroll --------
  useEffect(() => {
    if (!autoScroll) return;
    const el = consoleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, autoScroll]);

  function pushLine(line: Omit<ConsoleLine, 'id'>) {
    setLines((prev) => {
      const next = [...prev, { ...line, id: lineCounterRef.current++ }];
      if (next.length > MAX_LINES) next.splice(0, next.length - MAX_LINES);
      return next;
    });
  }

  /** Each chunk may contain partial lines. Buffer until \n. */
  function ingestChunk(channel: 'stdout' | 'stderr', chunk: string) {
    const bufRef = channel === 'stdout' ? stdoutBufferRef : stderrBufferRef;
    const combined = bufRef.current + chunk;
    const parts = combined.split(/\r?\n/);
    bufRef.current = parts.pop() ?? '';
    for (const text of parts) {
      if (text.length === 0) continue;
      pushLine({
        channel,
        level: classifyLine(channel, text),
        text,
        jump: parseJump(text),
      });
    }
  }

  function flushBuffers() {
    if (stdoutBufferRef.current) {
      pushLine({
        channel: 'stdout',
        level: classifyLine('stdout', stdoutBufferRef.current),
        text: stdoutBufferRef.current,
        jump: parseJump(stdoutBufferRef.current),
      });
      stdoutBufferRef.current = '';
    }
    if (stderrBufferRef.current) {
      pushLine({
        channel: 'stderr',
        level: classifyLine('stderr', stderrBufferRef.current),
        text: stderrBufferRef.current,
        jump: parseJump(stderrBufferRef.current),
      });
      stderrBufferRef.current = '';
    }
  }

  function attachToRun(id: string) {
    setRunId(id);
    setRunning(true);
    subscribeGodotRun(id, handleStreamEvent);
  }

  const handleStreamEvent = useCallback((e: GodotStreamEvent) => {
    if (e.type === 'stdout') {
      ingestChunk('stdout', e.data.chunk);
    } else if (e.type === 'stderr') {
      ingestChunk('stderr', e.data.chunk);
    } else if (e.type === 'start') {
      pushLine({
        channel: 'system',
        level: 'system',
        text: `▶ Godot started · ${(e.data as { bin?: string }).bin ?? ''}`,
      });
    } else if (e.type === 'error') {
      pushLine({
        channel: 'system',
        level: 'error',
        text: `× ${(e.data as { message?: string }).message ?? 'unknown error'}`,
      });
    } else if (e.type === 'end') {
      flushBuffers();
      const status = (e.data as { status?: string }).status ?? 'finished';
      pushLine({
        channel: 'system',
        level: status === 'succeeded' ? 'system' : 'error',
        text: `■ Godot ${status} (code=${(e.data as { code?: number | null }).code ?? '—'})`,
      });
      setRunning(false);
      setRunId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function play() {
    if (!godot?.available || running || !props.projectPath) return;
    setLines([]);
    lineCounterRef.current = 0;
    stdoutBufferRef.current = '';
    stderrBufferRef.current = '';
    try {
      const r = await startGodot({
        projectPath: props.projectPath,
        mainScene: props.mainScene ?? undefined,
      });
      attachToRun(r.runId);
    } catch (err) {
      pushLine({
        channel: 'system',
        level: 'error',
        text: `× could not start: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  async function stop() {
    if (!runId) return;
    await stopGodot(runId);
  }

  function clear() {
    setLines([]);
    lineCounterRef.current = 0;
  }

  function onScroll() {
    const el = consoleRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (autoScroll !== atBottom) setAutoScroll(atBottom);
  }

  const visibleLines = filter === 'errors'
    ? lines.filter((l) => l.level === 'error' || l.level === 'warning')
    : lines;

  // -------- Render --------

  if (godotLoading) {
    return (
      <div className="inspector">
        <div className="crumbs">
          <span className="last">Play</span>
        </div>
        <div className="play-empty muted">Detecting Godot…</div>
      </div>
    );
  }

  if (!godot?.available) {
    return (
      <div className="inspector">
        <div className="crumbs">
          <span className="last">Play</span>
          <span className="badge-dim" style={{ color: 'var(--red)' }}>godot not found</span>
        </div>
        <div className="play-empty">
          <div className="play-empty-card">
            <h3>Godot binary not detected</h3>
            <p className="muted">
              OGF looked on PATH and common Windows install locations but couldn't find a Godot
              executable. You can either:
            </p>
            <ol className="play-empty-list">
              <li>
                Set the <span className="kbd-inline">OGF_GODOT</span> environment variable to your
                Godot exe path, then restart the daemon
              </li>
              <li>
                Add Godot to your <span className="kbd-inline">PATH</span>
              </li>
              <li>
                Install Godot to a folder under <span className="kbd-inline">D:\</span> /{' '}
                <span className="kbd-inline">C:\</span> /{' '}
                <span className="kbd-inline">~\Downloads</span> with the default extracted layout
              </li>
            </ol>
            <button
              className="btn btn-sm"
              onClick={() => {
                setGodotLoading(true);
                detectGodot()
                  .then(setGodot)
                  .catch(() => setGodot({ available: false }))
                  .finally(() => setGodotLoading(false));
              }}
            >
              Re-check
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="inspector">
      <div className="crumbs">
        <span className="last">Play</span>
        <span className="badge-dim" title={godot.path}>
          {godot.version?.split('.').slice(0, 3).join('.')}
        </span>
        {props.mainScene && (
          <span className="badge-dim" style={{ color: 'var(--ink-2)' }}>
            {props.mainScene.split('/').pop()}
          </span>
        )}
        <span className="actions">
          <button
            className="btn btn-sm"
            data-active={filter === 'all'}
            onClick={() => setFilter('all')}
            title="Show all output"
          >
            all
          </button>
          <button
            className="btn btn-sm"
            data-active={filter === 'errors'}
            onClick={() => setFilter('errors')}
            title="Show errors and warnings only"
          >
            errors{lastError ? ' ●' : ''}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={clear} title="Clear output">
            clear
          </button>
          {running ? (
            <button
              className="btn btn-sm"
              style={{ color: 'var(--red)' }}
              onClick={() => void stop()}
              title="Stop Godot"
            >
              {I.stop} stop
            </button>
          ) : (
            <button
              className="btn btn-sm btn-primary"
              onClick={() => void play()}
              title="Run the project"
            >
              {I.play} play
            </button>
          )}
        </span>
      </div>
      <div ref={consoleRef} className="play-console" onScroll={onScroll}>
        {visibleLines.length === 0 ? (
          <div className="play-empty muted">
            {running ? 'Waiting for output…' : 'Press play to launch Godot.'}
          </div>
        ) : (
          visibleLines.map((l) => (
            <PlayLine
              key={l.id}
              line={l}
              onJumpTo={props.onJumpTo}
            />
          ))
        )}
      </div>
    </div>
  );
}

function PlayLine({
  line,
  onJumpTo,
}: {
  line: ConsoleLine;
  onJumpTo?: (relPath: string, line: number) => void;
}) {
  const cls = `play-line play-line-${line.level}`;
  if (!line.jump) {
    return <div className={cls}>{line.text}</div>;
  }
  // Render with the jump target as a clickable link.
  const m = RES_LINE_RE.exec(line.text);
  if (!m) return <div className={cls}>{line.text}</div>;
  const idx = line.text.indexOf(m[0]);
  return (
    <div className={cls}>
      {line.text.slice(0, idx)}
      <button
        className="play-jump"
        title={`Jump to ${line.jump.relPath}:${line.jump.line}`}
        onClick={() => onJumpTo?.(line.jump!.relPath, line.jump!.line)}
      >
        {m[0]}
      </button>
      {line.text.slice(idx + m[0].length)}
    </div>
  );
}
