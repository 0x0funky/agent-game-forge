# Side-scroll Foundation Seed — architecture contract

This file documents what's **universal** (shared across all side-scroll
projects), what's **starter** (sensible default — fork wholesale for
project-specific behavior), and what's **recipe-fillable** (left empty or
stub, the agent fills per spec via `.ogf/recipes/`).

When OGF extracts this project into
`apps/daemon/src/templates/foundation/side-scroll/seed/`, the agent reads
THIS file first to understand what it owns vs what it inherits.

## Module classification

### Universal (do NOT modify unless truly needed)

These define the platform contract. Agent should treat them as read-only
unless the spec explicitly demands a different physics model or input layer.

| File | Purpose |
|---|---|
| `constants.js` | VIEW (1280×720), COLORS, DEFAULT_ANIM |
| `state.js` | global mutable state singleton |
| `dom.js` | canvas + ctx access |
| `assets.js` | image + JSON loader, sprite preload, pipeline-meta parser |
| `config.js` | cfg() loader |
| `catalogs.js` | byId() lookup for enemies/pickups/hazards/projectiles |
| `input.js` | keyboard + gamepad — `wasPressed("jump"/"attack"/"start"/"pause")`, `input.actions.x` |
| `audio.js` | WebAudio procedural SFX |
| `collision.js` | `rectsOverlap`, `bodyRect`, `pointInRect` primitives |
| `physics.js` | gravity + 2-axis integrate/resolve. Standard platformer math. |
| `platforms.js` | `platformColliders()` + `damageColliders()` filters |
| `parallax.js` | layer sort + opacity + repeatX rendering |
| `camera.js` | follow + clamp + shake |
| `particles.js` | `burstParticles` + `updateParticles` |
| `render.js` | scene draw orchestration, drawEntityAnimation helper |

### Starter (sensible defaults — fork for project-specific behavior)

Default implementations work for most side-scroll action games. When the
spec demands something different (e.g. wall-jump, dash, charged attack,
projectile-focused player) fork these files wholesale rather than adding
flags — clearer than option-flag spaghetti.

| File | Default behavior | When to fork |
|---|---|---|
| `entities/player.js` | run + double-jump + melee attack | wall-jump / dash / shield / charged attacks / ranged-only player |
| `entities/enemy.js` | patrol + chase + melee or ranged | flying enemy / multi-phase boss / spawner enemies |
| `entities/attack.js` | rectangle hitbox + slash VFX | beam attack / multi-hit combo / parry mechanic |
| `entities/projectiles.js` | straight-line ttl | homing / gravity-affected / spread shot |
| `scene.js` `updateScene` | linear scene play | branching levels / metroidvania map |
| `hud.js` | HP / lives / score | energy meter / combo meter / dialogue portrait |
| `dialogue.js` | story panel | barks / cutscene scripting / branching dialog |

### Recipe-fillable (left empty or stub)

The agent fills these per project spec, reading from `.ogf/recipes/side-scroll/`:

| File | Recipe | Purpose |
|---|---|---|
| `data/enemies.json` | `recipes/enemy-patrol.md` | enemy catalog (kind, stats, animations) |
| `data/pickups.json` | (inline simple) | pickup catalog (heal, points, key items) |
| `data/hazards.json` | `recipes/hazards.md` | hazard catalog (fire pits, spikes, ...) |
| `data/projectiles.json` | `recipes/projectiles.md` | projectile catalog (arrow, kunai, ...) |
| `data/items.json` | (inline simple) | inventory item catalog |
| `data/<level>.json` | `recipes/level-layout.md` | per-level layout (platforms, enemies, props) |
| `data/levels.json` | (registry) | maps level id → file |
| `data/player-config.json` | `recipes/player-config.md` | player stats + animation paths |

## Position model

**Top-left anchor**. `entity.x, entity.y` = top-left of bounding box.
`entity.w, entity.h` = bounding-box dimensions. `bodyInsetX, bodyInsetY`
shrinks the collision rect inward from the visual box.

Top-down RPG seed uses feet-anchor instead. Side-scroll keeps top-left
because:
1. Platform colliders in level JSON are authored as `{x, y, w, h}` (top-left)
2. Sprite atlases are authored top-left
3. Drag-resize math in OGF Scene editor expects top-left

## Two-axis collision resolution

Standard platformer pattern: move x, resolve walls; move y, resolve
platforms. See `physics.js` + `platforms.js`.

- `wall` colliders block x-axis only (vertical surfaces)
- `platform` colliders block y-axis only (horizontal top surfaces)
- `oneWay` platforms only block downward motion (jump up through)
- `hazard` / `kill` colliders DON'T block movement — read separately by
  `updateHazards` for damage

## Damage source contract

Two parallel arrays, both checked by `scene.js:updateHazards()`:

1. **`level.hazards[]`** — visible hazard entries with sprite + rect
   ```json
   { "id": "fire_01", "type": "fire_pit", "x": 930, "y": 556, "w": 96, "h": 44 }
   ```

2. **`level.colliders[]` with `type: "hazard"` or `"kill"`** — invisible
   damage zones (typically below platforms for pit-deaths)
   ```json
   { "id": "pit_kill", "shape": "rect", "x": 720, "y": 690, "w": 100, "h": 64, "type": "kill" }
   ```

`updateHazards` reads both. Avoid duplicating the same damage zone in
both arrays — pick the one that matches authoring intent (sprite =
hazards[], invisible kill plane = colliders[type:kill]).

## Entry id contract

Every entry in array fields MUST carry a unique `id` string:

```
level.platforms[]   .id
level.colliders[]   .id
level.hazards[]     .id
level.pickups[]     .id
level.enemies[]     .id
level.checkpoints[] .id
level.exits[]       .id (when array; dict form uses key as id)
```

OGF's Scene editor addresses by `id` for every move/resize/delete op.
The loader will auto-inject `<section>_<n>` ids if missing and write
back to disk, but authoring with explicit ids is cleaner.
