# Genre — Arena survivor

Vampire Survivors, Brotato style. Open arena, camera follows player, enemies spawn in waves around the player, weapons auto-fire.

**Canonical reference**: [Emanuele Feronato's Phaser VS prototype](https://emanueleferonato.com/2024/11/29/quick-html5-prototype-of-vampire-survivors-built-with-phaser-like-the-original-game/) — single-file canonical implementation. Bigger: [yudinikita/rick-survival](https://github.com/yudinikita/rick-survival) (Phaser 3 + TS, MIT).

> ⚠️ **OGF projects do NOT use Phaser** — vanilla Canvas 2D only. References are pattern inspiration. See `runtime-patterns.md` for the Phaser → vanilla translation table. Code samples below are vanilla canvas; copy those, not the linked Phaser code directly.
>
> ⚠️ **OGF Scene editor support for arena-survivor is PARTIAL**: spawn rings + boss spawn + pickups are drag-editable. Wave timeline is JSON-only in V1.

This file assumes you've read `runtime-patterns.md` (delta time, AABB, **object pooling for projectiles + enemies**, FSM).

## Level data — custom JSON, NOT tilemap

VS-style: arena is "infinite" (very large or wrapping). Brotato-style: arena is fixed bounded rectangle. Both share the same data shape:

```json
{
  "id": "endless_field",
  "arena": { "width": 4000, "height": 4000, "wrap": false },
  "viewport": { "width": 1280, "height": 720 },
  "background": {
    "tile": "assets/maps/grass_tile.png",
    "tileW": 256, "tileH": 256,
    "scrollWith": "camera"
  },
  "spawnRing": { "innerMargin": 80, "maxAlive": 300 },
  "waves": [
    { "startTime":   0, "duration": 60, "enemyType": "bat",      "minCount": 12, "interval": 1.5 },
    { "startTime":  60, "duration": 60, "enemyType": "skeleton", "minCount": 18, "interval": 1.0 },
    { "startTime": 120, "duration": 60, "enemyType": "wolf",     "minCount": 24, "interval": 0.8 },
    { "startTime": 180, "duration": 60, "enemyType": "bat",      "minCount": 30, "interval": 0.6,
      "modifier": "swarm" }
  ],
  "mapEvents": [
    { "at": 90,  "kind": "encircling_swarm",  "params": { "type": "bat", "count": 60 } },
    { "at": 240, "kind": "boss",              "params": { "type": "ancient_skull" } }
  ],
  "playerSpawn": { "x": 2000, "y": 2000 }
}
```

Per [VS wiki](https://vampire-survivors.fandom.com/wiki/Timed_Enemy_Spawn): "one wave every minute, with each wave specifying a minimum amount and a spawn interval". Map events (encircling swarm, sweep-across) are layered on top.

## Camera — rigid follow, bounds clamp

```js
camera.x = clamp(player.x - viewport.w/2, 0, arena.width  - viewport.w);
camera.y = clamp(player.y - viewport.h/2, 0, arena.height - viewport.h);
```

No deadzone, no lookahead. Player is at screen center.

## Background — tileable image, scrolls with camera infinitely

Arena-survivor's main field is a single tile (this genre IS one big repeating arena — that's the design, not a bug). Player movement creates the perception of motion via enemy/pickup positions changing relative to bg.

```js
function drawTiledBackground(ctx, img, tileW, tileH) {
  const offsetX = -((camera.x) % tileW);
  const offsetY = -((camera.y) % tileH);
  for (let x = offsetX; x < canvas.width;  x += tileW) {
    for (let y = offsetY; y < canvas.height; y += tileH) {
      ctx.drawImage(img, x, y);
    }
  }
}
```

Schema shape:
```json
"background": {
  "tile": "assets/maps/<level>/ground_tile.png",
  "tileW": 256,
  "tileH": 256,
  "scrollWith": "camera"
}
```

No parallax (single layer). The variety in arena-survivor comes from **wave content + map events**, not bg variation — that's the genre signature.

### Boss arena is DIFFERENT

When the user transitions to a boss arena (locked camera, fixed bounds), DON'T use `background.tile`. Use a **single static `background: { image: "..." }`** so the boss fight feels like a distinct stage, not "more of the same field":

```json
// honnoji_boss_arena.json:
"background": { "image": "assets/maps/honnoji_boss_arena/throne_floor.png" }
```

Boss arena image is sized = camera viewport (e.g. 1280×720), full-camera coverage. No tiling, no parallax.

## Enemy spawn — ring outside viewport (CANONICAL VS pattern)

The most important spawn pattern for this genre: **pick a random point on a ring just outside the visible viewport**. Enemy walks toward player from off-screen.

```js
function spawnEnemyRingOutside(player, viewport, margin = 80) {
  // Pick a random angle, place enemy at viewport edge + margin
  const theta = Math.random() * Math.PI * 2;
  const halfDiagonal = Math.hypot(viewport.w, viewport.h) / 2 + margin;
  const x = player.x + Math.cos(theta) * halfDiagonal;
  const y = player.y + Math.sin(theta) * halfDiagonal;
  return { x: clamp(x, 0, arena.width), y: clamp(y, 0, arena.height) };
}
```

Phaser-native: `Phaser.Geom.Rectangle.RandomOutside(outerRect, viewportRect)`.

**Anti-pattern**: spawning enemies uniformly in arena — half spawn off-screen / behind walls / nowhere visible. **Always spawn on the ring just outside player view**.

## Enemy AI — dumb chase

No pathfinding. Each enemy moves toward the player every frame:

```js
function updateEnemy(e, player, dt) {
  const dx = player.x - e.x;
  const dy = player.y - e.y;
  const len = Math.hypot(dx, dy);
  if (len > 0) {
    e.x += (dx / len) * e.speed * dt;
    e.y += (dy / len) * e.speed * dt;
  }
}
```

Enemies push each other (simple repulsion) so they don't stack into one tight cluster. Despawn if `dist(enemy, player) > arena.maxLeash` (e.g. 2× viewport diagonal).

## Hard cap on alive enemies

VS caps total alive enemies at ~300 to prevent frame drops. Hard cap, not soft:

```js
if (alive.length >= spawnRing.maxAlive) return; // skip this spawn tick
```

When the cap is hit, periodic-wave spawns pause. Boss / map-event spawns ignore the cap.

## Player attacks — auto-target, weapon timers

Player has no manual aim. Weapons fire automatically on a timer; each weapon picks its target based on its pattern:

| Weapon kind | Target / pattern |
|---|---|
| `forward` | nearest enemy in player's facing direction |
| `ring` | radial — N projectiles at evenly-spaced angles |
| `orbit` | rotating around player |
| `area` | damage all enemies within radius |
| `homing` | tracks nearest enemy each frame |

```json
"weapons": [
  { "kind": "forward",  "id": "magic_wand", "cooldown": 1.2, "damage": 5,  "projectiles": 1 },
  { "kind": "ring",     "id": "garlic",    "cooldown": 0.0, "damage": 1,  "radius": 96, "tickEvery": 0.5 },
  { "kind": "homing",   "id": "axe",       "cooldown": 2.5, "damage": 12, "projectiles": 3 }
]
```

`closestEnemy(player)` cached per weapon for ~0.2s — refreshing every frame is wasteful with 200+ enemies.

## Pickups — magnet radius

Pickups are physics objects with a "magnet radius" — within that, they accelerate toward the player:

```js
function updatePickup(p, player, dt) {
  const dx = player.x - p.x;
  const dy = player.y - p.y;
  const len = Math.hypot(dx, dy);
  if (len < player.magnetRadius) {
    p.x += (dx / len) * 600 * dt; // 600 px/s magnet pull
    p.y += (dy / len) * 600 * dt;
  }
  if (len < 20) {
    player.collect(p);
    p.alive = false;
  }
}
```

## Catalog patterns

```
data/
  enemies.json     ← bat, skeleton, wolf, ancient_skull
  weapons.json     ← magic_wand, garlic, axe
  pickups.json     ← xp_orb, gold, chicken
  upgrades.json    ← per-level player choices (HP+, speed+, weapon evolutions)
  levels.json      ← registry
  endless_field.json ← per-level (waves + map events + arena)
```

## Common pitfalls

1. **No max-enemy cap** → 1000 enemies → 5fps. Always cap (~300 alive).
2. **Spawning enemies uniformly in arena** — half spawn invisible. Use ring-outside-viewport.
3. **Bullets/projectiles allocated per-shot** — GC stutter. **Use object pool** (mandatory).
4. **`closestEnemy` for every projectile every frame** — quadratic. Cache target per weapon, refresh every N frames.
5. **Trying to add tilemap walls** — doesn't fit the genre. If walls needed, use rect colliders, but most VS-likes are open arena.
6. **Adding parallax** — not VS-pattern. Single tiled background only.

## Reference repos

- [Emanuele Feronato VS prototype](https://emanueleferonato.com/2024/11/29/quick-html5-prototype-of-vampire-survivors-built-with-phaser-like-the-original-game/) — single-file canonical
- [yudinikita/rick-survival](https://github.com/yudinikita/rick-survival) — fuller (TS, MIT)
- [jc-alvaradov/vampire-clone](https://github.com/jc-alvaradov/vampire-clone) — vanilla JS shape
- [VS wiki — Timed Enemy Spawn](https://vampire-survivors.fandom.com/wiki/Timed_Enemy_Spawn)
