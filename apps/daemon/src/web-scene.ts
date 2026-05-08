// Web engine scene loader. A web project's "scene" is just a JSON level file
// like data/temple.json or data/level1.json. We translate that into the same
// SceneModel shape used by Godot scenes so the canvas editor + writers work
// without engine-specific frontend code.
//
// Schema (extra fields are tolerated):
//   {
//     "background": "assets/maps/X.png",
//     "mapSize":    { "width", "height" },
//     "spawn":      { "x", "y", "facing"? },        ← single point
//     "npc":        { "x", "y", ... }                 ← optional single point
//     "boss":       { "x", "y", ... }                 ← optional single point
//     "rest":       { "x", "y", "rx", "ry"? }        ← optional ellipse
//     "exits":      { "<id>": { "x", "y", ... } },
//     "zones":      { "<id>": { "x", "y", "w", "h" } },
//     "walkBounds": [ { "id", "type": "rect"|"ellipse", ... } ],
//     "blockers":   [ { "id", "type", ... } ],
//     "spawn_points": [ { "id", "x", "y" } ],
//     "props":      [ { "id", "image", "x", "y", "w", "h", "sortY"? } ]
//   }

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  ColliderRef,
  ColliderShape,
  LoadSceneResponse,
  SceneBackground,
  SceneCollider,
  SceneImagePayload,
  SceneLayer,
  SceneModel,
  ScenePath,
  SceneProp,
  SceneZone,
  Vec2,
} from '@ogf/contracts';

interface RectLike {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rx?: number;
  ry?: number;
  radius?: number;
  id?: string;
  type?: string;
  points?: [number, number][];
  [k: string]: unknown;
}

function safeJoin(rootAbs: string, rel: string): string {
  const abs = path.resolve(rootAbs, rel);
  const normRoot = path.resolve(rootAbs);
  if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) {
    throw new Error('path escapes project root');
  }
  return abs;
}

function readPngSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function inferShapeFromEntry(entry: RectLike): ColliderShape | null {
  if (entry.type === 'polygon' && Array.isArray(entry.points)) {
    return { kind: 'polygon', points: entry.points.map(([x, y]) => ({ x, y })) };
  }
  if (entry.type === 'ellipse' || entry.type === 'circle') {
    // Treat ellipse as circle using max radius for V1 (canvas can't render ellipse natively yet).
    const r = Math.max(Number(entry.rx ?? entry.radius ?? 0), Number(entry.ry ?? entry.radius ?? 0));
    if (r > 0) return { kind: 'circle', r };
  }
  if (typeof entry.w === 'number' && typeof entry.h === 'number') {
    return { kind: 'rect', w: entry.w, h: entry.h };
  }
  if (typeof entry.radius === 'number') {
    return { kind: 'circle', r: entry.radius };
  }
  return null;
}

/** Top-left {x,y} + rect size → center. Web JSONs typically store top-left. */
function entryCenterPosition(entry: RectLike): Vec2 {
  const x = Number(entry.x ?? 0);
  const y = Number(entry.y ?? 0);
  if (typeof entry.w === 'number' && typeof entry.h === 'number') {
    return { x: x + entry.w / 2, y: y + entry.h / 2 };
  }
  return { x, y };
}

const SINGLE_POINT_FIELDS = ['spawn', 'heroSpawn', 'playerSpawn', 'npc', 'boss', 'rest'] as const;

interface CollectImagesOpts {
  rootAbs: string;
  paths: Set<string>;
}

export function isWebLevelJson(content: string): boolean {
  try {
    const data = JSON.parse(content);
    if (!data || typeof data !== 'object') return false;
    // mapSize is the strongest signal of a level file.
    const sz = (data as Record<string, unknown>).mapSize as
      | { width?: unknown; height?: unknown }
      | undefined;
    return !!sz && typeof sz.width === 'number' && typeof sz.height === 'number';
  } catch {
    return false;
  }
}

