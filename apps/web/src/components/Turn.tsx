import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Block, ToolFamily, ToolItem } from '../lib/blocks.js';
import { buildTurn, extractFileChanges, summarizeGroup } from '../lib/blocks.js';
import type { AgentEvent } from '@ogf/contracts';
import { I } from './icons.js';

export type TurnStatus = 'streaming' | 'done' | 'failed' | 'canceled';

export interface TurnProps {
  userText: string;
  events: AgentEvent[];
  status: TurnStatus;
  startedAt: number;
  endedAt?: number;
  error?: string;
}

export function Turn(props: TurnProps) {
  const built = buildTurn(props.events);
  const elapsed = formatElapsed(
    Math.max(0, (props.endedAt ?? Date.now()) - props.startedAt),
  );

  return (
    <>
      <div className="msg-user">{props.userText}</div>

      <div className="msg-agent">
        {built.blocks.length === 0 && props.status === 'streaming' && (
          <div className="agent-thinking">
            <span className="dot-pulse" />
            <span>Thinking…</span>
          </div>
        )}

        {built.blocks.map((b, i) => (
          <BlockView key={i} block={b} streaming={props.status === 'streaming'} />
        ))}

        {props.status === 'streaming' && built.blocks.length > 0 && (
          <span className="stream-cursor" />
        )}

        {props.error && (
          <div className="msg-sys err">
            {I.warn} {props.error}
          </div>
        )}

        <TurnFooter
          status={props.status}
          elapsed={elapsed}
          usage={built.footer.usage}
        />
      </div>
    </>
  );
}

function BlockView({ block, streaming }: { block: Block; streaming: boolean }) {
  if (block.kind === 'text') {
    return (
      <div className="md-block">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // External links open in new tab; in-product links could later resolve to files
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
            // Single-line `code` stays inline; fenced blocks become a styled pre
            code: ({ className, children, ...rest }) => {
              const isBlock = !!className;
              if (isBlock) {
                return (
                  <pre className="md-pre">
                    <code className={className} {...rest}>
                      {children}
                    </code>
                  </pre>
                );
              }
              return <code {...rest}>{children}</code>;
            },
          }}
        >
          {block.text}
        </ReactMarkdown>
      </div>
    );
  }
  return <ToolGroup family={block.family} items={block.items} streaming={streaming} />;
}

function ToolGroup({
  family,
  items,
  streaming,
}: {
  family: ToolFamily;
  items: ToolItem[];
  streaming: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isRunning = streaming && items.some((it) => it.output === undefined);
  const summary = summarizeGroup({ family, items });
  const ico = familyIconClass(family);
  const icoEl = familyIconEl(family);

  return (
    <div className="tool-card" data-open={open} data-running={isRunning ? 'true' : 'false'}>
      <div className="tool-head" onClick={() => setOpen((v) => !v)}>
        <span className={`ico ${ico}`}>{icoEl}</span>
        <span className="name">{toolHeadName(family, items)}</span>
        <span className="arg">{summary}</span>
        <span className="dur">
          {isRunning ? <span style={{ color: 'var(--accent)' }}>running…</span> : `${items.length} item${items.length === 1 ? '' : 's'}`}
        </span>
        <span className="twirl">{I.caretRight}</span>
      </div>
      <div className="tool-body">
        {items.map((it) => (
          <ToolDetail key={it.id} item={it} />
        ))}
      </div>
    </div>
  );
}

function ToolDetail({ item }: { item: ToolItem }) {
  if (item.family === 'edit') {
    const changes = extractFileChanges(item);
    return (
      <div>
        <span className="label">Files</span>
        {changes.length > 0 ? (
          <ul className="file-list">
            {changes.map((c, i) => (
              <li key={i} className={`file-row file-${c.kind}`}>
                <span className="file-kind">{kindLabel(c.kind)}</span>
                <code title={c.path}>{shortPath(c.path)}</code>
              </li>
            ))}
          </ul>
        ) : (
          <pre>(no changes recorded)</pre>
        )}
      </div>
    );
  }

  if (item.family === 'shell') {
    const command = String((item.input as { command?: unknown })?.command ?? '');
    return (
      <div>
        <span className="label">Command</span>
        <pre>{command}</pre>
        {item.output !== undefined && (
          <>
            <span className="label">{item.isError ? 'Error' : 'Output'}</span>
            <pre className={item.isError ? 'err' : ''}>{item.output || '(empty)'}</pre>
          </>
        )}
      </div>
    );
  }

  if (item.family === 'thinking') {
    const text = String((item.input as { text?: unknown })?.text ?? '');
    return (
      <div>
        <pre style={{ fontStyle: 'italic', opacity: 0.85 }}>{text}</pre>
      </div>
    );
  }

  return (
    <div>
      <pre>{JSON.stringify(item.input, null, 2)}</pre>
      {item.output !== undefined && (
        <pre className={item.isError ? 'err' : ''}>{item.output}</pre>
      )}
    </div>
  );
}

function TurnFooter(props: {
  status: TurnStatus;
  elapsed: string;
  usage?: { input?: number; output?: number; cachedRead?: number };
}) {
  const labelMap: Record<TurnStatus, string> = {
    streaming: 'Working…',
    done: 'Done',
    failed: 'Failed',
    canceled: 'Stopped',
  };
  const dotClass = props.status === 'streaming' ? 'dot-pulse' : `dot-${props.status}`;

  return (
    <div className="turn-footer">
      <span className={dotClass} />
      <span className="turn-state">{labelMap[props.status]}</span>
      <span className="turn-sep">·</span>
      <span>{props.elapsed}</span>
      {props.usage && (
        <>
          <span className="turn-sep">·</span>
          <span title={`cached ${props.usage.cachedRead ?? 0}`}>
            {(props.usage.input ?? 0).toLocaleString()} in / {(props.usage.output ?? 0).toLocaleString()} out
          </span>
        </>
      )}
    </div>
  );
}

/* ---------- helpers ---------- */

function familyIconClass(f: ToolFamily): string {
  if (f === 'edit') return 'edit';
  if (f === 'shell') return 'bash';
  if (f === 'thinking') return 'view';
  return 'gen';
}

function familyIconEl(f: ToolFamily) {
  if (f === 'edit') return I.edit;
  if (f === 'shell') return I.bash;
  if (f === 'thinking') return I.spark;
  return I.image;
}

function toolHeadName(f: ToolFamily, items: ToolItem[]): string {
  if (f === 'edit') return 'edit_file';
  if (f === 'shell') return 'bash';
  if (f === 'thinking') return 'thinking';
  if (items.length > 0) return items[0].name.toLowerCase();
  return 'tool';
}

function kindLabel(kind: string): string {
  if (kind === 'add') return 'add';
  if (kind === 'delete') return 'del';
  return 'edit';
}

function shortPath(p: string): string {
  if (!p) return '';
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 3) return parts.join('/');
  return '…/' + parts.slice(-2).join('/');
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s - m * 60);
  return `${m}m ${sec}s`;
}
