# Recipe — Hazards (fire/spike) and pit deaths

Implements environmental damage: visible hazard sprites that hurt player
on touch, and invisible kill zones (pit-deaths below platforms).

## When to use

- Side-scroll with environmental obstacles (fire pits, spike traps,
  saw blades, lava)
- Want both VISIBLE damage tiles AND invisible pit-kill zones
- Player should die or lose HP from these — not just block movement

## When NOT to use

- **No hazards at all** — empty `hazards[]` and no `kill` colliders
- **One-hit kill on everything** (Super Meat Boy) — use only `kill`
  colliders, no `hazard` colliders
- **Damage zones with bespoke logic** (poison cloud that ticks HP over
  time) — fork; this pattern is one-time damage on overlap

## Files this affects

- `src/scene.js` — `updateHazards()` reads both arrays (~20 LOC)
- `src/platforms.js` — `damageColliders()` filter (~3 LOC)
- `data/hazards.json` — IDENTITY catalog (fire_pit / spike_stakes / lava_pool / ...)
- `data/<level>.json` `hazards[]` and `colliders[]` arrays
- `assets/sprites/hazards/<kind>/clean.png` — hazard sprites

## Pattern

### Two damage sources

The runtime checks BOTH in `updateHazards()`:

**(A) `level.hazards[]`** — visible hazard with sprite + rect
```json
"hazards": [
  { "id": "fire_01",   "type": "fire_pit",     "x": 930,  "y": 556, "w": 96,  "h": 44 },
  { "id": "spikes_01", "type": "spike_stakes", "x": 1630, "y": 556, "w": 128, "h": 44 }
]
```
The `type` field joins to the catalog via `byId("hazards", type)` for
sprite + damage value.

**(B) `level.colliders[]` with `type: "hazard"` or `"kill"`** — invisible
damage rectangles
```json
"colliders": [
  { "id": "pit_kill_01", "shape": "rect", "x": 720,  "y": 690, "w": 100, "h": 64, "type": "kill" },
  { "id": "fire_pit_dmg_01", "shape": "rect", "x": 930, "y": 568, "w": 96, "h": 32, "type": "hazard" }
]
```
- `type: "kill"` → instant death (`loseLife()`)
- `type: "hazard"` → standard damage (uses `col.damage` or default 1)

### Catalog (data/hazards.json)

```json
[
  { "id": "fire_pit", "kind": "ground", "damage": 1, "effect": "damage", "sprite": "assets/sprites/hazards/fire_pit/clean.png", "fps": 8, "frames": 4, "frameW": 96, "frameH": 96 },
  { "id": "spike_stakes", "kind": "ground", "damage": 1, "effect": "damage", "sprite": "assets/sprites/hazards/spike_stakes/clean.png" },
  { "id": "lava_floor", "kind": "ground", "damage": 999, "effect": "kill", "sprite": "..." }
]
```

- `effect: "damage"` → `damagePlayer(damage)`
- `effect: "kill"` → `loseLife()`
- `fps + frames` for animated hazards (fire, water, spikes-shooting); omit
  for static

### updateHazards() loop

```js
function updateHazards() {
  const pRect = bodyRect(state.player);
  // (A) Visible hazard sprites
  for (const hazard of state.hazards) {
    if (!rectsOverlap(pRect, hazard)) continue;
    if (hazard.effect === "kill") loseLife();
    else damagePlayer(hazard.damage || 1, state.player.x < hazard.x ? -1 : 1);
  }
  // (B) Invisible kill/hazard colliders
  for (const col of damageColliders(state.level)) {
    if (!rectsOverlap(pRect, col)) continue;
    if (col.type === "kill") loseLife();
    else damagePlayer(col.damage || 1, state.player.x < col.x ? -1 : 1);
  }
}
```

## Adaptation knobs

| Knob | Where | Effect |
|---|---|---|
| `damage` | hazards.json or col entry | HP loss per touch |
| `effect: "kill"` | hazards.json or col `type:"kill"` | Instant death |
| `fps + frames` | hazards.json | Animated hazard sprite |
| Hazard rect h | level hazards[] | Visible "active" zone (often smaller than sprite) |
| Pit-kill rect | level colliders[] type:"kill" | Below platform edge |

## When to use which

| Authoring intent | Use |
|---|---|
| Fire / spike / saw blade — visible damage tile | hazards[] |
| Falling-off-the-map pit death | colliders[] type:"kill" |
| Sub-platform damage zone (no sprite) | colliders[] type:"hazard" |
| One-hit-kill spike trap on visible spikes | hazards[] with `effect: "kill"` |
| Invisible kill plane below entire level | colliders[] type:"kill" spanning full mapSize |

**Don't duplicate** — if you have a fire sprite (hazards[]) and also a
collider rect at the same location (colliders[type:hazard]), the player
takes damage twice per frame (one source applies, invuln blocks the
other, but it's redundant config). Pick one.

## Out-of-world safety net

`entities/player.js` has a final backstop:
```js
if (p.y > (state.level.mapSize.height + 120)) loseLife();
```
Catches player falling off the level when no `kill` collider covers it.
Keep this as belt-and-suspenders — designed pits use `kill` colliders,
this catches the unexpected.

## Common mistakes

1. **Hazard rect = sprite rect exactly** — fire sprite has wide tongue of
   flame visible but the actual "burn" area should be a narrower rect.
   Place hazard rect over the dangerous core, not the entire sprite frame.

2. **Forgetting the kill collider** — built a beautiful pit between two
   platforms but no collider in the gap. Player falls 5000 px before the
   y-line backstop fires. Always add `kill` collider in pits.

3. **Damage every frame** — without `invuln` after a hit, player takes
   N damage in N frames touching a hazard. Player's `damagePlayer()`
   sets `invuln` to ~1s; respect it (guard at top: `if (invuln > 0)
   return`).

4. **Hazard catalog entry without `effect`** — `effect` is required to
   distinguish damage vs kill. Default behavior is damage if unset, but
   be explicit.

5. **Animated hazard with fps but no frames** — fps without frames count
   = NaN division. Always set both or neither.

## Reference

`D:/Sengoku-Era-act-ogf/src/scene.js:updateHazards` +
`data/border_road.json` hazards + colliders.
