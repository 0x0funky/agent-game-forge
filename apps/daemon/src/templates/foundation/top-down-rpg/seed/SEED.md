# Foundation Seed — top-down 2D RPG

This is OGF's foundation seed for top-down 2D RPGs (Pokemon-style monster-taming, Stardew-style sim, Zelda-like action — same spatial structure, different mechanics). It's extracted from `D:/Sengoku-Era-ogf` minus the Sengoku-specific content, then offered as a **starting point** for new projects.

## What this gives you

- **20 src/ modules** with universal vanilla-JS patterns (state / render / scene / collision / audio / input / etc.)
- **8 *-config.json files** with sensible default tuning (battle balance, audio frequencies, animation tick rates, XP curve)
- **Empty identity catalogs** (starters/enemies/items/levels) — agent fills these per project
- **Working game shell** — index.html + styles.css that boots the loop

## What this does NOT give you

- Game-specific content (御魂 / monsters / characters / dialogue) — agent generates per project
- Maps + sprites — agent generates via `generate2dmap` / `generate2dsprite` skills
- Story / quest data
- Recipes for game subsystems — those live in `templates/recipes/top-down-rpg/`

## What's "universal" vs "starter"

| File | Status | Notes |
|---|---|---|
| `index.html` | starter | Title + minimal HUD shell. Replace title; HUD structure should stay (battle/menu CSS targets it). |
| `styles.css` | starter | Color palette + chrome. Modify freely. |
| `src/state.js` | universal | Shared global state shape. Keep the field set; new fields can be added. |
| `src/game.js` | universal | Entry + main loop. Don't edit unless changing the dispatch model. |
| `src/render.js` | universal | Mode-dispatched draw. Add new modes by adding `if (state.mode === "X") drawX();`. |
| `src/scene.js` | universal | Camera math + scene transition. |
| `src/collision.js` | universal | AABB + ellipse + polygon point-tests + collision-map validator. |
| `src/audio.js` | universal | WebAudio oscillator/noise sfx + procedural music. Tune via `data/audio-config.json`. |
| `src/input.js` | universal | Keyboard + menu navigation. |
| `src/touch.js` | universal | Mobile touch (joystick + 3 buttons). Optional — drop if desktop-only. |
| `src/transition.js` | universal | Battle entry/exit fade + sprite hop tween. |
| `src/dialogue.js` | starter | Dialogue queue + UI. Replace strings; structure stays. |
| `src/progression.js` | universal | XP curve / level-up / save+migrate. Per-game balance via `progression-config.json`. |
| `src/interaction.js` | starter | NPC interact + scene exit + healer. Replace NPC dialogue, keep flow. |
| `src/overworld.js` | starter | Movement + encounter check. Replace zone-specific logic, keep movement. |
| `src/battle.js` | recipe | **DELETE OR REWRITE per recipe**. The Sengoku version of turn-based battle is left as a starter. If your game uses ATB / action / no-battle, follow the corresponding recipe in `templates/recipes/top-down-rpg/battle-*.md`. |
| `src/menu.js` | recipe | Same — Sengoku-style party/dex menu is starter. Customize per game. |
| `src/catalogs.js` | universal | Catalog loader + `mitamaById` / `enemyById` lookup helpers. |
| `src/assets.js` | universal | Image preloader + `loadGameData()` orchestration. |
| `src/config.js` | universal | Config table loader + `battleString()` / `animFrame()` helpers. |
| `src/constants.js` | universal | VIEW dimensions + foot radius. |
| `src/dom.js` | universal | DOM element refs. Add IDs to index.html and ref them here. |

| Data file | Status |
|---|---|
| `data/runtime.json` | universal defaults — adjust mapSize/camera/spawn per project |
| `data/audio-config.json` | universal — sfx tone library, copy-as-is or override frequencies |
| `data/battle-config.json` | universal — type chart, damage formula, action powers, xp/item rewards |
| `data/battle-strings.json` | starter — replace bosses/dialogue per project's enemies |
| `data/progression-config.json` | universal — XP curve + evolution levels |
| `data/overworld-config.json` | universal — speed, encounter rates |
| `data/music-themes.json` | starter — replace tunes per project mood |
| `data/ui.json` | starter — UI text |
| `data/starters.json` | empty — per-project catalog |
| `data/enemies.json` | empty — per-project catalog |
| `data/items.json` | empty — per-project catalog |
| `data/levels.json` | starter (1 outdoor entry) — extend to N scenes |
| `data/collision-map.json` | starter (empty outdoor) — fill spawn / props / exits / zones / walkBounds per scene |
| `data/assets.json` | starter — append imageKey → path entries as agent generates sprites |

## How a new project uses this seed

1. **Daemon copies seed** into project root on first project create (write-if-missing — never clobber user code).
2. **Agent reads `discovery` form answers** and the relevant recipe(s).
3. **Agent edits identity catalogs** (starters/enemies/items.json) with project's monsters/characters/items.
4. **Agent generates assets** via `generate2dsprite` / `generate2dmap` skills.
5. **Agent updates `assets.json`** with the new imageKey → path entries.
6. **Agent fills `collision-map.json`** with map size, spawn, props (matching generated map).
7. **Agent customizes `battle.js` / `menu.js`** per recipe (or rewrites for non-RPG mechanic).
8. **Agent writes `battle-strings.json`** per project's bosses + dialogue tone.
9. **Agent flips spec.md phase checkboxes** as deliverables land.

## Override model

User explicit > recipe default > seed default.

If user says "no battle, sandbox exploration", agent **deletes battle.js + menu.js + battle-* config + battle-strings**, and skips the battle/menu recipes entirely. The remaining seed (state/render/scene/collision/audio/input/overworld/dialogue/progression) is enough for a non-combat exploration game.

If user says "ATB battle instead of turn-based", agent reads `recipe-battle-atb.md` (when it exists; otherwise writes from scratch) and replaces battle.js. The other modules stay.

If user says "use ES modules instead of script tags", agent transforms index.html + adds import/export to all src/* — at the cost of more friction, but it's their choice.

The seed is **a starting point, not a contract**.
