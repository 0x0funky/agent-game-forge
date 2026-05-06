# Asset-Centric View — Plan

> **Status:** Discussion / proposal. Branch `feature/asset-centric-view`. No code yet.

## The problem in one screenshot's worth of words

OGF's left pane today is a raw file tree. For a finished test project (`test-td`) it shows ~40 files across `data/`, `assets/`, `src/`, `.ogf/`. The user thinks in **entities** ("Scout", "Archer Tower") and **scenes** ("Guandu Pass"); the tree forces them to think in **paths** (`assets/sprites/scout/walk.png`, `data/enemies.json#scout`, `src/enemies.js:142`).

Net effect: even after the agent does great work, the project feels messy because the surface area we expose is messy.

Today, when the user wants to "regenerate Scout":

1. They guess where Scout's sprite lives → drill into `assets/sprites/scout/`.
2. Pick ONE png (say `attack.png`) → click Regenerate.
3. Modal pops, asks options for that ONE png.
4. Other anims of Scout are unchanged → drift between idle/walk/attack.

What they actually mean: "redo the whole Scout pack with consistent style." The current UI can't say that.

## What the user is asking for

1. **Asset-first sidebar.** Show the things people care about (entities, scenes, maps), not files. Files are accessible but secondary.
2. **Group by entity.** All Scout-related files (sprites + catalog row + usages) collapse into one "Scout" item.
3. **Whole-pack regenerate.** Click an entity → regenerate ALL its sprites + update its catalog row in one operation.
4. **Separate Data vs Scenes.** Two top-level lanes in the sidebar — like Figma's "Pages" + "Assets".
5. **Refactor button on Open Project.** For users with existing JS games, a third option that asks the agent to import + restructure into OGF layout.

## Mental model — Figma analogy

| Figma | OGF (today) | OGF (proposed) |
|-------|-------------|-----------------|
| Pages | n/a | Scenes lane |
| Components | n/a | Entities lane (each = sprite pack + catalog row) |
| Assets | n/a | Maps / Audio lane |
| Layers (raw) | File tree | Files lane (collapsed by default) |

The shift: **the catalog files become the index, not the asset folders.** `data/enemies.json` is a list of entities → each entry maps to a folder of sprites → that's what we display.

## Proposed UI

```
┌─ SIDEBAR ─────────────────┐  ┌─ MAIN ─────────────────────┐
│                           │  │                            │
│ ▼ ENTITIES                │  │  [whatever's selected]     │
│   ▼ Enemies (3)           │  │                            │
│     ● Scout               │  │                            │
│     ● Bandit              │  │                            │
│     ● Crimson Daimyo      │  │                            │
│   ▼ Towers (4)            │  │                            │
│     ● Archer              │  │                            │
│     ● Spear               │  │                            │
│     ● Strategist          │  │                            │
│     ● Cavalry Camp        │  │                            │
│   ▼ Heroes (1)            │  │                            │
│     ● Guan Yu             │  │                            │
│   ▼ Pickups (2)           │  │                            │
│     ● Rice Ball           │  │                            │
│     ● XP Orb              │  │                            │
│                           │  │                            │
│ ▼ SCENES (3)              │  │                            │
│   ◆ Guandu Pass           │  │                            │
│   ◆ Baima Gate Boss       │  │                            │
│   ◆ Level 1               │  │                            │
│                           │  │                            │
│ ▼ ASSETS                  │  │                            │
│   ▶ Maps (3)              │  │                            │
│   ▶ Audio (8)             │  │                            │
│   ▶ Style anchor          │  │                            │
│                           │  │                            │
│ ▼ CODE                    │  │                            │
│   game.js                 │  │                            │
│   enemies.js              │  │                            │
│   towers.js               │  │                            │
│   ...                     │  │                            │
│                           │  │                            │
│ ▼ FILES (raw)             │  │                            │
│   ▶ all 47 files          │  │                            │
│                           │  │                            │
│ ─────────────────────     │  │                            │
│ + Add entity              │  │                            │
│ + Add scene               │  │                            │
└───────────────────────────┘  └────────────────────────────┘
```

