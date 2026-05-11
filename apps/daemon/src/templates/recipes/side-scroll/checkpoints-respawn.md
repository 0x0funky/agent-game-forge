# Recipe — Checkpoints + lives + respawn

Implements progress markers that update player's respawn point on touch,
plus lives system that returns player to last checkpoint on death.

## When to use

- Side-scroll action with multi-room or multi-screen levels
- Player has finite lives (3 by default); permadeath unlocks "gameover"
- Want forgiving difficulty — death sends back to last touched banner /
  flag / shrine, not level start

## When NOT to use

- **Single-room game** — no checkpoints needed, respawn = level spawn
- **Permadeath / roguelike** — no checkpoints; one life only
- **Open-world / metroidvania save points** — fork; save_points are
  bigger (full state save), not just respawn position

## Files this affects

- `src/entities/player.js` — `loseLife()` reads `state.checkpoint`
- `src/scene.js` `updateCheckpoints()` — touches active checkpoint
- `data/<level>.json` `checkpoints[]` — checkpoint positions
- `src/hud.js` — displays lives count

## Pattern

### 1. Level JSON

```json
"checkpoints": [
  { "id": "mid_banner", "x": 1500, "y": 530, "w": 68, "h": 96 }
]
```

Each checkpoint is a trigger rectangle. Touch overlaps → spawn point
updated.

### 2. State

`state.checkpoint = { x, y }` — initially set to level's `spawn_points[0]`
in `buildSceneRuntime`. Updated on checkpoint touch.

`state.lastCheckpointId` — id of last touched checkpoint (for "Banner
checkpoint reached!" message; only message once per checkpoint).

### 3. updateCheckpoints (scene.js)

```js
function updateCheckpoints() {
  const center = centerOf(bodyRect(state.player));
  for (const checkpoint of state.level.checkpoints || []) {
    if (pointInRect(center, checkpoint)) {
      state.checkpoint = { x: checkpoint.x, y: checkpoint.y - state.player.h };
      if (state.lastCheckpointId !== checkpoint.id) {
        state.lastCheckpointId = checkpoint.id;
        showMessage(`Banner reached.`, 1.5);
        playSfx("checkpoint");
      }
    }
  }
}
```

- `y - state.player.h` so the respawn point puts feet at the checkpoint's
  bottom, not its top
- Idempotent per id — re-touching the same banner doesn't re-message

### 4. loseLife (entities/player.js)

```js
function loseLife() {
  const p = state.player;
  p.lives -= 1;
  if (p.lives < 1) {
    state.mode = "gameover";
    showMessage("The road is lost.", 4);
    return;
  }
  p.hp = p.maxHp;
  p.x = state.checkpoint.x;
  p.y = state.checkpoint.y;
  p.vx = 0; p.vy = 0;
  p.invuln = cfg("player").stats.invulnSec;
  state.projectiles.length = 0;
  showMessage("Back to the last banner.", 2.5);
}
```

- Clears in-flight projectiles (player shouldn't take damage from arrows
  fired before respawn)
- Sets invuln (~1s) so respawned player has a grace window

### 5. Game over

When `lives < 1`:
- `state.mode = "gameover"`
- Renderer detects mode → draws title-overlay-style screen with "Press
  Enter to retry"
- `handleGlobalInput` (game.js) listens for start → `startNewRun()`

## Adaptation knobs

| Knob | Where | Effect |
|---|---|---|
| `lives` initial | player-config.json | Starting count |
| `invulnSec` | player-config.json | Grace window after damage/respawn |
| Checkpoint rect size | level checkpoints[] | Easier (large) vs precise (small) |
| Respawn HP | player-config.json `maxHp` | Full heal vs partial |

## Common mistakes

1. **Respawn at checkpoint.y exactly** — player respawns INSIDE the
   banner sprite. Subtract `player.h` so feet sit at the bottom of the
   trigger zone (top of the ground it sits on).

2. **Re-arming checkpoint each frame** — without `lastCheckpointId`
   guard, the message + sfx fire every frame the player overlaps the
   trigger. Always store last-touched id.

3. **Not clearing projectiles on respawn** — player respawns, gets hit
   by an arrow that was in flight, dies again. Player needs a clean
   slate.

4. **No invuln on respawn** — enemy still in damage range → player
   respawns and dies instantly. Always give invuln seconds.

5. **Lives stored separately from player** — when player object is
   recreated on `newPlayer: true` switchScene, lives count resets. Keep
   lives on the player (which persists across scene switches with
   `newPlayer: false`), or on `state.lives` (global) for cross-scene
   persistence.

## Reference

`D:/Sengoku-Era-act-ogf/src/entities/player.js:loseLife` +
`src/scene.js:updateCheckpoints` + `data/border_road.json` checkpoints.
