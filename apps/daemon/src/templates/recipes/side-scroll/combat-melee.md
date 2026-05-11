# Recipe — Melee attack (sword swing / punch)

Implements a player melee attack: rectangular hitbox spawned in front of
the player for a short active window, with hit tracking so each enemy
takes damage at most once per swing. Includes a chunky procedural slash
VFX (no extra sprite assets needed).

## When to use

- Side-scroll action with sword / spear / fist (Mega Man Zero, Castlevania,
  Shinobi)
- Player has 1 melee attack with cooldown
- Attack should hit multiple enemies in one swing if they overlap the
  hitbox
- Want a slash visual but don't want to generate FX sprite sheets

## When NOT to use

- **Combo attacks** (3-hit chain, light/heavy) — fork `entities/attack.js`
  and add a chain counter; this single-swing pattern doesn't extend
  cleanly
- **Ranged-only player** (Mega Man-style buster) — delete entities/attack.js
  entirely, only use projectiles
- **Charged attack** (hold to power up) — fork with a charge timer +
  damage scaling; not a default
- **Aim-direction attack** (8-direction or mouse aim) — change hitbox
  spawn math (relies on `player.facing` ±1 here)

## Files this affects

- `src/entities/attack.js` — main module (~75 LOC reference)
- `src/render.js` — `drawAttacks(ctx)` for the slash VFX
- `data/player-config.json` — TUNING: `attack` block (damage, range,
  height, duration, activeTime, cooldown)

Player input + animation hook is in `src/entities/player.js`:
```js
if (wasPressed("attack") && p.attackCooldown <= 0) startPlayerAttack();
```

## Pattern

### 1. Spawn the hitbox

`startPlayerAttack()` in `entities/attack.js`:
- Reads `cfg("player").attack` for tuning (damage, range, height, duration,
  activeTime, cooldown)
- Sets `player.attackTimer` (animation duration) + `player.attackCooldown`
  (rate-limit next swing)
- Pushes a hitbox entry to `state.attacks[]`:
  ```js
  {
    owner: "player",
    x: dir > 0 ? player.x + player.w - 12 : player.x - atk.range + 12,
    y: player.y + 20,
    w: atk.range,
    h: atk.height,
    damage: atk.damage,
    ttl: atk.activeTime,   // active window for hit checks
    dur: atk.activeTime,   // total duration (for VFX progress calc)
    dir,                   // facing snapshot (slash visual anchors to it)
    hit: new Set()         // tracks which enemies got hit (no double-tap)
  }
  ```
- Calls `burstParticles(originX, footY, 4, COLORS.smoke)` for dust puff at
  swing origin

### 2. Tick + hit detection

`updateAttacks(dt)` runs once per frame:
- Decrement `atk.ttl`
- For player-owned attacks: call `hitEnemies(atk)` to check overlaps
- `hitEnemies` iterates `state.enemies`, skips already-hit ones (`atk.hit.has(enemy.uid)`),
  damages on rect overlap with enemy's `bodyRect`
- Filter `state.attacks = state.attacks.filter(a => a.ttl > 0)` at end of
  the update — dead hitboxes drop out

### 3. Damage application

`damageEnemy(enemy, amount, dir)`:
- Decrements `enemy.hp`
- `enemy.hurtTimer = 0.18` (used by render for flash)
- Knockback: `enemy.vx += dir * 90`
- `burstParticles(enemy.center, 8, COLORS.gold)` for hit sparks
- `screenshake(4, 0.1)`
- On `hp <= 0`: `enemy.dead = true`, `enemy.removeTimer = 0.4` (allows
  death anim window before cleanup), boss-defeat flag if boss

### 4. Render the slash

`drawAttacks(ctx)` in `render.js`:
- Compute `progress = 1 - ttl / dur` (0→1)
- `fade = sin(progress * π)` (0→1→0 envelope)
- Draw 4 chunky parallel bands (top→bottom rake), middle bands hot white,
  outer bands muted gold
- Each band sweeps forward as progress advances (length tracks progress)
- Leading-edge spark in first 45% of swing (drops off so it doesn't trail)

## Adaptation knobs

| Knob | Where | Default | Effect |
|---|---|---|---|
| `attack.damage` | player-config.json | 1 | Per-hit damage |
| `attack.range` | player-config.json | 74 | Hitbox width (px) |
| `attack.height` | player-config.json | 44 | Hitbox height |
| `attack.duration` | player-config.json | 0.22 | Animation/attack-timer (player can't move-cancel) |
| `attack.activeTime` | player-config.json | 0.12 | Window the hitbox damages enemies |
| `attack.cooldown` | player-config.json | 0.28 | Minimum gap between swings |
| Slash band count | render.js `drawAttacks` | 4 | More = denser visual |
| Slash colors | render.js `drawAttacks` | white + gold | Match spec palette |

## Common mistakes

1. **No `atk.hit` Set** — same enemy gets hit on every frame the hitbox
   overlaps. Always track which enemies the hitbox already damaged.

2. **Storing `player.facing` reference, not snapshot** — if player turns
   mid-swing, the hitbox flips. Snapshot `dir = player.facing` at spawn
   and use `atk.dir` in the visual.

3. **Active window === animation duration** — keep them separate.
   `duration` = how long player is "in attack pose" (locks player anim);
   `activeTime` = how long the hitbox can damage. Usually `activeTime <
   duration` so the swing has wind-up + wind-down frames where you can't
   hit but you can't act either.

4. **No cooldown** — without it, mashing attack lets player vacuum-cleaner
   through enemies. `cooldown ≥ duration` (or slightly less for combo
   feel).

5. **Hitbox spawned at player.x** — for a right-facing swing, hitbox
   should start at `player.x + player.w` (in front), not at `player.x`
   (player's own center). Mirror for left-facing.

## Reference

`D:/Sengoku-Era-act-ogf/src/entities/attack.js` — the polished implementation
this recipe is based on (75 LOC).
