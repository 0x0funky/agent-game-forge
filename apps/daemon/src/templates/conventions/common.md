# OGF — common conventions (all genres)

This file applies to every project regardless of genre. Engine-specific rules + genre-specific rules are in separate files.

## What OGF is

OGF is the **visual half of an agent-driven game-making workflow**. You (the agent) are the primary author. The OGF user reviews and tweaks via chat (back to you) or by drag-editing things on a canvas. The editor exists for the parts that are easier to drag than to describe — moving an enemy spawn, retiming a wave, swapping a sprite. Everything else stays in chat with you.

Implications:

- **Disk is the contract.** Everything OGF needs to render or edit lives in files. Don't store gameplay data in code constants — put it in JSON under `data/` so OGF's editor can read it.
- **Web-first.** New projects default to the `web` engine. Godot still works for legacy projects.
- **Editor incompleteness is OK; agent incompleteness is not.** If the editor can't visualize something yet, fine — they'll chat about it. Your job is to make sure the GAME works.

## Spec authorship — describe WHAT, not HOW

`.ogf/spec.md` is the GAME DESCRIPTION. It tells future phases what the game IS. It does NOT prescribe how visual assets get made — that emerges from the skill rules at invocation time.

**Spec.md should describe:**

- Identity: genre, art style, palette, references, premise
- Player: id, moves, HP, animations BY NAME (idle / walk / attack)
- Levels: id, camera mode (locked / scroll), map_kind for the skill
- Enemies / pickups / hazards: id, role, animations BY NAME
- Phase plan with VERIFY gates
- Out of scope

**Spec.md should NOT describe:**

- Parallax layer count or layer names (sky / far_bg / mid_bg ...)
- `stage_segment_count` for side-scroll levels
- `platform_strategy` (`platform_rects_with_shared_tiles` vs other)
- Prop pack format (3×3, 4×4, strip)
- Sprite frame counts or grid (2×2, 2×4, etc.)
- Specific `frameW` / `frameH` / `fps` values per animation

These get decided at `generate2dmap` / `generate2dsprite` invocation time. Letting the spec prescribe them in advance LOCKS THEM IN at spec-write time and prevents skill upgrades from cascading.

If the user explicitly requests a number ("I want 8-frame walk"), record it in spec section 2 as `walk frames: 8 (user-specified)` — but structural decisions stay with the skill defaults unless overridden.

## MANDATORY: discovery form must include `genre` and `animation_richness`

Before writing spec.md, emit a `<question-form>` block. The form's `fields` array MUST include at least these two keys:

```json
{
  "id": "discovery",
  "title": "Project setup",
  "fields": [
    {
      "key": "genre",
      "label": "What kind of game is this?",
      "type": "radio",
      "default": "side-scroll",
      "options": [
        { "value": "side-scroll",   "label": "Side-scroller / Platformer", "detail": "Mega Man, Mario, Castlevania" },
        { "value": "top-down-rpg",  "label": "Top-down RPG",                "detail": "Pokemon-style overworld, Stardew" },
        { "value": "tower-defense", "label": "Tower defense",               "detail": "Kingdom Rush, Bloons" },
        { "value": "arena-survivor","label": "Arena survivor",              "detail": "Vampire Survivors, Brotato" },
        { "value": "shmup",         "label": "Shoot-em-up",                 "detail": "Vertical or horizontal scroll shooter" }
      ]
    },
    {
      "key": "animation_richness",
      "label": "How smooth should character animations be?",
      "type": "radio",
      "default": "standard",
      "options": [
        { "value": "lite",     "label": "Lite",     "detail": "all 2×2 grids — fastest gen, retro look" },
        { "value": "standard", "label": "Standard", "detail": "skill picks per-action (idle 2×2, walk 2×3-2×4, attack 2×3)" },
        { "value": "rich",     "label": "Rich",     "detail": "bigger grids: walk 2×4-2×6, attack 2×4, death 2×4" }
      ]
    }
    /* … add other discovery questions: title, palette, references, etc. … */
  ]
}
```

Add other discovery questions (title, world setting, palette, etc) as needed. **Do NOT add `platform_strategy`, `stage_segment_count`, parallax-layer-count, frame-count fields** — those are engineering decisions, not user preferences. They're handled by skill defaults + the genre file's recommendations.

After form submission, write **Visual decisions** into spec.md §1 Identity:

```
- **Visual decisions**: genre=<chosen>, animation_richness=<chosen>
```

Then read `.ogf/conventions/genres/<chosen-genre>.md` for the genre-specific patterns the spec + later phases must follow.

## Skill invocation precedence

Skills `generate2dmap` and `generate2dsprite` have TWO components:

