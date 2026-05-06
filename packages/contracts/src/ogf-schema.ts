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
  image: string;
  /** 0 = static (sky), 1 = locked to camera. Typical: 0.1..0.95. */
  parallax: number;
  zIndex: number;
  /** Optional override; defaults to mapSize. */
  width?: number;
  height?: number;
}

// ─── Platforms (platformer) ─────────────────────────────────────────

/** Visual + collision for solid surfaces. `solid:true` means a wall;
 *  `oneWay:true` means jump-through-from-below. */
export interface PlatformSpec extends RectXY {
  id: string;
  /** Catalog ref (kind name, NOT a free-form prop). */
  kind: string;
  /** Sprite sheet path. */
  image: string;
  solid: boolean;
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
