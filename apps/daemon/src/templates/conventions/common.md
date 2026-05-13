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

### Phase plan — expand multi-step pipelines per scene

> ⚠️ Recurring failure: spec writer reads a genre file's pipeline phases ("Phase 2 = base, Phase 3 = reference, Phase 4..N = props") as **abstract pipeline labels**, then for an N-scene project writes "Phase 2 = scene_A base, Phase 3 = scene_B base" — collapsing N scenes into N base phases and skipping reference + props entirely. The agent dutifully generates clean bases, then moves to level data because reference + props phases are not in the plan. test-2d-rpg4 hit exactly this.

When the genre file describes a multi-step pipeline (top-down-rpg image-bg, side-scroll parallax segments, etc.), **expand it per scene/level** in spec.md §7:

- N scenes × M pipeline steps = N×M visual phases (plus 1 anchor + 1 wiring)
- Do NOT flatten to "Phase A: scene_1 step_1, Phase B: scene_2 step_1" and stop there
- Per-scene grouping: keep all of one scene's pipeline steps adjacent (scene_A base → scene_A reference → scene_A props → scene_B base → scene_B reference → scene_B props), so a phase failure can resume from the broken scene without redoing earlier scenes

See the genre file's "Spec phase-plan expansion" section (e.g. `top-down-rpg.md`) for the exact pattern + examples for that genre.

### Phase plan — split character + system phases (NOT one mega-phase)

> ⚠️ Recurring failure: 2DGAMERPG2 (2026) — spec writer compressed the entire post-visuals plan into 4 phases. Phase 5 was "summoner sprites + movement + collision + Y-sort + camera + interaction + altar trigger". Phase 7 was "enemy sprites + grass encounter RNG + turn-based battle + commands + HP UI + Command Seal capture" — half the game in one phase. Outcomes: (1) daemon stall watchdog (5 min no stdout) kills the run mid-phase, (2) view_image reference chain breaks across 6+ sequential gen calls in one phase, (3) failure recovery is messy because the system is half-wired. Each compressed phase wastes 30-90 minutes when it fails.

**Phase granularity rules** (apply alongside the per-scene expansion rule above):

1. **One sprite-gen group ≠ one system-wire group.** Generating 6 sprite sheets is one phase's worth; wiring movement + collision + camera + interaction is another phase's worth. Combining them creates phases that are too long to verify and too risky to retry.

2. **Each major character family gets its own phase for sprite gen.** Player avatar, starter trio, enemy roster, boss — each is a separate sprite-only phase. The wiring for that character (controller, AI, battle stats) goes in a follow-up phase.

3. **Each system gets at least one dedicated phase.** Movement, collision, camera, interaction, dialogue, menu, save, battle FSM, encounter RNG, capture, HP UI, win/loss flow — these are separate concerns. Putting "battle FSM + encounter RNG + HP UI + capture" in one phase is the canonical anti-pattern. Each of those is one phase.

4. **Verify boundaries are short**: 1 phase ≈ "user can verify ONE specific thing in Play tab or Scenes tab in under 30 seconds." If your VERIFY line lists 4+ outcomes, the phase is too big — split it.

5. **Heuristic phase counts** (top-down RPG with 1 level, 1 player, 3 starters, 1 wild enemy, 1 boss):
   - Anchor + maps + props extraction: ~4 phases (covered by the per-scene expansion rule above)
   - Player sprite gen: 1 phase
   - Player overworld controller (movement + collision + camera): 1 phase
   - Interaction + dialogue + altar trigger: 1 phase
   - Starter sprite gen (3 spirits × idle/attack): 1-2 phases (split if 6+ sheets)
   - Starter selection menu + heroes.json wiring: 1 phase
   - Wild enemy sprite gen: 1 phase
   - Encounter RNG + grass zone trigger: 1 phase
   - Battle FSM + commands + HP UI: 1 phase
   - Capture / Command Seal flow: 1 phase
   - Boss sprite gen: 1 phase
   - Boss trigger + boss battle + win/loss + final dialogue: 1-2 phases
   - **Total: 12-15 phases for the post-visuals work** (vs the failed 4-phase spec).

6. **Phase title smell test**: a phase title that uses 3+ "+" connectives (e.g. "movement + collision + camera + interaction + altar trigger") is the spec writer telling you the phase is too big. Each "+" is a phase boundary that got missed.

