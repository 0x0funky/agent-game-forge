# OGF Game Schema v1 — LOCKED

> **Status:** Locked 2026-05-05 after three test-genre runs (platformer, arena, tower-defense) converged on the same shape. Source of truth: `packages/contracts/src/ogf-schema.ts`. This document is the human-readable spec. If they disagree, the TS file wins.

The agent produces JSON files in `data/`. Schema v1 defines what shape those files take so OGF can render them in the Scene tab and let you drag-edit them.

## Files at a glance

```
project-root/
├── .ogf/
│   ├── spec.md              ← agent-authored project plan
│   ├── conventions.md       ← OGF rules (we write on bootstrap)
│   ├── style-anchor.png     ← visual canon for image_gen reference chain
│   └── scene-context.json   ← live editor state (OGF writes)
├── data/
│   ├── levels.json          ← OgfLevelRegistry
│   ├── <level_id>.json      ← OgfLevel (the editable unit)
│   ├── enemies.json         ← catalog (always)
│   ├── audio.json           ← catalog (always)
│   ├── pickups.json         ← catalog (when present)
│   ├── projectiles.json     ← catalog (combat genres)
│   ├── hud.json             ← catalog (when present)
│   ├── waves.json           ← catalog (TD, optional — may live in level)
│   ├── towers.json          ← catalog (TD)
│   ├── heroes.json / player.json  ← catalog (genre-specific)
│   └── …
├── assets/
│   ├── maps/<level_id>/{background.png | sky.png + far_*.png + …}
│   ├── sprites/<entity_id>/{sheet.png + pipeline-meta.json}
│   └── audio/…
└── src/
    └── game.js + module files
```

The agent picks file names organically (e.g. `moonlit_ridge.json`, `guan_du_pass.json`) — we do NOT enforce `level_1.json`-style naming. Q1 from the draft → resolved via observation: humans-readable names, registry maps id → file.

## OgfLevel — the editable unit

```jsonc
{
  "id": "moonlit_ridge",
  "name": "Moonlit Ridge",

  "mapSize": { "width": 2400, "height": 720 },
  "camera": { "mode": "follow", "x": 0, "y": 0, "w": 1280, "h": 720, "followLead": 0.35 },
  "spawn":  { "x": 120, "y": 600 },

  // background OR layers (mutually exclusive)
  "layers": [
    { "id": "sky",      "image": "assets/maps/moonlit_ridge/sky.png",      "parallax": 0.12, "zIndex": 0 },
    { "id": "midground","image": "assets/maps/moonlit_ridge/midground.png","parallax": 0.42, "zIndex": 2 }
  ],

  // per-genre geometry
  "platforms":  [...],   // platformer
  "colliders":  [...],   // standalone collision
  "paths":      [...],   // TD/NPC routes
  "buildSpots": [...],   // TD pads (rect, NOT radius)

  // entity placements
  "hazards":     [],
  "pickups":     [],
  "enemies":     [],
  "props":       [],     // ALWAYS present, even if empty
  "checkpoints": [],

  // arena-specific
  "spawn_points":   [...],
  "enemy_spawners": [...],
  "boss_spawn":     { "x": 1600, "y": 420 },

  // TD-specific
  "waves":     [...],
  "heroSpawn": { "x": 610, "y": 580 },

  // topology
  "zones": { "play_area": { "x": 0, "y": 0, "w": 3200, "h": 2400 } },
  "exits": { "next": { "toLevel": "boss_room", "zone": { ... } } },

  "notes": "Plain-text design notes."
}
```

## Field reference

### Required core (every level, every genre)

