// OGF project conventions — written verbatim into <project>/.ogf/conventions.md
// at New-Project scaffold time. Read by composePrompt every turn so Codex
// stays consistent with the structure OGF can edit visually.
//
// One template per engine. Cross-engine rules at the top, engine-specific
// section underneath.

const COMMON = `# OGF project conventions

This file is the contract between Codex and the in-app editor. The editor
shows / edits things in this layout; Codex must keep producing them in this
layout so the visual editor stays useful.

## The contract — short version

1. **Data and code are separate.** Numbers (HP, damage, prices, wave counts,
   anchor positions, prop layouts) live in JSON under \`data/\`. Never inline
   gameplay data into source files.
2. **Spatial data uses canonical shapes.** Each shape has a fixed schema:
   - point: \`{ "x": <num>, "y": <num> }\`
   - rect:  \`{ "x", "y", "w", "h" }\`  (top-left + size)
   - circle: \`{ "x", "y", "radius" }\`
   - polygon: \`{ "points": [[x,y], [x,y], ...] }\`
   Always use these field names; do not invent variants.
3. **One level / one screen → one data file.** Every editable level has its
   own JSON in \`data/\` so the user can open and tweak it independently.
4. **assets/ is for raw files**, **data/ is for structured files**. Generated
   sprites land under \`assets/\`. Their per-asset metadata (slicing,
   anchors) goes in \`data/\` if it needs editing, or as sidecar JSON next to
   the asset if it's purely build-time.
5. **One source of truth.** Don't store the same fact in two places (e.g.
   prop position both in a .tscn and a JSON). Pick one.

## Catalogs

Catalogs are arrays-of-objects. Use them for: enemy types, hero types, tower
types, items, abilities, dialogue lines.

\`\`\`json
[
  { "id": "scout", "hp": 42, "speed": 128, "sprite": "assets/enemies/scout/sheet.png" },
  { "id": "grunt", "hp": 82, "speed": 92, "sprite": "assets/enemies/grunt/sheet.png" }
]
\`\`\`

Top-level array OR wrapped in \`{ "<plural>": [...] }\` are both fine; OGF
detects either.

## Wave / event timelines

If your game has wave-based or time-based events, store them as
array-of-objects with a \`delay\` (or \`time\`) field per entry:

\`\`\`json
{
  "waves": [
    { "delay": 1.0, "groups": [{ "type": "scout", "count": 8, "interval": 0.6 }] },
    { "delay": 5.0, "groups": [...] }
  ]
}
\`\`\`

Object form (not array of arrays). OGF will offer a timeline editor for any
array-of-objects with a recognized time field.

## Image generation skill (Codex)

For sprite / animation assets, USE the **\`generate2dsprite\`** Codex skill.
It handles image_gen + chroma key + frame slicing. Don't roll your own.

For maps and tiles / props, USE the **\`generate2dmap\`** skill. It picks the
right pipeline (baked / layered / tilemap) and writes sliced sprite files
under \`assets/\` plus a metadata JSON under \`data/\`.

When the user asks "make me a slime", reach for these skills before writing
custom image_gen prompts.

### These skills are MANDATORY for visual assets — no shortcuts

You MUST NOT generate game-visible art with raw \`image_gen\` and bypass the
skill, even when "you just need one frame quickly", even when you think
batching is more efficient. Specifically:

- ❌ DON'T call \`image_gen\` directly for character / enemy / item / FX /
  tower / prop sprites — EVER. Even one. Even "just for testing".
- ❌ DON'T inline-generate a single PNG and use it as a sprite.
- ❌ DON'T fake an animation sheet by tiling one pose N× and calling each cell
  a "frame" — the result looks like the character froze.
- ❌ **DON'T pack multiple distinct assets into a single mega-sheet.**
  This is the most common bypass and it's WRONG. Examples of what NOT to do:
    - "EXACT GRID: 4 rows × 5 columns. Row 1: archer, spear, stone, strategist,
      banner. Row 2: their level-2 versions. Row 3: their level-3 versions.
      Row 4: build_pad, arrow, projectile, flame_fx, coin_icon"
    - "Generate one atlas containing all 4 enemies, each in a different row"
    - "Pack hero and 3 NPCs into one sheet for memory efficiency"
  The skill is designed for **ONE asset per call**, with multiple animation
  rows for THAT one asset (idle / walk / attack / death of the same character).
  Different assets MUST go through separate \`generate2dsprite\` calls.
  5 towers × 3 levels = **15 separate \`generate2dsprite\` calls**, not 1
  image_gen with a 4×5 grid. Yes, really. The cost is real but the alternative
  is broken sprites the slicer can't parse and the user can't use.
- ❌ If you're about to write "Row 1: …, Row 2: …" or "EXACT GRID" or
  "atlas containing X, Y, and Z" in an image_gen prompt, STOP. That's the
  forbidden pattern. Use \`generate2dsprite\` per-asset instead.

- ✅ Call \`generate2dsprite\` ONCE per asset. The skill's \`sheet\` parameter
  (1x4 / 2x2 / 4x4 / etc.) controls the animation-row layout for that ONE
  asset, not a multi-asset packing.
- ✅ Each row in a generate2dsprite sheet is one ANIMATION of the same
  character (idle row, walk row, attack row), with each cell a DISTINCT
  pose progression — actual motion frames, not duplicates.
- ✅ Request the SAME number of frames for each animation row (so the slicer
  can grid-cut). The exact count is your judgement call — pick what suits
  the genre / style / completeness tier (a chunky NES-style walk reads at
  2 frames; a fluid Hollow-Knight-style walk wants 6+).
- ✅ Backgrounds + props go through \`generate2dmap\` regardless of whether
  you "could just" \`image_gen\` a single image.

#### Cost vs. correctness

If the spec lists 5 towers × 3 upgrade levels + 4 enemies + 1 hero, the
correct plan is **23 separate skill invocations** (15 + 4 + 1 + N for hero
animation rows the skill handles internally), not "let me batch this into
2 mega-atlases to save image_gen calls". Yes, you'll spend more turns and
more API budget on visual generation. That is the explicit trade-off OGF
makes. Bypassing it produces unusable assets and wastes more time when
the user has to ask you to redo it.

The non-negotiable rule is **motion variation**: every cell in a row must
show actual progression. The frame COUNT is your call, but the count must
mean what it claims (a 4-frame walk row must show 4 distinct walk poses,
not 1 pose × 4).

#### When may I call image_gen directly?

The narrow exceptions, in order of frequency:
1. **Never for game-visible sprites.** Use \`generate2dsprite\`.
2. **Never for backgrounds / maps / tiles.** Use \`generate2dmap\`.
3. The skill itself uses \`image_gen\` internally — that's the skill's job,
   not yours. If you find yourself writing \`image_gen\` calls "the way the
   skill would", you are bypassing the skill. Stop and call the skill.
4. The only legitimate direct \`image_gen\` is something neither skill
   covers (e.g. a one-off explanation diagram for the user, never going
   into the game). If you're tempted to use it for game art, you are wrong.

### Honor the spec's Style directive in every gen call

\`.ogf/spec.md\` §1 contains a 'Style directive' line — a concrete art
direction sentence that combines art_style + color_mood + world_setting +
references. This is the source of truth for visual identity.

**Every \`generate2dsprite\` and \`generate2dmap\` call MUST include the
Style directive verbatim in its prompt argument.** Don't paraphrase, don't
drop fields, don't rewrite for "concision". The image-gen model defaults
to generic-illustration look when given vague prompts — the user picked
'pixel art' and got 'painterly' more than once because the skill calls
omitted the style hint. The directive is the fix.

If the spec is missing a Style directive (legacy spec from before this
rule), construct one from the available spec fields BEFORE calling the
skill, then write it back into spec.md so future calls stay consistent.

### Visual consistency — reference image workflow is MANDATORY

Image generation models are stochastic. Even with an identical Style
directive, two independent calls produce visually different characters
— same prompt, different faces / proportions / palette emphasis.
We've shipped projects where idle / walk / attack / death of the same
character looked like four different people. **This is unacceptable
and the fix is non-negotiable.** Every gen call after the project's
first one must reference an existing asset via the \`view_image\` →
generate workflow.

#### The mandatory pattern (read before every gen call)

Before calling \`generate2dsprite\` or \`generate2dmap\` for the
SECOND or later time in a project, you MUST do these steps in order:

**Step 1 — Identify the reference asset.** Pick the closest existing
file using this priority:

1. **Same character / asset**: generating another animation of an
   existing character (\`scout_walk.png\` when \`scout_idle.png\`
   exists)? Reference = that existing sheet.
2. **Same family**: generating another enemy in the same army, another
   tile in the same biome, another tower in the same line? Reference
   = a previously generated sibling in the same category.
3. **Project anchor**: \`.ogf/style-anchor.png\` if it exists.
4. **Last fallback**: any previously generated asset in the project.

If NONE of the above exist (you really are generating the first
visual in the project), you are creating the implicit anchor — make
your first gen the most representative one possible (the hero or
main background, not a one-off prop) so future calls have a strong
reference.

**Step 2 — Make the reference visible to \`image_gen\` via \`view_image\`.**
This is non-negotiable. Reading a path string into a prompt does NOT
load the image into context. Without view_image, the model generates
blind and you get the same drift you were trying to prevent.

\`\`\`
view_image: <path/to/reference.png>
\`\`\`

The reference image bytes go into the conversation, image_gen's next
call sees them, generation is anchored.

**Step 3 — State the reference role explicitly in the gen prompt.**
The skill needs to know whether to copy the subject or only the
style. Use one of these phrasings verbatim:

- **Same character, new animation**:
  > "Use the image just shown as the visual reference. PRESERVE the
  > subject's identity exactly: silhouette, palette, face/eye
  > features, costume marks, accessories, body proportions. Generate
  > the SAME character in a different animation: <action>."

- **Same family, sibling asset**:
  > "Use the image just shown as a STYLE reference. Match: art style,
  > palette, line weight, lighting, proportions. The new asset is a
  > DIFFERENT subject (<id>) in the same world — do not copy the
  > subject, only the rendering."

- **Style anchor**:
  > "Use the image just shown as a STYLE reference. Match: palette,
  > line weight, overall aesthetic. The new asset is unrelated to the
  > figure shown — only the rendering style must match."

Pick the phrasing that fits the case; do not invent a fourth.

**Step 4 — Pass the right \`reference\` parameter to the skill.**
\`generate2dsprite\` / \`generate2dmap\` accept
\`reference: 'generated_image' | 'local_file' | 'attached_image' | 'none'\`.
After view_image you set \`reference: 'generated_image'\` (the bytes
are now in context as a generated-image-like asset).

#### What this prevents

- Same character drifting across animations (idle is bald, walk has
  a hat, attack has a beard, death is a different species)
- Faction members looking visually unrelated to each other
- Random art-style drift between background and characters
- Palette drift across the project as gens accumulate
- Per-frame instability inside a single sheet — the skill's existing
  containment rules cover frame-to-frame, but reference also helps

#### Forbidden patterns

- ❌ Pasting the file path into the prompt without view_image — the
  model never sees the file, generation is blind.
- ❌ Generating the second character without referencing the first.
- ❌ "Match the style of <id>" in plain prose without view_image of
  that id.
- ❌ Skipping reference because "this is just a small prop, doesn't
  matter" — small props drift the most because the model fills in
  more from defaults.

#### Style anchor file

\`.ogf/style-anchor.png\` is OGF's project-wide visual canon — the
reference of last resort. If the spec's Phase 1 doesn't already
generate one, the FIRST \`generate2dsprite\` call's output should be
copied to that path so subsequent calls have an anchor. A good anchor
is a 3×2 grid showing one of each category (hero / enemy / prop /
environment tile / effect / UI element) in a single image, all in
the project's locked palette and line weight. \`generate2dsprite\` can
emit one with \`asset_type: 'style_anchor'\` if you ask.

### Generating ≠ done — you MUST wire it into game data

Both skills produce ASSETS only. The generated \`assets/\*\` files are
invisible until something references them in the gameplay data the engine
reads. This is the most common failure mode: Codex calls the skill, sprites
land on disk, the user reloads the game and sees nothing.

After the skill finishes, in the same turn you MUST:

1. Decide where the new asset belongs (which level / which catalog).
2. Edit the appropriate data file to add the reference:
   - **prop sprites** → append to the active level's \`props[]\` (web) or
     instance the sprite under the appropriate node (godot)
   - **enemy / hero sprites** → add an entry to \`data/enemies.json\` /
     \`data/heroes.json\` with the new \`sprite\` path
   - **item / pickup sprites** → add an entry to \`data/items.json\`
   - **map background** → set the level's \`background\` field

The pack metadata file the skill writes (e.g. \`data/han-stage-prop-pack.json\`
with an \`accepted\` array of label / crop boxes) is for the slicing tool ONLY.
It is NOT the gameplay data; it never gets loaded by the game. If you stop
after that file is written, the user sees nothing in OGF and nothing in
their game.

## Read the live state before answering spatial questions

OGF writes the user's current scene state to \`.ogf/scene-context.json\` on
every drag / select / scene change. When the user asks "this prop", "the
selected zone", or refers to anything by visual position, read that file
first.
`;

