# Genre — Side-scroller / Platformer

Mega Man X, Mario, Castlevania-style side-view action games.

**Canonical reference**: [Mike Hadley's Phaser 3 tilemap series](https://github.com/mikewesthad/phaser-3-tilemap-blog-posts) — author of Phaser's tilemap API. The `posts/post-2/03-drawing-platformer/` example shows everything in one place. Read it for the PATTERN.

> ⚠️ **OGF projects do NOT use Phaser** — vanilla Canvas 2D only. References below are pattern inspiration. See `runtime-patterns.md` for the Phaser → vanilla translation table. The code samples in this file are already vanilla canvas; copy those, not Phaser snippets from the linked tutorials.

This file assumes you've also read `runtime-patterns.md` (delta time, AABB, FSM, scroll factor, etc — those are universal).

## Generation procedure — view_image + skill call as paired tool_uses

EVERY `generate2dmap` / `generate2dsprite` call MUST be preceded by `view_image` of the closest existing reference, in the SAME message. See `common.md` "Visual consistency" for the canonical pattern + reasoning.

```
Phase 2 (parallax layers — first per-segment image):
  tool_use 1: view_image .ogf/style-anchor.png
  tool_use 2: generate2dmap reference: 'generated_image'
              prompt: "[STYLE...] [VIEW...] side-scroll parallax
                       <layer-name>, segment 1 of 2..."

Phase 3 (platform tile pack):
  tool_use 1: view_image .ogf/style-anchor.png
  tool_use 2: generate2dmap (or generate2dsprite for tile pack)
              reference: 'generated_image'

Phase 4 (player anims — after first idle exists):
  Phase 4a (idle, first time):
    tool_use 1: view_image .ogf/style-anchor.png
    tool_use 2: generate2dsprite reference: 'generated_image'
  Phase 4b (walk, idle now exists — reference idle for character identity):
    tool_use 1: view_image assets/sprites/player/idle/sheet.png
    tool_use 2: generate2dsprite reference: 'generated_image'
                prompt: "Same character, new animation: walk cycle..."
```

Skipping view_image → blind generation → degenerate output (flat vector geometric shapes when "pixel art" requested, palette drift, character faces inconsistent across animations).

### Process strategy for character action sheets

When you run `scripts/generate2dsprite.py process` on player / enemy / boss action sheets, use **`--scale-strategy preserve --align feet`** for ALL their actions (idle, walk, jump, attack, hurt, etc.). This is the SKILL.md default — preserve keeps weapons, capes, slash arcs, and aura FX intact instead of vertically compressing wide attack poses.

**Hard rule**: every action sheet for the same character uses the same strategy. Don't process idle with default fit and attack with preserve — the character will visibly shrink between animations (test-2d-gpg2 nobunaga: idle 139px / attack 102px = 27% drift). Pick preserve at the first action and stick with it.

`fit` is for: projectiles, item pickups, hit-spark / muzzle-flash FX sheets, UI sprites — small grid-uniform assets where cell-fitting matters more than artistic preservation.

## Camera — camera-window + lookahead, NOT raw lerp

Side-scrolling cameras have a small set of established patterns. Itay Keren catalogued them in [Scroll Back](https://www.gamedeveloper.com/design/scroll-back-the-theory-and-practice-of-cameras-in-side-scrollers). For OGF, the **canonical pattern is camera-window + lookahead + platform-snapping** (this is what Mega Man X uses):

- **Camera window**: a region in the middle of the screen the player can move within without the camera moving. Camera only scrolls when the player tries to leave the window.
- **Lookahead**: when player faces right, camera target shifts right ~80px so the player sees more of where they're going. Same flipped on left.
- **Platform-snapping**: only re-center vertically when the player is grounded — prevents motion sickness during jumps.
- **Bounds clamp**: camera never shows outside the level (`mapSize.width` / `mapSize.height`).

Implementation sketch (vanilla web, ~40 lines in `src/scene.js`):

```js
// State carried in the scene
let camLookahead = 0; // smoothed
let camY = 0;        // platform-snap target

function updateCamera(player, dt) {
  // 1. Smooth the lookahead so facing changes don't snap (CRITICAL — otherwise
  //    walking back jumps the camera 160px in one frame)
  const desired = player.facing.x * 80;
  camLookahead += (desired - camLookahead) * Math.min(1, dt * 4);

  // 2. X target = player center + lookahead (camera-window logic optional;
  //    minimal version is just lerp toward target)
  const targetX = player.x + player.w/2 - viewport.w/2 + camLookahead;

  // 3. Y only re-centers when grounded (platform snapping)
  if (player.grounded) camY = player.y + player.h/2 - viewport.h/2;
  // else camY stays as-is during jumps

  // 4. Clamp to map bounds
  camera.x = clamp(targetX, 0, mapSize.width  - viewport.w);
  camera.y = clamp(camY,    0, mapSize.height - viewport.h);
}
```

**Anti-pattern**: setting `targetX = player.x + player.facing.x * 80` (no lerp) — when player turns from right to left, target jumps by 160px in one frame and the camera snaps. Always smooth lookahead.

**Anti-pattern**: tracking player Y rigidly during jumps — Keren calls this "Y-axis chaos". Use platform-snap (only re-center on ground).

## Background — parallax via scroll factor + tileable image OR multi-layer

Two canonical implementations:

### A. Single tileable image per layer (preferred for sky/cloud-style infinite layers)

The layer image is small (1024-1536 wide). At render time, draw it twice to cover any horizontal extent, with `scrollFactor`:

```js
function drawParallaxLayer(ctx, img, scrollFactor) {
  const offsetX = -((camera.x * scrollFactor) % img.width);
  ctx.drawImage(img, offsetX, 0);
  ctx.drawImage(img, offsetX + img.width, 0); // second copy for the gap
}
```

**Anti-pattern**: clamping `srcX` to `[0, img.width - canvas.width]` — when player walks back past the clamp threshold, the layer "snaps". And distant layers (low scrollFactor) barely move because their max srcX is small. **Use modulo wrap, not clamp.**

### B. Multi-segment per layer (when each segment has unique terrain)

For mid/near layers where each camera-width has different content:

```js
"layers": [
  { "id": "mid_bg", "tileMode": "segments",
    "segmentImages": ["assets/maps/level1/mid_seg1.png", ".../mid_seg2.png"] },
  ...
]
```

Renderer draws each segment at its own X offset, all with the same scrollFactor.

### Recommended layer setup (per `generate2dmap` defaults)

| Layer | scrollFactor | Tile mode | Notes |
|---|---|---|---|
| sky | 0.0–0.15 | tileable single image | doesn't move; just decorative |
| far_bg | 0.2–0.35 | tileable single OR segments | mountains, distant terrain |
| mid_bg | 0.5–0.65 | segments preferred | actual scenery the player sees passing |
| near_bg | 0.8–0.9 | segments | foreground silhouettes / set dressing |
| foreground_overlay | 1.05+ | static placement | optional — ferns, lanterns occluding the player |

3 layers is fine for most projects. 5 is the max before image_gen budget burns.

Reference: [Phaser parallax TileSprites tutorial](https://phaser.io/news/2019/06/parallax-scrolling-with-tilesprites-tutorial), [Ourcade parallax post](https://blog.ourcade.co/posts/2020/add-pizazz-parallax-scrolling-phaser-3/).

## Platforms — tile library, NEVER stretch

The biggest visual bug in past side-scroll projects: agent generates a 512×512 platform prop, drops it into level JSON with `{ image, w: 760, h: 100 }`, runtime stretches → 5× squash → looks awful.

**Default platform_visual_strategy = `tile_library`**:

- `generate2dmap`'s `platform_strip` workflow outputs a **strip pack**: `left-cap.png + middle-tile.png + right-cap.png`. The middle is designed to repeat seamlessly.
- Use the **EXTRACTED individual files**, NOT the combined `sheet.png`. The combined sheet has cell-padding gaps that cause visual seams between platform pieces.
- Schema:

```json
"shared_platform_library": {
  "stone_tile": {
    "left":  { "image": "assets/maps/.../platform_strip-1.png" },
    "mid":   { "image": "assets/maps/.../platform_strip-2.png", "tileW": 64 },
    "right": { "image": "assets/maps/.../platform_strip-3.png" }
  }
},
"platforms": [
  { "id": "ground_01", "x": 0,    "y": 600, "w": 760, "h": 96,
    "tile": "stone_tile", "renderMode": "three-piece" },
  { "id": "ledge_02",  "x": 820,  "y": 520, "w": 320, "h": 32,
    "tile": "stone_tile", "renderMode": "three-piece", "oneWay": true }
]
```

- Renderer: draw left-cap, then loop middle every `tileW` until close to right edge, then right-cap. **Never stretch.**

If the user explicitly wants set-piece platforms ("each platform is its own unique landmark"), use `renderMode: "natural"` and require `platform.w === image.naturalW`. OGF's Scene editor warns when `renderMode` is unset and `platform.w` doesn't match the image's natural dimensions.

## Collision — separate from visuals

Don't infer collision from `platforms[].h`. Use a `colliders[]` array:

```json
"colliders": [
  { "id": "col_ground_01", "shape": "rect",
    "x": 0, "y": 600, "w": 760, "h": 12,
    "type": "platform", "oneWay": false, "links": "ground_01" }
]
```

Collision rect height is typically smaller than the visual platform height (e.g. 12px collision for a 96px-tall platform — only the top edge counts).

`type` values: `platform` (solid floor/wall), `wall` (left/right bound), `hazard` (damages player), `kill` (instant death), `trigger` (zone event).

`platforms[].solid` is OBSOLETE — colliders[] is the source of truth for collision.

## Sprites — `side_with_flip` direction

Side-scrollers use `sprite_direction: side_with_flip` — generate sprites facing right only, runtime mirrors them when facing left:

```js
ctx.save();
if (player.facing.x < 0) {
  ctx.translate(player.x + player.w, player.y);
  ctx.scale(-1, 1);
  drawSprite(ctx, sheet, anim, 0, 0, t);
} else {
  drawSprite(ctx, sheet, anim, player.x, player.y, t);
}
ctx.restore();
```

Cuts sprite generation in half (no need for separate left-facing sheets) and is what 2D action platformers have done since the NES.

## Map size + camera

Spec.md camera mode = `follow` for scrolling levels, `locked` for boss arenas:

- `mapSize.width = stage_segment_count × viewport.width` (typically 2 × 1280 = 2560 for normal levels).
- `stage_segment_count = 2` is the default; 1 for boss rooms; 3+ only if user explicitly requests a longer level.
- Boss rooms use `camera.mode = locked` with `mapSize === viewport`.

## Common pitfalls (don't repeat past project mistakes)

1. **Camera lookahead snap on facing flip** — always smooth via lerp. (See Camera section above.)
2. **Parallax srcX clamp** — layer "snaps" walking back. Use modulo wrap.
3. **Layer image = mapSize.width** — distant layers barely scroll because their `srcX` range is tiny. Distant layers should be small + tile.
4. **Platform image stretched to gameplay-sized rect** — squashes art. Use tile library.
5. **`platforms[].solid: true`** — OGF Scene editor doesn't honor it. Use `colliders[]`.
6. **Strip-pack referenced via `sheet.png`** — has cell-padding gaps. Use extracted `*-1.png` / `*-2.png` / `*-3.png`.
7. **Collision body = sprite size** — corner clipping. Body should be 60-80% of sprite size.

Each of these has bitten previous OGF test projects. Avoid by following the patterns above.

## Recommended module split (side-scroll)

**Phase 0** installs the side-scroll foundation seed (see common.md §"Phase 0 — install foundation seed"). Side-scroll seed ships 22 modules with the layout below — adopt verbatim from `.ogf/foundation-seeds/side-scroll/seed/` rather than re-deriving:

Per `common.md` "Module architecture (universal)", every project gets the universal modules. Side-scroll adds these on top, with entity code split into `src/entities/`:

| Module | Responsibility | Approx LOC |
|---|---|---|
| `src/physics.js` | Gravity, 2-axis integrate (move x, resolve walls; move y, resolve platforms) | ~60 |
| `src/platforms.js` | `platformColliders()` + `damageColliders()` filters | ~15 |
| `src/parallax.js` | Layer sort + opacity + repeatX rendering | ~20 |
| `src/camera.js` | Follow camera + clamp to mapSize + shake | ~40 |
| `src/collision.js` | rectsOverlap, bodyRect helpers | ~30 |
| `src/particles.js` | burstParticles + updateParticles | ~40 |
| `src/render.js` | drawLevel orchestration + drawEntityAnimation helper | ~270 |
| `src/scene.js` | switchScene + buildSceneRuntime + updateScene + updateHazards | ~165 |
| `src/hud.js` | HP / lives / score / pause | ~75 |
| `src/dialogue.js` | Story panel | ~15 |
| `src/entities/player.js` | FSM: idle / walk / jump / attack, movement | ~100 |
| `src/entities/enemy.js` | Patrol + chase + melee/ranged AI | ~120 |
| `src/entities/attack.js` | Hitbox lifecycle + procedural slash VFX | ~75 |
| `src/entities/projectiles.js` | Straight-line projectile entities | ~35 |

Total per-project: ~22 src files, ~1,400 LOC (seed baseline). Project additions for spec-specific systems (energy meter, combo chain, multi-weapon) bring it to ~1,800-2,500 LOC.

Genre-specific config files:

| File | Holds |
|---|---|
| `data/physics-config.json` | Gravity, jump impulse, max-fall, run accel, friction, wall-cling slide |
| `data/enemy-stats.json` | Per-enemy HP / damage / speed / contact-damage |
| `data/camera-config.json` | Window width/height, lookahead distance, vertical snap |
| `data/audio-config.json` | sfx tone freqs, gain |

Identity files:

| File | Holds |
|---|---|
| `data/levels.json` | Level registry |
| `data/<level_id>.json` | Per level: parallax layers, platforms, enemies, hazards, pickups, exits, boss zone |
| `data/enemies.json` | Enemy catalog (id, sprite paths, animations) |
| `data/projectiles.json` | Projectile catalog |

## Reference implementation + recipes

The side-scroll foundation seed at `.ogf/foundation-seeds/side-scroll/seed/` is the reference structure. Copy it via Phase 0 then fill in spec-specific values. Source reference repo at `D:/Sengoku-Era-act-ogf/` — a complete playable Sengoku ronin action platformer (Moonlit Ronin → Castle Gate Boss), the seed was extracted from there with catalogs emptied and player id genericized.

**Read these recipes at phase execution time** (alongside the foundation seed's SEED.md):

| Implementing | Read recipe FIRST |
|---|---|
| `src/entities/attack.js` (player melee swing + hitbox) | `.ogf/recipes/side-scroll/combat-melee.md` |
| `src/parallax.js` + level `layers[]` schema | `.ogf/recipes/side-scroll/parallax-layers.md` |
| Platforms with shared_platform_library | `.ogf/recipes/side-scroll/platform-three-piece.md` |
| `src/entities/enemy.js` (patrol + ranged AI) | `.ogf/recipes/side-scroll/enemy-patrol.md` |
| Hazards (fire/spike) + pit-kill zones | `.ogf/recipes/side-scroll/hazards-and-pits.md` |
| Ranged enemy projectiles | `.ogf/recipes/side-scroll/projectiles.md` |
| Checkpoints + lives + respawn | `.ogf/recipes/side-scroll/checkpoints-respawn.md` |

Each recipe has a "When to use / When NOT to use" section — if your project's mechanic differs (combo attacks, charged attack, homing projectiles, etc.) the recipe explicitly tells you to fork rather than apply.

## Reference repos to learn from

- [mikewesthad/phaser-3-tilemap-blog-posts](https://github.com/mikewesthad/phaser-3-tilemap-blog-posts) — canonical
- [Itay Keren — Scroll Back](https://www.gamedeveloper.com/design/scroll-back-the-theory-and-practice-of-cameras-in-side-scrollers) — camera essay
- [Ourcade parallax](https://blog.ourcade.co/posts/2020/add-pizazz-parallax-scrolling-phaser-3/) — parallax in Phaser 3
- [Ourcade FSM](https://blog.ourcade.co/posts/2020/state-pattern-character-movement-phaser-3/) — state pattern for player movement
