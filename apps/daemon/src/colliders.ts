// Collider readers/writers for the two backends:
//   - .tscn StaticBody2D + CollisionShape2D + RectangleShape2D/CircleShape2D
//   - JSON sidecar (kindomrush style: blockers[] + buildZones[])
//
// Writers patch the source text to keep diffs minimal — for .tscn that means
// editing the SubResource body, for JSON it means line-targeted regex replace.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ColliderRef, SceneCollider, Vec2 } from '@ogf/contracts';
import {
  findBodyLine,
  formatVector2,
  parseTscn,
  parseVector2,
  joinTscn,
  readBodyValue,
  type ParsedTscn,
  type Section,
} from './tscn-parse.js';

const SHAPE_KINDS = new Set([
  'RectangleShape2D',
  'CircleShape2D',
  'ConvexPolygonShape2D',
  'CapsuleShape2D',
]);

/** Index sub_resources by id. */
function indexSubResources(parsed: ParsedTscn): Map<string, Section> {
  const out = new Map<string, Section>();
  for (const s of parsed.sections) {
    if (s.kind !== 'sub_resource') continue;
    const id = s.attrs.id;
    if (id) out.set(id, s);
  }
  return out;
}

/** Read the SubResource("X") id from a `shape = SubResource("X")` line. */
function parseSubResourceRef(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^SubResource\(\s*"([^"]+)"\s*\)/.exec(raw);
  return m ? m[1] : null;
}

/** Parse a Godot 4 PackedVector2Array(...) literal. */
function parsePackedVector2Array(raw: string | null): Vec2[] | null {
  if (!raw) return null;
  const m = /^PackedVector2Array\(\s*(.*)\)\s*$/s.exec(raw);
  if (!m) return null;
  const inner = m[1].trim();
  if (inner === '') return [];
  const nums = inner.split(/\s*,\s*/).map((x) => Number(x));
  if (nums.length % 2 !== 0 || nums.some((n) => Number.isNaN(n))) return null;
  const out: Vec2[] = [];
  for (let i = 0; i < nums.length; i += 2) out.push({ x: nums[i], y: nums[i + 1] });
  return out;
}

/** Read all colliders from a .tscn parse. */
export function readTscnColliders(parsed: ParsedTscn): SceneCollider[] {
  const subs = indexSubResources(parsed);
  const out: SceneCollider[] = [];
  let counter = 0;

  // Find every CollisionShape2D node — its parent is the body (StaticBody2D / Area2D).
  for (const csNode of parsed.sections) {
    if (csNode.kind !== 'node') continue;
    if (csNode.attrs.type !== 'CollisionShape2D') continue;
    const parentPath = csNode.attrs.parent;
    if (!parentPath || parentPath === '.') continue;

    // The parent body owns the position; CollisionShape2D itself usually has 0,0.
    const bodySection = parsed.sections.find(
      (s) => s.kind === 'node' && nodeKey(s) === parentPath,
    );
    // Skip Area2D — those are zones (Phase 3).
    if (!bodySection || bodySection.attrs.type === 'Area2D') continue;
    if (bodySection.attrs.type !== 'StaticBody2D') continue;

    const shapeRefId = parseSubResourceRef(readBodyValue(parsed, csNode, 'shape'));
    if (!shapeRefId) continue;
    const subResource = subs.get(shapeRefId);
    if (!subResource) continue;

    const position =
      parseVector2(readBodyValue(parsed, bodySection, 'position')) ?? { x: 0, y: 0 };

    const subType = subResource.attrs.type;
    if (!SHAPE_KINDS.has(subType)) continue;

    const kind = readKindMetadata(parsed, bodySection);
    const baseRef: ColliderRef = {
      backend: 'tscn',
      nodePath: parentPath,
      subResourceId: shapeRefId,
    };
    const uid = `tscn:${parentPath}:${counter++}`;

    if (subType === 'RectangleShape2D') {
      const size = parseVector2(readBodyValue(parsed, subResource, 'size')) ?? { x: 0, y: 0 };
      out.push({
        uid,
        ref: baseRef,
        name: bodySection.attrs.name ?? '',
        kind,
        position,
        shape: { kind: 'rect', w: size.x, h: size.y },
        editable: true,
      });
    } else if (subType === 'CircleShape2D') {
      const r = Number(readBodyValue(parsed, subResource, 'radius') ?? 0);
      out.push({
        uid,
        ref: baseRef,
        name: bodySection.attrs.name ?? '',
        kind,
        position,
        shape: { kind: 'circle', r },
        editable: true,
      });
    } else if (subType === 'ConvexPolygonShape2D') {
      const points = parsePackedVector2Array(readBodyValue(parsed, subResource, 'points')) ?? [];
      out.push({
        uid,
        ref: baseRef,
        name: bodySection.attrs.name ?? '',
        kind,
        position,
        shape: { kind: 'polygon', points },
        // Polygon point-edit is Phase 4.
        editable: false,
      });
    }
    // CapsuleShape2D handled later — render-only via fallback elsewhere if needed.
  }

  return out;
}