### When user clicks an entity (e.g. "Scout")

```
┌─ SCOUT ─────────────────────────────── enemy ─┐
│                                                │
│ ┌────┬────┬────┬────┐                         │
│ │idle│walk│atk │die │  [+ add animation]      │
│ └────┴────┴────┴────┘                         │
│   ▶ animated previews loop side-by-side       │
│                                                │
│ ── STATS ────────────────────────────────      │
│ HP        45                                   │
│ Speed     90 px/s                              │
│ Damage    8                                    │
│ XP        5                                    │
│ [Edit table view]                              │
│                                                │
│ ── DISPLAY ─────────────────────────────       │
│ Render     90 × 90 px, anchor: bottom          │
│ Hitbox     55 × 70                             │
│ Strategy   side_with_flip                      │
│                                                │
│ ── USED IN ─────────────────────────────       │
│ Scenes:    Guandu Pass · Baima Gate Boss       │
│ Code refs: src/enemies.js:142, 158             │
│                                                │
│ ── ACTIONS ─────────────────────────────       │
│ ⟳ Regenerate whole pack                        │
│ ⟳ Regenerate one animation                     │
│ + Add animation (e.g. "dodge", "block")        │
│ + Add variant (e.g. "elite_scout")             │
│ 🗑  Remove from project                         │
│                                                │
│ ── FILES ───────────────────────────────       │
│ 4 sprites · 1 catalog row · 2 code refs        │
│ [Show in raw file tree]                        │
└────────────────────────────────────────────────┘
```

This view is **derived** from existing files — no schema change needed. The catalog (`data/enemies.json#scout`) IS the source of truth; sprites are matched by id convention (`assets/sprites/scout/*.png`).

### When user clicks a scene (e.g. "Guandu Pass")

Opens the existing **SceneEditor** (already built, no changes needed). The existing Scene/Data/Play tabs continue to work.

### When user clicks "Files (raw)"

Drops back to today's full file tree. This is the escape hatch — power users + debugging always have it.

## How OGF discovers entities (no schema work needed)

```ts
// Pseudocode — runs on project load + when catalogs change
async function discoverEntities(projectPath: string): Promise<Entity[]> {
  const entities: Entity[] = [];

  // 1. Walk known catalog files. These ARE the entity index.
  const catalogs = [
    { file: 'data/enemies.json', kind: 'enemy' },
    { file: 'data/heroes.json', kind: 'hero' },
    { file: 'data/towers.json', kind: 'tower' },
    { file: 'data/pickups.json', kind: 'pickup' },
    { file: 'data/projectiles.json', kind: 'projectile' },
    { file: 'data/items.json', kind: 'item' },
    { file: 'data/player.json', kind: 'player' },
    // discovered dynamically: any data/<name>.json with a top-level array OR record
  ];

  for (const cat of catalogs) {
    const json = await readJsonIfExists(projectPath, cat.file);
    if (!json) continue;
    const rows = Array.isArray(json) ? json : Object.entries(json).map(([id, v]) => ({ id, ...v }));
    for (const row of rows) {
      entities.push({
        id: row.id,
        kind: cat.kind,
        catalog: cat.file,
        sprites: await findSprites(projectPath, row.id),  // glob assets/sprites/<id>/*.png
        usages: await scanCodeRefs(projectPath, row.id),  // existing fetchUsages
        stats: row.stats ?? {},
        display: { displayW: row.displayW, displayH: row.displayH, anchor: row.anchor },
      });
    }
  }
  return entities;
}
```

**No file system changes. No new schema. Just a derived view.**

If discovery fails (catalog malformed, sprite folder missing) → show entity in a "broken" state with a "Show files" link to investigate. Never hide errors.

## Whole-pack regenerate — the flow

Today: user picks one PNG → modal options → agent regens that PNG.