const GODOT = `## Godot 4 specifics

### File layout
\`\`\`
project.godot
scenes/
  Main.tscn                 ← run/main_scene; the runtime entry
  prefabs/
    Enemy.tscn
    Hero.tscn
    Tower.tscn
scripts/
  Main.gd
  Enemy.gd
  ...
data/
  enemies.json              ← catalog
  heroes.json
  towers.json
  waves.json
  <level>/
    collision.json          ← { blockers, buildZones, enemyPaths, entrances, goals, heroSpawn }
    props.json              ← array of { id, image, x, y, w, h, sortY }
assets/
  map/
  props/
  enemies/
  ui/
\`\`\`

### Scene patterns — use Godot's built-in node types

| Need | USE | DO NOT use |
|---|---|---|
| Enemy walking path | **Path2D + Curve2D** | Node2D + custom MapEditPathPoint script |
| Trigger area / zone | **Area2D + CollisionShape2D** | Custom Node2D + script |
| Solid blocker | **StaticBody2D + CollisionShape2D / CollisionPolygon2D** | Same |
| Spawn point | **Marker2D** | Empty Node2D |
| Single sprite prop | **Sprite2D** as a direct child of a grouping Node2D | Node2D wrapper around a Sprite2D when there's no extra logic |

### Sprite anchoring — match what the user sees in OGF Scenes tab to runtime

Godot's \`Sprite2D\` defaults to \`centered = true\`, so the texture's CENTER
sits at the parent's position. That looks fine in-game (because the player
is centered against centered collision and a moving camera frames the
result), but the OGF Scenes tab shows raw world coords and the visual
"feet" land halfway off the platform. Author with the runtime experience
in mind:

| Node kind | Sprite2D setting | Result |
|---|---|---|
| **Actor** (Player / Enemy / NPC) | \`offset = Vector2(0, -h/2)\` (h = texture height) | Parent's position is the FEET point — aligns with collision bottom and OGF's bottom-center anchor convention |
| **Platform / static prop** | \`centered = false\` | position = top-left corner — aligns trivially with rectangle collision |

Then **CollisionShape2D position should match the sprite anchor exactly** —
don't offset the collision down by half the sprite height to "fix" the
visual. If the sprite's top half is decoration the player can pass through,
either crop the sprite OR put the decoration in a separate Sprite2D
sibling. The collider and the sprite must agree on what 'origin' means.

### Set \`z_index\` for layering — backgrounds behind, foreground above

Without explicit \`z_index\`, sprites render in scene-tree order, which is
usually NOT what you want. A background Sprite2D placed AFTER the
platforms in the .tscn will draw ON TOP of them and hide gameplay.

Conventions:
- Backgrounds / parallax layers: \`z_index = -10\` or \`-20\`
- Static world props (platforms, decorations): \`z_index = 0\` (default, omit)
- Actors (player, enemies): \`z_index = 5\`
- Foreground / particle effects: \`z_index = 10\`
- UI overlays: use a CanvasLayer instead

OGF's Scenes tab sorts by z_index when rendering. If you ship a 1280×720
background as a centered=false Sprite2D with no z_index, OGF will guess
'-1' to keep it behind — but be explicit; relying on the heuristic is
fragile across edits.

### Wrapper-position pattern: Sprite2D + CollisionShape2D share one transform

A platform / wall / static prop is conceptually ONE thing — a visual surface
the player walks on. The standard Godot pattern is a single \`StaticBody2D\`
that owns the position, with both children at local \`(0, 0)\`:

\`\`\`
PlatformStart  StaticBody2D  position = (320, 650)   ← THE position. Owns transform.
  Visual       Sprite2D      position = (0, 0)        ← inherits parent transform
  CollisionShape2D            position = (0, 0)        ← inherits parent transform
\`\`\`

Both children's positions are LOCAL offsets relative to the wrapper. With
both at (0, 0), they sit exactly where the wrapper is.

**OGF behavior with this pattern**: the same \`StaticBody2D.position\` field
drives both the prop's render position AND the collider's position. So in
the Scenes tab:
- Drag the prop → wrapper moves → collider tracks it
- Drag the collider → wrapper moves → prop tracks it
- They are **linked** because they're the same physical thing.

This is correct. Don't try to "fix" it by giving each child a non-zero
local position to compensate for something — that just makes the .tscn
authored state diverge from the runtime composition.

**When to break the pattern (use child local position non-zero)**:

- The collision rect intentionally covers a smaller region than the sprite
  (e.g. a wide tree sprite with a thin trunk-only collider). Set
  CollisionShape2D.position to the collider's offset relative to the
  visual center.
- Decoration (smoke / glow / shadow) sits in front-of or behind the prop
  with its own offset. Use a separate Sprite2D sibling with non-zero
  position for that, NOT the main Visual sprite.

**Don't break the pattern just because OGF shows them linked.** Linked is
the right behavior for a 'platform' — moving the platform should move
both its visual AND its collision, in lockstep.

### Initial positions in .tscn must already be correct — don't reposition in \`_ready\`

The .tscn file IS the authoritative initial layout. If \`_ready()\` does
\`player.global_position = player_spawn.global_position\`, the OGF Scenes
tab shows the player at the .tscn position (whatever Codex left there),
but the user clicks Play and the player appears somewhere else. The two
views diverge.

Rule: **author the .tscn so initial positions are already runtime-correct**.
Markers like PlayerSpawn / EnemySpawn can still exist for RESPAWN logic
(after death, after entering a checkpoint), but the initial spawn shouldn't
need a \`_ready\` shuffle — set the actor at the right spot in the .tscn
and that becomes both the OGF view AND the game's starting state.

### Don't build the visible world from code — author it in .tscn

The .tscn IS the world. \`Main.tscn\` MUST contain the visible structure as
a real node tree: Sprite2D for sprites, StaticBody2D + CollisionShape2D for
static collision, Area2D for zones, AnimatedSprite2D for animated actors.
\`Main.gd\` and the rest of the scripts handle BEHAVIOR (input, AI, scoring,
state transitions, animation triggers) — they do NOT instantiate the world.

| Right | Wrong |
|---|---|
| \`Main.tscn\` has ~50 child nodes (player, platforms, enemies, background, UI) authored as real scene structure. Scripts just mutate position/animation/state. | \`Main.tscn\` has only a single Node2D + \`script = ExtResource\`. \`Main.gd\` is 700 lines that \`add_child(Sprite2D.new())\` everything at runtime. |

Why this matters: **OGF can't see runtime-instantiated nodes**. The Scenes
tab parses the .tscn file; if the file is empty, OGF shows an empty canvas
even though the running game is full of objects. The user can't drag what
isn't there. The whole point of the editor breaks.

If a level has many similar entities (e.g. 30 platforms), instance them as
Sprite2D / StaticBody2D children in the .tscn directly — copy/paste in
Godot editor or generate via a Codex turn that writes the .tscn text. Use
data JSON for catalogs (enemy stats, item drops) but NOT for the world's
spatial layout — that lives in the .tscn.

Acceptable code instantiation: things spawned dynamically by gameplay
(bullets, particles, picked-up enemies). Anything that exists at level
start should be in the .tscn.

### Asset import — OGF handles it automatically before Play

Godot 4 requires every asset to have a \`.import\` sidecar file. New PNG /
WAV / FBX files you generate (via \`image_gen\` / \`generate2dsprite\` /
\`generate2dmap\`) don't have one until Godot's editor scans the project.

OGF runs \`godot --headless --import\` automatically before each Play, so
**you don't have to do anything special** — just generate the asset, write
the \`load("res://...")\` reference, and the next Play will succeed.

Commit the auto-generated \`*.import\` sidecars and the \`.godot/imported/\`
folder to git so collaborators don't have to re-import.

If for some reason the import step fails (rare; usually means the asset
file itself is corrupt), the Play console will show:

\`\`\`
[OGF] Asset import exited with code N
ERROR: No loader found for resource: res://...
\`\`\`

Tell the user to (a) check the file is a valid PNG, (b) try opening
the project once in the Godot Editor for a more verbose error message.

### Strict typing gotcha — \`:=\` infers Variant from JSON / Dictionary methods

Default Godot 4 projects treat "type inferred from Variant value" as an
ERROR, not a warning. So this looks innocent but won't load:

\`\`\`gdscript
var rows := max(int(data.get("rows", 1)), 1)   # ← parse error
\`\`\`

\`max()\` is Variant-typed when its args go through \`data.get()\` (which
returns Variant). Use an explicit annotation instead:

\`\`\`gdscript
var rows: int = max(int(data.get("rows", 1)), 1)   # ← OK
\`\`\`

Same applies to \`min / abs / round / clamp / lerp\` and any chain that
touches \`Dictionary.get / Array[i]\` without a typed cast. When in doubt,
write the type — the few extra characters save a parse-fail launch.

### Avoid \`@tool\` for gameplay

\`@tool\` scripts run in the editor too. Use them ONLY for editor-time
visualization (e.g. drawing a guide). Never put gameplay logic behind \`@tool\`
— at runtime it confuses everything.

### Loading data

Use the standard pattern:

\`\`\`gdscript
const ENEMY_DATA := "res://data/enemies.json"

func _ready() -> void:
    var enemies = _load_json(ENEMY_DATA)
    for e in enemies:
        # spawn / register / whatever
        pass

func _load_json(path: String) -> Variant:
    var text := FileAccess.get_file_as_string(path)
    return JSON.parse_string(text)
\`\`\`

Don't write the catalog inline as a literal in the .gd file — OGF can edit
the JSON, can't edit the inline literal.

### Project setup defaults

\`project.godot\` should declare:
\`\`\`
[application]
config/name="<your game>"
run/main_scene="res://scenes/Main.tscn"
config/features=PackedStringArray("4.5")
\`\`\`
`;