function nodeKey(s: Section): string {
  const name = s.attrs.name ?? '';
  const parent = s.attrs.parent;
  if (parent === undefined) return name;
  if (parent === '.') return name;
  return `${parent}/${name}`;
}

function readKindMetadata(parsed: ParsedTscn, section: Section): string {
  for (let i = section.headerLine + 1; i < section.endLine; i++) {
    const line = parsed.lines[i];
    const m = /^\s*metadata\/kind\s*=\s*"([^"]*)"/.exec(line);
    if (m) return m[1];
  }
  return '';
}

// ---------- Writer: .tscn ----------

export function writeTscnMoveCollider(
  parsed: ParsedTscn,
  ref: ColliderRef & { backend: 'tscn' },
  position: Vec2,
): void {
  const bodySection = parsed.sections.find(
    (s) => s.kind === 'node' && nodeKey(s) === ref.nodePath,
  );
  if (!bodySection) throw new Error(`tscn body not found: ${ref.nodePath}`);
  patchOrInsertBodyLine(parsed, bodySection, 'position', `Vector2(${formatTwo(position.x, position.y)})`);
}

export function writeTscnResizeRect(
  parsed: ParsedTscn,
  ref: ColliderRef & { backend: 'tscn' },
  w: number,
  h: number,
): void {
  // Marker case: shape size lives on the node body, not a SubResource.
  if (!ref.subResourceId && ref.markerSizeProperty) {
    const node = parsed.sections.find(
      (s) => s.kind === 'node' && nodeKey(s) === ref.nodePath,
    );
    if (!node) throw new Error(`tscn node not found: ${ref.nodePath}`);
    patchOrInsertBodyLine(
      parsed,
      node,
      ref.markerSizeProperty,
      `Vector2(${formatTwo(w, h)})`,
    );
    return;
  }
  const sub = parsed.sections.find(
    (s) => s.kind === 'sub_resource' && s.attrs.id === ref.subResourceId,
  );
  if (!sub) throw new Error(`sub_resource not found: ${ref.subResourceId}`);
  patchOrInsertBodyLine(parsed, sub, 'size', `Vector2(${formatTwo(w, h)})`);
}

export function writeTscnResizeCircle(
  parsed: ParsedTscn,
  ref: ColliderRef & { backend: 'tscn' },
  r: number,
): void {
  // Marker case: radius is a body property of the node.
  if (!ref.subResourceId && ref.markerRadiusProperty) {
    const node = parsed.sections.find(
      (s) => s.kind === 'node' && nodeKey(s) === ref.nodePath,
    );
    if (!node) throw new Error(`tscn node not found: ${ref.nodePath}`);
    patchOrInsertBodyLine(parsed, node, ref.markerRadiusProperty, formatNumber(r));
    return;
  }
  const sub = parsed.sections.find(
    (s) => s.kind === 'sub_resource' && s.attrs.id === ref.subResourceId,
  );
  if (!sub) throw new Error(`sub_resource not found: ${ref.subResourceId}`);
  patchOrInsertBodyLine(parsed, sub, 'radius', formatNumber(r));
}

