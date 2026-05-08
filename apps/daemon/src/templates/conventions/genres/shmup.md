# Genre — Shoot-em-up (shmup)

Vertical or horizontal scrolling shooter. Background autoscrolls; player constrained to viewport; enemies fly in formations from the edges; bullets everywhere.

**Canonical reference**: [Phaser official Coding Tips 7 — Shoot-em-up](https://phaser.io/tutorials/coding-tips-007). Plus [phaserjs/editor-example-shmup](https://github.com/phaserjs/editor-example-shmup) and the very rich [Chmood/shmup](https://github.com/Chmood/shmup) which has multiple shoot patterns.

> ⚠️ **OGF projects do NOT use Phaser** — vanilla Canvas 2D only. References are pattern inspiration. See `runtime-patterns.md` for the Phaser → vanilla translation table. Code samples below are vanilla canvas.
>
> ⚠️ **OGF Scene editor support for shmup is LIMITED**: spawn points + zones are drag-editable. Wave script + paths are JSON-only.

This file assumes you've read `runtime-patterns.md` (delta time, AABB, **object pooling for bullets — mandatory**, FSM).

> Note: "twin-stick shooter" (Enter the Gungeon-style) is a different genre — room-based with hand-crafted rooms stitched procedurally, much harder to template. OGF V1 only ships this scrolling shmup variant.

## Level data — wave script

Custom JSON. Background is a single tile (auto-scrolls), levels are sequences of waves arriving over time:

```json
{
  "id": "stage_1",
  "scrollAxis": "vertical",
  "scrollSpeed": 80,
  "viewport": { "width": 720, "height": 1280 },
  "background": {
    "tile": "assets/maps/space_tile.png",
    "tileH": 1280
  },
  "playerSpawn": { "x": 360, "y": 1100 },
  "playerBounds": { "x": 0, "y": 600, "w": 720, "h": 680 },

  "waves": [
    { "at":  2, "formation": "v_shape",  "enemyType": "scout",  "count": 7,  "spacing": 60, "path": "swoop_left" },
    { "at":  6, "formation": "line",     "enemyType": "scout",  "count": 5,  "spacing": 80, "path": "drop_down" },
    { "at": 12, "formation": "column",   "enemyType": "gunner", "count": 4,  "spacing": 90, "path": "weave"     },
    { "at": 28, "formation": "single",   "enemyType": "boss",   "count": 1,                 "path": "boss_intro" }
  ]
}
```

`scrollAxis: vertical` (top-down shmup, like Galaga) or `horizontal` (R-Type, Gradius style).

## Camera — autoscroll, fixed speed

Background scrolls automatically; player constrained to a sub-rectangle of the viewport (not the entire screen — leaves room for enemies to spawn ahead):

```js
function updateCamera(dt) {
  if (scrollAxis === 'vertical')   camera.y -= scrollSpeed * dt; // move world up
  else                              camera.x += scrollSpeed * dt;
}

function clampPlayer(player) {
  player.x = clamp(player.x, playerBounds.x, playerBounds.x + playerBounds.w - player.w);
  player.y = clamp(player.y, playerBounds.y, playerBounds.y + playerBounds.h - player.h);
}
```

Forced scroll = level pacing (Itay Keren calls this "autoscroll" in his camera essay). The player can dodge but never stop time.

## Background — segmented progression, NOT single tile

> ⚠️ **The biggest shmup feel-bug: single repeating tile makes the player feel "stuck in place"** even though the world is scrolling. The screen visibly moves but the same image keeps coming back, so brain reads "no progress". Players want to feel they're traversing distinct terrain.

### Use segmented backgrounds for the main stage

Schema v2 supports `tileMode: 'segments' + segmentImages[]`. **Use it for the main stage**:

```json
"layers": [
  {
    "id": "ground",
    "tileMode": "segments",
    "segmentImages": [
      "assets/maps/stage1/seg_field.png",      // 0-30s: rice fields
      "assets/maps/stage1/seg_forest.png",     // 30-50s: forest
      "assets/maps/stage1/seg_castle_approach.png" // 50-72s: castle gates
    ],
    "parallax": 0.55,
    "zIndex": 0
  }
]
```

3-5 segments per main stage gives clear environmental progression. Each segment is one camera-height (or camera-width for horizontal) sized.

### Single tile is FOR boss arena ONLY

Boss arena is a fixed-camera one-screen fight. Use a **single static `background: { image: "..." }`** (NOT a tiled scroll). It looks like a unique fight stage, not a continuation of the scroll.

```json
// boss arena:
"background": { "image": "assets/maps/boss_arena/throne_room.png" }
// NO scrollAxis, NO tile, NO segments
```

### Optional secondary parallax layer

If you want depth, add ONE additional layer (stars / clouds / smoke) at a different parallax factor. Keep the main `ground` segmented; the secondary layer can be single-image-loop:

```json
"layers": [
  {
    "id": "stars_far",
    "image": "assets/maps/stage1/stars.png",
    "parallax": 0.15,
    "zIndex": 0,
    "tileMode": "loop"
  },
  {
    "id": "ground",
    "tileMode": "segments",
    "segmentImages": [...],
    "parallax": 0.55,
    "zIndex": 1
  }
]
```

Don't go beyond 2 layers for shmup — the action has too much going on for player to register more.

## Bullets — object pooling is MANDATORY

Bullets fire 5+/sec, enemies fire too, screen has 50-200 alive bullets at peak. **Pool everything**:

```js
const playerBulletPool = makePool(200, () => ({ x: 0, y: 0, vx: 0, vy: 0, dmg: 1, alive: false }));
const enemyBulletPool  = makePool(400, () => ({ x: 0, y: 0, vx: 0, vy: 0, dmg: 1, alive: false }));

function spawnBullet(pool, x, y, vx, vy, dmg) {
  const b = pool.find(b => !b.alive);
  if (!b) return;
  b.alive = true; b.x = x; b.y = y; b.vx = vx; b.vy = vy; b.dmg = dmg;
}

function updateBullets(pool, dt) {
  for (const b of pool) {
    if (!b.alive) continue;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (offScreen(b)) b.alive = false;
  }
}
```

200-400 pre-allocated per side covers most cases. **Never `new Bullet()`** in the hot loop.

## Shoot patterns

Standard pattern types:

| Pattern | Behavior |
|---|---|
| `stream` | single line in shoot direction |
| `spread` | N projectiles in a fan (e.g. 5-fan ±20°) |
| `ring` | N projectiles around center, evenly spaced (boss attack) |
| `homing` | tracks target each frame |
| `lateral_pod` | side-mounted pods fire perpendicular |

```json
{ "id": "scout_shoot",  "pattern": "stream", "speed": 320, "interval": 1.2 },
{ "id": "boss_radial",  "pattern": "ring",   "speed": 180, "count": 16, "interval": 2.0 },
{ "id": "homing_missile","pattern":"homing", "speed": 240, "turnRate": 4.0 }
```

Each enemy has a `shootScript` referencing the pattern + cooldown. Decouples movement (path script) from shooting (pattern script).

## Enemy formations

Enemies arrive in groups. The formation determines where they appear relative to each other; the path determines how the formation moves through the screen.

```json
"waves": [
  { "at": 2, "formation": "v_shape", "enemyType": "scout", "count": 7,
    "spacing": 60, "path": "swoop_left", "interval": 0.15 }
]
```

`spacing` = pixels between enemies in the formation. `interval` = delay between successive spawns within the wave. `path` references a path defined elsewhere (could be a polyline, a sine wave function, or a parametric curve).

Common paths:

```js
const paths = {
  drop_down:  (t) => ({ x: 0, y: scrollSpeed * t * 1.5 }),
  swoop_left: (t) => ({ x: -200 + Math.sin(t * 2) * 100, y: t * 200 }),
  weave:      (t) => ({ x: Math.sin(t * 3) * 240,        y: t * 180 }),
  boss_intro: (t) => t < 2 ? { x: 0, y: 100 * t } : { x: Math.sin(t * 0.5) * 200, y: 200 }
};
```

## Player — aim direction

Vertical shmup: aim is fixed (up). Horizontal: fixed forward direction. Player position determines which enemies get hit by spread/ring patterns; aim doesn't rotate.

If the project asks for "free aim" — that's twin-stick territory, not shmup. Push back or genre-switch.

## Catalog patterns

```
data/
  enemies.json    ← scout, gunner, boss
  bullets.json    ← player_shot, enemy_basic, homing_missile
  weapons.json    ← player upgrades / power-ups
  paths.json      ← path scripts (or inline in level)
  levels.json     ← registry
  stage_1.json    ← per-stage (waves + scroll speed)
```

## Common pitfalls

1. **Per-shot `new Bullet()`** — GC stutter at 60+ shots/sec. **Pool mandatory.**
2. **Per-pixel collision** — overkill. AABB or circle.
3. **Hundreds of bullets as separate sprites in scene tree** — fine in Phaser up to ~1000; for vanilla canvas just iterate the pool.
4. **Forgetting to despawn off-screen bullets** — pool fills up, no new bullets fire.
5. **Adding twin-stick mechanics** — different genre. Free aim, room-based gameplay, hand-crafted dungeons. If user wants that, push back — OGF V1 doesn't model it.
6. **Letting player leave the playable bounds** — defines "stuck against scroll edge" UX. Always clamp player to `playerBounds`.

## Reference repos

- [Phaser Coding Tips 7](https://phaser.io/tutorials/coding-tips-007) — official walkthrough
- [phaserjs/editor-example-shmup](https://github.com/phaserjs/editor-example-shmup) — official example
- [Chmood/shmup](https://github.com/Chmood/shmup) — rich shoot patterns
