import type { AgentEvent } from '@ogf/contracts';

export type ToolFamily = 'edit' | 'shell' | 'thinking' | 'other';

export interface ToolItem {
  id: string;
  name: string;
  family: ToolFamily;
  input: unknown;
  output?: string;
  isError?: boolean;
}

export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'tool-group'; family: ToolFamily; items: ToolItem[] };

export interface TurnFooter {
  usage?: { input?: number; output?: number; cachedRead?: number };
  errors: string[];
}

export interface BuiltTurn {
  blocks: Block[];
  footer: TurnFooter;
}

export function familyOf(name: string): ToolFamily {
  if (name === 'Edit' || name === 'Write') return 'edit';
  if (name === 'Bash') return 'shell';
  if (name === 'Thinking') return 'thinking';
  return 'other';
}

/**
 * Walk an agent's event stream and collapse it into renderable blocks.
 * - Consecutive `text_delta` -> one text block
 * - Consecutive same-family `tool_use` -> one tool-group
 * - `tool_result` is matched back onto the last matching tool_use across all blocks
 * - status: initializing/running are dropped; usage goes to footer
 */
export function buildTurn(events: AgentEvent[]): BuiltTurn {
  const blocks: Block[] = [];
  const footer: TurnFooter = { errors: [] };

  let textBuf = '';
  let group: { family: ToolFamily; items: ToolItem[] } | null = null;

  function flushText() {
    if (textBuf.length > 0) {
      blocks.push({ kind: 'text', text: textBuf });
      textBuf = '';
    }
  }
  function flushGroup() {
    if (group) {
      blocks.push({ kind: 'tool-group', family: group.family, items: group.items });
      group = null;
    }
  }

  function attachResult(toolUseId: string, content: string, isError: boolean) {
    if (group) {
      for (let i = group.items.length - 1; i >= 0; i--) {
        if (group.items[i].id === toolUseId) {
          group.items[i].output = content;
          group.items[i].isError = isError;
          return;
        }
      }
    }
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (b.kind === 'tool-group') {
        for (let j = b.items.length - 1; j >= 0; j--) {
          if (b.items[j].id === toolUseId) {
            b.items[j].output = content;
            b.items[j].isError = isError;
            return;
          }
        }
      }
    }
  }

  for (const ev of events) {
    switch (ev.type) {
      case 'text_delta':
        flushGroup();
        textBuf += ev.delta;
        break;

      case 'tool_use': {
        flushText();
        const family = familyOf(ev.name);
        const item: ToolItem = {
          id: ev.id,
          name: ev.name,
          family,
          input: ev.input,
        };
        if (group && group.family === family) {
          group.items.push(item);
        } else {
          flushGroup();
          group = { family, items: [item] };
        }
        break;
      }

      case 'tool_result':
        attachResult(ev.toolUseId, ev.content, ev.isError);
        break;

      case 'usage':
        footer.usage = ev.usage;
        break;

      case 'status':
        // initializing / running / thinking: drop. Footer reflects state instead.
        break;

      case 'raw':
        break;
    }
  }

  flushText();
  flushGroup();

  return { blocks, footer };
}

/* ---------- Tool-group display helpers ---------- */

export interface FileChange {
  path: string;
  kind: 'add' | 'modify' | 'delete' | string;
}

export function extractFileChanges(item: ToolItem): FileChange[] {
  const input = item.input as { changes?: FileChange[] } | undefined;
  if (input && Array.isArray(input.changes)) return input.changes;
  return [];
}

export function summarizeGroup(group: { family: ToolFamily; items: ToolItem[] }): string {
  const total = group.items.length;
  const allDone = group.items.every((it) => it.output !== undefined);
  const anyError = group.items.some((it) => it.isError);
  const stateLabel = !allDone ? '…' : anyError ? 'Failed' : 'Done';

  if (group.family === 'edit') {
    let added = 0;
    let modified = 0;
    let deleted = 0;
    for (const it of group.items) {
      for (const ch of extractFileChanges(it)) {
        if (ch.kind === 'add') added++;
        else if (ch.kind === 'delete') deleted++;
        else modified++;
      }
    }
    const parts: string[] = [];
    if (added) parts.push(`${added} added`);
    if (modified) parts.push(`${modified} modified`);
    if (deleted) parts.push(`${deleted} deleted`);
    const summary = parts.join(', ') || `${total} change${total === 1 ? '' : 's'}`;
    return `${summary} · ${stateLabel}`;
  }

  if (group.family === 'shell') {
    if (total === 1) {
      const cmd = String((group.items[0].input as { command?: unknown })?.command ?? '');
      const shown = cmd.length > 60 ? cmd.slice(0, 60) + '…' : cmd;
      return `Ran \`${shown}\` · ${stateLabel}`;
    }
    return `Ran ${total} command${total === 1 ? '' : 's'} · ${stateLabel}`;
  }

  if (group.family === 'thinking') {
    return `Thought · ${total} step${total === 1 ? '' : 's'}`;
  }

  return `${group.items[0].name} ×${total} · ${stateLabel}`;
}