function patchOrInsertBodyLine(parsed: ParsedTscn, section: Section, key: string, value: string): void {
  const newLine = `${key} = ${value}`;
  const idx = findBodyLine(parsed, section, key);
  if (idx >= 0) {
    parsed.lines[idx] = newLine;
  } else {
    parsed.lines.splice(section.headerLine + 1, 0, newLine);
    for (const s of parsed.sections) {
      if (s.headerLine > section.headerLine) {
        s.headerLine++;
        s.endLine++;
      } else if (s.headerLine === section.headerLine) {
        s.endLine++;
      }
    }
  }
}

function formatTwo(a: number, b: number): string {
  return `${formatNumber(a)}, ${formatNumber(b)}`;
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return Number.parseFloat(n.toFixed(6)).toString();
}

// ---------- JSON sidecar reader/writer ----------

const COLLISION_JSON_HINTS = ['-collision.json', '_collision.json', 'collision.json'];

export function findCollisionJsonPath(rootAbs: string, scenePath: string): string | null {
  // 1) Look for a sibling-named file: scenes/Foo.tscn ↔ data/foo-collision.json
  const baseName = path.basename(scenePath, path.extname(scenePath)).toLowerCase();
  const dataDir = path.join(rootAbs, 'data');
  if (existsSync(dataDir)) {
    let names: string[] = [];
    try {
      names = readdirSync(dataDir);
    } catch {
      names = [];
    }
    // First pass: name contains scene base
    for (const n of names) {
      const lower = n.toLowerCase();
      if (!COLLISION_JSON_HINTS.some((h) => lower.endsWith(h))) continue;
      if (lower.includes(baseName) || baseName.includes(lower.replace(/-collision\.json$/, ''))) {
        return path.posix.join('data', n);
      }
    }
    // Fallback: any *-collision.json
    for (const n of names) {
      const lower = n.toLowerCase();
      if (COLLISION_JSON_HINTS.some((h) => lower.endsWith(h))) return path.posix.join('data', n);
    }
  }
  return null;
}

interface JsonBlocker {
  id: string;
  type?: 'rect' | 'circle' | 'ellipse' | 'polygon';
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  radius?: number;
  rx?: number;
  ry?: number;
  points?: [number, number][];
}

interface CollisionJson {
  blockers?: JsonBlocker[];
  buildZones?: JsonBlocker[];
  walkBounds?: JsonBlocker[];
}

