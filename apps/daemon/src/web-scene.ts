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

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

/** Section names that have a 1:1 catalog file under `data/<section>.json`.
 *  Matches the convention in side-scroll seed's `src/catalogs.js` — agent
 *  may add more (e.g. weapons) but these are the universal set. */
const CATALOG_SECTIONS = new Set([
  'hazards',
  'pickups',
  'enemies',
  'items',
  'projectiles',
  'doors',
  'checkpoints',
]);

interface CatalogEntry {
  id?: unknown;
  sprite?: unknown;
  animations?: Record<string, unknown>;
  [k: string]: unknown;
}

/** Read a section's catalog file (e.g. data/hazards.json) once per loader
 *  call. Returns null if the file is missing or malformed — call sites
 *  should fall back to their non-catalog defaults. */
function loadCatalogForSection(
  rootAbs: string,
  section: string,
): CatalogEntry[] | null {
  if (!CATALOG_SECTIONS.has(section)) return null;
  try {
    const abs = safeJoin(rootAbs, `data/${section}.json`);
    if (!existsSync(abs)) return null;
    const parsed = JSON.parse(readFileSync(abs, 'utf8'));
    return Array.isArray(parsed) ? (parsed as CatalogEntry[]) : null;
  } catch {
    return null;
  }
}

interface CollectImagesOpts {
  rootAbs: string;
  paths: Set<string>;
}

export function isWebLevelJson(content: string): boolean {
  try {
    const data = JSON.parse(content);
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    // mapSize is necessary but not sufficient — collision-map sidecars
    // also carry mapSize. A real level file ALSO carries at least one
    // visible-content field. Without this extra check, opening a sidecar
    // (data/<scene>-collision-map.json) in the editor produced an empty
    // canvas because the loader returned a SceneModel with no bg / layers
    // / props. (test-2drpg, 2026 — convention also tells the agent not
    // to put mapSize in sidecars, but old projects + drift still hit it.)
    const sz = obj.mapSize as { width?: unknown; height?: unknown } | undefined;
    if (!sz || typeof sz.width !== 'number' || typeof sz.height !== 'number') {
      return false;
    }
    const hasBackground =
      typeof obj.background === 'string' || isPlainObject(obj.background);
    const hasLayers = Array.isArray(obj.layers) && obj.layers.length > 0;
    const hasProps = Array.isArray(obj.props) && obj.props.length > 0;
    // A sidecar has blockers/walkable/walkBounds/zones but none of the above.
    return hasBackground || hasLayers || hasProps;
  } catch {
    return false;
  }
}

/** Walk the named arrays in `data` and inject `id: "<section>_<idx>"` on
 *  any entry missing one. Returns the list of arrays that were mutated
 *  so the caller can decide whether to write the file back to disk.
 *  Per common.md "JSON entry contract": every entry needs an id for OGF
 *  editor writes to address it. Auto-injection is the safety net when
 *  the agent forgot. */
function autoInjectIds(
  data: Record<string, unknown>,
  arrayNames: readonly string[],
): boolean {
  let dirty = false;
  for (const name of arrayNames) {
    const arr = data[name];
    if (!Array.isArray(arr)) continue;
    let nextSeq = 0;
    const used = new Set<string>();
    for (const e of arr) {
      if (e && typeof e === 'object' && !Array.isArray(e)) {
        const id = (e as { id?: unknown }).id;
        if (typeof id === 'string' && id) used.add(id);
      }
    }
    arr.forEach((e, idx) => {
      if (!e || typeof e !== 'object' || Array.isArray(e)) return;
      const obj = e as Record<string, unknown>;
      if (typeof obj.id === 'string' && obj.id) return; // already has id
      // Find a unique synthetic id. Most arrays will collide-check trivially
      // since other entries also lack ids, but if the user has a mix we
      // still want uniqueness within the array.
      let candidate = `${name}_${idx}`;
      while (used.has(candidate)) {
        candidate = `${name}_${idx}_${nextSeq++}`;
      }
      obj.id = candidate;
      used.add(candidate);
      dirty = true;
    });
  }
  return dirty;
}

