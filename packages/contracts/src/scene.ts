// SceneModel — engine-agnostic 2D scene representation used by the in-app editor.
// Phase 1 scope: background + Sprite2D-style props (drag-to-move only).
// Future phases will add collisions, zones, paths.

export interface Vec2 {
  x: number;
  y: number;
}

export interface SceneBackground {
  /** Project-relative path to a single PNG used as the visible backdrop. */
  relPath: string;
  /** Inferred from .tscn or the image's natural size. Pixels. */
  width?: number;
  height?: number;
  /** "image" = a baked Sprite2D (kindomrush style) or auto-detected layered-preview.
   *  "tilemap" = TileMapLayer source — Phase 5 will render it natively.
   *              For Phase 1 we still send a preview image when one is found.
   *  "tile" = small repeating tile (arena-survivor pattern). Renderer tiles
   *           horizontally + vertically across the level's mapSize using
   *           tileW/tileH, modulo wrap.
   */
  source: 'image' | 'tilemap-preview' | 'placeholder' | 'tile';
  /** Pixel width of one tile repeat (when source = 'tile'). */
  tileW?: number;
  /** Pixel height of one tile repeat (when source = 'tile'). */
  tileH?: number;
}

/** One visual layer in a multi-layer scene. Used by side-scrollers with
 *  parallax: sky / far / mid / near each get their own SceneLayer. The
 *  scene editor renders them stacked by zIndex (no real parallax preview
 *  in v1 — just z-ordered draw). When the level uses a single-image
 *  background instead, layers is undefined and `background` is set. */
export interface SceneLayer {
  /** Stable id (matches the layer's id in level JSON). */
  id: string;
  /** Project-relative PNG path. */
  relPath: string;
  /** Render order — lower draws first (further back). 0 = sky / far,
   *  positive = closer. */
  zIndex: number;
  /** Parallax scroll factor: 0 = static (sky), 1 = scrolls 1:1 with camera
   *  (foreground props). Editor uses this for visual hint only — it doesn't
   *  actually scroll-preview yet. */
  parallax?: number;
  /** Inferred natural size if available. */
  width?: number;
  height?: number;
}

export interface SceneProp {
  /** Stable id within this scene. Use the node path "Parent/Name". */
  nodePath: string;
  /** Display label. */
  name: string;
  /** What the user drags — written back as the prop's position. */
  position: Vec2;
  /** Sprite2D child render offset. */
  spriteOffset: Vec2;
  /** Sprite2D child scale. */
  scale: Vec2;
  /** Project-relative path to the prop's PNG. May be null if texture is missing. */
  texture: string | null;
  /** prop_type, encounter_zone_id, etc. — preserved verbatim. */
  metadata: Record<string, string>;
  /** When set, render at this size (overrides naturalSize × scale). Used by
   *  web props that store fixed w/h in JSON instead of a Godot-style scale. */
  displaySize?: Vec2;
  /** Sprite2D's centered attribute (Godot). Default true.
   *  - true (default):  position = render center
   *  - false:           position = top-left corner of the rendered sprite
   *  Frontend propBounds branches on this so OGF Scenes tab matches what
   *  Godot draws at runtime. */
  centered?: boolean;
  /** z_index — render order. Lower draws first (further back). Default 0.
   *  Backgrounds typically use negative values (-10, -20). Foreground UI
   *  elements use higher values. Frontend sorts before drawing. */
  zIndex?: number;
  /** When set, write-back goes through this ref instead of the default
   *  Godot .tscn nodePath path. Used for web JSON-backed props. */
  ref?: ColliderRef;
  /** Render strategy for tile / three-piece platforms (Schema v2).
   *  When set, the SceneEditor renders this prop using the matching
   *  branch instead of the default `texture`-stretch-to-fit:
   *    'tile'        — repeat tilePieces.mid every tilePieces.mid.tileW px
   *    'three-piece' — tilePieces.left + mid loop + tilePieces.right
   *    'natural'     — fall through to texture, expect w/h match
   *  Loader sets this when the underlying JSON entry has tile + library
   *  resolves. Undefined → default texture-stretch behavior. */
  renderMode?: 'tile' | 'three-piece' | 'natural';
  /** Resolved library pieces for tile/three-piece render modes.
   *  Loader populates by looking up shared_platform_library[platform.tile]. */
  tilePieces?: {
    left?: { image: string; naturalW?: number; naturalH?: number };
    mid: { image: string; naturalW?: number; naturalH?: number; tileW?: number; tileH?: number };
    right?: { image: string; naturalW?: number; naturalH?: number };
  };
}

export type ColliderShape =
  | { kind: 'rect'; w: number; h: number }
  | { kind: 'circle'; r: number }
  | { kind: 'polygon'; points: Vec2[] }
  | { kind: 'point' };

/** Where this collider/marker lives + how to address it for writes.
 *  For 'tscn' refs: when subResourceId is empty AND markerSizeProperty is set,
 *  resize ops write the named body property of the node itself
 *  (e.g. `pad_size = Vector2(...)`) rather than a SubResource's `size`.
 *  This covers script-driven editor markers (MapEdit-style TowerPad nodes,
 *  PathPoint nodes, Blocker nodes). */
