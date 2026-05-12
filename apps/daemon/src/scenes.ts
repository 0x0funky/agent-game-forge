import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  LoadSceneResponse,
  SceneBackground,
  SceneCollider,
  SceneImagePayload,
  SceneModel,
  SceneOp,
  SceneProp,
  SceneZone,
} from '@ogf/contracts';
import {
  applyJsonArrayEntryByIndex,
  applyJsonArrayEntryRemoveByIndex,
  applyJsonColliderEdit,
  applyJsonDictKeyedDelete,
  applyJsonDictKeyedEdit,
  applyJsonDictKeyedSet,
  applyJsonSingleFieldEdit,
  findCollisionJsonPath,
  isIndexId,
  readJsonColliders,
  readTscnColliders,
  writeTscnMoveCollider,
  writeTscnResizeCircle,
  writeTscnResizeRect,
} from './colliders.js';
import {
  findZonesJsonPath,
  readJsonPointMarkers,
  readJsonZones,
  readTscnZones,
} from './zones.js';
import { readTscnPaths, writeTscnMovePathPoint } from './paths.js';
import { isWebLevelJson, loadWebLevel } from './web-scene.js';
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

/** Look up an entry's default `size: {w, h}` from `data/<section>.json`.
 *  Mirrors web-scene.ts's catalog fallback — pickups/enemies often write
 *  level entries with only {type, x, y} because the runtime pulls size
 *  from the catalog. Returns null if the catalog or entry is missing or
 *  the size shape is malformed. Section must be one of the known catalog
 *  sections (hazards/pickups/enemies/items/projectiles/doors/checkpoints). */
const CATALOG_SECTIONS = new Set([
  'hazards',
  'pickups',
  'enemies',
  'items',
  'projectiles',
  'doors',
  'checkpoints',
]);
function readCatalogSize(
  rootAbs: string,
  section: string,
  typeId: string,
): { w: number; h: number } | null {
  if (!CATALOG_SECTIONS.has(section)) return null;
  try {
    const abs = safeJoin(rootAbs, `data/${section}.json`);
    if (!existsSync(abs)) return null;
    const parsed = JSON.parse(readFileSync(abs, 'utf8'));
    if (!Array.isArray(parsed)) return null;
    const hit = (parsed as Array<{ id?: unknown; size?: unknown }>).find(
      (c) => c?.id === typeId,
    );
    const sz = hit?.size;
    if (!sz || typeof sz !== 'object') return null;
    const w = Number((sz as { w?: unknown }).w);
    const h = Number((sz as { h?: unknown }).h);
    return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
      ? { w, h }
      : null;
  } catch {
    return null;
  }
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

/** Node types that count as "real editable content" — used to decide whether
 *  a scene is just a wrapper around an instanced sub-scene. */
const CONTENT_NODE_TYPES = new Set([
  'Sprite2D',
  'StaticBody2D',
  'Area2D',
  'Marker2D',
  'Path2D',
  'TileMapLayer',
]);

/** Node types that own a Transform2D and therefore contribute to a Sprite2D's
 *  world position when present in its ancestor chain. Anything not in this
 *  set (e.g. CanvasLayer, Node) doesn't move children spatially. */
const TRANSFORM2D_NODE_TYPES = new Set([
  'Node2D',
  'Sprite2D',
  'AnimatedSprite2D',
  'StaticBody2D',
  'CharacterBody2D',
  'RigidBody2D',
  'KinematicBody2D',
  'Area2D',
  'Marker2D',
  'Path2D',
  'PathFollow2D',
  'CollisionShape2D',
  'CollisionPolygon2D',
  'TileMapLayer',
  'TileMap',
  'Camera2D',
]);

/** Walk up the parent chain from a node, summing position vectors of every
 *  Transform2D-bearing ancestor. Returns the node's WORLD-SPACE position
 *  in the .tscn — what Godot would compose at runtime via the scene tree.
 *
 *  Stops at root ('.') or a non-Transform2D ancestor (e.g. CanvasLayer).
 *  Doesn't try to handle rotation / scale composition — pure position only,
 *  which is what 99% of game scenes need for OGF visualization. */
function worldPositionOf(
  parsed: ParsedTscn,
  nodes: { byPath: Map<string, ParsedTscn['sections'][number]> },
  nodePath: string,
): { x: number; y: number } {
  let cx = 0;
  let cy = 0;
  let cur: string | undefined = nodePath;
  // Cap the walk depth to avoid pathological loops in malformed scenes.
  for (let i = 0; i < 32 && cur; i++) {
    const section = nodes.byPath.get(cur);
    if (!section) break;
    const t = section.attrs.type ?? '';
    if (!TRANSFORM2D_NODE_TYPES.has(t)) break;
    const p = parseVector2(readBodyValue(parsed, section, 'position'));
    if (p) {
      cx += p.x;
      cy += p.y;
    }
    const parent = section.attrs.parent;
    if (!parent || parent === '.' || parent === '') break;
    cur = parent;
  }
  return { x: cx, y: cy };
}

/** When a scene has no Sprite2D/etc. of its own and just instances a
 *  PackedScene, redirect to the inner scene so OGF actually shows / edits
 *  the embedded content (e.g. Main.tscn → MapEdit.tscn). Recursively follows
 *  instance chains up to a small depth.
 *
 *  Returns the relPath that should actually be loaded. Returns the input
 *  unchanged when no redirect applies. */
function resolveActualScenePath(
  rootAbs: string,
  relPath: string,
  depth: number = 0,
): string {
  if (depth > 3) return relPath;
  const abs = safeJoin(rootAbs, relPath);
  if (!existsSync(abs)) return relPath;
  const parsed = parseTscn(readFileSync(abs, 'utf8'));

  // If this scene has any editable content of its own, don't redirect.
  const hasOwnContent = parsed.sections.some(
    (s) => s.kind === 'node' && CONTENT_NODE_TYPES.has(s.attrs.type ?? ''),
  );
  if (hasOwnContent) return relPath;

  // Otherwise look for the first PackedScene instance and follow it.
  const ext = indexExtResources(parsed);
  for (const s of parsed.sections) {
    if (s.kind !== 'node') continue;
    const inst = s.attrs.instance;
    if (!inst) continue;
    const m = /^ExtResource\(\s*"([^"]+)"\s*\)/.exec(inst);
    if (!m) continue;
    const ref = ext.get(m[1]);
    if (!ref || ref.type !== 'PackedScene') continue;
    const subRel = ref.path.startsWith('res://')
      ? ref.path.slice('res://'.length)
      : ref.path.replace(/\\/g, '/');
    return resolveActualScenePath(rootAbs, subRel, depth + 1);
  }

  return relPath;
}