1. **Rules** — markdown files at `.agents/skills/<name>/{SKILL.md, agents/openai.yaml, references/*.md}`. Read at Phase 0 + every time you plan visuals.
2. **Scripts** — Python files at `.agents/skills/<name>/scripts/*.py`. Codex spawns these when you invoke the skill via `$generate2dsprite` / `$generate2dmap`. **Don't run the scripts directly with `python`** — go through the codex skill invocation so context (SKILL.md + references) gets injected.

NEVER hand-roll the workflow. If you call `image_gen` directly and write your own postprocess, you lose: chroma cleanup, frame extraction, edge-touch QC, anchor alignment, pipeline-meta.json output. The skills exist precisely so OGF assets are uniform.

If `$generate2dsprite` invocation fails (skill registry missing, codex CLI doesn't see the bundle): STOP and report. Don't fall back to ad-hoc `image_gen`.

## The contract — short version

1. **Data and code are separate.** Numbers (HP, damage, prices, wave counts, anchor positions, prop layouts) live in JSON under `data/`. Never inline gameplay data into source files.
2. **Spatial data uses canonical shapes.** Each shape has a fixed schema:
   - point: `{ "x": <num>, "y": <num> }`
   - rect: `{ "x", "y", "w", "h" }` (top-left + size)
   - circle: `{ "x", "y", "radius" }`
   - polygon: `{ "points": [[x,y], [x,y], ...] }`
   Always use these field names; do not invent variants.
3. **One level / one screen → one data file.** Every editable level has its own JSON in `data/`.
4. **`assets/` is for raw files**, **`data/` is for structured files**. Sprites land under `assets/`. Per-asset metadata (slicing, anchors) goes in `data/` if it needs editing, or as sidecar JSON next to the asset if it's purely build-time.
5. **One source of truth.** Don't store the same fact in two places.

## Catalogs

Catalogs are arrays of objects. Use them for: enemy types, hero types, tower types, items, abilities, dialogue lines.

### Single-action entity (pickups, projectiles, simple props)

```json
[
  { "id": "war_order", "sprite": "assets/sprites/war_order/sheet.png", "frameW": 64, "frameH": 64, "fps": 6 },
  { "id": "spike",     "sprite": "assets/sprites/spike/sheet.png",     "frameW": 64, "frameH": 64 }
]
```

### Multi-action entity (player, enemies, bosses, NPCs)

ANY entity with multiple actions MUST use the `animations: { ... }` open object — one key per action, NOT a single `sprite` field. Each animation references its OWN sheet generated by a separate `generate2dsprite` call.

```json
[
  {
    "id": "ashigaru_spearman",
    "kind": "melee",
    "stats": { "hp": 2, "speed": 80, "damage": 1 },
    "animations": {
      "idle":   { "sprite": "assets/sprites/ashigaru_spearman/idle/sheet.png" },
      "walk":   { "sprite": "assets/sprites/ashigaru_spearman/walk/sheet.png" },
      "attack": { "sprite": "assets/sprites/ashigaru_spearman/attack/sheet.png" }
    }
  }
]
```

`frameW`/`frameH`/`fps` come from each sheet's `pipeline-meta.json` — runtime reads metadata, not your inline numbers. If you DO need to override, put values inline; otherwise leave only `sprite`.

### Per-action sheet generation rule

Every named animation = one separate `generate2dsprite` call. Player has 4 anims → 4 calls. Spearman has 3 → 3 calls. **Frame layout per call** is decided by the skill; don't pass a `sheet` parameter unless the user asked for a specific grid.

### Inline vs catalog

- **Inline** (lives in level JSON): single-action / static entities — hazards, pickups, projectiles, checkpoints, decorative props.
- **Catalog** (lives in `data/<plural>.json`): multi-action / multi-instance entities — enemies, heroes, towers.

Use **inline** when the entity appears once or twice and doesn't need shared stats. Use **catalog** when multiple instances share definition.

## Image generation skill — read these in order

1. `.agents/skills/generate2dmap/agents/openai.yaml` (distilled defaults)
2. `.agents/skills/generate2dmap/SKILL.md` (full rules)
3. `.agents/skills/generate2dsprite/agents/openai.yaml`
4. `.agents/skills/generate2dsprite/SKILL.md`

These contain everything about: side-scroll segment counts, platform strategies, parallax layer organization, prop pack vs strip vs tilemap, sprite frame layouts per action, anchor + collision extraction, magenta cleanup, QC. **OGF defers to them.** If they contradict this file, the skill files win.

## Style directive — every gen call uses it

`.ogf/spec.md` §1 contains a 'Style directive' line — the concrete art direction the project locks. **Every** `generate2dsprite` and `generate2dmap` call must include this directive verbatim in the prompt argument. After each gen, the skill writes the actual prompt back to `prompt-used.txt` next to the asset; that's your audit trail.

## Prompt template — required for every skill call

Past projects produced bad assets when the agent shortcut prompts to ~10 words ("ronin idle 2x2"). The reference image carries some weight, but a skeletal prompt loses palette / proportion / mood and the model fills in defaults that drift from the project. **Every `generate2dsprite` / `generate2dmap` prompt MUST be ≥ 200 chars and follow this template:**

```
[STYLE DIRECTIVE — paste verbatim from spec.md §1]
[VIEW + GENRE in one phrase]
[SUBJECT + ACTION in plain English]
[GRID/LAYOUT only if non-default]
[REFERENCE NOTE]
```

Concrete:

❌ **Too short** (8 words, no project context):
```
ronin idle side-view 2x2
```

✅ **Correct** (~280 chars, includes everything):
```
Style: hand-painted ink 2D side-scrolling action art, warm sunset palette
(#7A1E18 oxblood, #C75A28 burnt orange, #F0B35A gold), Sengoku motifs
(lamellar armor, katana, war banners), readable Mega Man X-style silhouettes.
Side-view platformer. Subject: border ronin warrior in idle breathing stance,
body-only sheet. Reference-aligned to the previously loaded ronin idle sheet.
```

The template is mechanical — copy spec.md §1 Style directive verbatim, append a one-line view+genre tag, append subject+action, append reference note. **Don't paraphrase or compress the style directive.** Even if the reference image carries it, the words anchor the model when image + text disagree.

After every gen call, open `prompt-used.txt` next to the new asset and verify the saved prompt matches the template. If the saved prompt is short / missing style: the skill received your shortened version, the asset is degraded, regenerate with the full template.

## Visual consistency — reference image workflow is MANDATORY

Drift across generated assets (same character looking like 4 different people across animations) is the #1 quality-killer. Before every `generate2dsprite` / `generate2dmap` call after the first:

1. Pick the closest existing reference: same-character sheet > same-family sibling > project anchor (`.ogf/style-anchor.png`).
2. `view_image` it so the bytes enter context.
3. Pass `reference: 'generated_image'` to the skill.
4. State the role explicitly: "Same character, new animation — preserve identity, change action only" OR "Same family, new asset — match palette/line/lighting, different subject".

Skipping this means the model generates blind and you get drift.

## Generating ≠ done — wire it into game data

Both skills produce ASSETS only. The generated `assets/*` files are invisible until something references them in the gameplay data the engine reads. After every skill call, in the same turn:

1. Decide where the new asset belongs (which level, which catalog).
2. Edit the data file to add the reference.
3. Verify the runtime can find it.

Sprites land on disk + the user reloads the game and sees nothing = you stopped halfway.

## Phase verification — you are headless, don't try to see

Phase plans have VERIFY rows (e.g. "open Play tab and see X"). You CAN'T open the Play tab — the user does. Don't try to spawn Chrome, run `npm run dev`, screenshot, or otherwise simulate visual verification. Those attempts fail and waste 1-2 minutes per phase.

What you CAN verify:

- File exists with correct path + size
- JSON parses, schema fields present
- Code typechecks / lints
- Sprite sheets have expected dimensions (read PNG header bytes, or pipeline-meta.json)
- Catalog references resolve (the sprite file the JSON points at exists)

Mark a phase done with logical verification. The user runs the game.

## Read the live state before answering spatial questions

When the user asks "where is X?" or "why does Y look broken?", read the actual file (level JSON, scene file) instead of guessing from chat history. Spatial state changes via drag-edit; chat history doesn't reflect those changes.

## OGF Scene editor — what's editable vs not

The Scene tab supports drag-editing on:

- Position of any entity in `enemies[]`, `pickups[]`, `hazards[]`, `props[]`, `checkpoints[]`, `spawn_points[]`
- Position + size of `platforms[]`, `colliders[]`, `zones[]`
- Path waypoints in `paths[]`
- Background image (replace via Regenerate button on the file)

Not editable in Scene tab (chat the user instead):

- Catalog stats (HP, damage, speed)
- Animation timing (fps, frame count)
- Wave timeline (use a future Timeline tab when shipped)
- Code patches

## Background dimensions MUST equal level.mapSize

For every level, the background PNG (or each parallax layer) MUST be exactly `mapSize.width × mapSize.height`. Generated PNGs that don't match get rejected by OGF's loader OR cause coordinate misalignment between Scene tab and Play tab.

After every `generate2dmap` call:

1. Read PNG natural size (Pillow / PNG IHDR header bytes 16-23).
2. If width ≠ mapSize.width OR height ≠ mapSize.height: resize via `Image.resize((mapSize.width, mapSize.height), Image.LANCZOS)`.
3. Save back to the same path.

For multi-layer parallax, every layer file must independently match mapSize.

## Engine selection

- **Web** (default): vanilla JS + HTML5 Canvas + JSON data files. The active development direction. Pick this unless the user explicitly asks for Godot.
- **Godot**: still supported for legacy projects but no longer the default.
- **Unity / Unreal / WebGL+Three.js**: not supported for new projects.

## File layout (web engine)

```
project-root/
├── index.html
├── styles.css
├── src/
│   ├── game.js              ← entry: boots renderer + scene + input + frame loop
│   ├── render.js            ← all canvas drawing
│   ├── scene.js             ← level state + per-frame update
│   ├── input.js             ← keyboard + gamepad
│   ├── assets.js            ← image preloader + cache
│   ├── collision.js         ← AABB + tilemap collision
│   ├── combat.js            ← if game has combat
│   ├── entities/
│   │   ├── player.js
│   │   ├── enemy.js
│   │   └── projectile.js
│   ├── ui.js                ← HUD overlay
│   └── audio.js             ← WebAudio cues
├── data/
│   ├── levels.json          ← registry: { id, file, displayName? }[]
│   ├── <level_id>.json      ← per level
│   ├── enemies.json         ← catalog (one per kind)
│   ├── heroes.json
│   ├── pickups.json
│   ├── hazards.json
│   ├── projectiles.json
│   └── ...
├── assets/
│   ├── maps/<level_id>/{layers}.png + per-asset folders
│   └── sprites/<entity_id>/<action>/sheet.png + pipeline-meta.json
├── .ogf/
│   ├── spec.md
│   ├── style-anchor.png
│   ├── conventions/         ← these conventions files
│   │   ├── common.md
│   │   ├── runtime-patterns.md
│   │   └── genres/<your-genre>.md
│   └── ...
└── .agents/
    └── skills/              ← codex skills bundle (auto-discovered)
```

## Module split rules (when to break out a new file)

- A function is a state machine ≥ 4 states → its own file.
- A subsystem has ≥ 3 entry points called from elsewhere → its own file.
- A file passes ~250 lines OR mixes 2 concerns → split.

Don't pre-emptively split. Most game-jam-scale projects fit in 4-6 files in `src/` + entities folder.

## What NOT to do (project-wide)

- ❌ **Import any game framework.** No `phaser`, no `pixi`, no `three`, no `kaboom`, no `excalibur`. OGF's editor parses your `data/*.json` files directly — it cannot read Phaser scene definitions, Pixi DisplayObject trees, or any framework's serialized state. Genre files cite Phaser tutorials for **pattern inspiration** (Phaser has the most-documented canonical 2D patterns); read them for the WHAT, write your code as plain Canvas 2D. See `runtime-patterns.md` for a Phaser → vanilla canvas translation table.
- ❌ **Import Tiled / LDtk JSON at runtime.** OGF schema (platforms[], colliders[], paths[], etc.) is what the editor reads. If you want Tiled-style data, convert it to OGF schema at generation time.
- ❌ WebGL / Three.js for new projects (3D in OGF's 2D editor doesn't visualize).
- ❌ React / Vue / framework UI inside the game (the `<canvas>` IS the UI; HUD is direct `ctx.fillText` / `ctx.fillRect`).
- ❌ Hardcoded gameplay numbers in source files (HP/damage/speed go in catalog JSON).
- ❌ Asset paths with spaces (Windows + various tooling don't handle them well).
- ❌ Inventing schema field names — use the canonical shapes (point/rect/circle/polygon).

## OGF Scene editor support level by genre

The Scene tab can drag-edit some genres better than others. Push back gracefully if user expects full editor support for limited genres:

| Genre | Editor support | What's drag-editable |
|---|---|---|
| Side-scroll / platformer | **full** | layers, platforms, colliders, hazards, pickups, enemies, checkpoints, exits |
| Tower defense | **full** | path waypoints, buildSpots, zones, enemies, exits |
| Arena survivor | **partial** | spawn_points, boss_spawn, pickups, hazards. Wave timeline edit only via JSON. |
| Top-down RPG | **limited** | placement objects + zones. Tile layers NOT drag-editable in V1 (treat tilemap as one big rendered image for editor purposes). |
| Shmup | **limited** | spawn_points + zones. Wave script + paths only via JSON. |

Side-scroll and TD are the best-supported genres. Other genres still WORK at runtime, but the user has less drag-edit power; they'll review via Play tab + edit JSON in the editor. Be honest about this in spec planning.