export type ColliderRef =
  | {
      backend: 'tscn';
      nodePath: string;
      subResourceId: string;
      /** When set + subResourceId is '', resize patches `<property> = Vector2(w, h)`. */
      markerSizeProperty?: string;
      /** When set, resize-circle patches `<property> = N`. */
      markerRadiusProperty?: string;
    }
  | {
      backend: 'json';
      relPath: string;
      /** Top-level field name in the JSON. For arrays it's the array key; for
       *  single-object fields (heroSpawn) it equals `id`. */
      section: string;
      id: string;
      /** When true, `section` points to a top-level object field
       *  (e.g. `"heroSpawn": { x, y }`), not an array of items.
       *  Writers patch x/y inside that object directly. */
      singleField?: boolean;
    };

export interface SceneCollider {
  /** Stable per-load id for UI keys. Not used by writers — use `ref` instead. */
  uid: string;
  ref: ColliderRef;
  name: string;
  /** "blocker", "buildzone", "water", "prop", "edge", etc. — preserved verbatim. */
  kind: string;
  position: Vec2;
  shape: ColliderShape;
  /** False when we don't yet support edits to this shape kind in this backend. */
  editable: boolean;
}

export interface ScenePath {
  uid: string;
  ref: ColliderRef;
  name: string;
  /** Position of the Path2D parent node — child point coords are relative. */
  origin: Vec2;
  /** Each point in node-local space (add `origin` to render in world). */
  points: Vec2[];
  /** Phase 4: only handles-zero straight-line edits; bezier-handles are flagged unsupported. */
  hasBezierHandles: boolean;
  editable: boolean;
}

/** Gameplay zones: encounter triggers, scene exits, spawn points,
 *  plus generic 'marker' for script-driven Node2D editor handles
 *  (TowerPads, PathPoints, Blockers, etc.) */
export type ZoneKind = 'encounter' | 'exit' | 'spawn' | 'marker' | 'unknown';

export interface SceneZone {
  uid: string;
  ref: ColliderRef;
  name: string;
  zoneKind: ZoneKind;
  position: Vec2;
  shape: ColliderShape;
  /** Script-bound or JSON-stored fields: encounter_rate, target, facing, etc. */
  fields: Record<string, string | number>;
  editable: boolean;
}

export interface SceneModel {
  /** Source .tscn path, project-relative. */
  scenePath: string;
  /** Human-readable scene name from the root node. */
  rootName: string;
  /** Background to render under everything. Null when the level uses
   *  multi-layer parallax instead — see `layers`. Mutually exclusive
   *  with layers in practice; the loader picks one. */
  background: SceneBackground | null;
  /** Multi-layer scenery (parallax / depth). When set, render in zIndex
   *  order back-to-front. When unset, use `background` as the single
   *  backdrop. Side-scrollers use this; TD / arena use `background`. */
  layers?: SceneLayer[];
  /** Draggable props. */
  props: SceneProp[];
  /** Collision shapes (StaticBody2D or JSON sidecar). */
  colliders: SceneCollider[];
  /** When non-empty, the daemon used a JSON sidecar (project-relative). */
  collidersJsonPath: string | null;
  /** Encounter zones, exits, spawn points (Area2D / Marker2D / JSON sidecar). */
  zones: SceneZone[];
  zonesJsonPath: string | null;
  /** Path2D / Curve2D — currently .tscn only. */
  paths: ScenePath[];
  /** Notes the editor surfaces in the UI (e.g. "TileMap layers not yet editable"). */
  notes: string[];
}

// ---------- Wire types ----------

export interface LoadSceneRequest {
  projectPath: string;
  relPath: string;
}

/** Image bytes returned alongside the model so the canvas can render in one round-trip. */
export interface SceneImagePayload {
  relPath: string;
  base64: string;
  width: number;
  height: number;
}

export interface LoadSceneResponse {
  scene: SceneModel;
  /** All textures referenced by the scene (background + every prop), keyed by relPath. */
  images: SceneImagePayload[];
}

// ---------- Edit ops ----------

/** Move a prop's parent Node2D to a new position. */
export interface MovePropOp {
  kind: 'move-prop';
  nodePath: string;
  position: Vec2;
  /** When set, write to the JSON-backed location instead of the .tscn node. */
  ref?: ColliderRef;
}

/** Scale a prop's Sprite2D (independent X/Y scale). */
export interface ScalePropOp {
  kind: 'scale-prop';
  nodePath: string;
  scale: Vec2;
  /** When set, write to the JSON-backed location (uses displaySize w/h fields). */
  ref?: ColliderRef;
  /** Web-only: the new display w/h for the JSON entry (when ref is set). */
  displaySize?: Vec2;
}

export interface MoveColliderOp {
  kind: 'move-collider';
  ref: ColliderRef;
  position: Vec2;
}

export interface ResizeRectColliderOp {
  kind: 'resize-rect-collider';
  ref: ColliderRef;
  w: number;
  h: number;
}

export interface ResizeCircleColliderOp {
  kind: 'resize-circle-collider';
  ref: ColliderRef;
  r: number;
}

export interface MovePathPointOp {
  kind: 'move-path-point';
  ref: ColliderRef;
  index: number;
  /** Node-local coords (already relative to the Path2D's own position). */
  position: Vec2;
}

export type SceneOp =
  | MovePropOp
  | ScalePropOp
  | MoveColliderOp
  | ResizeRectColliderOp
  | ResizeCircleColliderOp
  | MovePathPointOp;

export interface ApplySceneOpsRequest {
  projectPath: string;
  relPath: string;
  ops: SceneOp[];
}

export interface ApplySceneOpsResponse {
  ok: true;
  /** Updated bytes-on-disk size. */
  size: number;
}
