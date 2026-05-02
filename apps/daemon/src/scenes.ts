import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  LoadSceneResponse,
  SceneBackground,
  SceneImagePayload,
  SceneModel,
  SceneOp,
  SceneProp,
} from '@ogf/contracts';
import {
  findBodyLine,
  formatVector2,
  indexExtResources,
  joinTscn,
  parseExtResourceRef,
  parseTscn,
  parseVector2,
  readBodyValue,
  type ParsedTscn,
  type Section,
} from './tscn-parse.js';

/** Resolve a Godot-style "res://..." path to a project-relative POSIX path. */
function resResolve(godotPath: string): string {
  if (godotPath.startsWith('res://')) return godotPath.slice('res://'.length);
  return godotPath.replace(/\\/g, '/');
}

function safeJoin(rootAbs: string, rel: string): string {
  const abs = path.resolve(rootAbs, rel);
  const normRoot = path.resolve(rootAbs);
  if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) {
    throw new Error('path escapes project root');
  }
  return abs;
}

interface NodeIndex {
  byPath: Map<string, Section>; // "Parent/Name"
  rootSection: Section | null;
}

function indexNodes(parsed: ParsedTscn): NodeIndex {
  const out: NodeIndex = { byPath: new Map(), rootSection: null };
  for (const s of parsed.sections) {
    if (s.kind !== 'node') continue;
    const name = s.attrs.name;
    const parent = s.attrs.parent;
    if (!name) continue;
    if (parent === undefined) {
      // The very first node (root) often has no `parent` attr in Godot 4.
      // Index it under just the name.
      out.byPath.set(name, s);
      if (!out.rootSection) out.rootSection = s;
      continue;
    }
    if (parent === '.') {
      out.byPath.set(name, s);
      continue;
    }
    out.byPath.set(`${parent}/${name}`, s);
  }
  return out;
}

/** Read PNG width/height from the IHDR chunk (bytes 16..23, big-endian uint32). */
function readPngSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24) return null;
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] !== 0x89 ||
    buf[1] !== 0x50 ||
    buf[2] !== 0x4e ||
    buf[3] !== 0x47
  ) {
    return null;
  }
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const PREVIEW_HINTS = ['layered-preview', 'baked-map', 'basemap', 'base-map'];

/** Pick a background image from the project: scan likely directories for a preview PNG. */
function findBackgroundImage(rootAbs: string): string | null {
  const candidates = [
    'assets/map',
    'assets/maps',
    'assets/background',
    'assets',
  ];
  for (const dir of candidates) {
    const abs = path.join(rootAbs, dir);
    if (!existsSync(abs)) continue;
    let entries: string[] = [];
    try {
      entries = readdirNoThrow(abs);
    } catch {
      continue;
    }
    // First pass: any "*-layered-preview.png" or similar hint
    for (const name of entries) {
      const lower = name.toLowerCase();
      if (!lower.endsWith('.png')) continue;
      if (PREVIEW_HINTS.some((h) => lower.includes(h))) {
        return path.posix.join(dir, name);
      }
    }
    // Second pass: largest PNG in the dir (likely the map)
    let best: { rel: string; size: number } | null = null;
    for (const name of entries) {
      if (!name.toLowerCase().endsWith('.png')) continue;
      try {
        const st = statSync(path.join(abs, name));
        if (!best || st.size > best.size) best = { rel: path.posix.join(dir, name), size: st.size };
      } catch {
        // ignore
      }
    }
    if (best) return best.rel;
  }
  return null;
}

function readdirNoThrow(p: string): string[] {
  return readdirSync(p);
}

/** Find the root node's name (its node path, used to identify "directly under root"). */
function rootNodeName(parsed: ParsedTscn): string | null {
  for (const s of parsed.sections) {
    if (s.kind === 'node' && s.attrs.parent === undefined) return s.attrs.name ?? null;
  }
  return null;
}

export interface LoadOptions {
  rootAbs: string;
  relPath: string;
}

