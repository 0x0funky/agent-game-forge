# Recipe — Enemy patrol AI (melee + ranged)

Implements a basic patrol AI: enemy walks back and forth between bounds,
turns around at edges, optionally attacks when player enters range.
Covers melee (close-range damage on contact) and ranged (spawn
projectiles) variants from one code path.

## When to use

- Side-scroll action with ground-based enemies (ashigaru, ronin, slime)
- 1-3 enemy archetypes per level
- Patrol-based, not pathfinding-based (no A* needed)
- Ranged enemies use single-projectile-type per shot (one fireball at a
  time, not spread)

## When NOT to use

- **Flying enemies / aerial pathfinding** — fork; add y movement and
  remove gravity from those entities
- **Boss AI** (multi-phase, scripted) — fork `entities/enemy.js` into
  `entities/boss.js`; bosses get unique state machines
- **Stealth-based AI** (line of sight, alert states) — write from scratch
- **Swarm AI** (Vampire Survivors) — different shape (no patrol bounds)

## Files this affects

- `src/entities/enemy.js` — main AI module (~120 LOC)
- `data/enemies.json` — IDENTITY: per-kind stats + animations
- `data/<level>.json` `enemies[]` — placement (x, y, facing, patrol
  bounds)
- `src/entities/projectiles.js` — used by ranged variant
- `data/projectiles.json` — IDENTITY: per-projectile-kind stats

## Pattern

### 1. Enemy catalog (data/enemies.json)

```json
[
  {
    "id": "ashigaru_spearman",
    "kind": "melee",
    "name": "Ashigaru Spearman",
    "size": { "w": 52, "h": 70 },
    "bodyInsetX": 11, "bodyInsetY": 8,
    "stats": {
      "hp": 2, "damage": 1, "speed": 65, "score": 100,
      "attackRange": 60, "attackCooldown": 0.9
    },
    "animations": {
      "idle":   { "sprite": "assets/sprites/ashigaru_spearman/idle/sheet-transparent.png" },
      "walk":   { "sprite": "assets/sprites/ashigaru_spearman/walk/sheet-transparent.png" },
      "attack": { "sprite": "assets/sprites/ashigaru_spearman/attack/sheet-transparent.png" }
    }
  },
  {
    "id": "yumi_archer",
    "kind": "ranged",
    "name": "Yumi Archer",
    "size": { "w": 50, "h": 68 },
    "bodyInsetX": 11, "bodyInsetY": 8,
    "stats": {
      "hp": 1, "damage": 1, "speed": 0, "score": 150,
      "shootRange": 520, "attackCooldown": 1.4
    },
    "projectile": "arrow",
    "animations": {
      "idle":   { "sprite": "assets/sprites/yumi_archer/idle/sheet-transparent.png" },
      "attack": { "sprite": "assets/sprites/yumi_archer/attack/sheet-transparent.png" }
    }
  }
]
```

### 2. Level placement

```json
"enemies": [
  { "id": "spearman_01", "type": "ashigaru_spearman", "x": 980, "y": 532, "facing": -1, "patrol": { "minX": 880, "maxX": 1230 } },
  { "id": "archer_01",   "type": "yumi_archer",       "x": 1220, "y": 396, "facing": -1 }
]
```

- `type` — catalog id (joined via `byId("enemies", type)`)
- `patrol` — only for melee; ranged stays put

### 3. Update loop

`updateEnemies(dt)` in `entities/enemy.js`:

For each enemy:
1. Apply gravity, run `integrateEntity` against platform colliders
2. If `kind === "melee"`: patrol math
   - If `patrol` set: walk at `speed * facing`, flip at minX/maxX
   - If `patrol` unset: stand still
   - On contact with player body: `damagePlayer` (if `attackCooldown <= 0`)
3. If `kind === "ranged"`:
   - Stand still
   - If player within `shootRange`: spawn projectile, reset cooldown
4. Update `hurtTimer` (for damage flash)
5. Decrement removeTimer on dead enemies, remove from array when ≤ 0

### 4. Death sequence

When `enemy.hp <= 0`:
- `enemy.dead = true`
- `enemy.removeTimer = 0.4` (delay before splice)
- Particles burst (gold)
- Score added to `state.score`
- Render skips dead enemies (`if (enemy.dead) continue`) — they're just
  reserved in the array until removeTimer hits 0 for transitions

## Adaptation knobs

| Knob | Where | Effect |
|---|---|---|
| `kind` | enemies.json | `melee` / `ranged` / `boss` |
| `speed` | enemies.json | Patrol walking speed |
| `attackRange` (melee) | enemies.json | Distance for contact damage |
| `shootRange` (ranged) | enemies.json | Distance to fire projectile |
| `attackCooldown` | enemies.json | Min seconds between attacks |
| `patrol.minX / maxX` | level enemies[] | Bounds; omit for stationary |
| `facing` initial | level enemies[] | Start direction (1 / -1) |

## Common mistakes

1. **Patrol bounds same as enemy.x** — enemy walks zero distance, snaps
   to wall, flips, snaps back. Always give a 200+ px patrol window.

2. **Patrol bound past platform edge** — enemy walks off ledge, falls
   into pit. Either keep patrol within the platform's x extent, OR add
   ledge-detection (check if next step has ground under it).

3. **Ranged with shootRange < player jump distance** — player can jump
   close and melee the archer before it shoots. Either give archer
   `attackRange` for contact damage too, OR move archer to a perch.

4. **No `removeTimer`** — dead enemy disappears instantly, no death pose
   visible. Half-second hold lets the player feel the kill.

5. **Patrol turns mid-frame causing facing flicker** — use `if (x <= minX
   && facing < 0) facing = 1` (one-shot flip), not `facing = (x < center
   ? 1 : -1)` (re-evaluates every frame).

## Reference

`D:/Sengoku-Era-act-ogf/src/entities/enemy.js` + `data/enemies.json`.
