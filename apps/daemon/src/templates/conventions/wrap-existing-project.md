# Wrapping an existing project in OGF (sidecar mode)

Read this when the user asks you to "wrap / convert / OGF-fy / sidecar" an
existing game project that already has its own runtime, assets, and data
files. NOT for fresh OGF scaffolds — those follow `common.md` Phase 0.

## Two modes — pick one, declare it in `.ogf/spec.md`

### Mode A — Sidecar (default, preserves existing runtime)

- Existing source code is NOT modified, renamed, refactored, or rewired.
- Existing assets are NOT moved, renamed, regenerated, or deleted.
- Existing runtime data files (the ones the game's `src/*.js` actually
  reads at run time) are NOT changed in shape.
- OGF JSON files are ADDED alongside the existing data as metadata
  sidecars — for asset browsing, regeneration planning, and Scene
  editor inspection.

### Mode B — Migrate (refactor runtime to use OGF schema)

- Existing runtime is refactored to consume the new OGF-shaped data
  files directly. Existing data files may be deleted or replaced.
- Use this when the user explicitly asks ("migrate fully to OGF",
  "rewire the runtime", etc.) AND the existing data shape is small
  enough that a refactor is tractable.

> If the user says "OGF化" / "convert to OGF" without specifying,
> default to **Mode A (Sidecar)** and confirm in your first reply.

---

## The hard rule (BOTH modes)

**Every `data/<scene>.json` level file MUST conform to the OGF level
schema at the TOP LEVEL, regardless of which mode you picked.**

This is non-negotiable. The OGF Scene editor reads the top level only —
nested mirrors like `map.width` or `world.size.w` do NOT count. If a
level file fails this check, opening it in the editor produces:

> `JSON file is not a level (missing mapSize)`

### Required top-level fields

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique scene id |
| `mapSize` | `{ width: number, height: number }` | World dimensions in level units |
| `background` OR `layers` OR `props` | (see below) | At least one must be present + non-empty |

`background` can be:

- a string path: `"assets/maps/<scene>.png"`, OR
- an object: `{ "image": "...", "width": 1672, "height": 941 }`

`layers[]` is for parallax (side-scroll). `props[]` is for prop placements.

### Optional but commonly needed

- `spawn: { x, y }`
- `viewport: { width, height }`
- `camera: { mode, x, y, w, h }`
- `exits: { ... }`
- `zones: { ... }`
- `walkBounds[]`, `blockers[]` (or `collisionSource` pointing to a sidecar)
- `npcs[]`, `pickups[]`, `hazards[]`, `paths[]`

See `genres/<your-genre>.md` for the full per-genre schema.

### Extra fields are fine

You MAY keep project-specific fields the existing runtime needs — `source`,
`map.camera.viewportW`, `trainers[]`, `npcCatalogId`, whatever. They
won't break the editor. **But the OGF-required fields MUST exist at the
top level in addition.**

---

## Anti-pattern (the test-2drpg-pokemon failure, 2026)

Agent wrapped an existing top-down RPG and produced this level file:

```jsonc
// data/outdoor.json — BROKEN, editor can't open
{
  "id": "outdoor",
  "kind": "top_down_rpg_scene",
  "map": {                       // ← width / height hidden inside `map`
    "image": "assets/map/x.png",
    "width": 1672,
    "height": 941
  },
  "spawn": { "x": 836, "y": 782 }
}
```

The editor reads `data.mapSize` (top level). It's missing. Scene tab
shows the error and the user can't edit the level visually.

**Fix:**

```jsonc
// data/outdoor.json — WORKING
{
  "id": "outdoor",
  "kind": "top_down_rpg_scene",
  "background": "assets/map/x.png",         // ← top level
  "mapSize": { "width": 1672, "height": 941 }, // ← top level
  "map": {                                   // ← OK to keep as extra
    "image": "assets/map/x.png",
    "width": 1672,
    "height": 941,
    "camera": { "viewportW": 960, ... }
  },
  "spawn": { "x": 836, "y": 782 }
}
```

---

## Where to write your decision in `.ogf/spec.md`

Add a section near the top:

```markdown
## OGF Mode

- Mode: Sidecar (existing runtime preserved)
- Existing runtime entry point: `src/game.js`
- OGF-required level fields (`mapSize`, `background`) are mirrored at
  the top level of each `data/<scene>.json` so the Scene editor can
  open them; the runtime continues to read its own existing fields
  (e.g. `map.image`).
```

---

## Validation checklist — run before declaring done

For every `data/<scene>.json` you created or touched:

- [ ] `mapSize.width` and `mapSize.height` exist at top level, both numbers
- [ ] At least one of: `background` (string or object), `layers[]` (non-empty),
      `props[]` (non-empty) — exists at top level
- [ ] If you used `background` as an object form, its `width`/`height`
      equal `mapSize.width`/`mapSize.height` (top-down RPG / locked-camera
      cases — see `common.md` "Background dimensions")
- [ ] Open the scene in OGF Scene editor (ask the user to verify) — no
      "JSON file is not a level" error

If any item fails, the level file does NOT satisfy the schema. Fix and
re-validate.

---

## Sidecar collision-map files — separate convention

A `data/<scene>-collision-map.json` sidecar is NOT a level file. It
holds ONLY `blockers[]` / `walkable[]` / `walkBounds[]` (+ optionally a
back-reference `scene` field). It MUST NOT carry `mapSize` — putting
`mapSize` there confuses the loader because the editor's level check
sees `mapSize` and tries to render an empty canvas.

See `genres/top-down-rpg.md` § "Sidecar discipline" for the full rule.