Proposed: user clicks entity → action button "Regenerate whole pack" → modal pre-fills with:
- All current animations (preview each)
- ☑ Regenerate ALL animations (default)
- ☑ Update catalog row if dimensions/grid change
- ☑ Match style anchor + previously generated entities
- Hint textarea: "what should change about this character?"
- Aspect ratio selector (applies to all anims)
- Per-anim FPS overrides (collapsed)

Submit → builds ONE prompt:

```
Regenerate the COMPLETE sprite pack for entity `scout` (data/enemies.json).

The pack:
- assets/sprites/scout/idle.png  (8 frames @ 4×2)
- assets/sprites/scout/walk.png  (6 frames @ 6×1)
- assets/sprites/scout/attack.png (4 frames @ 4×1)
- assets/sprites/scout/death.png (5 frames @ 5×1)

Goal: refresh all four animations as a coherent set so Scout looks
like the SAME character across all anims. Current concern: visual
drift between anims.

For each animation:
1. Stage to .ogf/regen/assets/sprites/scout/<anim>.png
2. Use generate2dsprite with reference=generated_image after
   view_image of the FIRST anim's previous version (the agent picks
   one — typically idle).
3. Maintain the existing grid + fps for each anim.

Hint from user: "More aggressive — bigger swings, more weight"

Style references (read these via view_image before any generate call):
- .ogf/style-anchor.png
- assets/sprites/scout/idle.png  (existing — primary identity ref)

Don't edit any other file. Confirm each regen output path when done.
The user reviews + applies the swap (see Regenerate workflow in
conventions for staging).
```

Once user reviews + applies all 4 → if dimensions changed, run a follow-up agent turn that updates `enemies.json#scout` displayW/displayH/collision and any code references.

## Separate Data vs Scene panes

Today: one mixed file tree.
Proposed: top-level lanes in sidebar (see UI mock above):

