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
   */
  source: 'image' | 'tilemap-preview' | 'placeholder';
}

export interface SceneProp {
  /** Stable id within this scene. Use the node path "Parent/Name". */
  nodePath: string;
  /** Display label. */
  name: string;
  /** Parent Node2D position — what the user drags. */
  position: Vec2;
  /** Sprite2D child render offset. */
  spriteOffset: Vec2;
  /** Sprite2D child scale. */
  scale: Vec2;
  /** Project-relative path to the prop's PNG. May be null if texture is missing. */
  texture: string | null;
  /** prop_type, encounter_zone_id, etc. — preserved verbatim. */
  metadata: Record<string, string>;
}

export interface SceneModel {
  /** Source .tscn path, project-relative. */
  scenePath: string;
  /** Human-readable scene name from the root node. */
  rootName: string;
  /** Background to render under everything. */
  background: SceneBackground | null;
  /** Draggable props. */
  props: SceneProp[];
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
}

export type SceneOp = MovePropOp;

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
