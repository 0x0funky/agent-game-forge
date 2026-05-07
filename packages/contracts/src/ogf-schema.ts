/**
 * OGF Game Schema v1 — canonical shape produced by JS-first agents.
 *
 * These types reflect what the agent ACTUALLY writes after three test
 * genres (platformer, arena, tower-defense) converged. They are the
 * source of truth for `data/levels/*.json` files.
 *
 * Design rules:
 * - Common core (id/name/mapSize/camera/spawn/zones) is required for
 *   every genre.
 * - `background` (single) and `layers` (parallax) are mutually
 *   exclusive — agents pick one based on camera mode.
 * - Per-genre top-level arrays (platforms, paths, buildSpots, waves)
 *   are optional. OGF loader tolerates unknown keys; unknowns flow
 *   through `extras` for inspection.
 * - All entity arrays are present even when empty — no field-presence
 *   ambiguity in the loader.
 *
 * Loader: apps/daemon/src/web-scene.ts maps this onto SceneModel.
 */

import type { Vec2 } from './scene.js';

// ─── Common primitives ────────────────────────────────────────────

export interface RectXY {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Facing = 'left' | 'right' | 'up' | 'down';

// ─── Map + camera ────────────────────────────────────────────────

/** Logical world size. Renderer scales canvas to fit. Background image
 *  dimensions MUST equal this — see conventions.ts. */
export interface MapSize {
  width: number;
  height: number;
}

/** Camera viewport + behavior. `w`/`h` is the visible window the
 *  camera shows, NOT the world size (that's mapSize). */
export interface CameraSpec {
  mode: 'locked' | 'follow' | 'horizontal-scroll' | 'vertical-scroll' | 'parallax';
  /** Initial position. */
  x: number;
  y: number;
  /** Visible window dimensions. */
  w: number;
  h: number;
  /** mode='follow': lookahead bias toward player movement (0..1). */
  followLead?: number;
  /** mode='follow' / scroll: optional pan limits. */
  bounds?: RectXY;
}

// ─── Background — two shapes, mutually exclusive ────────────────────

/** Single-image background. Used by locked-camera genres (TD, arena). */
export interface SingleBackground {
  image: string;
  /** Optional override; defaults to mapSize. */
  width?: number;
  height?: number;
}

/** Parallax layer for follow-camera genres (platformer, side-scroll).
 *  Layers render back-to-front by `zIndex`. */
export interface ParallaxLayer {
  id: string;
  /** Required when tileMode is undefined / 'static' / 'loop'. */
  image?: string;
  /** Required when tileMode is 'segments'. Each entry is camera-width-sized
   *  and laid out left-to-right. */
  segmentImages?: string[];
  /** How the layer fills horizontal extent:
   *   'static'   — single image at (0,0), no tiling. Default for backwards
   *                compat with v1.
   *   'loop'     — single small image, repeated horizontally with modulo
   *                wrap. Use for sky / clouds / distant horizon where the
   *                image is tileable seamlessly.
   *   'segments' — N camera-width images stitched left-to-right. Use for
   *                mid/near layers with unique terrain per camera-width. */
  tileMode?: 'static' | 'loop' | 'segments';
  /** 0 = static (sky), 1 = locked to camera. Typical: 0.1..0.95. */
  parallax: number;
  zIndex: number;
  /** Optional override; defaults to mapSize. */
  width?: number;
  height?: number;
}

// ─── Platforms (platformer) ─────────────────────────────────────────

/** A single tileable / three-piece platform asset, referenced by id from
 *  PlatformSpec.tile when renderMode = 'tile' | 'three-piece'. Keys live
 *  in OgfLevel.shared_platform_library. */
export interface PlatformLibraryEntry {
  /** Three-piece composition. left + right are caps with edge ornaments;
   *  mid is the seamlessly-tileable middle section. Required when any
   *  PlatformSpec referencing this entry uses renderMode = 'three-piece'.
   *  When referenced from renderMode = 'tile', only `mid` is needed. */
  left?: { image: string; naturalW?: number; naturalH?: number };
  mid: {
    image: string;
    naturalW?: number;
    naturalH?: number;
    /** Pixel width of one tile repeat (typically equals natural width).
     *  Renderer loops mid every `tileW` px to fill the platform width. */
    tileW?: number;
    /** Pixel height of one tile (informational; render uses platform.h). */
    tileH?: number;
  };
  right?: { image: string; naturalW?: number; naturalH?: number };
}

/** Visual + collision for solid surfaces.
 *
 *  Three render modes:
 *  - `tile`        — repeat library.mid horizontally every tileW px
 *                    across platform.w. No edge caps. Inline `image`
 *                    field is allowed as a single-prop fallback if
 *                    no `tile` reference is provided.
 *  - `three-piece` — library.left cap + library.mid loop + library.right cap.
 *                    Requires the library entry to have all three pieces.
 *                    Best for ornamented platforms that need to scale.
 *  - `natural`     — single image at its natural size. platform.w/h MUST
 *                    equal image.naturalW/H — never stretch. Used for
 *                    one-off set-piece platforms (boss arena floor etc).
 *
 *  `oneWay:true` means jump-through-from-below.
 *  `solid` is OBSOLETE — colliders[] is the source of truth for collision. */
export interface PlatformSpec extends RectXY {
  id: string;
  /** Catalog ref / display label. */
  kind: string;
  /** Render strategy. Defaults to 'natural' for v1 backwards compat. */
  renderMode?: 'tile' | 'three-piece' | 'natural';
  /** Reference into shared_platform_library when renderMode = 'tile'
   *  or 'three-piece'. */
  tile?: string;
  /** Single sprite sheet path when renderMode = 'natural'. */
  image?: string;
  solid?: boolean;
  oneWay?: boolean;
}

// ─── Colliders ─────────────────────────────────────────────────────

/** Standalone collision shape — used for invisible walls, hazard areas,
 *  edges of platforms not 1:1 with their visual rect. */
export interface ColliderSpec extends RectXY {
  id: string;
  type: 'platform' | 'wall' | 'hazard' | 'kill' | 'trigger' | (string & {});
  shape: 'rect';
  oneWay?: boolean;
  /** Visually-linked entity id (e.g. platform id). */
  links?: string;
}

// ─── Path (TD enemy route, NPC patrol) ──────────────────────────────

export interface PathSpec {
  id: string;
  points: Vec2[];
  tag?: string;
}

// ─── TD build spot ─────────────────────────────────────────────────

/** Tower placement pad. Always rect (NOT radius — see conventions). */
export interface BuildSpotSpec extends RectXY {
  id: string;
  /** Tower ids permitted on this pad. */
  allowed: string[];
}

// ─── Hazards / pickups / enemies / props (entity placements) ────────

export interface HazardPlacement {
  id: string;
  type: string;
  x: number;
  y: number;
  /** Optional inline geometry; otherwise looked up in catalog. */
  w?: number;
  h?: number;
  data?: Record<string, unknown>;
}

export interface PickupPlacement {
  id: string;
  type: string;
  x: number;
  y: number;
  data?: Record<string, unknown>;
}

export interface EnemyPlacement {
  id: string;
  type: string;
  x: number;
  y: number;
  facing?: Facing;
  data?: Record<string, unknown>;
}

export interface PropPlacement {
  id: string;
  type: string;
  x: number;
  y: number;
  rotation?: number;
  scale?: number;
  data?: Record<string, unknown>;
}

export interface CheckpointPlacement {
  id: string;
  x: number;
  y: number;
  data?: Record<string, unknown>;
}

// ─── Arena spawners + boss ─────────────────────────────────────────

export interface SpawnPoint {
  id: string;
  x: number;
  y: number;
  facing?: Facing;
}

export interface EnemySpawner {
  id: string;
  x: number;
  y: number;
  /** Spawn ring radius. */
  radius: number;
  /** Catalog enemy ids that can come from this spawner. */
  types: string[];
}

// ─── TD wave timeline ──────────────────────────────────────────────

export interface WaveGroup {
  type: string;
  count: number;
  /** Seconds between spawns within this group. */
  interval: number;
}

export interface WaveSpec {
  /** Seconds delay before this wave starts (after previous wave). */
  delay: number;
  groups: WaveGroup[];
}

// ─── Zones + exits ─────────────────────────────────────────────────

/** Named map of regions. Use object/Record (not array) — agents
 *  consistently chose this shape across all 3 genres. */
export type ZoneMap = Record<string, RectXY>;

/** Named map of exits. `null` value = exit declared but not yet wired. */
export type ExitMap = Record<
  string,
  | {
      toLevel: string;
      toSpawn?: Vec2;
      /** Trigger zone in this level. */
      zone?: RectXY;
    }
  | null
>;

// ─── The level file itself ────────────────────────────────────────

export interface OgfLevel {
  // ── identity ──
  id: string;
  name: string;