| Field      | Type     | Notes                                                                                                                                       |
|------------|----------|---------------------------------------------------------------------------------------------------------------------------------------------|
| `id`       | string   | Stable id, conventionally matches file basename.                                                                                            |
| `name`     | string   | Human-readable display name.                                                                                                                |
| `mapSize`  | MapSize  | World dimensions in level units. **Background image dimensions MUST equal this.** OGF Scene editor uses this as the authoritative coord system. |
| `camera`   | CameraSpec | `mode: 'locked' \| 'follow' \| 'horizontal-scroll' \| 'vertical-scroll' \| 'parallax'`. `w`/`h` is the visible window, NOT mapSize.       |
| `spawn`    | Vec2     | Player entry point. TD genres MAY duplicate as `heroSpawn`.                                                                                  |
| `props`    | array    | Always present, even if empty. Loader presence-checks here.                                                                                  |

### Background — pick one

**Single image** — for `camera.mode = 'locked'` (TD, arena):
```jsonc
"background": { "image": "assets/maps/<level_id>/background.png" }
```

**Parallax stack** — for `mode = 'follow'` and side-scrollers:
```jsonc
"layers": [
  { "id": "sky",       "image": "...", "parallax": 0.12, "zIndex": 0 },
  { "id": "mid",       "image": "...", "parallax": 0.42, "zIndex": 2 },
  { "id": "near",      "image": "...", "parallax": 0.65, "zIndex": 3 },
  { "id": "occluders", "image": "...", "parallax": 0.92, "zIndex": 90 }
]
```

Layers render back-to-front by `zIndex`. `parallax: 0` is static, `1` locks to camera. Each layer's natural size SHOULD equal mapSize; if not, the loader passes mapSize through `width`/`height` so the editor can render correctly anyway.

### Per-genre geometry

| Field         | Genre         | Shape                                                                       |
|---------------|---------------|-----------------------------------------------------------------------------|
| `platforms`   | platformer    | `{ id, x, y, w, h, kind, image, solid, oneWay? }[]` — visual + collision   |
| `colliders`   | platformer    | `{ id, x, y, w, h, type, shape: 'rect', oneWay?, links? }[]` — standalone  |
| `paths`       | TD            | `{ id, points: Vec2[], tag? }[]` — array, not singular object              |
| `buildSpots`  | TD            | `{ id, x, y, w, h, allowed: string[] }[]` — rect, NOT `radius`             |

### Entity placements

```jsonc
"hazards":     [{ "id": "spike_01", "type": "spike", "x": 800, "y": 580 }],
"pickups":     [{ "id": "rice_01",  "type": "rice_ball", "x": 720, "y": 1980 }],
"enemies":     [{ "id": "bandit_01","type": "bandit",   "x": 1180,"y": 840 }],
"props":       [{ "id": "lantern_01","type":"lantern",  "x": 350, "y": 540 }],
"checkpoints": [{ "id": "ck_01",    "x": 1200, "y": 600 }]
```

Each placement = `{ id, type, x, y, ...optional }`. Visual + stats live in the catalog (`data/<type>.json` or `data/enemies.json` etc.); placements only carry instance data.

### Arena-specific

```jsonc
"spawn_points":   [{ "id": "boss_add_north", "x": 1600, "y": 120, "facing": "south" }],
"enemy_spawners": [{ "id": "boss_add_ring", "x": 1600, "y": 1200, "radius": 1280, "types": ["ashigaru_swarm"] }],
"boss_spawn":     { "x": 1600, "y": 420 }
```

### TD-specific

```jsonc
"waves": [
  { "delay": 1.0, "groups": [{ "type": "scout", "count": 8, "interval": 0.75 }] },
  { "delay": 4.0, "groups": [{ "type": "scout", "count": 12, "interval": 0.58 }] }
]
```

`delay` = seconds between waves. Each `group` spawns `count` enemies of `type` at `interval` seconds apart.

### Topology

`zones` and `exits` are **objects** (Record), NOT arrays. All three test genres consistently chose this shape — keys serve as ids.

