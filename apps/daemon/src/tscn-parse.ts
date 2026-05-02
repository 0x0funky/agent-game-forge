// Minimal Godot .tscn parser. Line-aware so writers can patch a single property
// without losing whitespace, comments, or property ordering.

export type SectionKind =
  | 'header'        // [gd_scene ...]
  | 'ext_resource'
  | 'sub_resource'
  | 'node'
  | 'connection'
  | 'editable'
  | 'unknown';

export interface Section {
  kind: SectionKind;
  /** key=value pairs from the header line (values are unquoted strings). */
  attrs: Record<string, string>;
  /** Index of the header line in `lines`. */
  headerLine: number;
  /** Exclusive end index — header included, body lines = [headerLine+1, endLine). */
  endLine: number;
}

export interface ParsedTscn {
  /** Raw source lines (no trailing \n). Length === number of lines. */
  lines: string[];
  /** Trailing newline preserved verbatim ("" if file had none). */
  trailingNewline: string;
  /** Original line ending used in the file. */
  eol: '\n' | '\r\n';
  sections: Section[];
}

const HEADER_RE = /^\[(gd_scene|ext_resource|sub_resource|node|connection|editable)\b([^\]]*)\]\s*$/;
const ANY_HEADER_RE = /^\[[^\]]+\]\s*$/;

export function parseTscn(text: string): ParsedTscn {
  const eol: '\n' | '\r\n' = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(eol);
  // If the file ended with \n, split leaves an empty trailing element. Track that
  // so writers can reattach it without mutating other lines.
  const trailingNewline = text.endsWith(eol) ? eol : '';
  if (trailingNewline) lines.pop();

  const sections: Section[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = HEADER_RE.exec(line);
    if (m) {
      const raw = m[1];
      const kind: SectionKind = raw === 'gd_scene' ? 'header' : (raw as SectionKind);
      const attrs = parseHeaderAttrs(m[2] ?? '');
      // body extends until the next [header] line or EOF
      let j = i + 1;
      while (j < lines.length && !ANY_HEADER_RE.test(lines[j])) j++;
      sections.push({ kind, attrs, headerLine: i, endLine: j });
      i = j;
    } else {
      i++;
    }
  }

  return { lines, trailingNewline, eol, sections };
}

/** Parse `key="value" key=value key=123` from a header attribute string. */
function parseHeaderAttrs(attrText: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Tokenize by hand so quoted strings keep spaces.
  const re = /([A-Za-z_][\w-]*)=(?:"((?:[^"\\]|\\.)*)"|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrText))) {
    const key = m[1];
    const quoted = m[2];
    const bare = m[3];
    out[key] = quoted !== undefined ? unescapeQuoted(quoted) : bare;
  }
  return out;
}

function unescapeQuoted(s: string): string {
  return s.replace(/\\(.)/g, (_, c) => c);
}

/** Find a property line `key = ...` inside a section's body. Returns the absolute line index, or -1. */
export function findBodyLine(parsed: ParsedTscn, section: Section, key: string): number {
  const lhs = `${key} =`;
  const lhsAlt = `${key}=`;
  for (let i = section.headerLine + 1; i < section.endLine; i++) {
    const line = parsed.lines[i];
    const trimmed = line.trimStart();
    if (trimmed.startsWith(lhs) || trimmed.startsWith(lhsAlt)) return i;
  }
  return -1;
}

/** Read a body property's right-hand side as raw text (trimmed). */
export function readBodyValue(parsed: ParsedTscn, section: Section, key: string): string | null {
  const idx = findBodyLine(parsed, section, key);
  if (idx < 0) return null;
  const line = parsed.lines[idx];
  const eq = line.indexOf('=');
  return eq < 0 ? null : line.slice(eq + 1).trim();
}

export function joinTscn(parsed: ParsedTscn): string {
  return parsed.lines.join(parsed.eol) + parsed.trailingNewline;
}

// ---------- Value parsers ----------

export function parseVector2(raw: string | null): { x: number; y: number } | null {
  if (!raw) return null;
  const m = /^Vector2\(\s*(-?[\d.eE+-]+)\s*,\s*(-?[\d.eE+-]+)\s*\)/.exec(raw);
  if (!m) return null;
  return { x: Number(m[1]), y: Number(m[2]) };
}

export function formatVector2(v: { x: number; y: number }): string {
  // Match Godot's serializer: integers stay integers, floats keep precision.
  return `Vector2(${formatNumber(v.x)}, ${formatNumber(v.y)})`;
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  // Trim trailing zeros while preserving precision.
  return Number.parseFloat(n.toFixed(6)).toString();
}

export function parseExtResourceRef(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^ExtResource\(\s*"([^"]+)"\s*\)/.exec(raw);
  return m ? m[1] : null;
}

/** Map ext_resource id → resolved info. */
export interface ExtResource {
  id: string;
  type: string;
  /** As written in the file, e.g. "res://assets/foo.png" or absolute. */
  path: string;
}

export function indexExtResources(parsed: ParsedTscn): Map<string, ExtResource> {
  const out = new Map<string, ExtResource>();
  for (const s of parsed.sections) {
    if (s.kind !== 'ext_resource') continue;
    const id = s.attrs.id;
    const path = s.attrs.path;
    const type = s.attrs.type ?? '';
    if (id && path) out.set(id, { id, type, path });
  }
  return out;
}