export function loadScene(opts: LoadOptions): LoadSceneResponse {
  const sceneAbs = safeJoin(opts.rootAbs, opts.relPath);
  if (!existsSync(sceneAbs)) throw new Error(`scene not found: ${opts.relPath}`);

  const text = readFileSync(sceneAbs, 'utf8');
  const parsed = parseTscn(text);
  const ext = indexExtResources(parsed);
  const nodes = indexNodes(parsed);

  const props: SceneProp[] = [];
  const referencedTextures = new Set<string>();
  const notes: string[] = [];
  const seenNodePaths = new Set<string>();

  const root = rootNodeName(parsed);

  function readMetadata(section: Section): Record<string, string> {
    const out: Record<string, string> = {};
    for (let i = section.headerLine + 1; i < section.endLine; i++) {
      const line = parsed.lines[i];
      const m = /^\s*metadata\/([\w-]+)\s*=\s*(.+)$/.exec(line);
      if (m) {
        const v = m[2].trim();
        out[m[1]] = v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v;
      }
    }
    return out;
  }

  function resolveTexture(spriteSection: Section): string | null {
    const id = parseExtResourceRef(readBodyValue(parsed, spriteSection, 'texture'));
    if (!id) return null;
    const r = ext.get(id);
    if (!r) return null;
    return resResolve(r.path);
  }

  // ---- Pattern A: Node2D wrapper with exactly one Sprite2D child ----
  // (skill_generatemap_test style: tree_north_1 / Sprite2D pair)
  // If a Node2D has many Sprite2D children, it's a grouping container — let
  // Pattern B handle each child as its own prop.
  for (const [nodePath, section] of nodes.byPath) {
    if (section.attrs.type !== 'Node2D') continue;

    const children = parsed.sections.filter(
      (s) =>
        s.kind === 'node' &&
        s.attrs.type === 'Sprite2D' &&
        s.attrs.parent === nodePath,
    );
    if (children.length !== 1) continue;
    const spriteSection = children[0];
    const texturePath = resolveTexture(spriteSection);
    if (!texturePath) continue;

    const position = parseVector2(readBodyValue(parsed, section, 'position')) ?? { x: 0, y: 0 };
    const spriteOffset = parseVector2(readBodyValue(parsed, spriteSection, 'position')) ?? { x: 0, y: 0 };
    const scale = parseVector2(readBodyValue(parsed, spriteSection, 'scale')) ?? { x: 1, y: 1 };

    referencedTextures.add(texturePath);
    seenNodePaths.add(nodePath);
    props.push({
      nodePath,
      name: section.attrs.name,
      position,
      spriteOffset,
      scale,
      texture: texturePath,
      metadata: readMetadata(section),
    });
  }

  // ---- Pattern B: Sprite2D directly under a non-root parent (kindomrush style) ----
  // Skip the root-level Sprite2D — that's the baked map background.
  for (const [nodePath, section] of nodes.byPath) {
    if (section.attrs.type !== 'Sprite2D') continue;
    if (seenNodePaths.has(nodePath)) continue;

    // Skip Sprite2Ds that ARE the child of a Pattern-A Node2D (already counted).
    // Their parent attr looks like "X/Y" where X/Y is in seenNodePaths.
    const parent = section.attrs.parent;
    if (!parent || parent === '.' || parent === root) continue; // skip root-level / unparented
    if (seenNodePaths.has(parent)) continue;

    const texturePath = resolveTexture(section);
    if (!texturePath) continue;

    const position = parseVector2(readBodyValue(parsed, section, 'position')) ?? { x: 0, y: 0 };
    const scale = parseVector2(readBodyValue(parsed, section, 'scale')) ?? { x: 1, y: 1 };

    referencedTextures.add(texturePath);
    seenNodePaths.add(nodePath);
    props.push({
      nodePath,
      name: section.attrs.name,
      position,
      spriteOffset: { x: 0, y: 0 },
      scale,
      texture: texturePath,
      metadata: readMetadata(section),
    });
  }

  // ----- Background -----
  let background: SceneBackground | null = null;

  // Heuristic 1: a top-level Sprite2D directly under root with a large texture
  // (kindomrush-style baked map). Treat any Sprite2D whose parent is "." as
  // background candidate.
  const bakedBgSection = parsed.sections.find(
    (s) => s.kind === 'node' && s.attrs.type === 'Sprite2D' && s.attrs.parent === '.',
  );
  if (bakedBgSection) {
    const texId = parseExtResourceRef(readBodyValue(parsed, bakedBgSection, 'texture'));
    const rel = texId ? resResolve(ext.get(texId)?.path ?? '') : null;
    if (rel) {
      background = { relPath: rel, source: 'image' };
      referencedTextures.add(rel);
    }
  }

  // Heuristic 2: TileMapLayer present → look for a preview image side-by-side.
  const hasTileMap = parsed.sections.some(
    (s) => s.kind === 'node' && s.attrs.type === 'TileMapLayer',
  );
  if (!background && hasTileMap) {
    const preview = findBackgroundImage(opts.rootAbs);
    if (preview) {
      background = { relPath: preview, source: 'tilemap-preview' };
      referencedTextures.add(preview);
      notes.push(
        'TileMap layers are shown via a preview image. Direct tile painting is coming in a later phase.',
      );
    } else {
      notes.push('TileMap detected but no preview image found.');
    }
  }

  // Heuristic 3: still nothing → look anywhere for a likely map PNG.
  if (!background) {
    const fallback = findBackgroundImage(opts.rootAbs);
    if (fallback) {
      background = { relPath: fallback, source: 'image' };
      referencedTextures.add(fallback);
    }
  }

  // ----- Image payloads -----
  const images: SceneImagePayload[] = [];
  for (const rel of referencedTextures) {
    const abs = path.join(opts.rootAbs, rel);
    if (!existsSync(abs)) continue;
    const buf = readFileSync(abs);
    const size = readPngSize(buf);
    images.push({
      relPath: rel,
      base64: buf.toString('base64'),
      width: size?.w ?? 0,
      height: size?.h ?? 0,
    });
  }

  if (background) {
    const bgImg = images.find((i) => i.relPath === background!.relPath);
    if (bgImg) {
      background.width = bgImg.width;
      background.height = bgImg.height;
    }
  }

  const rootName = nodes.rootSection?.attrs.name ?? path.posix.basename(opts.relPath);

  const scene: SceneModel = {
    scenePath: opts.relPath,
    rootName,
    background,
    props,
    notes,
  };

  return { scene, images };
}

