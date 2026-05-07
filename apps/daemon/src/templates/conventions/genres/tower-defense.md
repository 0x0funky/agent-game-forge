# Genre — Tower defense

Kingdom Rush, Bloons-style. Path-based enemy waves, grid tower placement, single-screen camera (or limited scroll).

**Canonical reference**: [Phaser official Tower Defense tutorial](https://gamedevacademy.org/how-to-make-tower-defense-game-with-phaser-3/) — covers grid + polyline path + wave + targeting in one file. For pathfinding theory if path becomes dynamic: [Red Blob Games](https://www.redblobgames.com/pathfinding/tower-defense/).

This file assumes you've read `runtime-patterns.md` (delta time, AABB, FSM, **object pooling** for projectiles).

## Level data — hybrid: grid + polyline path

TD doesn't fit Tiled/LDtk well — the path is a graph, not tiles. Use custom JSON:

```json
{
  "id": "guandu_pass",
  "mapSize":  { "width": 1280, "height": 720 },
  "viewport": { "width": 1280, "height": 720 },
  "background": "assets/maps/guandu_pass/background.png",
  "camera":  { "mode": "locked", "x": 0, "y": 0, "w": 1280, "h": 720 },

  "grid":    { "cellSize": 64, "cols": 20, "rows": 11 },

  "paths": [
    {
      "id": "main_road",
      "points": [
        { "x": -40,  "y": 342 },   // off-screen spawn
        { "x": 290,  "y": 410 },
        { "x": 605,  "y": 505 },
        { "x": 895,  "y": 265 },
        { "x": 1320, "y": 280 }    // off-screen goal
      ]
    }
  ],

  "buildSpots": [
    { "id": "pad_archer_01", "x": 134, "y": 154, "w": 72, "h": 72,
      "allowed": ["archer_roost", "strategist_drum"] },
    { "id": "pad_fire_01",   "x": 327, "y": 267, "w": 76, "h": 76,
      "allowed": ["fire_pot_tower", "archer_roost"] }
  ],

  "waves": [
    { "delay": 1.0, "groups": [{ "type": "scout", "count": 8,  "interval": 0.75 }] },
    { "delay": 4.0, "groups": [{ "type": "scout", "count": 12, "interval": 0.58 }] },
    { "delay": 5.0, "groups": [
      { "type": "scout",      "count": 8, "interval": 0.6 },
      { "type": "saboteur",   "count": 4, "interval": 1.1 }
    ]}
  ],

  "heroSpawn": { "x": 610, "y": 580 }
}
```

`paths[]` is plural array (not singular object). Each path is a polyline (line segments). **Don't use bezier** — Kingdom Rush's smoothness comes from rendering curved tiles ON TOP of straight segments, not from bezier path math.

`buildSpots` is rect (`x, y, w, h`), not radius. Player taps a spot to open the tower picker.

## Camera — static

TD levels typically fit one screen. `camera.mode = locked`, `mapSize === viewport`. If the level is wider, optional drag-to-pan with bounds — no follow.

## Enemy movement — path follower

Each enemy has a parameter `t ∈ [0, 1]` representing progress along the path. Each frame:

```js
function updateEnemy(e, path, dt) {
  e.t += (e.speed * dt) / path.totalLength;
  if (e.t >= 1) {
    // reached goal — leak life or despawn
    return 'goal';
  }
  const point = pointAlongPath(path, e.t);
  e.x = point.x;
  e.y = point.y;
  e.facing = pathTangent(path, e.t); // direction of next segment
}

// pointAlongPath: walk path segments, return interpolated point
function pointAlongPath(path, t) {
  const target = t * path.totalLength;
  let acc = 0;
  for (let i = 1; i < path.points.length; i++) {
    const segLen = dist(path.points[i-1], path.points[i]);
    if (acc + segLen >= target) {
      const local = (target - acc) / segLen;
      return lerpPoint(path.points[i-1], path.points[i], local);
    }
    acc += segLen;
  }
  return path.points[path.points.length - 1];
}
```

Cache `path.totalLength` once on level load. Don't recompute every frame.

## Tower targeting — first by default

When a tower's cooldown expires, pick a target. Default policy: **first** (enemy with highest `t` along path — closest to goal). Other policies: nearest (least distance), strongest (highest HP), weakest (lowest HP). Make the policy a tower stat:

```json
{ "id": "archer_roost", "range": 220, "cooldown": 1.0,
  "damage": 1, "targeting": "first", "projectile": "arrow" }
```

**Anti-pattern**: recompute target every frame for every tower for every enemy → O(towers × enemies × cooldown_frames). Cache target per tower; refresh only on cooldown trigger or when target dies.

For very large enemy counts, use spatial hashing (grid bucket of enemies). Premature for V1.

## Projectiles — object pool

Bullets/arrows spawn frequently → use a pool (see `runtime-patterns.md` §5).

```json
{ "id": "arrow", "speed": 800, "damage": 1, "homing": false }
```

Homing: arrow tracks its target each frame. Ballistic: arrow fires toward the target's predicted position at fire time, no further tracking.

## Wave timeline

`waves[]` plays sequentially. Each wave has `delay` (seconds before THIS wave starts after the previous wave's last spawn). Each wave has `groups[]` — concurrent spawn batches.

Skip / fast-forward UI: standard TD QoL. Convention spec records "wave timing is editable in OGF Scene tab Timeline view (when shipped)" — for V1, hand-edit the JSON.

## Catalog patterns

```
data/
  enemies.json       ← scout, saboteur, boss
  towers.json        ← archer_roost, fire_pot_tower, strategist_drum
  projectiles.json   ← arrow, fire_pot, drum_wave
  pickups.json       ← rare; some TDs have power-ups
  waves.json         ← optional; usually inline in level
  levels.json        ← registry
  guandu_pass.json   ← per-level (path + buildSpots + waves)
```

## Common pitfalls

1. **Bezier paths** — oversold. Polyline + curved-tile render is the standard.
2. **Storing path as grid waypoints with cardinal-only segments** — looks blocky. Use direct polyline with diagonals; render curved tiles on top if needed.
3. **Recomputing tower target every frame** — quadratic. Cache + invalidate.
4. **Tower placement allowing overlap** — always check `buildSpots[].allowed` AND that the spot is unoccupied.
5. **Background image dim ≠ mapSize** — coordinate misalignment between Scene tab and Play tab.
6. **Per-bullet `new Bullet()`** — GC stutter. Pool projectiles.

## Reference repos

- [Phaser official TD tutorial](https://gamedevacademy.org/how-to-make-tower-defense-game-with-phaser-3/)
- [SerhiiChoGames/tower-defense](https://github.com/SerhiiChoGames/tower-defense) — fuller project
- [rexrainbow PathFollower notes](https://rexrainbow.github.io/phaser3-rex-notes/docs/site/pathfollower/)
- [Red Blob — Pathfinding for Tower Defense](https://www.redblobgames.com/pathfinding/tower-defense/) — only if path needs to be dynamic