export function readJsonColliders(rootAbs: string, jsonRel: string): SceneCollider[] {
  const abs = path.join(rootAbs, jsonRel);
  if (!existsSync(abs)) return [];
  let parsed: CollisionJson;
  try {
    parsed = JSON.parse(readFileSync(abs, 'utf8'));
  } catch {
    return [];
  }
  const out: SceneCollider[] = [];

  function kindFor(sectionName: string): string {
    if (sectionName === 'buildZones') return 'buildzone';
    if (sectionName === 'walkBounds') return 'walkbound';
    return 'blocker';
  }

  function ingest(
    items: JsonBlocker[] | undefined,
    sectionName: 'blockers' | 'buildZones' | 'walkBounds',
  ) {
    if (!items) return;
    for (const b of items) {
      const ref: ColliderRef = {
        backend: 'json',
        relPath: jsonRel,
        section: sectionName,
        id: b.id,
      };
      const uid = `json:${sectionName}:${b.id}`;
      const kind = kindFor(sectionName);
      if (b.type === 'rect') {
        out.push({
          uid,
          ref,
          name: b.id,
          kind,
          position: { x: (b.x ?? 0) + (b.w ?? 0) / 2, y: (b.y ?? 0) + (b.h ?? 0) / 2 },
          shape: { kind: 'rect', w: b.w ?? 0, h: b.h ?? 0 },
          editable: true,
        });
      } else if (b.type === 'circle') {
        out.push({
          uid,
          ref,
          name: b.id,
          kind,
          position: { x: b.x ?? 0, y: b.y ?? 0 },
          shape: { kind: 'circle', r: b.radius ?? 0 },
          editable: true,
        });
      } else if (b.type === 'ellipse') {
        // V1: render and edit ellipses as a circle of max(rx, ry). Center
        // semantics match the JSON ({x, y} = center). Keep this in sync with
        // web-scene.ts inferShapeFromEntry — both readers must agree on the
        // shape mapping or applyJsonColliderEditForMove can't translate moves.
        const r = Math.max(Number(b.rx ?? b.radius ?? 0), Number(b.ry ?? b.radius ?? 0));
        out.push({
          uid,
          ref,
          name: b.id,
          kind,
          position: { x: b.x ?? 0, y: b.y ?? 0 },
          shape: { kind: 'circle', r },
          editable: true,
        });
      } else if (b.type === 'polygon') {
        const points = (b.points ?? []).map(([x, y]) => ({ x, y }));
        // Compute centroid as the polygon "position" for HUD readouts.
        const cx = points.reduce((a, p) => a + p.x, 0) / Math.max(1, points.length);
        const cy = points.reduce((a, p) => a + p.y, 0) / Math.max(1, points.length);
        out.push({
          uid,
          ref,
          name: b.id,
          kind,
          position: { x: cx, y: cy },
          shape: { kind: 'polygon', points },
          editable: false, // polygon edit = Phase 4
        });
      }
    }
  }

  ingest(parsed.blockers, 'blockers');
  ingest(parsed.buildZones, 'buildZones');
  ingest(parsed.walkBounds, 'walkBounds');
  return out;
}

/** Patch a top-level single-object field like `"heroSpawn": { "x": 760, "y": 520 }`.
 *  Used for fields that aren't part of an array. */