  // ── world ──
  mapSize: MapSize;
  camera: CameraSpec;
  spawn: Vec2;

  /** Single-image bg (locked / arena / TD). Mutually exclusive with `layers`. */
  background?: SingleBackground;
  /** Parallax stack (follow camera). Mutually exclusive with `background`. */
  layers?: ParallaxLayer[];

  // ── shared assets ──
  /** Reusable platform tile / strip definitions, keyed by id.
   *  PlatformSpec.tile entries reference these. Use to share one tile
   *  art set across many platforms (Megaman-style: one stone tile,
   *  used by every ground/ledge/wall in the level). */
  shared_platform_library?: Record<string, PlatformLibraryEntry>;

  // ── geometry ──
  /** Platformer: visual+collision platform tiles. */
  platforms?: PlatformSpec[];
  /** Standalone collision shapes. Editable in OGF Scene tab. */
  colliders?: ColliderSpec[];
  /** TD enemy / NPC patrol routes. */
  paths?: PathSpec[];
  /** TD tower placement pads. */
  buildSpots?: BuildSpotSpec[];

  // ── entities ──
  hazards?: HazardPlacement[];
  pickups?: PickupPlacement[];
  enemies?: EnemyPlacement[];
  /** ALWAYS present, even if empty. */
  props: PropPlacement[];
  checkpoints?: CheckpointPlacement[];