const WEB = `## Web (Canvas 2D + vanilla JS) specifics

### File layout — modular by responsibility

The bootstrap scaffolds a minimal split that's the OGF contract: each module
owns one job, stays under ~300 lines, and is independently understandable.
Add new modules as the game grows — don't fold new responsibilities into an
existing module to "save a file".

\`\`\`
index.html
styles.css
src/
  game.js                   ← entry: boot + frame loop. STAYS SMALL (<60 lines).
  scene.js                  ← level JSON loading, scene state, draw dispatch
  render.js                 ← camera (sx/sy), background + props draw primitives
  input.js                  ← keyboard/mouse → poll-able intent surface
  assets.js                 ← loadJSON / loadImage helpers (no game state)
  collision.js              ← ADD when checking blockers/walkBounds at runtime
  battle.js                 ← ADD when introducing a combat scene / state machine
  ui.js                     ← ADD for HUD, dialogs, menus
  entities/
    player.js               ← ADD when player has its own update logic
    enemy.js                ← ADD when enemies have their own update logic
data/
  levels.json               ← list of { id, file } — one entry per scene
  <level-id>.json           ← one file per scene (see schema below)
  enemies.json              ← catalog (array-of-objects)
  heroes.json
  items.json
  waves.json                ← (TD games) wave timeline
assets/
  maps/<level-id>.png       ← background per level
  props/<id>/prop.png       ← single sprite props
  sprites/<thing>/sheet.png ← multi-frame characters
  sounds/...
\`\`\`

**Why this split**: each module aligns with an OGF editor surface. \`scene.js\`
+ level JSON ↔ Scenes tab. Catalogs ↔ Table editor. \`waves.json\` ↔ Timeline
editor. Code that grows past 300 lines is a sign to split — pick the smallest
new module that lifts a single responsibility out (collision math, battle
state machine, an entity's update loop).

### \`data/levels.json\` is the level registry — keep it accurate

OGF uses \`data/levels.json\` to decide which JSON files are levels (open in
the Scenes tab as a draggable canvas) versus which are catalogs (open as a
table). If you add a new scene, add it to \`data/levels.json\` immediately.

Two equivalent shapes — both work, OGF parses either:

\`\`\`json
{
  "levels": [
    { "id": "outdoor", "file": "data/outdoor-collision-map.json" },
    { "id": "temple",  "file": "data/temple-collision-map.json"  }
  ]
}
\`\`\`

\`\`\`json
[
  { "id": "outdoor", "file": "data/outdoor-collision-map.json" },
  { "id": "temple",  "file": "data/temple-collision-map.json"  }
]
\`\`\`

Each entry MUST have at least \`id\` and \`file\`. Extra fields (display name,
mapKey, etc.) are fine — OGF ignores them but your game can use them.

Any \`data/*.json\` NOT listed here (enemies, items, audio-themes, assets) is
treated as a catalog and won't be routed to the Scenes tab. Don't store
gameplay numbers inside levels.json itself — it's a routing manifest only.

### Per-level JSON schema

Each level file has this shape (extra fields are fine):

\`\`\`json
{
  "id": "temple",
  "background": "assets/maps/temple.png",
  "mapSize": { "width": 1672, "height": 941 },
  "spawn":   { "x": 836, "y": 782 },
  "exits":   { "<id>": { "x", "y", "interactRadius", "target", "spawn": { "x", "y" } } },
  "zones":   { "<id>": { "x", "y", "w", "h" } },
  "walkBounds": [ { "id", "type": "rect" | "ellipse", "x", "y", ...} ],
  "blockers":   [ { "id", "type", "x", "y", "w", "h" | "rx", "ry" } ],
  "spawn_points": [ { "id", "x", "y", "facing"? } ],
  "props":     [ { "id", "image", "x", "y", "w", "h", "sortY"? } ]
}
\`\`\`

OGF will render the \`background\` image, then overlay every shape from this
file with the correct semantic color. The user drags a shape → OGF rewrites
the JSON in place.

### Anchor conventions

- **Props** use a **bottom-center** anchor: \`(p.x, p.y)\` = (horizontal center,
  feet / ground line). Renders as
  \`ctx.drawImage(img, p.x - p.w/2, p.y - p.h, p.w, p.h)\`. This matches how
  characters stand on the ground and how OGF drags them.
- **Rects / blockers / walkBounds / platforms / hazards / pickups** use
  **top-left** anchor: \`(x, y)\` = upper-left corner, plus \`w\`, \`h\`.
- **Points** (spawn, exits, goals) are just \`{ x, y }\` with no anchor concept.
- \`sortY\` (optional) is the y used for back-to-front draw order; defaults
  to \`y\`. Use it when the visual feet sit above the collision feet (e.g.
  a shrine whose roof should sort behind a tree even though its base is in
  front).

### Visual entities can live in any top-level array

Domain-specific arrays are FINE — model your game the way it actually works.
A platformer naturally has \`platforms[]\`, \`hazards[]\`, \`pickups[]\`,
\`checkpoints[]\`, \`doors[]\`. A TD game has \`towers[]\`, \`waves[]\`,
\`buildSpots[]\`. Don't fold everything into \`props[]\` just because OGF
historically only knew that one.

OGF auto-renders any entry in any top-level array that has:
- \`image\`: a path to a sprite under \`assets/\`
- \`x\`, \`y\`: position numbers
- \`w\`, \`h\`: size numbers (must be > 0)

Such entries are draggable in the Scenes tab and writes go back to their
source array (no migration to \`props[]\` needed). They're tinted by section
so the user can tell platforms apart from pickups at a glance.

Gameplay metadata (\`solid\`, \`damage\`, \`value\`, \`kind\`, …) lives on the
SAME entry alongside the visual fields — don't split visual and gameplay
data across two arrays. ONE source of truth.

### Code patterns

- **Level JSON is loaded from disk every boot. Never hardcode coordinates,
  prop lists, or catalogs in JS.** The whole point of the JSON layout is
  that OGF (or the user, or Codex) can edit data/\\*.json and the next
  reload sees the change with zero code edits. If you find yourself writing
  a literal array of \`{ x, y, image }\` in a .js file — STOP and put it in a
  level/catalog JSON instead.

  \`\`\`js
  // scene.js
  const level = await loadJSON('data/temple.json');
  for (const p of level.props) {
    ctx.drawImage(images[p.image], p.x - p.w/2, p.y - p.h, p.w, p.h);
  }
  \`\`\`

- Pre-load every \`props[*].image\` into an \`images\` map keyed by the
  path string itself; look up via \`images[p.image]\` at draw time.
- Catalogs (\`enemies.json\`, \`items.json\`) are array-of-objects; load once
  at boot, look up by id at runtime.

### Module split rules (when to break out a new file)

The bootstrap ships with five files (\`game / scene / render / input /
assets\`). Add another when ANY of these is true:

- A module exceeds ~300 lines.
- You're about to add a second responsibility to an existing module
  (e.g. combat math creeping into scene.js → split into \`battle.js\`).
- You're adding a poll-able state machine (battle, dialog, menu) — give
  it its own module so the loop in game.js stays a one-line dispatch.
- An entity has its own update loop / per-frame logic — promote it to
  \`entities/<thing>.js\`.

DON'T pre-create empty files for "future" modules. Add them when the
threshold trips, not before.

The bootstrap's \`src/game.js\` is intentionally tiny (boot + dispatch loop).
Don't grow it. New work goes in scene.js or its own module.

### Image generation

Same skills as Godot:
- \`generate2dsprite\` for character / enemy / item sprites
- \`generate2dmap\` for backgrounds + props

The generated assets land under \`assets/\`. The cross-engine "you MUST wire
it into game data" rule applies — for web, that means editing the level JSON.

#### Wiring \`generate2dmap\` prop pack → level JSON

The skill writes one sprite per accepted entry to
\`assets/props/<pack-name>/<label>/prop.png\` and a metadata pack at
\`data/<pack-name>-prop-pack.json\` with an \`accepted\` array. For each
accepted entry, append an entry to the active level's \`props[]\`:

\`\`\`js
// pack metadata entry  →  OGF level prop
{
  label: "stone-floor",       →   id:    "stone-floor",
  // (image file lives at      →   image: "assets/props/<pack>/stone-floor/prop.png",
  //  the path above)
  // crop_bbox: [x0,y0,x1,y1]  →   w:     <x1-x0>,
  //   gives natural size      →   h:     <y1-y0>,
  //                           →   x:     <pick a sensible spot on the level>,
  //                           →   y:     <ground line for that spot>,  // bottom-center anchor
}
\`\`\`

Pick \`x\` / \`y\` based on what the prop IS — a stone-floor goes on the
ground, a fortress-gate spans an entry, a bamboo-spike sits on a
walkable surface. If you don't know where, place them in a row near
the spawn so the user can see them and drag them to the right spots.

After this edit, the level reload (in the Web Play tab) will show
the new props immediately. If \`level.props\` is still empty after a
\`generate2dmap\` turn, the work isn't done.

### What NOT to do

- ❌ WebGL / Three.js for new projects (much harder to visually edit)
- ❌ Physics engines for V1 — own the simple AABB / circle math
- ❌ Bundlers / build steps unless asked — OGF assumes the project is
  serve-able as a static folder
`;

export function godotConventions(): string {
  return COMMON + '\n' + GODOT;
}

export function webConventions(): string {
  return COMMON + '\n' + WEB;
}

/** Loaded by composePrompt — short summary, not the full doc. The full doc
 *  is in .ogf/conventions.md if Codex needs to re-read it. */
export function summarizeConventions(): string {
  return `# OGF conventions (full doc at .ogf/conventions.md)

- Data and code SEPARATE. Numbers in JSON under data/. Never inline.
- Shapes use canonical fields: { x, y } / { x, y, w, h } / { x, y, radius } /
  { points: [[x,y]...] }. No variants.
- One level per JSON file.
- For sprites use the \`generate2dsprite\` Codex skill; for maps use
  \`generate2dmap\`. They handle image_gen + post-processing.
- Generating ≠ done. After the skill writes assets, you MUST edit the
  level / catalog JSON to reference them, or the user sees nothing. The
  \`*-prop-pack.json\` metadata file is NOT the gameplay data.
- Live editor state is at .ogf/scene-context.json — cat it for spatial info.

Engine-specific rules in .ogf/conventions.md (read it when starting fresh
work or when you'd otherwise pick a non-standard pattern).`;
}