- **Entities** — derived from data catalogs
- **Scenes** — `data/levels.json` registry
- **Assets** — Maps + Audio + Style anchor (raw image/audio assets that aren't tied to entities)
- **Code** — `src/*.js` and other source files
- **Files (raw)** — full file tree, escape hatch

Each lane is collapsible. User can hide everything except what they're working on.

## Refactor existing project — the new "Open" option

Open Project modal today: **Open existing** + **Create new from prompt**.

Add: **Refactor existing JS game**.

Flow:
1. User picks a folder containing an existing JS game (Phaser, vanilla canvas, P5, whatever).
2. OGF asks Codex to scan it and produce a 1-page audit:
   - Detected engine (Phaser vs vanilla)
   - Found entities (parsed from sprite paths + script analysis)
   - Found scenes/levels (if any)
   - Found assets (PNGs, sheets, audio)
   - Confidence score per detection
3. User reviews audit. Picks: full refactor, sidecar-only, or cancel.
4. **Sidecar-only mode** (low risk, default): agent writes `data/*.json` catalogs derived from existing code, doesn't touch original files. User sees their game in OGF's asset-centric view but the original code keeps working unchanged.
5. **Full refactor mode** (high risk, opt-in): agent restructures into OGF's `data/`+`assets/`+`src/` layout, possibly rewriting source. Always works in a NEW dir or git branch. Never destroys the original.

**Sidecar-only is the right default.** It's what makes the import a one-click decision instead of a high-stakes rewrite. Most existing games don't NEED OGF's structure — they just need OGF's asset-centric view. The sidecar gives that without touching the engine.

Refactor flow respects existing CLAUDE.md / conventions if present.

## Implementation plan

This is a multi-week effort. Order matters — each step ships value independently.

### Phase 1 — Discovery + sidebar lanes (1 week)

- [ ] Daemon API: `GET /api/projects/:id/entities` → returns derived entity list
- [ ] Daemon API: `GET /api/projects/:id/scenes` → returns scene list (already partially exists via levels registry)
- [ ] React: new `Sidebar` lanes (Entities / Scenes / Assets / Code / Files), collapsible
- [ ] Click entity → opens new `EntityInspector` panel (placeholder, just shows id + sprite list for now)
- [ ] Click scene → opens existing SceneEditor
- [ ] "Files (raw)" lane = today's FileTree, hidden behind toggle

**Ship gate:** test-td shows 6 entities + 1 scene in the new sidebar; user can click each. EntityInspector is bare but functional.

### Phase 2 — EntityInspector full UI (1 week)

- [ ] Animations strip (each anim's SpritePreview side-by-side)
- [ ] Stats panel (editable inline; writes back to catalog json)
- [ ] Display + hitbox panel
- [ ] Used-in panel (scenes + code refs)
- [ ] Click any sprite → existing FileEditor opens with regen pending

**Ship gate:** User can browse Scout, edit HP value, see it persist to enemies.json.

### Phase 3 — Whole-pack regenerate (1 week)

- [ ] New action: "Regenerate pack" → builds multi-anim prompt
- [ ] Staging: `.ogf/regen/assets/sprites/<id>/*` (multi-file staging, not just one)
- [ ] Approval UX: shows all N anims diff at once; "Apply pack" / "Apply selected" / "Discard pack"
- [ ] Catalog auto-update if displayW/H or grid changes (deferred to post-apply turn)

**Ship gate:** Regenerate Scout pack with hint "more aggressive" → 4 new anims diff side-by-side → apply all → catalog updates → game looks consistently more aggressive.

### Phase 4 — Refactor existing project (2 weeks, riskier)

- [ ] Open Project modal: third option "Refactor existing JS game"
- [ ] Codex skill / prompt: project audit → produce JSON report
- [ ] Audit review UI (one screen, scroll-through)
- [ ] Sidecar-only mode (default, low risk)
- [ ] Full refactor mode (opt-in, branch isolation)
- [ ] Documentation: what OGF guarantees / doesn't guarantee for imports

**Ship gate:** A real Phaser tutorial game can be imported in sidecar mode; OGF's asset-centric view shows correct entities; the original game still runs unchanged.

## Open questions

1. **What about projects WITHOUT clean catalogs?** A user who hand-coded enemies into `enemies.js` constants instead of `enemies.json` — do we discover them? Probably yes via code-scan as Phase 4 work; for Phase 1-3 assume well-structured projects.
2. **Multi-genre projects** (a project with TD AND platformer levels)? Each scene declares its own genre via `camera.mode` already. Sidebar groups everything together. Fine.
3. **Custom catalogs** (user adds `data/spells.json`)? Detect via heuristic: any `data/<name>.json` with array-of-objects-with-id shape gets a sidebar lane. Whitelist common ones for nicer labels.
4. **Backwards compat** — does the old file tree go away? **No.** It's a toggle, always available. Power users + debugging always need raw access.
5. **Naming.** "Entities" vs "Things" vs "Components"? "Entities" wins — game-dev native term.
6. **Where does scene-context.json fit?** Behind the scenes, unchanged. Sidebar doesn't need to surface it.

## What this PROBABLY isn't worth doing

- Drag-and-drop between sidebar lanes (overkill, click-to-rename works)
- Search bar in sidebar (later, only if entity count grows past ~30)
- Custom user-defined groupings (premature abstraction; let conventions emerge first)
- A "favorites" star (not enough projects to need it yet)

## Recommendation: ship Phase 1 first

Phase 1 alone gives the user 80% of the perceived improvement (clean sidebar, click-to-entity, scenes separate from data). EntityInspector can be bare for week one — even if it just shows "Scout (3 sprites, 2 usages) [open files]" that's already cleaner than today.

Phase 2-3 each add real workflow value but Phase 1 is the foundation that makes them obvious wins later.

Phase 4 (refactor existing project) is the marketing win — it's what gets external users to try OGF. But it's the riskiest and shouldn't block Phase 1-3.

## Next step (for the human)

Pick one:
- **(a)** Approve plan → I start Phase 1 in this branch
- **(b)** Push back on UI / discovery rules / phasing
- **(c)** Cut scope — e.g. "just whole-pack regenerate, skip the sidebar redesign for now"