const LEVEL_ARRAYS_NEEDING_ID = [
  'props',
  'npcs',
  'pickups',
  'hazards',
  'colliders',
  'blockers',
  'walkBounds',
  'walkable',
  'paths',
  'spawn_points',
];

const SIDECAR_ARRAYS_NEEDING_ID = ['blockers', 'walkBounds', 'walkable'];

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

  // Strategy 2 — auto-inject missing ids and persist. Side effect on
  // first load of an agent-written file that omitted ids; subsequent
  // loads see the ids and this is a no-op. Editor writers can then
  // address every entry by id without the index-based fallback path.
  if (autoInjectIds(data, LEVEL_ARRAYS_NEEDING_ID)) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    writeFileSync(abs, JSON.stringify(data, null, 2) + eol, 'utf8');
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
      const repeatX = l.repeatX === true;
      const explicitW = typeof l.width === 'number' && (l.width as number) > 0
        ? (l.width as number)
        : undefined;
      const explicitH = typeof l.height === 'number' && (l.height as number) > 0
        ? (l.height as number)
        : undefined;
      // Width/height = the extent the layer covers (always mapSize-aligned
      // so editor coords line up with Play). For tileable layers, the PNG
      // is smaller than the extent — the editor tiles it. tileW/tileH carry
      // the actual tile dimensions when explicitly declared in JSON;
      // otherwise the editor falls back to the PNG's natural size.
      const layerW = repeatX ? mapW : (explicitW ?? mapW);
      const layerH = repeatX ? mapH : (explicitH ?? mapH);
      const tileW = repeatX ? explicitW : undefined;
      const tileH = repeatX ? explicitH : undefined;
      out.push({
        id,
        relPath: img,
        zIndex,
        parallax,
        width: layerW,
        height: layerH,
        repeatX,
        tileW,
        tileH,
      });
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

    // Catalog-size fallback — pickups/enemies typically write
    // `{type, x, y}` without explicit w/h because the runtime pulls
    // size from `data/<section>.json` at load time. Compute effective
    // (w, h) so the editor can show + resize those entries; without
    // this they'd be filtered out (no w/h) and silently invisible.
    const sectionCatalog = loadCatalogForSection(rootAbs, section);
    function catalogSizeFor(entry: RectLike): { w: number; h: number } | null {
      const type = (entry as { type?: unknown }).type;
      if (typeof type !== 'string' || !sectionCatalog) return null;
      const hit = sectionCatalog.find((c) => c?.id === type);
      const sz = (hit as { size?: unknown } | undefined)?.size;
      if (!sz || typeof sz !== 'object') return null;
      const w = Number((sz as { w?: unknown }).w);
      const h = Number((sz as { h?: unknown }).h);
      return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
        ? { w, h }
        : null;
    }
    function effectiveSize(entry: RectLike): { w: number; h: number } | null {
      if (
        typeof entry?.w === 'number' &&
        typeof entry?.h === 'number' &&
        entry.w > 0 &&
        entry.h > 0
      ) {
        return { w: entry.w, h: entry.h };
      }
      return catalogSizeFor(entry);
    }
    /** Pull `hitbox: {w,h,offsetX?,offsetY?}` from the entry first, then
     *  fall back to the catalog. Centered within the visual rect at the
     *  editor + runtime — see SceneProp.hitbox docstring. */
    function effectiveHitbox(
      entry: RectLike,
    ): { w: number; h: number; offsetX?: number; offsetY?: number } | null {
      const fromEntry = (entry as { hitbox?: unknown }).hitbox;
      const sources: unknown[] = [fromEntry];
      if (sectionCatalog) {
        const type = (entry as { type?: unknown }).type;
        if (typeof type === 'string') {
          const hit = sectionCatalog.find((c) => c?.id === type);
          sources.push((hit as { hitbox?: unknown } | undefined)?.hitbox);
        }
      }
      for (const src of sources) {
        if (!src || typeof src !== 'object') continue;
        const obj = src as { w?: unknown; h?: unknown; offsetX?: unknown; offsetY?: unknown };
        const w = Number(obj.w);
        const h = Number(obj.h);
        if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) continue;
        const ox = Number(obj.offsetX);
        const oy = Number(obj.offsetY);
        return {
          w,
          h,
          offsetX: Number.isFinite(ox) ? ox : undefined,
          offsetY: Number.isFinite(oy) ? oy : undefined,
        };
      }
      return null;
    }

    // An entry is editable if it has at minimum a position + size rect.
    // Image is OPTIONAL — entries without image (e.g. platforms[] with
    // collision-only kind: 'earth_rampart') still render as outlined
    // rects so the user can drag and resize them. Otherwise platforms
    // would be invisible and uneditable.
    const editable = arr.filter(
      (e) =>
        typeof e?.x === 'number' &&
        typeof e?.y === 'number' &&
        effectiveSize(e) !== null,
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

    // Catalog fallback — hazards/pickups/enemies (and similar) carry
    // `type: "<catalog_id>"` referencing data/<section>.json. The runtime
    // resolves type → catalog.sprite via byId(); the editor needs the same
    // resolution or it draws an empty outlined rect.
    function pickImageFromCatalog(entry: RectLike): string | null {
      const type = (entry as { type?: unknown }).type;
      if (typeof type !== 'string') return null;
      const catalog = loadCatalogForSection(rootAbs, section);
      if (!catalog) return null;
      const hit = catalog.find((c) => c?.id === type);
      if (!hit) return null;
      // Catalogs typically use `sprite` (single image) or
      // `animations.<name>.sprite` (animated). Take sprite first, else fall
      // back to the first animation frame the agent registered. The
      // sprite-forge skill writes sheets at `assets/sprites/<kind>/sheet-transparent.png`
      // which is what the runtime uses; we hand that to the editor too.
      const trim = (s: string) => s.replace(/^\.?\//, '');
      if (typeof hit.sprite === 'string') return trim(hit.sprite);
      if (hit.animations && typeof hit.animations === 'object') {
        for (const anim of Object.values(hit.animations)) {
          if (anim && typeof anim === 'object') {
            const sp = (anim as { sprite?: unknown }).sprite;
            if (typeof sp === 'string') return trim(sp);
          }
        }
      }
      return null;
    }

    editable.forEach((p, idx) => {
      const direct = pickImagePath(p) ?? pickImageFromCatalog(p);
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
      // Effective size = entry.w/h when present, else catalog.size.w/h
      // (pickups/enemies often omit w/h since runtime reads from catalog).
      const eff = effectiveSize(p) ?? { w: 0, h: 0 };
      const w = eff.w;
      const h = eff.h;
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
      const hitbox = effectiveHitbox(p) ?? undefined;
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
        hitbox,
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

  // ---- Sidecar collision data (Sengoku top-down RPG pattern) ----
  //
  // Top-down RPG levels often store the bulk of collision in a separate
  // file referenced by `collisionSource: "data/<scene>-collision-map.json"`.
  // The runtime loads it at scene-enter time; without ALSO loading it
  // here, the editor's Colliders + Zones tabs would silently miss every
  // entry the agent wrote to the sidecar (rpg-gogogo, 2026 — user saw a
  // green walkable polygon in Play but nothing in the editor's zones
  // tab because walkBounds lives in the sidecar, not the main level).
  //
  // Each sidecar entry's ColliderRef points at the SIDECAR path (not the
  // level), so subsequent move/resize ops write back to the right file
  // and stay consistent with what the runtime reads.
  const collisionSource =
    typeof data.collisionSource === 'string' ? (data.collisionSource as string) : '';
  if (collisionSource) {
    const sidecarRel = collisionSource.replace(/^\.?\//, '');
    const sidecarAbs = safeJoin(rootAbs, sidecarRel);
    if (existsSync(sidecarAbs)) {
      try {
        const sidecarText = readFileSync(sidecarAbs, 'utf8');
        const sidecar = JSON.parse(sidecarText) as Record<string, unknown>;

        // Strategy 2 — auto-inject ids into sidecar entries that omit
        // them, then persist. Subsequent loads see the ids and this is
        // a no-op; editor writers find each entry by its real id.
        // The `__i<n>` synthetic-id fallback in writers stays in place
        // as a safety net (covers files that fail to write back, etc.)
        // but normally won't fire after the first load of an agent file.
        if (autoInjectIds(sidecar, SIDECAR_ARRAYS_NEEDING_ID)) {
          const eol = sidecarText.includes('\r\n') ? '\r\n' : '\n';
          writeFileSync(sidecarAbs, JSON.stringify(sidecar, null, 2) + eol, 'utf8');
        }

        const sidecarBlockers = Array.isArray(sidecar.blockers)
          ? (sidecar.blockers as RectLike[])
          : [];
        sidecarBlockers.forEach((b, idx) => {
          const shape = inferShapeFromEntry(b);
          if (!shape) return;
          const id = typeof b.id === 'string' && b.id ? b.id : `__i${idx}`;
          const ref: ColliderRef = {
            backend: 'json',
            relPath: sidecarRel,
            section: 'blockers',
            id,
          };
          colliders.push({
            uid: `web:sidecar-blockers:${id}`,
            ref,
            name: typeof b.tag === 'string' ? (b.tag as string) : id,
            kind: 'blocker',
            position: entryCenterPosition(b),
            shape,
            editable: shape.kind !== 'polygon',
          });
        });

        // walkBounds and walkable both exist in some sidecars (agent
        // duplicates them for safety). Treat both as walkable zones —
        // the editor shows them in the zones tab with neutral coloring.
        for (const fieldName of ['walkBounds', 'walkable'] as const) {
          const arr = Array.isArray(sidecar[fieldName])
            ? (sidecar[fieldName] as RectLike[])
            : [];
          arr.forEach((b, idx) => {
            const shape = inferShapeFromEntry(b);
            if (!shape) return;
            const id = typeof b.id === 'string' && b.id ? b.id : `__i${idx}`;
            const ref: ColliderRef = {
              backend: 'json',
              relPath: sidecarRel,
              section: fieldName,
              id,
            };
            zones.push({
              uid: `web:sidecar-${fieldName}:${id}`,
              ref,
              name: typeof b.tag === 'string' ? (b.tag as string) : id,
              zoneKind: 'unknown',
              position: entryCenterPosition(b),
              shape,
              fields: { kind: 'walkable', source: 'sidecar' },
              editable: shape.kind !== 'polygon',
            });
          });
        }
      } catch {
        // Sidecar exists but failed to parse — surface as a note so the
        // user sees something visible in the editor.
        notes.push(
          `collisionSource ${sidecarRel} failed to parse — colliders + walkBounds from the sidecar will not appear in the editor.`,
        );
      }
    }
  }

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
        // Editable since dict-keyed writer (applyJsonDictKeyedEdit) landed.
        // ref.section is `zones.<id>` so the writer knows the parent + key.
        editable: true,
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
        // Editable: move works for point + circle; resize works for circle
        // (writes both `radius` and `interactRadius` so the runtime field
        // gets updated whichever name it expects).
        editable: true,
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

  // collidersJsonPath drives where the editor's "+ rect / + circle /
  // + poly" tools write NEW colliders. When the level has a sidecar, the
  // agent's convention is to put blockers there — so new editor-drawn
  // colliders should join the sidecar too. Without this, new colliders
  // would land in the main level JSON while existing ones live in the
  // sidecar, producing inconsistent collision data on the next reload.
  const sidecarRelForRoute =
    typeof data.collisionSource === 'string'
      ? (data.collisionSource as string).replace(/^\.?\//, '')
      : '';
  const sidecarExists =
    sidecarRelForRoute.length > 0 && existsSync(safeJoin(rootAbs, sidecarRelForRoute));
  const collidersJsonPathFinal = sidecarExists ? sidecarRelForRoute : relPath;

  const scene: SceneModel = {
    scenePath: relPath,
    rootName: typeof data.id === 'string' ? data.id : path.posix.basename(relPath, '.json'),
    background,
    layers,
    props,
    colliders,
    collidersJsonPath: collidersJsonPathFinal,
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
