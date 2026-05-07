# Genre — Top-down RPG

Pokemon-style overworld + interior, Stardew Valley-ish exploration. Single-screen or scrolling map with NPCs, dialogue, simple movement.

**Canonical reference**: [Mike Hadley's Modular Game Worlds in Phaser 3 — Tilemaps part 1](https://github.com/mikewesthad/phaser-3-tilemap-blog-posts/blob/master/posts/post-1/README.md). Canonical Pokemon-style top-down done right. Read it before phase 1.

This file assumes you've read `runtime-patterns.md` (delta time, AABB, FSM, **Y-sort**, etc).

## Level data — three stacked tilemap layers

Top-down RPG tilemaps follow the **three-layer convention**:

1. **Below Player** — ground, paths, water (visual; no collision).
2. **World** — walls, fences, trees-trunks (visual + collision).
3. **Above Player** — treetops, signs, awnings (visual; rendered ON TOP of player so the player can walk "behind" them).

Plus an **objectgroup** layer for NPC spawns, doors, dialog triggers, item pickups.

### Recommended format: LDtk for new projects

[LDtk JSON](https://ldtk.io/docs/general/json-overview/) is well-typed, has working JS loaders, and is what new indie 2D projects default to. Tiled JSON is fine for ports/legacy.

If LDtk is overkill (small project, agent doesn't need editor support), use a custom JSON:

```json
{
  "id": "starter_town",
  "tileset": "assets/maps/tileset.png",
  "tileSize": 32,
  "mapSize": { "width": 50, "height": 30 },  // in tiles
  "layers": [
    { "name": "below_player", "tiles": [[1,1,2,2,...], ...] },  // 2D array of tile IDs
    { "name": "world",        "tiles": [[0,0,5,0,...], ...], "collision": true },
    { "name": "above_player", "tiles": [[0,0,0,8,...], ...] }
  ],
  "objects": [
    { "kind": "npc",     "id": "elder_alma",  "x": 320, "y": 480, "dialog": "intro_alma" },
    { "kind": "door",    "id": "to_house_01", "x": 224, "y": 320, "to": "house_01" },
    { "kind": "trigger", "id": "shrine_intro", "x": 800, "y": 240, "w": 48, "h": 48, "event": "shrine_text" }
  ]
}
```

`tile ID = 0` is empty. Any positive ID indexes into the tileset.

## Camera — rigid follow, no deadzone, no lookahead

Top-down doesn't have a "facing direction the player wants to peek further into" the way side-scrollers do. Center the player rigidly:

```js
camera.x = clamp(player.x + player.w/2 - viewport.w/2, 0, mapSize.width  * tileSize - viewport.w);
camera.y = clamp(player.y + player.h/2 - viewport.h/2, 0, mapSize.height * tileSize - viewport.h);
```

Optional smoothing (lerp 0.1–0.15) for less abrupt teleports between rooms. Camera mode in spec: `follow` always, no `followLead` parameter.

## Background — single tilemap, no parallax

Top-down genres have no parallax. Background = tilemap. Period. If the user asks for "depth", that's not how top-down works — push back.

Sub-screens (interiors, caves, shops) are separate level files (`data/house_01.json`) loaded on door interaction. Don't try to keep all sub-areas in one map.

## Sprites — `4_direction` direction strategy

Top-down characters need facing in 4 directions (or 8 if the project asks). Generate FOUR sheets per character per action:

```
ronin_walk_up.png    (4 frames)
ronin_walk_down.png  (4 frames)
ronin_walk_left.png  (4 frames)
ronin_walk_right.png (4 frames)
```

OR generate 1 sheet per direction-action and reference them in the catalog:

```json
"animations": {
  "walk-up":    { "sprite": ".../ronin/walk-up/sheet.png" },
  "walk-down":  { "sprite": ".../ronin/walk-down/sheet.png" },
  "walk-left":  { "sprite": ".../ronin/walk-left/sheet.png" },
  "walk-right": { "sprite": ".../ronin/walk-right/sheet.png" },
  "idle-up":    { "sprite": ".../ronin/idle-up/sheet.png" },
  "idle-down":  { "sprite": ".../ronin/idle-down/sheet.png" },
  ...
}
```

Animation state combines movement state + last facing direction:

```js
const state = (player.vx === 0 && player.vy === 0) ? 'idle' : 'walk';
const dir = player.lastDir; // 'up' | 'down' | 'left' | 'right'
const animKey = `${state}-${dir}`;
```

## Y-sort is mandatory

Without Y-sort, the player walks "in front of" everything regardless of their Y position. Sort dynamic entities by Y each frame:

```js
function renderDynamicEntities(ctx) {
  const entities = [player, ...npcs, ...enemies];
  entities.sort((a, b) => a.y - b.y);
  for (const e of entities) e.draw(ctx);
}
```

Static layers (below_player, above_player) get fixed depth — they don't participate in dynamic sort.

## Dialogue triggers — object zones, not tile properties

Dialogue / NPC interaction uses object-zone overlap, not tile-property checks. Tile-property checks break when tiles change.

```json
"objects": [
  { "kind": "trigger", "id": "shrine_intro",
    "x": 800, "y": 240, "w": 48, "h": 48,
    "event": "shrine_text" }
]
```

Runtime: each frame, check if player's collision box overlaps any trigger zone. Fire `event` once on entry; clear flag on exit.

## Movement — normalize diagonal speed

Diagonal speed = `sqrt(2) × cardinal speed` if you don't normalize. Always normalize the input vector:

```js
let vx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
let vy = (input.down  ? 1 : 0) - (input.up   ? 1 : 0);
const len = Math.hypot(vx, vy);
if (len > 0) { vx /= len; vy /= len; }
player.x += vx * player.speed * dt;
player.y += vy * player.speed * dt;
```

## Catalog patterns

```
data/
  npcs.json              ← catalog of NPC types (name, dialog ref, sprite ref)
  enemies.json           ← if combat exists
  items.json             ← inventory items
  dialogues.json         ← lines keyed by event id (e.g. "shrine_text")
  levels.json            ← registry of all level files
  starter_town.json      ← per-level
  house_01.json          ← per-level (interior)
```

## Common pitfalls

1. **Forgetting Y-sort** — player draws over trees regardless of position.
2. **Putting "above_player" in same group as collision** — breaks render order.
3. **Diagonal not normalized** — player moves 1.4× faster on diagonals than cardinals.
4. **Triggering dialog from tile properties** — fragile; use object zones.
5. **Trying to add parallax** — top-down doesn't have parallax. Push back if asked.
6. **All NPC dialogues hardcoded in source** — put them in `data/dialogues.json`.

## Reference repos

- [mikewesthad/phaser-3-tilemap-blog-posts post-1](https://github.com/mikewesthad/phaser-3-tilemap-blog-posts/blob/master/posts/post-1/README.md)
- [LDtk docs](https://ldtk.io/docs/) — modern indie level format
- [boxerbomb/PokemonClone](https://github.com/boxerbomb/PokemonClone) — fuller game shape
- [Phaser z-order tutorial](https://phaser.io/news/2016/03/z-order-tutorial) — Y-sort