export interface LoadOptions {
  rootAbs: string;
  relPath: string;
}

export function loadScene(opts: LoadOptions): LoadSceneResponse {
  // Web engine: a level is a JSON file. Dispatch to the web-scene loader.
  if (opts.relPath.toLowerCase().endsWith('.json')) {
    const abs = safeJoin(opts.rootAbs, opts.relPath);
    if (!existsSync(abs)) throw new Error(`level not found: ${opts.relPath}`);
    const probe = readFileSync(abs, 'utf8');
    if (isWebLevelJson(probe)) {
      return loadWebLevel(opts.rootAbs, opts.relPath);
    }
    throw new Error('JSON file is not a level (missing mapSize)');
  }

  // If the requested scene is just a wrapper that instances another scene,
  // follow the instance and load that one instead.
  const actualRelPath = resolveActualScenePath(opts.rootAbs, opts.relPath);
  const sceneAbs = safeJoin(opts.rootAbs, actualRelPath);
  if (!existsSync(sceneAbs)) throw new Error(`scene not found: ${opts.relPath}`);

  const text = readFileSync(sceneAbs, 'utf8');
  const parsed = parseTscn(text);
  const wasRedirected = actualRelPath !== opts.relPath;
  const ext = indexExtResources(parsed);
  const nodes = indexNodes(parsed);

  const props: SceneProp[] = [];
  const referencedTextures = new Set<string>();
  const notes: string[] = [];
  const seenNodePaths = new Set<string>();

  if (wasRedirected) {
    notes.push(
      `Showing content from ${actualRelPath} (instanced via ${opts.relPath}). Edits save to ${actualRelPath}.`,
    );
  }

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

  // ---- Pattern A: any Transform2D-bearing parent with exactly one Sprite2D
  // child. Covers the canonical Codex-generated structure — StaticBody2D /
  // CharacterBody2D / Area2D wrapping a Sprite2D + CollisionShape2D — as
  // well as the historic Node2D + Sprite2D pattern.
  // If a parent has many Sprite2D children, it's a grouping container —
  // let Pattern B handle each child individually.
  for (const [nodePath, section] of nodes.byPath) {
    if (!TRANSFORM2D_NODE_TYPES.has(section.attrs.type ?? '')) continue;
    if (section.attrs.type === 'Sprite2D') continue; // a Sprite2D itself isn't a wrapper

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

    // World position = parent's accumulated world transform. Sprite offset =
    // its local position relative to that parent. SceneEditor combines both
    // when drawing (position + spriteOffset = sprite anchor; anchor's role
    // depends on centered).
    const position = worldPositionOf(parsed, nodes, nodePath);
    const spriteOffset = parseVector2(readBodyValue(parsed, spriteSection, 'position')) ?? { x: 0, y: 0 };
    const scale = parseVector2(readBodyValue(parsed, spriteSection, 'scale')) ?? { x: 1, y: 1 };
    // Godot Sprite2D defaults to centered = true; only present in .tscn when
    // the user (or Codex) flipped it. When false, position is the TOP-LEFT
    // of the drawn sprite, not its center — propBounds switches anchor.
    const centeredRaw = readBodyValue(parsed, spriteSection, 'centered');
    const centered = centeredRaw === 'false' ? false : true;
    // z_index: render order. Default 0. Negative = behind. Read from the
    // SPRITE node itself (not the wrapper) — that's what Godot honors.
    const zIndex = parseInt(
      readBodyValue(parsed, spriteSection, 'z_index') ?? '0',
      10,
    );

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
      centered,
      zIndex,
    });
  }

  // ---- Pattern B: Sprite2D directly under a non-root parent (kindomrush style) ----
  // Skip the root-level Sprite2D — that's the baked map background.
  for (const [nodePath, section] of nodes.byPath) {
    if (section.attrs.type !== 'Sprite2D') continue;
    if (seenNodePaths.has(nodePath)) continue;

    // Skip Sprite2Ds that ARE the child of a Pattern-A wrapper (already counted).
    // Their parent attr looks like "X/Y" where X/Y is in seenNodePaths.
    const parent = section.attrs.parent;
    if (!parent || parent === '.' || parent === root) continue; // skip root-level / unparented
    if (seenNodePaths.has(parent)) continue;

    const texturePath = resolveTexture(section);
    if (!texturePath) continue;

    // World position = walk up parent chain summing transforms, then add
    // this Sprite2D's local position. Without this, deeply-nested sprites
    // (under Group / Layer / WrapperBody) get plotted at the origin.
    const position = worldPositionOf(parsed, nodes, nodePath);
    const scale = parseVector2(readBodyValue(parsed, section, 'scale')) ?? { x: 1, y: 1 };
    const centeredRaw = readBodyValue(parsed, section, 'centered');
    const centered = centeredRaw === 'false' ? false : true;
    const zIndex = parseInt(
      readBodyValue(parsed, section, 'z_index') ?? '0',
      10,
    );

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
      centered,
      zIndex,
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

  // ----- Colliders -----
  // Prefer .tscn-resident colliders. Fall back to JSON sidecar (kindomrush style).
  const tscnColliders: SceneCollider[] = readTscnColliders(parsed);
  let colliders: SceneCollider[] = tscnColliders;
  let collidersJsonPath: string | null = null;
  if (tscnColliders.length === 0) {
    const jsonRel = findCollisionJsonPath(opts.rootAbs, actualRelPath);
    if (jsonRel) {
      colliders = readJsonColliders(opts.rootAbs, jsonRel);
      collidersJsonPath = jsonRel;
    }
  } else {
    // If there's also a JSON sidecar, mention it so the user knows.
    const jsonRel = findCollisionJsonPath(opts.rootAbs, actualRelPath);
    if (jsonRel) {
      collidersJsonPath = jsonRel;
      notes.push(
        `A JSON collision sidecar exists at ${jsonRel} — edits go to the .tscn (the scene-tree source of truth).`,
      );
    }
  }

  // ----- Zones -----
  // Prefer .tscn-resident zones (Area2D / Marker2D). Fall back to JSON sidecar.
  const tscnZones: SceneZone[] = readTscnZones(parsed);
  let zones: SceneZone[] = tscnZones;
  let zonesJsonPath: string | null = null;
  if (tscnZones.length === 0) {
    const jsonRel = findZonesJsonPath(opts.rootAbs, actualRelPath);
    if (jsonRel) {
      zones = readJsonZones(opts.rootAbs, jsonRel);
      zonesJsonPath = jsonRel;
    }
  } else {
    const jsonRel = findZonesJsonPath(opts.rootAbs, actualRelPath);
    if (jsonRel) {
      zonesJsonPath = jsonRel;
      notes.push(
        `A JSON zones sidecar exists at ${jsonRel} — edits go to the .tscn (the scene-tree source of truth).`,
      );
    }
  }

  // ----- Point markers (heroSpawn / entrances / goals) -----
  // Often live inside the collision sidecar, sometimes the zones sidecar.
  // Always read both files and merge whatever's there into zones.
  const pointMarkerSeen = new Set<string>();
  const candidatePaths = [collidersJsonPath, zonesJsonPath].filter(
    (p): p is string => !!p,
  );
  for (const p of candidatePaths) {
    if (pointMarkerSeen.has(p)) continue;
    pointMarkerSeen.add(p);
    const markers = readJsonPointMarkers(opts.rootAbs, p);
    for (const m of markers) zones.push(m);
  }

  // ----- Paths -----
  const paths = readTscnPaths(parsed);

  const scene: SceneModel = {
    scenePath: opts.relPath,
    rootName,
    background,
    props,
    colliders,
    collidersJsonPath,
    zones,
    zonesJsonPath,
    paths,
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
  // Web scene: the relPath is a level JSON. Don't parseTscn — JSON is not a
  // TSCN file. Dispatch to the JSON-only writer.
  if (opts.relPath.toLowerCase().endsWith('.json')) {
    return applyOpsToJsonScene(opts);
  }

  // If the requested scene is a wrapper that instances another scene, edits
  // go to the inner scene — same redirect rule as loadScene.
  const actualRelPath = resolveActualScenePath(opts.rootAbs, opts.relPath);
  const sceneAbs = safeJoin(opts.rootAbs, actualRelPath);
  const text = readFileSync(sceneAbs, 'utf8');
  const parsed = parseTscn(text);
  const nodes = indexNodes(parsed);
  let tscnDirty = false;

  for (const op of opts.ops) {
    if (op.kind === 'move-prop') {
      // Web prop: ref points at a JSON entry. Patch x/y in the JSON file.
      if (op.ref?.backend === 'json') {
        applyJsonColliderEdit(opts.rootAbs, op.ref, {
          x: op.position.x,
          y: op.position.y,
        });
        continue;
      }
      const section = nodes.byPath.get(op.nodePath);
      if (!section) throw new Error(`node not found: ${op.nodePath}`);
      const newLine = `position = ${formatVector2(op.position)}`;
      const idx = findBodyLine(parsed, section, 'position');
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
      tscnDirty = true;
    } else if (op.kind === 'scale-prop') {
      // Find the Sprite2D node holding the visible scale.
      // Pattern A: Sprite2D child whose parent === op.nodePath
      // Pattern B: op.nodePath itself is a Sprite2D
      let target = parsed.sections.find(
        (s) =>
          s.kind === 'node' &&
          s.attrs.type === 'Sprite2D' &&
          s.attrs.parent === op.nodePath,
      );
      if (!target) {
        const own = nodes.byPath.get(op.nodePath);
        if (own && own.attrs.type === 'Sprite2D') target = own;
      }
      if (!target) throw new Error(`prop scale target not found: ${op.nodePath}`);
      const newLine = `scale = ${formatVector2(op.scale)}`;
      const idx = findBodyLine(parsed, target, 'scale');
      if (idx >= 0) {
        parsed.lines[idx] = newLine;
      } else {
        parsed.lines.splice(target.headerLine + 1, 0, newLine);
        for (const s of parsed.sections) {
          if (s.headerLine > target.headerLine) {
            s.headerLine++;
            s.endLine++;
          } else if (s.headerLine === target.headerLine) {
            s.endLine++;
          }
        }
      }
      tscnDirty = true;
    } else if (op.kind === 'move-collider') {
      if (op.ref.backend === 'tscn') {
        writeTscnMoveCollider(parsed, op.ref, op.position);
        tscnDirty = true;
      } else {
        applyJsonColliderEditForMove(opts.rootAbs, op.ref, op.position);
      }
    } else if (op.kind === 'resize-rect-collider') {
      const ref = op.ref;
      if (ref.backend === 'tscn') {
        writeTscnResizeRect(parsed, ref, op.w, op.h);
        tscnDirty = true;
      } else {
        // JSON rects store top-left, but the model exposes center. Preserve
        // the visual center across a resize so users don't see drift.
        const colliders = readJsonColliders(opts.rootAbs, ref.relPath);
        const target = colliders.find(
          (c) => c.ref.backend === 'json' && c.ref.id === ref.id,
        );
        if (!target || target.shape.kind !== 'rect') {
          throw new Error(`json rect collider not found: ${ref.id}`);
        }
        const tlx = target.position.x - op.w / 2;
        const tly = target.position.y - op.h / 2;
        applyJsonColliderEdit(opts.rootAbs, ref, { x: tlx, y: tly, w: op.w, h: op.h });
      }
    } else if (op.kind === 'resize-circle-collider') {
      if (op.ref.backend === 'tscn') {
        writeTscnResizeCircle(parsed, op.ref, op.r);
        tscnDirty = true;
      } else {
        applyJsonColliderEdit(opts.rootAbs, op.ref, { radius: op.r });
      }
    } else if (op.kind === 'move-path-point') {
      if (op.ref.backend !== 'tscn') {
        throw new Error('path point edit currently only supports .tscn paths');
      }
      writeTscnMovePathPoint(parsed, op.ref, op.index, op.position);
      tscnDirty = true;
    } else {
      throw new Error(`unsupported op kind: ${(op as { kind: string }).kind}`);
    }
  }

  if (tscnDirty) {
    const newText = joinTscn(parsed);
    writeFileSync(sceneAbs, newText, 'utf8');
    return { size: Buffer.byteLength(newText, 'utf8') };
  }
  return { size: Buffer.byteLength(text, 'utf8') };
}

/** Web-scene apply path. Operates only on JSON files; never touches .tscn.
 *  All ops MUST carry a json-backend `ref`; otherwise we can't know where to
 *  write. A missing ref usually means OGF was loaded against an older daemon
 *  that didn't attach refs — refresh the browser to re-fetch. */
function applyOpsToJsonScene(opts: ApplyOpsOptions): ApplyOpsResult {
  function requireJsonRef<T extends { ref?: { backend: string } }>(
    op: T,
    kind: string,
  ): asserts op is T & { ref: import('@ogf/contracts').ColliderRef & { backend: 'json' } } {
    if (!op.ref || op.ref.backend !== 'json') {
      throw new Error(
        `${kind} on a .json scene needs a json-backed ref (got '${op.ref?.backend ?? 'none'}'). ` +
          `Refresh OGF — the prop/collider was loaded before the JSON-ref upgrade.`,
      );
    }
  }

  for (const op of opts.ops) {
    if (op.kind === 'move-prop') {
      requireJsonRef(op, 'move-prop');
      applyJsonColliderEdit(opts.rootAbs, op.ref, {
        x: op.position.x,
        y: op.position.y,
      });
    } else if (op.kind === 'scale-prop') {
      requireJsonRef(op, 'scale-prop');
      // Web entries store size as (w, h), not a unit scale. Translate the
      // unit scale to a pixel size using the entry's CURRENT w/h. The entry
      // can live in any top-level array (props / platforms / pickups / ...);
      // op.ref.section tells us which.
      //
      // ALSO update x/y to preserve the visual CENTER across the resize.
      // The editor's prop-scale drag scales from the bbox center (top-left
      // moves outward), so the user expects the rect to grow symmetrically.
      // Without center-preserving x/y rewrite here, the JSON-stored top-left
      // stays put, the loader re-emits with scale=1, and the prop visually
      // jumps on the next reload (top-left fixed, growth now asymmetric).
      //
      // Catalog fallback: pickups/enemies often write {type, x, y} with no
      // w/h (runtime reads size from data/<section>.json). Look up the
      // current effective size from that catalog so the FIRST resize works
      // — without this the entry has no cur.w to multiply against and the
      // edit silently no-ops.
      const map = JSON.parse(
        readFileSync(safeJoin(opts.rootAbs, op.ref.relPath), 'utf8'),
      ) as Record<string, unknown>;
      const arr = map[op.ref.section];
      if (Array.isArray(arr)) {
        const cur = (arr as Array<{ id?: string; type?: string; x?: number; y?: number; w?: number; h?: number }>).find(
          (p) => p?.id === op.ref!.id,
        );
        let curW: number | undefined =
          typeof cur?.w === 'number' ? cur.w : undefined;
        let curH: number | undefined =
          typeof cur?.h === 'number' ? cur.h : undefined;
        if ((curW === undefined || curH === undefined) && cur?.type) {
          const sz = readCatalogSize(opts.rootAbs, op.ref.section, cur.type);
          if (sz) {
            curW = curW ?? sz.w;
            curH = curH ?? sz.h;
          }
        }
        if (cur && curW !== undefined && curH !== undefined) {
          const newW = curW * op.scale.x;
          const newH = curH * op.scale.y;
          const patch: Record<string, number> = { w: newW, h: newH };
          if (typeof cur.x === 'number') {
            const cx = cur.x + curW / 2;
            patch.x = cx - newW / 2;
          }
          if (typeof cur.y === 'number') {
            const cy = cur.y + curH / 2;
            patch.y = cy - newH / 2;
          }
          applyJsonColliderEdit(opts.rootAbs, op.ref, patch);
        }
      }
    } else if (op.kind === 'move-collider') {
      if (op.ref.backend !== 'json') {
        throw new Error(`move-collider on .json scene must use json ref`);
      }
      applyJsonColliderEditForMove(opts.rootAbs, op.ref, op.position);
    } else if (op.kind === 'resize-rect-collider') {
      if (op.ref.backend !== 'json') {
        throw new Error(`resize-rect-collider on .json scene must use json ref`);
      }
      const ref = op.ref;
      // Dict-keyed (zones.X / exits.X): preserve visual center across the
      // resize by reading current x/y/w/h, computing the old center, and
      // writing new top-left + size around that center.
      if (ref.section.includes('.')) {
        const dotIx = ref.section.indexOf('.');
        const parent = ref.section.slice(0, dotIx);
        const key = ref.section.slice(dotIx + 1);
        const abs = safeJoin(opts.rootAbs, ref.relPath);
        const json = JSON.parse(readFileSync(abs, 'utf8')) as Record<string, unknown>;
        const dict = json[parent];
        const entry =
          dict && typeof dict === 'object' && !Array.isArray(dict)
            ? ((dict as Record<string, unknown>)[key] as Record<string, unknown> | undefined)
            : undefined;
        const oldX = typeof entry?.x === 'number' ? (entry.x as number) : 0;
        const oldY = typeof entry?.y === 'number' ? (entry.y as number) : 0;
        const oldW = typeof entry?.w === 'number' ? (entry.w as number) : 0;
        const oldH = typeof entry?.h === 'number' ? (entry.h as number) : 0;
        const cx = oldX + oldW / 2;
        const cy = oldY + oldH / 2;
        applyJsonDictKeyedEdit(opts.rootAbs, ref, {
          x: cx - op.w / 2,
          y: cy - op.h / 2,
          w: op.w,
          h: op.h,
        });
      } else if (isIndexId(ref.id)) {
        // Sidecar entries (no `id` on disk) — addressed by array index.
        // Read current x/y/w/h to preserve visual center across resize.
        const abs = safeJoin(opts.rootAbs, ref.relPath);
        const json = JSON.parse(readFileSync(abs, 'utf8')) as Record<string, unknown>;
        const arr = Array.isArray(json[ref.section]) ? (json[ref.section] as unknown[]) : [];
        const idx = Number(ref.id.slice(3));
        const entry = (arr[idx] as Record<string, unknown> | undefined) ?? {};
        const oldX = typeof entry.x === 'number' ? (entry.x as number) : 0;
        const oldY = typeof entry.y === 'number' ? (entry.y as number) : 0;
        const oldW = typeof entry.w === 'number' ? (entry.w as number) : 0;
        const oldH = typeof entry.h === 'number' ? (entry.h as number) : 0;
        const cx = oldX + oldW / 2;
        const cy = oldY + oldH / 2;
        applyJsonArrayEntryByIndex(opts.rootAbs, ref, {
          x: cx - op.w / 2,
          y: cy - op.h / 2,
          w: op.w,
          h: op.h,
        });
      } else {
        const colliders = readJsonColliders(opts.rootAbs, ref.relPath);
        const target = colliders.find(
          (c) => c.ref.backend === 'json' && c.ref.id === ref.id,
        );
        if (target && target.shape.kind === 'rect') {
          const tlx = target.position.x - op.w / 2;
          const tly = target.position.y - op.h / 2;
          applyJsonColliderEdit(opts.rootAbs, ref, {
            x: tlx,
            y: tly,
            w: op.w,
            h: op.h,
          });
        }
      }
    } else if (op.kind === 'resize-circle-collider') {
      if (op.ref.backend !== 'json') {
        throw new Error(`resize-circle-collider on .json scene must use json ref`);
      }
      // Dict-keyed exits store circle as `interactRadius`, not `radius`.
      // Web-scene loader maps either field into shape.kind === 'circle'.
      // Write back via dict-keyed editor so we hit the right object key.
      if (op.ref.section.includes('.')) {
        applyJsonDictKeyedEdit(opts.rootAbs, op.ref, {
          radius: op.r,
          interactRadius: op.r,
        });
      } else if (isIndexId(op.ref.id)) {
        applyJsonArrayEntryByIndex(opts.rootAbs, op.ref, {
          radius: op.r,
          interactRadius: op.r,
        });
      } else {
        applyJsonColliderEdit(opts.rootAbs, op.ref, { radius: op.r });
      }
    } else if (op.kind === 'move-path-point') {
      if (op.ref.backend !== 'json') {
        throw new Error(`move-path-point on .json scene must use json ref`);
      }
      applyJsonPathPointEdit(opts.rootAbs, op.ref, op.index, op.position);
    } else if (op.kind === 'add-prop') {
      applyJsonArrayAppend(opts.rootAbs, op.relPath, op.section ?? 'props', op.entry);
    } else if (op.kind === 'remove-prop') {
      applyJsonArrayRemove(opts.rootAbs, op.relPath, op.section ?? 'props', op.id);
    } else if (op.kind === 'add-collider') {
      applyJsonArrayAppend(opts.rootAbs, op.relPath, op.section ?? 'blockers', op.entry);
    } else if (op.kind === 'remove-collider') {
      applyJsonArrayRemove(opts.rootAbs, op.relPath, op.section ?? 'blockers', op.id);
    } else if (op.kind === 'add-path') {
      applyJsonArrayAppend(opts.rootAbs, op.relPath, op.section ?? 'paths', op.entry);
    } else if (op.kind === 'remove-path') {
      applyJsonArrayRemove(opts.rootAbs, op.relPath, op.section ?? 'paths', op.id);
    } else if (op.kind === 'add-zone') {
      // Section "<parent>.<key>" → dict-keyed set; bare name → array append.
      if (op.section.includes('.')) {
        applyJsonDictKeyedSet(
          opts.rootAbs,
          { backend: 'json', relPath: op.relPath, section: op.section, id: '' },
          op.entry,
        );
      } else {
        // Sidecar walkBounds / walkable / blockers entries don't carry
        // `id` on disk — the loader assigns synthetic __i<n>. The undo of
        // a delete-zone arrives here with no id; use raw push (no dedup
        // check on undefined id, which would false-match every existing
        // id-less entry).
        applyJsonArrayPush(opts.rootAbs, op.relPath, op.section, op.entry);
      }
    } else if (op.kind === 'remove-zone') {
      if (op.section.includes('.')) {
        applyJsonDictKeyedDelete(opts.rootAbs, {
          backend: 'json',
          relPath: op.relPath,
          section: op.section,
          id: op.id,
        });
      } else {
        applyJsonArrayRemove(opts.rootAbs, op.relPath, op.section, op.id);
      }
    } else {
      throw new Error(
        `op '${(op as { kind: string }).kind}' not supported on .json scenes`,
      );
    }
  }

  const sceneAbs = safeJoin(opts.rootAbs, opts.relPath);
  return { size: existsSync(sceneAbs) ? statSync(sceneAbs).size : 0 };
}

/** Append an entry (any shape with an `id`) to `<relPath>[<section>]`.
 *  Creates the array if missing. Rejects duplicate ids. Whole-file JSON
 *  roundtrip — fine for level files (no comments, ~1-3KB typical).
 *  Used by add-prop, add-collider, and any future array-append op. */
function applyJsonArrayAppend(
  rootAbs: string,
  relPath: string,
  section: string,
  entry: { id: string } & Record<string, unknown>,
): void {
  const abs = safeJoin(rootAbs, relPath);
  const text = readFileSync(abs, 'utf8');
  const json = JSON.parse(text) as Record<string, unknown>;
  const arr = Array.isArray(json[section]) ? (json[section] as unknown[]) : [];
  for (const e of arr) {
    if (e && typeof e === 'object' && (e as { id?: string }).id === entry.id) {
      throw new Error(`add: id '${entry.id}' already exists in ${relPath}#${section}`);
    }
  }
  arr.push(entry);
  json[section] = arr;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  writeFileSync(abs, JSON.stringify(json, null, 2) + eol, 'utf8');
}

/** Push an entry to <relPath>[<section>] WITHOUT dedup-by-id checks.
 *  For sidecar arrays where entries don't have `id` (walkBounds polygons,
 *  walkable rects), the dedup logic in applyJsonArrayAppend would false-
 *  match every id-less entry against undefined and throw. Use this instead
 *  whenever the entry shape may legitimately omit `id`. */
function applyJsonArrayPush(
  rootAbs: string,
  relPath: string,
  section: string,
  entry: Record<string, unknown>,
): void {
  const abs = safeJoin(rootAbs, relPath);
  const text = readFileSync(abs, 'utf8');
  const json = JSON.parse(text) as Record<string, unknown>;
  const arr = Array.isArray(json[section]) ? (json[section] as unknown[]) : [];
  arr.push(entry);
  json[section] = arr;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  writeFileSync(abs, JSON.stringify(json, null, 2) + eol, 'utf8');
}

function applyJsonArrayRemove(
  rootAbs: string,
  relPath: string,
  section: string,
  id: string,
): void {
  const abs = safeJoin(rootAbs, relPath);
  const text = readFileSync(abs, 'utf8');
  const json = JSON.parse(text) as Record<string, unknown>;
  const arr = json[section];
  if (!Array.isArray(arr)) {
    throw new Error(`remove: section '${section}' is not an array in ${relPath}`);
  }
  // Index-addressed entry (synthetic id `__i<n>` from sidecar loader) —
  // splice by position. Otherwise filter by id field.
  if (isIndexId(id)) {
    const idx = Number(id.slice(3));
    if (idx < 0 || idx >= arr.length) {
      throw new Error(
        `remove: index ${idx} out of range in ${relPath}#${section} (len ${arr.length})`,
      );
    }
    arr.splice(idx, 1);
    json[section] = arr;
  } else {
    const before = arr.length;
    json[section] = (arr as Array<{ id?: string }>).filter((e) => e?.id !== id);
    if ((json[section] as unknown[]).length === before) {
      throw new Error(`remove: id '${id}' not found in ${relPath}#${section}`);
    }
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  writeFileSync(abs, JSON.stringify(json, null, 2) + eol, 'utf8');
}

/** Patch a single point inside `paths[id].points[index]` of a JSON
 *  level file. Used by the Scene editor when the user drags a path
 *  waypoint. Path data lives raw {x,y} (no center-conversion) so we
 *  just overwrite the indexed point.
 *
 *  This was missing before — the editor sent `move-path-point` ops
 *  but `applyOpsToJsonScene` only knew about props/colliders, so
 *  every drag on a path waypoint failed with 'op not supported on
 *  .json scenes'. */
function applyJsonPathPointEdit(
  rootAbs: string,
  ref: import('@ogf/contracts').ColliderRef & { backend: 'json' },
  pointIndex: number,
  position: { x: number; y: number },
): void {
  const abs = safeJoin(rootAbs, ref.relPath);
  const text = readFileSync(abs, 'utf8');
  const json = JSON.parse(text) as Record<string, unknown>;

  // ref.section is the array name carrying paths — usually 'paths', but
  // we tolerate older convention names too. Walk the section to find
  // the path with the matching id.
  const section = ref.section || 'paths';
  const arr = json[section];
  if (!Array.isArray(arr)) {
    throw new Error(`section '${section}' is not an array in ${ref.relPath}`);
  }
  const pathEntry = (arr as Array<{ id?: string; points?: Array<{ x?: number; y?: number }> }>)
    .find((p) => p?.id === ref.id);
  if (!pathEntry) {
    throw new Error(`path '${ref.id}' not found in ${ref.relPath}#${section}`);
  }
  if (!Array.isArray(pathEntry.points)) {
    throw new Error(`path '${ref.id}' has no points[] array`);
  }
  if (pointIndex < 0 || pointIndex >= pathEntry.points.length) {
    throw new Error(
      `point index ${pointIndex} out of range (path '${ref.id}' has ${pathEntry.points.length} points)`,
    );
  }

  const point = pathEntry.points[pointIndex] ?? {};
  point.x = position.x;
  point.y = position.y;
  pathEntry.points[pointIndex] = point;

  writeFileSync(abs, JSON.stringify(json, null, 2) + '\n', 'utf8');
}

/** JSON colliders store rects as top-left + (w,h) but our model uses center.
 *  Convert center-position back to top-left when writing. Also handles
 *  single-object fields (heroSpawn) and point-array entries (entrances /
 *  goals) which store {x,y} directly without center conversion.
 */
function applyJsonColliderEditForMove(
  rootAbs: string,
  ref: import('@ogf/contracts').ColliderRef & { backend: 'json' },
  centerPos: { x: number; y: number },
): void {
  // Single-object field (e.g. "heroSpawn": {x, y}) — patch directly.
  if (ref.singleField) {
    applyJsonSingleFieldEdit(rootAbs, ref, { x: centerPos.x, y: centerPos.y });
    return;
  }

  // Index-addressed sidecar entries (no `id` field on disk).
  // Determine center→top-left translation by reading current w/h.
  if (isIndexId(ref.id)) {
    const abs = safeJoin(rootAbs, ref.relPath);
    const json = JSON.parse(readFileSync(abs, 'utf8')) as Record<string, unknown>;
    const arr = Array.isArray(json[ref.section]) ? (json[ref.section] as unknown[]) : [];
    const idx = Number(ref.id.slice(3));
    const entry = (arr[idx] as Record<string, unknown> | undefined) ?? {};
    const w = typeof entry.w === 'number' ? (entry.w as number) : 0;
    const h = typeof entry.h === 'number' ? (entry.h as number) : 0;
    if (w > 0 && h > 0) {
      applyJsonArrayEntryByIndex(rootAbs, ref, {
        x: centerPos.x - w / 2,
        y: centerPos.y - h / 2,
      });
    } else {
      // Circle / point — write center directly. Polygon falls here too;
      // moving polygons is a TODO (would need to translate every point).
      applyJsonArrayEntryByIndex(rootAbs, ref, { x: centerPos.x, y: centerPos.y });
    }
    return;
  }

  // Dict-keyed sections like "zones.wild_grass" or "exits.to_boss" — the
  // entry sits at json[parent][key] and may carry x/y/w/h or just x/y +
  // interactRadius. Read the current entry to decide whether to translate
  // center→top-left (rect) or write x/y as-is (circle/point).
  // (rpg-gogogo, 2026: encounter zones were marked editable:false in the
  // loader because no dict-keyed writer existed — user couldn't drag the
  // grass encounter zone to align it with the map.)
  if (ref.section.includes('.')) {
    const dotIx = ref.section.indexOf('.');
    const parent = ref.section.slice(0, dotIx);
    const key = ref.section.slice(dotIx + 1);
    const abs = safeJoin(rootAbs, ref.relPath);
    const json = JSON.parse(readFileSync(abs, 'utf8')) as Record<string, unknown>;
    const dict = json[parent];
    const entry =
      dict && typeof dict === 'object' && !Array.isArray(dict)
        ? ((dict as Record<string, unknown>)[key] as Record<string, unknown> | undefined)
        : undefined;
    const w = typeof entry?.w === 'number' ? (entry.w as number) : 0;
    const h = typeof entry?.h === 'number' ? (entry.h as number) : 0;
    if (w > 0 && h > 0) {
      // Rect — same top-left convention as blockers. Translate center back.
      applyJsonDictKeyedEdit(rootAbs, ref, {
        x: centerPos.x - w / 2,
        y: centerPos.y - h / 2,
      });
    } else {
      // Point or circle — center IS the stored position.
      applyJsonDictKeyedEdit(rootAbs, ref, { x: centerPos.x, y: centerPos.y });
    }
    return;
  }

  // Point-array entries (entrances / goals / similar) store {x,y} as-is —
  // no center conversion. Their section names sit outside the
  // blockers/buildZones reader, so they won't show up in readJsonColliders.
  const POINT_ARRAY_SECTIONS = new Set(['entrances', 'goals', 'spawn_points']);
  if (POINT_ARRAY_SECTIONS.has(ref.section)) {
    applyJsonColliderEdit(rootAbs, ref, { x: centerPos.x, y: centerPos.y });
    return;
  }

  // We need the current shape to know whether to translate center→tl (rect) or pass through (circle/polygon).
  // Re-read from disk; cheap.
  const colliders = readJsonColliders(rootAbs, ref.relPath);
  const target = colliders.find((c) => c.ref.backend === 'json' && c.ref.id === ref.id);
  if (!target) throw new Error(`json collider not found: ${ref.id}`);

  if (target.shape.kind === 'rect') {
    const tlx = centerPos.x - target.shape.w / 2;
    const tly = centerPos.y - target.shape.h / 2;
    applyJsonColliderEdit(rootAbs, ref, { x: tlx, y: tly });
  } else if (target.shape.kind === 'circle') {
    applyJsonColliderEdit(rootAbs, ref, { x: centerPos.x, y: centerPos.y });
  } else {
    // Polygon move = translate all points; Phase 4 territory.
    throw new Error('polygon move not yet supported');
  }
}