```jsonc
"zones": {
  "play_area":  { "x": 0,    "y": 0,   "w": 3200, "h": 2400 },
  "boss_stage": { "x": 1240, "y": 240, "w": 720,  "h": 420 }
},
"exits": {
  "to_castle": { "toLevel": "castle_gate_boss", "zone": { "x": 2300, "y": 540, "w": 100, "h": 160 } }
}
```

## Catalogs

Catalog files (`data/enemies.json`, `data/towers.json`, etc.) follow the `CatalogEntity` shape:

```ts
{
  id: string;
  name?: string;
  // visuals
  displayW: number;            // render size (world units)
  displayH: number;
  collision?: { w, h, offsetX?, offsetY? };  // hitbox
  anchor?: 'center' | 'bottom' | 'top-left';
  facingStrategy?: 'side_with_flip' | '4_direction' | 'sprite_rotation' | 'static_facing';
  // sprites — pick ONE
  image?: string;              // single-action entity
  animations?: Record<string, AnimationRef>;  // multi-anim entity
  // gameplay
  stats?: Record<string, number>;
  extras?: Record<string, unknown>;
}
```

Three sizes per multi-anim entity (mandatory — see conventions):
- `frameW`/`frameH` (in AnimationRef): source frame in the sheet
- `displayW`/`displayH`: render size in world units
- `collision: { w, h }`: hitbox (independent of render size)

These are independent because sprites have visual padding (e.g. weapon swings extend frame), but the hitbox should be tight to the body.

## Open questions resolved

The draft (`schema-v1-draft.md`) had Q1–Q8. Locked answers:

| # | Question                       | Locked answer                                                                                              |
|---|--------------------------------|------------------------------------------------------------------------------------------------------------|
| 1 | File naming?                   | Human-readable level ids (`moonlit_ridge`, `guan_du_pass`). Registry maps id → file path.                |
| 2 | Inline vs reference animations? | Catalog reference. Placements only carry `{ id, type, x, y }`; visuals live in `data/<type>.json`.       |
| 3 | Multi-layer parallax?          | Yes. `layers[]` with `zIndex` + `parallax`. Mutually exclusive with `background`.                         |
| 4 | Tile vs free position?         | Free position for v1. No tilemap shape. Add later if a real test demands.                                  |
| 5 | Where does collision live?     | `colliders[]` for standalone shapes; `platforms[]` for visual + collision combined.                       |
| 6 | image_gen output references?   | Per-entity sheet at `assets/sprites/<id>/sheet.png` + `pipeline-meta.json` sidecar.                       |
| 7 | Script layout?                 | `src/game.js` entry + per-system modules (`enemies.js`, `towers.js`, etc.) — convention-driven.            |
| 8 | UI?                            | `data/hud.json` catalog + UI rendered code-side. Not part of OgfLevel.                                    |

## Migration from old SceneModel

`packages/contracts/src/scene.ts` → `apps/daemon/src/web-scene.ts` translates `OgfLevel` to `SceneModel` for the Scene editor:

| OgfLevel field | SceneModel field          |
|----------------|---------------------------|
| `background`   | `SceneBackground` (single) |
| `layers`       | `SceneLayer[]`            |
| `platforms`    | `SceneCollider[]` (visual + auto-collider) |
| `colliders`    | `SceneCollider[]`         |
| `paths`        | `ScenePath[]`             |
| `buildSpots`   | `SceneCollider[]` (special-tagged) |
| `props/enemies/pickups/hazards/checkpoints` | `SceneProp[]` (auto-detected) |
| `zones`        | `SceneZone[]`             |

The loader is forgiving: any unknown top-level field passes through and is preserved on save.

## Next steps after lock

The schema is stable across 3 genres. To break it, we'd need to find a genre that doesn't fit. Candidates worth testing:
- Top-down RPG (4-direction movement + dialog trees + inventory)
- Puzzle (turn-based grid + state machines)
- Rhythm (timeline-driven, not spatial)

Each will probably stress different schema seams. When something breaks, add to `extras` first and only promote to top-level after a second genre needs the same field.