  // ── arena/boss ──
  spawn_points?: SpawnPoint[];
  enemy_spawners?: EnemySpawner[];
  boss_spawn?: Vec2;

  // ── TD ──
  waves?: WaveSpec[];
  /** Hero entry point in TD genres. Optional duplicate of `spawn`. */
  heroSpawn?: Vec2;

  // ── topology ──
  zones?: ZoneMap;
  exits?: ExitMap;

  // ── meta ──
  notes?: string;

  /** Anything the loader doesn't know about lands here for inspection.
   *  Agents SHOULD prefer named top-level fields; `extras` is a safety
   *  valve, not a recommended namespace. */
  extras?: Record<string, unknown>;
}

// ─── Level registry (data/levels.json) ──────────────────────────────

export interface OgfLevelRegistryEntry {
  id: string;
  /** Project-relative path to the level file. */
  file: string;
  displayName?: string;
}

export type OgfLevelRegistry = OgfLevelRegistryEntry[];

// ─── Catalogs (data/*.json siblings of levels/) ────────────────────

export interface AnimationRef {
  /** Project-relative sheet path. */
  sheet: string;
  /** Source frame size in the sheet. */
  frameW: number;
  frameH: number;
  /** Total frames. Cols inferred from sheet width / frameW. */
  frames: number;
  fps: number;
  loop?: boolean;
}

/** Three-size pattern (frame/display/collision) is enforced for every
 *  multi-anim entity — see conventions. */
export interface EntityVisuals {
  /** Render size in world units. */
  displayW: number;
  displayH: number;
  /** Collision hitbox (relative to anchor). */
  collision?: { w: number; h: number; offsetX?: number; offsetY?: number };
  /** Anchor point on render rect. */
  anchor?: 'center' | 'bottom' | 'top-left';
}

/** Common catalog entry shape; specific catalogs (enemies, towers etc.)
 *  extend this with stats. */
export interface CatalogEntity extends EntityVisuals {
  id: string;
  name?: string;
  /** Direction strategy — see conventions table. */
  facingStrategy?: 'side_with_flip' | '4_direction' | 'sprite_rotation' | 'static_facing';
  /** Either inline image (single-action entity) or animations map. */
  image?: string;
  animations?: Record<string, AnimationRef>;
  /** Gameplay numbers — schema-agnostic. */
  stats?: Record<string, number>;
  /** Catch-all for genre-specific fields. */
  extras?: Record<string, unknown>;
}

// ─── Type guards ───────────────────────────────────────────────────

export function hasParallaxLayers(level: OgfLevel): level is OgfLevel & { layers: ParallaxLayer[] } {
  return Array.isArray(level.layers) && level.layers.length > 0;
}

export function hasSingleBackground(level: OgfLevel): level is OgfLevel & { background: SingleBackground } {
  return !!level.background?.image;
}