When in doubt: split. A run that completes 12 small phases is better than a run that fails on phase 7 of 8 and leaves the project half-built.

### Phase plan — respect `combat_style: none`

> ⚠️ Recurring failure: user picks `combat_style: none` (pure-platformer / puzzle / exploration) but spec writer still slots in 3 enemy phases + 1 boss phase because the seed and recipes are combat-flavored. Agent then writes combat code into a non-combat game. (test-2d-scroll, 2026.)

If `spec.combat_style === 'none'`, your phase plan **MUST NOT** contain:
- Any phase named "Enemy …" / "Enemies" / "Boss …" / "Combat …"
- Any phase that generates enemy sprite sheets
- Any phase that wires `data/enemies.json` content
- Any boss-room scene phase

Replace those phases with platforming-variety phases — moving platforms, timing puzzles, collectible secrets, decorative props, narrative beats. The token budget for "core" / "polished" / "full" stays the SAME; you reallocate from combat to traversal richness. See the per-genre convention file (e.g. `genres/side-scroll.md`'s "Pure-platformer mode" section) for the concrete phase-plan replacement template.

This rule overrides any default phase plan baked into a genre file. The user's binding answer wins.

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
    },
    {
      "key": "module_style",
      "label": "How should the source code be organized?",
      "type": "radio",
      "default": "simple",
      "options": [
        { "value": "simple", "label": "Simple — script tags + globals", "detail": "Sengoku-Era-ogf style. <script src=...> in index.html, shared global state.js, easy to inspect in DevTools, easy to add modules. Default — best for prototyping and iterative tweaks." },
        { "value": "modern", "label": "Modern — ES modules", "detail": "import/export per file, scoped modules. Slightly more ceremony when adding a module (update import graph). Pick this if you plan to ship to a bundler later." }
      ]
    }
    /* … add other discovery questions: title, palette, references, etc. … */
  ]
}
```

Add other discovery questions (title, world setting, palette, etc) as needed. **Do NOT add `platform_strategy`, `stage_segment_count`, parallax-layer-count, frame-count fields** — those are engineering decisions, not user preferences. They're handled by skill defaults + the genre file's recommendations.

After form submission, write **Visual decisions** into spec.md §1 Identity:

```
- **Visual decisions**: genre=<chosen>, animation_richness=<chosen>, module_style=<chosen>
```

Then read `.ogf/conventions/genres/<chosen-genre>.md` for the genre-specific patterns the spec + later phases must follow.

## How to invoke the skills (READ THIS — common misconception)

`generate2dsprite` and `generate2dmap` are **procedure bundles**, not standalone callable tools. There is no `$generate2dsprite` MCP tool, no `skill registry`, no separate CLI command to look up. Stop searching for one — you will not find it, and the absence is not a blocker.

The bundle has TWO components:

1. **SKILL.md + references** at `.agents/skills/<name>/{SKILL.md, agents/openai.yaml, references/*.md}` — these are **instructions** that Codex auto-loads into your context. Read SKILL.md at Phase 0 + every time you plan visuals.
2. **Python scripts** at `.agents/skills/<name>/scripts/*.py` — `build-prompt`, `process`, `list-options`. You run these via `python` / `bash` like any other script.

### To "invoke the skill" means execute this 3-step procedure in your turn:

```
Step 1: Build the prompt manually following the template in SKILL.md /
        references/prompt-rules.md. (Optional: shell out to
        `python .agents/skills/<name>/scripts/<name>.py build-prompt ...`
        for a starting draft, but you usually write it yourself.)

Step 2: Generate the raw image via the route your CLI exposes:
        - Codex CLI → built-in `image_gen` tool (preferred — Codex
          subscription quota covers it).
        - Claude Code / any other CLI without built-in image gen →
          `python .agents/tools/gen-image.py "<prompt>" <output.png>
                 [--ref PATH] [--no-magenta-bg] [--provider gemini|openai]`
          The OGF daemon routes to Gemini 2.5 Flash Image or OpenAI
          gpt-image-1 using the API key you set in OGF Settings.
        Both routes produce equivalent PNGs.

Step 3: Postprocess by shelling out to the script:
        `python .agents/skills/<name>/scripts/<name>.py process ...`
        This does chroma-key cleanup, frame extraction, QC, anchor alignment,
        transparent export, prompt-used.txt audit log.
```

That is the entire mechanism. SKILL.md is the manual; the image route + the postprocess script are the tools.

### "Never use raw image_gen" — what this actually means

Earlier convention versions said "never raw image_gen" to stop agents from skipping the SKILL.md template + postprocess. **It does NOT mean image generation is forbidden.** Some image route IS REQUIRED — it's the only way to produce raw art. The rule is about the wrapper, not the tool:

- ❌ Wrong reading: "image_gen is banned, find another tool" → search for a non-existent `$generate2dsprite` tool, give up, declare environment broken.
- ✅ Right reading: "image generation must be used through the SKILL.md procedure" → build prompt per template, call your CLI's image route (Codex `image_gen` or `gen-image.py`), run postprocess script.

If you cannot find a callable named `generate2dsprite` / `generate2dmap`: that is normal and expected. Proceed with the image route + the postprocess script. Do **not** write a "skill registry missing" blocker into spec.md — there is no registry, just SKILL.md + scripts + an image route, and all are present in any OGF project.

### When to actually stop

Real blockers (these are rare):

- No image route available — Codex's `image_gen` missing AND `gen-image.py` daemon returns "no API key set" for all providers. Tell the user to either install Codex CLI or add an OpenAI/Gemini key in OGF Settings.
- The `.agents/skills/<name>/scripts/<name>.py` file is missing or corrupted.
- The script raises a Python error you cannot fix.

In all other cases — including "I can't find a tool named generate2dsprite" — keep going.

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

## Phase 0 — install foundation seed (BEFORE Phase 1)

Before running Phase 1 of your spec's phase plan, decide whether you can adopt a hand-built reference scaffold instead of generating every src/ and data/ file from scratch. This step takes 30 seconds and saves hours.

**Procedure** (run exactly once at the start of phase execution):

1. Read your spec to confirm the genre (Identity §1).

2. Check whether `.ogf/foundation-seeds/<genre>/seed/` exists in the project. The genre folder name matches your `genres/<genre>.md` convention file's basename. Currently shipped seeds:
   - `top-down-rpg` → full Sengoku-Era-derived 36-file scaffold
   - (other genres: not yet — you build from scratch)

3. **If the seed directory exists**:
   a. Read `.ogf/foundation-seeds/<genre>/seed/SEED.md` first to understand what you're inheriting (universal vs starter vs recipe-fillable modules).
   b. Copy every file from `.ogf/foundation-seeds/<genre>/seed/` into the project root, preserving the `src/` and `data/` subfolder structure. Overwrite the inline minimal stubs (index.html, src/game.js, etc.) that bootstrap dropped at create time.
   c. The `data/*.json` catalog files ship empty — leave them empty for now; you'll fill them per spec during the relevant phases.
   d. After copying, the project root should mirror the seed layout. Verify by listing `src/` (should be the seed's module count, not the bootstrap's 5 stubs).

4. **If the seed directory does NOT exist for your genre**:
   a. Build the file structure from scratch using the **Module architecture** rules (universal across all genres) and the **File layout** section in your `genres/<genre>.md` convention.
   b. Aim for the same module count and split shape: 14–20 src files, config-vs-identity split, thin game.js entry, script-tag default loading.
   c. Keep the bootstrap's inline 5 stubs as your starting point — extend rather than rewrite where the stub already covers the universal module.

5. Whichever path you take, this is a **one-time procedure**. Do not revisit Phase 0 mid-game; only re-run if the user explicitly asks for a fresh scaffold.

This MUST happen before any `generate2dsprite` or `generate2dmap` call — those skills read `data/levels.json` and similar files that the seed defines, and a missing seed means broken loaders later.

## Recipes — read at phase execution time

`.ogf/recipes/<genre>/<recipe>.md` contains paste-ready code patterns + adaptation guidance for every common subsystem (battle FSM, menu navigation, dialogue box, save/load, progression, FX layer, etc.). The Phase 0 foundation seed (when one exists for your genre) gives you the universal scaffolding; recipes show you how to fill the genre-specific subsystem files. When no seed exists for your genre, recipes are doubly important — they're the only proven-pattern reference you have.

**Mandatory read points** (during phase execution):

| Implementing | Read this recipe FIRST |
|---|---|
| `src/battle.js` (turn-based combat) | `.ogf/recipes/<genre>/battle-turn-based.md` |
| `src/battle.js` (ATB / real-time variant) | corresponding recipe (or write from scratch if not present) |
| `src/menu.js` (party / inventory / dex) | `.ogf/recipes/<genre>/menu-stack.md` |
| `src/dialogue.js` (NPC + post-battle text) | `.ogf/recipes/<genre>/dialogue-box.md` |
| Save game / migration | `.ogf/recipes/<genre>/save-load.md` |
| XP / level-up / evolution | `.ogf/recipes/<genre>/progression.md` |
| Elemental FX on hit | `.ogf/recipes/<genre>/fx-layer.md` |

Each recipe has a "When to use / When NOT to use" section. **If your project's mechanic differs (ATB instead of turn-based, sandbox instead of combat, tactical instead of action), the recipe explicitly tells you to skip it or fork.** Recipes are starting points, not contracts.

If a recipe doesn't exist for what you need, the fallback is: read the closest neighbor recipe + write the new pattern from scratch using the same shape (when-to-use → files-affected → dependencies → pattern → adaptation knobs → common mistakes → reference).

## JSON entry contract — every array entry needs an `id`

Every entry in these JSON arrays MUST carry a unique `id` string field, regardless of whether the runtime uses it or not:

| File | Arrays that require `id` on every entry |
|---|---|
| `data/<level>.json` | `props[]`, `npcs[]`, `colliders[]`, `blockers[]`, `walkBounds[]`, `walkable[]`, `paths[]`, `pickups[]`, `hazards[]` |
| `data/<level>-collision-map.json` (sidecar) | `blockers[]`, `walkBounds[]`, `walkable[]` |

**Why**: OGF's scene editor addresses entries by `id` for every move / resize / delete operation. Without it, the editor's writers can't locate the entry to patch — every drag attempt fails with "save failed" until the user gives up. This is one of the most expensive recurring bug classes in OGF, more painful than any phase-plan or asset-path issue.

**Rule**: when generating JSON, populate `id` on EVERY entry, even when the entry already has a `tag` or other descriptive field. The two are different — `tag` is a human label, `id` is the editor's primary key. Example:

```json
"blockers": [
  { "id": "starter_altar_body",  "type": "rect", "x": 500, "y": 430, "w": 225, "h": 132, "tag": "starter_altar" },
  { "id": "torii_gate_pillars",  "type": "rect", "x": 830, "y": 60,  "w": 270, "h": 140, "tag": "torii_gate" }
]
```

**Naming**: `<purpose>_<n>` or a semantic name. Must be unique within its array. OGF's loader will auto-inject `<section>_<idx>` ids and write them back to disk if you forgot — the warning will surface as a note in the scene editor's notes panel — but **it's much cleaner to author them correctly the first time** since the auto-injection mutates your JSON and shows up as an unexpected file change in git.

## Asset path contract — ALWAYS write to `assets/`

OGF runtime reads from these hardcoded paths:
- `assets/maps/<scene_id>/base.png` — scene background
- `assets/sprites/<entity_id>/<action>/sheet.png` — character / NPC / enemy sprites
- `assets/props/<prop_id>/prop.png` — overworld / scene props
- `assets/fx/<element>/sheet-transparent.png` — elemental FX
- `assets/items/<item_id>/icon.png` — inventory item icons
- `assets/battle/<battle_bg>.png` — battle backgrounds

These paths are referenced from `src/assets.js` + `data/assets.json` + per-scene `data/<scene>-collision-map.json`. **If you write generated assets anywhere else, the runtime will not find them and Play tab stays empty.**

Past failure: test-2d-rpg9's agent ran an early `apply_patch` that failed for a non-permission reason (likely encoding / format), then concluded "Windows ACL blocks writes inside daemon-created folders" and switched to `generated_assets/` as a workaround. This was **wrong** — earlier projects (test-2d-rpg5, test-2d-rpg6) prove writes to `assets/maps/`, `assets/sprites/` etc. work fine.

If you see a write failure inside `assets/` or `data/`:
- Try a different write method (shell `Set-Content` instead of `apply_patch`, or vice versa)
- Verify the parent dir exists (`Test-Path` first, `New-Item -ItemType Directory -Force` if missing)
- Check the actual error message — file format / encoding / line endings can cause apparent "permission" errors
- DO NOT create `generated_assets/` or any other root-level workaround folder

## Style anchor — depict user's actual subject, not a generic mascot

The Phase 1 style anchor sets the visual canon every later asset references via `view_image`. **Whatever the anchor depicts becomes the project's visual identity.** Picking the wrong subject for the anchor cascades.

Past failure: user asked for "戰國武將 Pokemon-like RPG" (Sengoku general / human warrior + monster-taming structure). Agent picked anchor subject = "war-spirit fox-dragon mascot in samurai armor". Result: the project became chibi-creature-themed instead of warrior-themed. The anchor essentially overwrote user's stated theme.

**Anchor subject rule**:

1. **Read user's prompt for the MAIN PLAYABLE SUBJECT.** "戰國武將" = human general. "野獸馴服師" = beast-master human + creature partner. "通靈師" = spirit medium human. "妖怪變身者" = creature shapeshifter. The subject they NAME is the subject the anchor depicts.
2. **If user named a creature/monster theme** (Pokemon, Digimon, Slime ranch), anchor depicts the most representative starter creature.
3. **If user named a human theme** (samurai RPG, ninja game, cyberpunk hacker), anchor depicts the player human in their canonical pose.
4. **If user named a hybrid** (medium + spirit, knight + dragon), anchor depicts BOTH together — human + companion.
5. **Default ambiguous case**: pick HUMAN. Most RPG protagonists are human-shaped; safer baseline.

**Anchor prompt template**:
```
Style: <Style directive verbatim from spec §1>
Subject: <User-named main subject — be specific>.
       Example: "Young Sengoku tactician in lacquered armor, holding a war fan,
        confident pose, kabuto helmet visible, age 18-25."
       NOT: "war-spirit mascot creature with samurai armor."
Constraint: This anchor defines the project's visual identity. Every later
character / monster / NPC will be generated with view_image of this image —
so the proportions, color treatment, and rendering style here propagate.
```

If the first anchor comes back wrong (mascot when you wanted hero, monster when you wanted human), **regenerate before moving on**. A wrong anchor wastes every subsequent gen call.

## Style directive specificity — for restrictive art styles

Image_gen has strong defaults: bright chibi anime, full color, glossy rendering. To produce something OUTSIDE that bias (ink wash, brutalist pixel, monochrome retro, hand-drawn lineart), the prompt needs **explicit negatives** plus **positive examples**.

The `Style directive` from spec §1 must include both for restrictive styles. Examples:

**水墨 (ink wash) — restrictive**:
```
Style: traditional East Asian ink-wash painting, monochromatic black and grey
with ONE muted color accent maximum (vermilion seal red OR moss green, not
both). Visible brush strokes, ink bleed at edges, parchment background.
NOT chibi, NOT anime, NOT brightly colored. Sumi-e brush technique.
References: Sesshu Toyo, Hasegawa Tohaku ink scrolls.
```

**Brutalist pixel — restrictive**:
```
Style: high-contrast 8-bit pixel art, exactly 16-color palette, hard pixel
edges with NO anti-aliasing, NES-era constraint. Each character fits
in 16x16 or 24x24 cell. NOT 16-bit, NOT detailed, NOT smoothed pixels.
Reference: Castlevania (NES), Mega Man (NES).
```

**Cute cartoon — permissive (default-aligned)**:
```
Style: bright cartoon 2D, cute readable silhouettes, simple shading.
```
(Less constraint needed — image_gen defaults to this.)

**Hand-drawn editorial — restrictive**:
```
Style: editorial pencil-and-watercolor illustration, visible paper grain,
hand-drawn linework with weight variation, muted watercolor wash. NOT
digital, NOT chibi, NOT vector. Reference: Studio Ghibli concept sketches.
```

**Rule**: if the user picks a non-default style (ink_painterly, retro_pixel, hand_drawn, brutalist, monochrome, etc.), the Style directive MUST include explicit "NOT X, NOT Y" negatives + "Reference: <real-world artist or game>" anchors. Otherwise image_gen reverts to its default chibi-anime aesthetic and the user feels every project looks the same.

## Style directive — every gen call uses it

`.ogf/spec.md` §1 contains a 'Style directive' line — the concrete art direction the project locks. **Every** `generate2dsprite` and `generate2dmap` call must include this directive verbatim in the prompt argument. After each gen, the skill writes the actual prompt back to `prompt-used.txt` next to the asset; that's your audit trail.

## Palette discipline — sprite vs map roles (universal)

Past projects across multiple genres (sengoku platformer, three-kingdoms TD, sengoku arena, vertical shmup) produced backgrounds where characters blend in because spec §1 listed ONE palette and both `generate2dsprite` + `generate2dmap` used the SAME colors at full saturation. Every genre suffers; the rule lives here.

### Required structure for spec.md §1 palette

Spec must declare TWO palette roles instead of a single flat list:

- **Sprite palette** (full saturation, high contrast):
  Used for player, enemies, projectiles, pickups, weapon FX, hazards.
  These are the "accent colors" — should pop visually.

- **Map palette** (desaturated, lower value):
  Used for ground tiles, parallax layers, terrain props, walls, floors,
  decorative scenery, level architecture.
  These are "subordinated colors" — should recede so sprites read on top.

Example for an ink-style sengoku game:
```
Sprite palette: #D9362B vermilion, #E5B84A gold, #2FA66A jade
Map palette:    #6E1F18 muted oxblood, #8C7842 olive, #2A1B16 ink shadow
                (same hues, ~50% saturation reduction + ~20% value drop)
```

The map versions can be the same hues at lower saturation (one cohesive look) OR completely different hues (more contrast). The point is sprite-role colors must NOT appear in map at full intensity.

### Required at every gen call

Every `generate2dsprite` prompt MUST include verbatim:
```
"Use the SPRITE palette: <list spec's sprite colors>."
```

Every `generate2dmap` prompt MUST include verbatim:
```
"Use the MAP/BACKGROUND palette (subordinated): <list spec's map colors>.
 Avoid sprite-role colors at full saturation."
```

This is in addition to the `[STYLE DIRECTIVE]` line of the prompt template — palette discipline is a separate explicit instruction.

### Repair if the result fails

If a generated map makes sprites hard to read after an apply:
1. Open the map's `prompt-used.txt` — does it cite the map palette role explicitly?
2. If not: regenerate with explicit map-palette mention.
3. If yes but result still bad: reduce map palette saturation another 20% in spec.md §1, regenerate.
4. Last resort: shift map hues away from sprite hues (e.g. sprite reds → map cool greys/blues).

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

## Visual consistency — view_image is a HARD procedural step

> ⚠️ This is the #1 quality-killer when skipped. Read carefully.

Past projects produced flat-vector geometric output when the user asked for "16-bit pixel art" — including a recent test-2d-rpg project where the map came back looking like a child's drawing. Why: the agent **mentioned** the style anchor in the prompt text but **never invoked `view_image`** to load it into context. The model generated blind, interpreted "pixel art" with no visual anchor as "flat vector shapes", and produced unusable output.

**Mentioning a reference path in prompt text is NOT a substitute for view_image.** view_image is the only mechanism that loads asset bytes into the model's context. Text-only mentions read as "fyi this file exists" — the model can't see it.

### MANDATORY procedure for every generate2dsprite / generate2dmap call

In the SAME message that invokes the skill, you MUST emit TWO tool_uses in this order:

1. **`view_image`** — load the chosen reference path into context.
2. **`generate2dsprite` / `generate2dmap`** — call the skill with `reference: 'generated_image'`.

Reference selection priority (pick the closest existing):

```
same-character sheet  >  same-family sibling  >  project anchor (.ogf/style-anchor.png)
```

Examples:

```
Phase 1 (style anchor — first ever gen, no prior reference exists):
  tool_use 1: generate2dsprite asset_type='style_anchor' (no view_image, this IS the anchor)

Phase 2 (first map gen — anchor now exists):
  tool_use 1: view_image .ogf/style-anchor.png
  tool_use 2: generate2dmap reference: 'generated_image' prompt: '...'

Phase 4+ (player walk sheet — idle already exists):
  tool_use 1: view_image assets/sprites/player/idle/sheet.png
  tool_use 2: generate2dsprite reference: 'generated_image' prompt: '...'
```

### Forbidden patterns

- ❌ "Reference: project style anchor at .ogf/style-anchor.png" (text only — model can't see it).
- ❌ Sending the skill call alone in a message, view_image in a separate prior message — the bytes don't carry across messages reliably.
- ❌ Calling generate2dmap with `reference: 'none'` for any phase after the first — explicit opt-out from anchoring is wrong unless this IS the very first asset.
- ❌ Re-using a stale reference (e.g. view_image-ing an old idle sheet to generate the boss) — ALWAYS pick the closest matching one.

### Repair if the asset comes back degenerate

Symptoms of skipped view_image:
- Map looks like flat vector shapes when "pixel art" was requested
- Sprite palette doesn't match project palette
- Character proportions / face / costume drift across animations

Fix: re-do the generation with proper view_image. The skill's `prompt-used.txt` next to the asset will reveal whether reference was actually loaded — look for `reference: 'generated_image'` in the args (vs `'none'` or absent).

### State the reference role explicitly in the prompt

After view_image, the prompt to the skill must state how to USE the reference:

- **Same character, new animation**: "Use the loaded image as the visual reference. PRESERVE the subject's identity exactly: silhouette, palette, face/eye features, costume marks, accessories, body proportions. Generate the SAME character in a different animation: <action>."
- **Same family, sibling asset**: "Use the loaded image as a STYLE reference. Match: art style, palette, line weight, lighting, proportions. The new asset is a DIFFERENT subject (<id>) in the same world — do not copy the subject, only the rendering."
- **Style anchor**: "Use the loaded image as a STYLE reference. Match: palette, line weight, overall aesthetic. The new asset is unrelated to the figure shown — only the rendering style must match."

Pick one of these three phrasings; do not invent a fourth.

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

## Background dimensions

Two distinct cases — DO NOT confuse them:

### Case A — single full-map `background.image` (top-down RPG, locked-camera boss room)

The image MUST be exactly `mapSize.width × mapSize.height`. If `generate2dmap` returns a different size, resize via `Image.resize((mapSize.width, mapSize.height), Image.LANCZOS)` and save back.

### Case B — parallax `layers[]` with `repeatX: true` (side-scroll, scrolling levels)

Each layer image is a **tileable strip at viewport-native size (1280×720)**, NOT mapSize-wide. The runtime tiles it horizontally via modulo wrap. Do NOT resize to mapSize.width — that would defeat tileable parallax (produces blurry stretched art and pins level length).

| | width × height | resize after gen? |
|---|---|---|
| Full-map background (top-down RPG) | `mapSize.width × mapSize.height` | YES (to mapSize) |
| Locked-camera boss room background | `viewport.w × viewport.h` (=mapSize) | YES (to mapSize) |
| Tileable parallax layer (side-scroll, repeatX:true) | **1280 × 720** (or 1664×720 — divisible by 16) | downscale 1672×941 → 1280×720 via `process_parallax_layer.py`; NEVER stretch to mapSize.width |

For side-scroll parallax: `mapSize.width` is decoupled from layer image width — level can be 5120 or 10240 with the same 1280×720 layer PNGs.

## Engine selection

- **Web** (default): vanilla JS + HTML5 Canvas + JSON data files. The active development direction. Pick this unless the user explicitly asks for Godot.
- **Godot**: still supported for legacy projects but no longer the default.
- **Unity / Unreal / WebGL+Three.js**: not supported for new projects.

## Module architecture (universal across all genres)

> ⚠️ Past OGF projects shipped with weak engines because the spec template recommended only 4-6 files. test-2d-rpg5's combat.js was 138 lines for an entire turn-based battle system; test-scroll's whole game was 465 LOC. Compare to `D:/Sengoku-Era-ogf` — same RPG genre, 20 modules, 3,052 LOC, full battle FSM + menu + dialogue + progression + transitions + audio. The thin engine isn't a model limitation; it's a spec template that didn't ask for enough modules.

### Five universal rules

These apply to EVERY genre. Per-genre module recipes appear in each genre file.

**1. One responsibility per file.** Aim for 100-500 LOC per module. A 138-line combat.js that handles turn FSM + animation timing + capture math + state transitions is too crowded — split into `battle.js` (FSM) + `menu.js` (commands) + `progression.js` (XP). Sengoku-Era-ogf's battle.js is 537 lines doing ONLY the battle FSM with 30+ small functions; that's the depth target.

**2. Shared global `state.js`.** One canonical state object held in `src/state.js`. All other modules read/mutate it directly. No prop drilling, no React-style nested state, no per-entity stores. Keeps cross-module wiring trivial:

```js
// src/state.js
const state = {
  mode: "overworld",     // overworld | battle | menu | choose | transition
  scene: "outdoor",
  player: { x: 0, y: 0, hp: 100, ... },
  party: [],
  inventory: {},
  battle: null,          // populated when mode === 'battle'
  transition: null,
  keys: new Set(),
  // ... whatever the game needs
};
```

**3. Config split: tuning vs identity.** Two kinds of JSON under `data/`:
- `*-config.json` — TUNING (numbers the user wants to tweak: HP curves, damage multipliers, animation durations, ease curves, audio volumes, camera follow speed)
- `*.json` (no `-config` suffix) — IDENTITY (catalog entries: enemies/items/heroes/levels — what THINGS exist)

Why split: balance changes touch ONE file (`battle-config.json`), don't risk breaking catalog parsers. User can tweak game feel without reading code. Examples from Sengoku-Era-ogf:
- `data/enemies.json` — enemy ids, names, sprite paths (identity)
- `data/battle-config.json` — transition timings, finish delays, FX durations (tuning)
- `data/audio-config.json` — tone frequencies, gain levels (tuning)
- `data/progression-config.json` — XP curve, stat growth per level (tuning)

**4. Thin `game.js` entry.** ~50 lines max. Just: load assets → init state → start main loop → wire DOM event handlers. All gameplay logic lives in subsystem modules. Sengoku-Era-ogf's game.js is 46 lines.

**5. Script tag loading is the default.** Use classic `<script src="src/x.js">` tags in index.html, not ES modules. Each module declares functions at the top level (globals). This sounds old-school but is RIGHT for OGF's prototype-and-modify niche:
- Agent adds new module = add file + one `<script>` line. No import graph to update.
- User can inspect any global in DevTools without import tracking.
- Zero bundler overhead, fastest reload.
- Order-sensitivity is the only downside — declare load order in index.html (constants → state → subsystems → game.js entry last). For 5-25 module projects this is fine.

If the user explicitly opts into ES modules via the discovery form (`module_style: modern`), use `<script type="module">` and `import/export` instead. Default is `simple`.

### File layout (web engine, script-tag default)

```
project-root/
├── index.html             ← <script> tags load src/* in order
├── styles.css
├── src/
│   ├── constants.js       ← VIEW.w/h, frame budget, fixed values
│   ├── config.js          ← load + cache *-config.json
│   ├── catalogs.js        ← load + cache identity *.json
│   ├── dom.js             ← cached DOM refs
│   ├── state.js           ← shared global state object
│   ├── assets.js          ← image preloader
│   ├── audio.js           ← WebAudio cues (tones + noise, no .mp3)
│   ├── input.js           ← keyboard + gamepad
│   ├── touch.js           ← mobile touch (optional, only if mobile in scope)
│   ├── collision.js       ← AABB + level-collision-map
│   ├── render.js          ← canvas drawing (calls into per-mode draw functions)
│   ├── scene.js           ← scene/level switching
│   ├── transition.js      ← fade/zoom over the canvas (battle entry, scene change)
│   ├── dialogue.js        ← text-reveal box (only if game has dialogue)
│   ├── interaction.js     ← NPC / object interact triggers
│   │
│   ├── <genre subsystem 1>.js   ← see your genre file for recipe
│   ├── <genre subsystem 2>.js
│   ├── <genre subsystem N>.js
│   │
│   └── game.js            ← entry: load → init → main loop. ~50 lines.
├── data/
│   ├── levels.json
│   ├── <level_id>.json
│   ├── <level_id>-collision-map.json
│   │
│   ├── <catalog>.json     ← identity (enemies / items / heroes / pickups)
│   ├── <catalog>.json
│   │
│   ├── <subsystem>-config.json  ← tuning (battle-config / audio-config / progression-config)
│   ├── <subsystem>-config.json
│   └── ...
├── assets/
│   ├── maps/<level_id>/{base,reference,...}.png
│   └── sprites/<entity_id>/<action>/sheet.png + pipeline-meta.json
├── .ogf/
│   ├── spec.md
│   ├── style-anchor.png
│   └── conventions/
└── .agents/
    └── skills/
```

Every project gets the universal modules (constants/config/catalogs/dom/state/assets/audio/input/collision/render/scene/transition + game.js). Genre-specific modules and config files are listed in each genre file's `## Recommended module split` section. Most playable-tier projects land at 12-20 src/ files + 5-10 data/ files.

### When to split further

- A function is a state machine ≥ 4 states → its own file
- A subsystem has ≥ 3 entry points called from elsewhere → its own file
- A file passes ~500 lines OR mixes 2 concerns → split

Don't pre-emptively split single-state systems into their own files. Don't merge unrelated concerns to "save a file."

### Reference implementations to read

Each genre file lists `## Reference implementation` paths to known-good projects. When implementing engine code in any phase, view_image the relevant module from the reference and follow its shape rather than reinventing.

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