// ---------- Writer ----------

export interface ApplyOpsOptions {
  rootAbs: string;
  relPath: string;
  ops: SceneOp[];
}

export interface ApplyOpsResult {
  size: number;
}

export function applyOps(opts: ApplyOpsOptions): ApplyOpsResult {
  const sceneAbs = safeJoin(opts.rootAbs, opts.relPath);
  const text = readFileSync(sceneAbs, 'utf8');
  const parsed = parseTscn(text);
  const nodes = indexNodes(parsed);

  for (const op of opts.ops) {
    if (op.kind === 'move-prop') {
      const section = nodes.byPath.get(op.nodePath);
      if (!section) throw new Error(`node not found: ${op.nodePath}`);
      const newLine = `position = ${formatVector2(op.position)}`;
      const idx = findBodyLine(parsed, section, 'position');
      if (idx >= 0) {
        parsed.lines[idx] = newLine;
      } else {
        // Insert as the first body line after the header.
        parsed.lines.splice(section.headerLine + 1, 0, newLine);
        // Shift any sections after this one by 1.
        for (const s of parsed.sections) {
          if (s.headerLine > section.headerLine) {
            s.headerLine++;
            s.endLine++;
          } else if (s.headerLine === section.headerLine) {
            s.endLine++;
          }
        }
      }
    } else {
      throw new Error(`unsupported op kind: ${(op as { kind: string }).kind}`);
    }
  }

  const newText = joinTscn(parsed);
  writeFileSync(sceneAbs, newText, 'utf8');
  return { size: Buffer.byteLength(newText, 'utf8') };
}