export function applyJsonSingleFieldEdit(
  rootAbs: string,
  ref: ColliderRef & { backend: 'json' },
  patch: { x?: number; y?: number },
): void {
  const abs = path.join(rootAbs, ref.relPath);
  const text = readFileSync(abs, 'utf8');
  const lines = text.split(/\r?\n/);

  const startRe = new RegExp(`"${escapeRe(ref.section)}"\\s*:\\s*\\{`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (startRe.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    throw new Error(`single-field "${ref.section}" not found in ${ref.relPath}`);
  }

  // Single-line case: `"heroSpawn": { "x": 760, "y": 520 }`
  if (lines[start].includes('}')) {
    let next = lines[start];
    for (const [k, v] of Object.entries(patch)) {
      if (typeof v !== 'number') continue;
      next = patchField(next, k, v);
    }
    lines[start] = next;
  } else {
    // Multi-line: walk until matching close brace.
    let depth = countChar(lines[start], '{') - countChar(lines[start], '}');
    for (let i = start + 1; i < lines.length && depth > 0; i++) {
      depth += countChar(lines[i], '{') - countChar(lines[i], '}');
      let next = lines[i];
      for (const [k, v] of Object.entries(patch)) {
        if (typeof v !== 'number') continue;
        next = patchField(next, k, v);
      }
      lines[i] = next;
      if (depth <= 0) break;
    }
  }

  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  writeFileSync(abs, lines.join(eol), 'utf8');
}

/** Patch a single collider/prop entry's fields in JSON text. Handles BOTH
 *  one-line entries (`{ "id": ..., "x": ..., ... }`) and pretty-printed
 *  multi-line objects. Walks the section's array, tracks brace depth per
 *  entry, finds the entry containing `"id": "<target>"`, then patches each
 *  field on whichever line carries it. */
export function applyJsonColliderEdit(
  rootAbs: string,
  ref: ColliderRef & { backend: 'json' },
  patch: { x?: number; y?: number; w?: number; h?: number; radius?: number },
): void {
  const abs = path.join(rootAbs, ref.relPath);
  const text = readFileSync(abs, 'utf8');
  const lines = text.split(/\r?\n/);

  const sectionRe = new RegExp(`"${escapeRe(ref.section)}"\\s*:\\s*\\[`);
  const idRe = new RegExp(`"id"\\s*:\\s*"${escapeRe(ref.id)}"`);

  // Phase 1: find the array open and scan section.
  let i = 0;
  while (i < lines.length && !sectionRe.test(lines[i])) i++;
  if (i >= lines.length) {
    throw new Error(`JSON section "${ref.section}" not found in ${ref.relPath}`);
  }
  // Track depth from the position the array opens. Stop when it closes.
  let arrDepth = countChar(lines[i], '[') - countChar(lines[i], ']');
  i++;

  // Phase 2: scan entries until we find the one with our id.
  let entryStart = -1;
  let entryDepth = 0;
  let updated = false;
  for (; i < lines.length && arrDepth > 0; i++) {
    const line = lines[i];
    arrDepth += countChar(line, '[') - countChar(line, ']');
    const opens = countChar(line, '{');
    const closes = countChar(line, '}');

    if (entryStart < 0) {
      // Outside an entry. An entry starts on the line the first '{' appears.
      if (opens > 0) {
        entryStart = i;
        entryDepth = opens - closes;
        // Single-line entry collapses immediately.
        if (entryDepth === 0) {
          if (idRe.test(line)) {
            lines[i] = applyPatchOnLines(lines, i, i, patch);
            updated = true;
            break;
          }
          entryStart = -1;
        }
      }
      continue;
    }

    // Inside an entry — accumulate depth.
    entryDepth += opens - closes;
    if (entryDepth <= 0) {
      const startIdx = entryStart;
      const endIdx = i;
      const slice = lines.slice(startIdx, endIdx + 1).join('\n');
      if (idRe.test(slice)) {
        const patched = applyPatchOnLines(lines, startIdx, endIdx, patch);
        // applyPatchOnLines mutates `lines` in-place and returns last touched
        // line; we don't need its return value for multi-line.
        void patched;
        updated = true;
        break;
      }
      entryStart = -1;
    }
  }

  if (!updated) {
    throw new Error(
      `JSON collider not found for patch: ${ref.section} id=${ref.id} (or already up-to-date)`,
    );
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  writeFileSync(abs, lines.join(eol), 'utf8');
}

/** Patch every named field across the inclusive line range [startIdx, endIdx].
 *  Each field may live on its own line (multi-line entry) or on the same line
 *  (compact entry). Returns the last patched line for caller convenience. */
function applyPatchOnLines(
  lines: string[],
  startIdx: number,
  endIdx: number,
  patch: { [k: string]: number | undefined },
): string {
  let last = lines[endIdx];
  for (let i = startIdx; i <= endIdx; i++) {
    let next = lines[i];
    for (const [k, v] of Object.entries(patch)) {
      if (typeof v !== 'number') continue;
      const re = new RegExp(`("${k}"\\s*:\\s*)(-?\\d+(?:\\.\\d+)?)`);
      if (re.test(next)) {
        next = next.replace(re, (_, lhs) => `${lhs}${formatNumber(v)}`);
      }
    }
    if (next !== lines[i]) {
      lines[i] = next;
      last = next;
    }
  }
  return last;
}

function patchField(line: string, field: string, value: number): string {
  const re = new RegExp(`("${field}"\\s*:\\s*)(-?\\d+(?:\\.\\d+)?)`);
  if (!re.test(line)) {
    // Field missing — insert just before the closing brace of this object
    return line.replace(/\}\s*,?\s*$/, (close) => `, "${field}": ${formatNumber(value)} ${close}`);
  }
  return line.replace(re, (_, lhs) => `${lhs}${formatNumber(value)}`);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countChar(s: string, c: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === c) n++;
  return n;
}

export { joinTscn, parseTscn };
