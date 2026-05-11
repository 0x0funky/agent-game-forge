# Recipe — Projectiles (arrows / kunai / fireballs)

Implements traveling projectiles spawned by ranged enemies or the player.
Straight-line motion, lifetime + range, collision against player body
and platform colliders.

## When to use

- Ranged enemies (archers, gunners, magic-casters)
- Player ranged attack (separate from melee)
- Both single-shot and bursts (catalog supports multiple types)

## When NOT to use

- **Homing projectiles** — fork; this is straight-line only
- **Gravity-affected projectiles** (grenades, arc-shots) — fork and add
  ballistic update
- **Beam attacks** (instant raycast, no travel time) — write separately;
  beams don't fit the entity-with-position model
- **Spread shot / explosion** — fork the spawn logic to emit N projectiles
  per call

## Files this affects

- `src/entities/projectiles.js` — main module (~35 LOC)
- `src/entities/enemy.js` — ranged enemies spawn via `spawnProjectile()`
- `data/projectiles.json` — IDENTITY catalog (kind, speed, damage, sprite)
- `assets/sprites/projectiles/<kind>/clean.png` — projectile sprite

## Pattern

### 1. Catalog

```json
[
  { "id": "arrow", "speed": 540, "damage": 1, "lifespan": 1.8, "size": { "w": 38, "h": 14 }, "sprite": "assets/sprites/projectiles/arrow/clean.png" },
  { "id": "kunai", "speed": 620, "damage": 1, "lifespan": 1.4, "size": { "w": 26, "h": 18 }, "sprite": "assets/sprites/projectiles/kunai/clean.png" }
]
```

- `speed` px/sec (horizontal)
- `damage` HP loss on hit
- `lifespan` seconds before auto-despawn
- `size` collision + render dimensions

### 2. Spawn (from enemy)

In `entities/enemy.js` ranged AI:
```js
if (canShoot && enemy.attackCooldown <= 0) {
  const type = byId("projectiles", enemy.projectile);
  if (!type) return;
  const dir = enemy.x < state.player.x ? 1 : -1;
  state.projectiles.push({
    typeId: type.id,
    x: enemy.x + (dir > 0 ? enemy.w : 0),
    y: enemy.y + enemy.h * 0.35,
    w: type.size.w,
    h: type.size.h,
    vx: type.speed * dir,
    vy: 0,
    damage: type.damage,
    ttl: type.lifespan,
    facing: dir,
    sprite: type.sprite,
    dead: false
  });
  enemy.attackCooldown = enemy.stats.attackCooldown;
}
```

### 3. Update loop

`updateProjectiles(dt)` in `entities/projectiles.js`:
```js
for (const p of state.projectiles) {
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.ttl -= dt;
  if (p.ttl <= 0) { p.dead = true; continue; }
  // Hit player
  if (rectsOverlap(p, bodyRect(state.player))) {
    damagePlayer(p.damage, p.facing);
    p.dead = true;
    continue;
  }
  // Hit wall / platform
  for (const col of platformColliders(state.level)) {
    if (rectsOverlap(p, col)) {
      p.dead = true;
      burstParticles(p.x, p.y, 4, COLORS.smoke);
      break;
    }
  }
}
state.projectiles = state.projectiles.filter((p) => !p.dead);
```

### 4. Render

`drawProjectiles(ctx)` in `render.js`:
- Use `resolvedImage(p.sprite)` to get the cached image
- Flip horizontally if `p.facing < 0` (same pattern as drawEntityAnimation)
- Fallback colored rect if image not loaded

## Adaptation knobs

| Knob | Where | Effect |
|---|---|---|
| `speed` | projectiles.json | Travel speed (higher = harder to dodge) |
| `damage` | projectiles.json | HP loss on hit |
| `lifespan` | projectiles.json | Max travel time (= range) |
| `size` | projectiles.json | Collision + sprite dimensions |
| Spawn offset | enemy.js spawn code | Where on enemy body the projectile emerges |

## Common mistakes

1. **No `dead` flag + array splice mid-loop** — splicing while iterating
   skips entries. Always mark `dead = true` in the loop, filter at end.

2. **No `lifespan`** — projectiles that miss travel forever, eating
   memory + CPU. Always set lifespan (typically range / speed = 1–2s).

3. **Spawn position inside enemy body** — projectile immediately
   self-collides if the spawn x is within enemy bounds. Offset by
   `enemy.w * (dir > 0 ? 1 : -1)` to spawn at the muzzle.

4. **No platform collision** — arrows pass through walls. Always check
   against `platformColliders(state.level)`. Or restrict to `wall`-only
   if you want projectiles to fly over platforms.

5. **Facing snapshot at update, not spawn** — if you compute `dir` from
   `p.vx > 0` each frame, it's redundant. Capture once at spawn (`p.facing
   = dir`) and use for render flip + damage knockback.

## Reference

`D:/Sengoku-Era-act-ogf/src/entities/projectiles.js` +
`data/projectiles.json` (arrow).