export function loadWebLevel(rootAbs: string, relPath: string): LoadSceneResponse {
  const abs = safeJoin(rootAbs, relPath);
  if (!existsSync(abs)) throw new Error(`level not found: ${relPath}`);
  const text = readFileSync(abs, 'utf8');
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`level JSON parse error: ${err instanceof Error ? err.message : String(err)}`);
  }

  const props: SceneProp[] = [];
  const colliders: SceneCollider[] = [];
  const zones: SceneZone[] = [];
  const scenePaths: ScenePath[] = [];
  const referenced: Set<string> = new Set();
  const notes: string[] = [];
  let counter = 0;

  // mapSize is the level's declared world coordinate system. Both Scene
  // editor and Play tab agree on placing entities at coords in this
  // space. When the background PNG's natural size differs from mapSize
  // (skill output mismatch), we still want Scene editor to render the
  // bg at mapSize so entity positions align — same as what Play tab
  // does via canvas scaling. Pass mapSize through SceneBackground/Layer
  // width+height so the editor uses declared size, not PNG natural.
  const declaredMap =
    typeof data.mapSize === 'object' && data.mapSize
      ? {
          w: Number((data.mapSize as { width?: unknown }).width ?? 0),
          h: Number((data.mapSize as { height?: unknown }).height ?? 0),
        }
      : null;
  const mapW = declaredMap && declaredMap.w > 0 ? declaredMap.w : undefined;
  const mapH = declaredMap && declaredMap.h > 0 ? declaredMap.h : undefined;

  // ---- Background — single-image (TD / arena / locked-camera) ----
  let background: SceneBackground | null = null;
  const bgPath = typeof data.background === 'string' ? data.background : '';
  if (bgPath) {
    const bgRel = bgPath.replace(/^\.?\//, '');
    background = { relPath: bgRel, source: 'image', width: mapW, height: mapH };
    referenced.add(bgRel);
  } else {
    // background is an object — could be:
    //   { image: "..." }                 — single backdrop (TD / arena locked)
    //   { path: "..." } / { src: "..." } — common aliases when refactored from
    //                                       existing JS games whose code used
    //                                       different field names. We accept
    //                                       any of image/path/src as an
    //                                       alias for the same single-image
    //                                       intent.
    //   { tile: "...", tileW, tileH }    — repeated tile (arena-survivor /
    //                                       Vampire Survivors infinite floor)
    // arena-survivor.md genre guide writes the tile shape; without this
    // recognition, the loader saw a non-string `background` and emitted
    // "no background" warning, leaving Scene tab visually empty.
    const bgObj =
      (data.background as {
        image?: unknown;
        path?: unknown;
        src?: unknown;
        tile?: unknown;
        tileW?: unknown;
        tileH?: unknown;
      } | null) ?? null;
    const pickStr = (v: unknown) =>
      typeof v === 'string' ? v.replace(/^\.?\//, '') : '';
    const bgImg = pickStr(bgObj?.image) || pickStr(bgObj?.path) || pickStr(bgObj?.src);
    const bgTile = pickStr(bgObj?.tile);
    if (bgImg) {
      background = { relPath: bgImg, source: 'image', width: mapW, height: mapH };
      referenced.add(bgImg);
    } else if (bgTile) {
      const tileW = typeof bgObj?.tileW === 'number' ? (bgObj.tileW as number) : undefined;
      const tileH = typeof bgObj?.tileH === 'number' ? (bgObj.tileH as number) : undefined;
      background = {
        relPath: bgTile,
        source: 'tile',
        width: mapW,
        height: mapH,
        tileW,
        tileH,
      };
      referenced.add(bgTile);
    }
  }

  // ---- Layers — multi-image parallax (side-scrollers / scrolling cams) ----
  // When `layers: [...]` is present, the level uses parallax instead of a
  // single background. We render them stacked by zIndex (no real parallax
  // preview yet — just z-ordered). If both background and layers are
  // present, layers takes priority for visual rendering.
  let layers: SceneLayer[] | undefined;
  if (Array.isArray(data.layers)) {
    const arr = data.layers as Array<Record<string, unknown>>;
    const out: SceneLayer[] = [];
    arr.forEach((l, idx) => {
      const img =
        typeof l?.image === 'string' ? (l.image as string).replace(/^\.?\//, '') : '';
      if (!img) return;
      const id = String(l.id ?? `layer_${idx}`);
      const zIndex = typeof l.zIndex === 'number' ? l.zIndex : idx;
      const parallax = typeof l.parallax === 'number' ? (l.parallax as number) : undefined;
      // Layer-specific w/h override; otherwise use the level's mapSize.
      const layerW =
        typeof l.width === 'number' && (l.width as number) > 0
          ? (l.width as number)
          : mapW;
      const layerH =
        typeof l.height === 'number' && (l.height as number) > 0
          ? (l.height as number)
          : mapH;
      out.push({ id, relPath: img, zIndex, parallax, width: layerW, height: layerH });
      referenced.add(img);
    });
    if (out.length > 0) {
      // Sort by zIndex ascending — back-to-front render order
      out.sort((a, b) => a.zIndex - b.zIndex);
      layers = out;
      // If we have layers and no background, suppress the missing-bg warning
    }
  }

  if (!background && !layers) {
    notes.push(
      'No `background` or `layers[]` field on the level — add one so OGF can show the map underneath the markers.',
    );
  }

  // ---- Props ----
  // Sengoku-Era convention (and our Web standard): each prop's (x, y) is the
  // BOTTOM-CENTER anchor — y is the ground line. w / h are fixed display
  // pixel dimensions, independent of the texture's natural size.
  //
  // Image field accepted under multiple aliases (image / sprite / path /
  // src / texture, plus { sprite: { path } } object form) so refactored
  // projects with different naming conventions still render. Same alias
  // logic as background parser above + auto-detected arrays below — kept
  // inline because each parser had its own `if (!image) continue` guard
  // and lifting to a shared helper requires threading.
  function propImagePath(entry: RectLike): string | null {
    const trim = (s: string) => s.replace(/^\.?\//, '');
    for (const key of ['image', 'sprite', 'path', 'src', 'texture'] as const) {
      const v = (entry as Record<string, unknown>)[key];
      if (typeof v === 'string') return trim(v);
    }
    for (const key of ['image', 'sprite'] as const) {
      const v = (entry as Record<string, unknown>)[key];
      if (v && typeof v === 'object') {
        const obj = v as Record<string, unknown>;
        if (typeof obj.path === 'string') return trim(obj.path);
        if (typeof obj.image === 'string') return trim(obj.image);
      }
    }
    return null;
  }

  const rawProps = Array.isArray(data.props) ? (data.props as RectLike[]) : [];
  for (const p of rawProps) {
    const image = propImagePath(p);
    if (!image) continue;
    const id = String(p.id ?? `prop_${counter++}`);
    const x = Number(p.x ?? 0);
    const y = Number(p.y ?? 0);
    const w = Number(p.w ?? 0);
    const h = Number(p.h ?? 0);
    referenced.add(image);
    props.push({
      nodePath: `props/${id}`,
      name: id,
      // Drag handle = the JSON's (x, y) i.e. bottom-center / feet point.
      position: { x, y },
      // Visual center = (x, y - h/2). spriteOffset shifts up by h/2 so the
      // bounding box renders correctly above the drag handle.
      spriteOffset: { x: 0, y: -h / 2 },
      scale: { x: 1, y: 1 },
      texture: image,
      metadata: typeof p.sortY === 'number' ? { sortY: String(p.sortY) } : {},
      displaySize: { x: w, y: h },
      ref: { backend: 'json', relPath, section: 'props', id },
    });
  }

  // ---- Auto-detected visual entities in OTHER top-level arrays ----
  // platforms / pickups / hazards / decorations / etc. — anything Codex
  // chose to model as its own array (gameplay reasons) that ALSO carries
  // an `image` field. Without this loop, OGF would only see `props[]` and
  // a platformer's level would look almost empty in the Scenes tab.
  //
  // Anchor convention here is TOP-LEFT (matches collision-rect convention),
  // not bottom-center. Rationale: gameplay rects (platforms / hazards /
  // pickups) are authored from their collision corner; only handcrafted
  // 'props' get the bottom-center treatment because those are sprite-feet
  // anchored. The position field carries top-left raw; spriteOffset shifts
  // by (w/2, h/2) so the bbox center sits where propBounds expects.
  const HANDLED_ARRAYS = new Set([
    'props',
    'blockers',
    'colliders',         // ← collision rects, parsed as SceneCollider below
    'paths',             // ← path point sequences, parsed as ScenePath below
    'walkBounds',
    'spawn_points',
  ]);
  for (const [section, value] of Object.entries(data)) {
    if (HANDLED_ARRAYS.has(section)) continue;
    if (!Array.isArray(value)) continue;
    const arr = value as RectLike[];
    if (arr.length === 0) continue;

    // An entry is editable if it has at minimum a position + size rect.
    // Image is OPTIONAL — entries without image (e.g. platforms[] with
    // collision-only kind: 'earth_rampart') still render as outlined
    // rects so the user can drag and resize them. Otherwise platforms
    // would be invisible and uneditable.
    const editable = arr.filter(
      (e) =>
        typeof e?.x === 'number' &&
        typeof e?.y === 'number' &&
        typeof e?.w === 'number' &&
        typeof e?.h === 'number' &&
        Number(e.w) > 0 &&
        Number(e.h) > 0,
    );
    if (editable.length === 0) continue;
    if (editable.length * 2 < arr.length) continue;

    // Resolve `tile` reference against shared_platform_library (Schema v2).
    // Schema v2 adds first-class library entries (PlatformLibraryEntry).
    // Loader resolves the entry here so the SceneEditor renderer can do
    // proper three-piece composition (cap-L + tile-loop + cap-R) instead
    // of stretching a single image to fit. Falls back to `image` if the
    // platform doesn't reference a library entry.
    type LibPiece = { image?: string; naturalW?: number; naturalH?: number; tileW?: number; tileH?: number };
    type LibEntry = { left?: LibPiece; mid?: LibPiece; right?: LibPiece };
    const library =
      data.shared_platform_library && typeof data.shared_platform_library === 'object'
        ? (data.shared_platform_library as Record<string, LibEntry>)
        : null;

    function resolveLibraryEntry(tileKey: unknown): LibEntry | null {
      if (typeof tileKey !== 'string' || !library) return null;
      return library[tileKey] ?? null;
    }
    function buildTilePieces(entry: LibEntry | null) {
      if (!entry?.mid?.image) return undefined;
      const piece = (p: LibPiece | undefined) =>
        p?.image
          ? { image: p.image, naturalW: p.naturalW, naturalH: p.naturalH }
          : undefined;
      return {
        left: piece(entry.left),
        mid: {
          image: entry.mid.image,
          naturalW: entry.mid.naturalW,
          naturalH: entry.mid.naturalH,
          tileW: entry.mid.tileW,
          tileH: entry.mid.tileH,
        },
        right: piece(entry.right),
      };
    }

    // Same alias acceptance as background — refactored projects may use
    // sprite/path/src/texture instead of OGF's canonical 'image'. Without
    // this, refactored props render as red translucent rects (no
    // texture). String forms primarily; we also handle one common
    // object form (sprite: { path: '...' }) which appears in catalogs
    // when refactored from existing JS games.
    function pickImagePath(entry: RectLike): string | null {
      const trim = (s: string) => s.replace(/^\.?\//, '');
      for (const key of ['image', 'sprite', 'path', 'src', 'texture'] as const) {
        const v = (entry as Record<string, unknown>)[key];
        if (typeof v === 'string') return trim(v);
      }
      for (const key of ['image', 'sprite'] as const) {
        const v = (entry as Record<string, unknown>)[key];
        if (v && typeof v === 'object') {
          const obj = v as Record<string, unknown>;
          if (typeof obj.path === 'string') return trim(obj.path);
          if (typeof obj.image === 'string') return trim(obj.image);
        }
      }
      return null;
    }

    editable.forEach((p, idx) => {
      const direct = pickImagePath(p);
      const tileKey = (p as { tile?: unknown }).tile;
      const libEntry = direct ? null : resolveLibraryEntry(tileKey);
      const tilePieces = buildTilePieces(libEntry);
      // For renderMode: prefer the JSON-declared one; infer from tile usage
      // if the agent forgot to set it (treat tile + library as 'three-piece'
      // when caps exist, else 'tile').
      const declaredMode = (p as { renderMode?: string }).renderMode;
      const renderMode: 'tile' | 'three-piece' | 'natural' | undefined =
        declaredMode === 'tile' || declaredMode === 'three-piece' || declaredMode === 'natural'
          ? declaredMode
          : tilePieces
            ? tilePieces.left && tilePieces.right
              ? 'three-piece'
              : 'tile'
            : undefined;
      // Texture is the renderer's primary image — use the entry's mid as a
      // safe fallback so existing single-img branches still draw something.
      const image = direct ?? tilePieces?.mid.image ?? null;
      const w = Number(p.w);
      const h = Number(p.h);
      const id = String(p.id ?? `${section}_${idx}`);
      if (image) referenced.add(image);
      if (tilePieces?.left?.image) referenced.add(tilePieces.left.image);
      if (tilePieces?.right?.image) referenced.add(tilePieces.right.image);
      // Tag with the kind (when present) so the SceneEditor can show a
      // label on the outlined rect when there's no sprite.
      const meta: Record<string, string> = {};
      if (typeof p.sortY === 'number') meta.sortY = String(p.sortY);
      if (typeof p.kind === 'string') meta.kind = p.kind as string;
      if (typeof p.type === 'string') meta.type = p.type as string;
      props.push({
        nodePath: `${section}/${id}`,
        name: id,
        position: { x: Number(p.x), y: Number(p.y) },
        spriteOffset: { x: w / 2, y: h / 2 },
        scale: { x: 1, y: 1 },
        texture: image,
        metadata: meta,
        displaySize: { x: w, y: h },
        ref: { backend: 'json', relPath, section, id },
        renderMode,
        tilePieces,
      });
    });
  }

  // ---- Blockers (collision) ----
  const rawBlockers = Array.isArray(data.blockers) ? (data.blockers as RectLike[]) : [];
  rawBlockers.forEach((b, idx) => {
    const shape = inferShapeFromEntry(b);
    if (!shape) return;
    const id = String(b.id ?? `blocker_${idx}`);
    const ref: ColliderRef = {
      backend: 'json',
      relPath,
      section: 'blockers',
      id,
    };
    colliders.push({
      uid: `web:blockers:${id}`,
      ref,
      name: id,
      kind: 'blocker',
      position: entryCenterPosition(b),
      shape,
      editable: shape.kind !== 'polygon',
    });
  });

  // ---- Colliders (newer name; same SceneCollider shape) ----
  // Side-scrollers commonly have a `colliders[]` array semantically
  // distinct from `blockers[]`: each entry has type='platform' /
  // 'wall' / 'ceiling' / 'hazard'. We parse them with the entry's
  // type carried forward as `kind` so the editor can color-code by
  // role (platform tops vs hazard zones look different).
  const rawColliders = Array.isArray(data.colliders) ? (data.colliders as RectLike[]) : [];
  rawColliders.forEach((c, idx) => {
    const shape = inferShapeFromEntry(c);
    if (!shape) return;
    const id = String(c.id ?? `collider_${idx}`);
    const kind =
      typeof c.type === 'string'
        ? (c.type as string)
        : 'collider';
    const ref: ColliderRef = {
      backend: 'json',
      relPath,
      section: 'colliders',
      id,
    };
    colliders.push({
      uid: `web:colliders:${id}`,
      ref,
      name: id,
      kind,
      position: entryCenterPosition(c),
      shape,
      editable: shape.kind !== 'polygon',
    });
  });

  // ---- Paths (TD enemy routes / NPC patrols / bezier-like point sequences) ----
  // Tower-defense levels emit `paths: [{ id, points: [{x,y},...] }, ...]`.
  // Each becomes a ScenePath the editor renders as a draggable polyline.
  // Web JSON path coords are absolute world positions (not Path2D-style
  // node-local), so we set origin = (0,0) and pass points through verbatim.
  const rawPaths = Array.isArray(data.paths) ? (data.paths as Array<Record<string, unknown>>) : [];
  rawPaths.forEach((p, idx) => {
    const points = Array.isArray(p?.points) ? (p.points as Array<{ x?: unknown; y?: unknown }>) : [];
    if (points.length < 2) return; // a single-point "path" isn't a path
    const id = String(p.id ?? `path_${idx}`);
    scenePaths.push({
      uid: `web:paths:${id}`,
      ref: { backend: 'json', relPath, section: 'paths', id },
      name: id,
      origin: { x: 0, y: 0 },
      points: points
        .map((pt) => ({ x: Number(pt?.x ?? 0), y: Number(pt?.y ?? 0) }))
        .filter((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y)),
      hasBezierHandles: false,
      editable: true,
    });
  });

  // ---- WalkBounds (walkable areas — render as a special zone color) ----
  const rawWalkBounds = Array.isArray(data.walkBounds) ? (data.walkBounds as RectLike[]) : [];
  rawWalkBounds.forEach((b, idx) => {
    const shape = inferShapeFromEntry(b);
    if (!shape) return;
    const id = String(b.id ?? `walk_${idx}`);
    const ref: ColliderRef = {
      backend: 'json',
      relPath,
      section: 'walkBounds',
      id,
    };
    zones.push({
      uid: `web:walkBounds:${id}`,
      ref,
      name: id,
      zoneKind: 'unknown', // walkable areas — neutral purple
      position: entryCenterPosition(b),
      shape,
      fields: { kind: 'walkable' },
      editable: shape.kind !== 'polygon',
    });
  });

  // ---- Zones (named rect) ----
  const rawZones = isPlainObject(data.zones) ? (data.zones as Record<string, RectLike>) : null;
  if (rawZones) {
    for (const [id, z] of Object.entries(rawZones)) {
      const shape = inferShapeFromEntry(z);
      if (!shape) continue;
      const ref: ColliderRef = {
        backend: 'json',
        relPath,
        section: `zones.${id}`,
        id,
      };
      zones.push({
        uid: `web:zones:${id}`,
        ref,
        name: id,
        zoneKind: 'encounter',
        position: entryCenterPosition(z),
        shape,
        fields: {},
        editable: false, // dict-keyed zones need a dedicated writer (later)
      });
    }
  }

  // ---- Exits ----
  const rawExits = isPlainObject(data.exits) ? (data.exits as Record<string, RectLike>) : null;
  if (rawExits) {
    for (const [id, ex] of Object.entries(rawExits)) {
      const ref: ColliderRef = {
        backend: 'json',
        relPath,
        section: `exits.${id}`,
        id,
      };
      const targetField = typeof ex.target === 'string' ? ex.target : '';
      zones.push({
        uid: `web:exits:${id}`,
        ref,
        name: id,
        zoneKind: 'exit',
        position: { x: Number(ex.x ?? 0), y: Number(ex.y ?? 0) },
        shape: typeof ex.interactRadius === 'number'
          ? { kind: 'circle', r: Number(ex.interactRadius) }
          : { kind: 'point' },
        fields: targetField ? { target: targetField } : {},
        editable: false, // dict-keyed; needs dedicated writer later
      });
    }
  }

  // ---- Spawn points (array form) ----
  const rawSpawnPoints = Array.isArray(data.spawn_points)
    ? (data.spawn_points as RectLike[])
    : [];
  rawSpawnPoints.forEach((sp, idx) => {
    const id = String(sp.id ?? `spawn_${idx}`);
    const ref: ColliderRef = {
      backend: 'json',
      relPath,
      section: 'spawn_points',
      id,
    };
    zones.push({
      uid: `web:spawn_points:${id}`,
      ref,
      name: id,
      zoneKind: 'spawn',
      position: { x: Number(sp.x ?? 0), y: Number(sp.y ?? 0) },
      shape: { kind: 'point' },
      fields: typeof sp.facing === 'string' ? { facing: sp.facing } : {},
      editable: true,
    });
  });

  // ---- Single-point fields (spawn / npc / boss / hero / rest) ----
  for (const field of SINGLE_POINT_FIELDS) {
    const v = data[field];
    if (!isPlainObject(v)) continue;
    const o = v as RectLike;
    if (typeof o.x !== 'number' || typeof o.y !== 'number') continue;
    const shape = inferShapeFromEntry(o) ?? { kind: 'point' };
    const kind: SceneZone['zoneKind'] =
      field === 'spawn' || field === 'heroSpawn' || field === 'playerSpawn'
        ? 'spawn'
        : 'marker';
    const ref: ColliderRef = {
      backend: 'json',
      relPath,
      section: field,
      id: field,
      singleField: true,
    };
    const fields: Record<string, string | number> = {};
    if (typeof o.collisionRadius === 'number') fields.collisionRadius = o.collisionRadius as number;
    if (typeof o.interactRadius === 'number') fields.interactRadius = o.interactRadius as number;
    if (typeof o.facing === 'string') fields.facing = o.facing as string;
    zones.push({
      uid: `web:${field}`,
      ref,
      name: field,
      zoneKind: kind,
      position: { x: Number(o.x), y: Number(o.y) },
      shape,
      fields,
      editable: true,
    });
  }

  // ---- Image payloads ----
  const images: SceneImagePayload[] = collectImages({ rootAbs, paths: referenced });

  if (background) {
    const bgImg = images.find((i) => i.relPath === background!.relPath);
    if (bgImg) {
      background.width = bgImg.width;
      background.height = bgImg.height;
    } else {
      notes.push(
        `Background not found at ${background.relPath}. Make sure the image exists or update the level's "background" field.`,
      );
    }
  }

  const scene: SceneModel = {
    scenePath: relPath,
    rootName: typeof data.id === 'string' ? data.id : path.posix.basename(relPath, '.json'),
    background,
    layers,
    props,
    colliders,
    collidersJsonPath: relPath,
    zones,
    zonesJsonPath: relPath,
    paths: scenePaths,
    notes,
  };

  return { scene, images };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function collectImages(opts: CollectImagesOpts): SceneImagePayload[] {
  const out: SceneImagePayload[] = [];
  for (const rel of opts.paths) {
    const abs = path.join(opts.rootAbs, rel);
    if (!existsSync(abs)) continue;
    const buf = readFileSync(abs);
    const size = readPngSize(buf);
    out.push({
      relPath: rel,
      base64: buf.toString('base64'),
      width: size?.w ?? 0,
      height: size?.h ?? 0,
    });
  }
  return out;
}
