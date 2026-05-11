# Recipe — Three-piece platform rendering

Render platforms by tiling 3 reusable sprite pieces (`left` + `mid` + `right`)
instead of one stretched image. Lets short platforms and very long
platforms both look correct from a tiny art budget.

## When to use

- Side-scroll level with multiple platforms of varying widths
- Want platforms to look chunky/textured, not flat-color rects
- Generated 3 small platform sprites (~64px cap + tileable middle) and
  want to reuse them across all platforms in a level

## When NOT to use

- **Tilemap-based level** — TileMap handles platform tiling natively
- **Each platform is a unique sprite** (boss arena with bespoke art) —
  use single-image platforms with `renderMode: "natural"` instead
- **Top-down RPG** — RPG props use bottom-center sprites, not tile strips

## Files this affects

- `src/render.js` — `drawPlatformStrip(ctx, platform, lib, x, y)` (~18 LOC)
- `src/platforms.js` — `platformColliders(level)` filter (~3 LOC)
- `data/<level>.json` — `shared_platform_library` block + per-platform
  `tile` reference
- `assets/maps/shared/<tile_name>/left.png + mid.png + right.png` —
  three pieces per tile-style

## Pattern

### 1. Library definition (per level)

```json
"shared_platform_library": {
  "ash_stone": {
    "left":  { "image": "assets/maps/shared/ash_stone_platform/left.png" },
    "mid":   { "image": "assets/maps/shared/ash_stone_platform/mid.png", "tileW": 64 },
    "right": { "image": "assets/maps/shared/ash_stone_platform/right.png" }
  }
}
```

- `left` / `right` — end caps (typically 64px wide)
- `mid` — tileable middle, `tileW` specifies repeat width
- Multiple library entries allowed per level (`ash_stone`, `wood_bridge`,
  `castle_marble`, ...)

### 2. Platform entry

Each platform references a library entry + renderMode:

```json
{ "id": "ground_01", "x": 0, "y": 608, "w": 720, "h": 88, "tile": "ash_stone", "renderMode": "three-piece" }
```

`renderMode` values:
- `"three-piece"` — use library entry's left+mid+right
- `"natural"` — use platform.image directly, no tiling (legacy/standalone)

### 3. Renderer

`drawPlatformStrip(ctx, platform, lib, x, y)`:
- Draw `left` at `(x, y)` width `tileW`
- Tile `mid` from `x + tileW` to `x + platform.w - tileW`
- Draw `right` at `(x + platform.w - tileW, y)` width `tileW`

Fallback (if images not loaded yet): solid `platformFace` + `platformTop`
rect.

### 4. Collision

Platform colliders are SEPARATE from visual platforms. Add a corresponding
entry to `colliders[]`:

```json
{ "id": "col_ground_01", "shape": "rect", "x": 0, "y": 608, "w": 720, "h": 14, "type": "platform", "oneWay": false, "links": "ground_01" }
```

- `type: "platform"` — top surface; y-axis only blocks downward
- `oneWay: true` — jump up through it (ledges)
- `h: 14` — collision rect is THINNER than visual (top surface only);
  rest of the platform body is decoration
- `links` — back-reference to visual platform id (informational, for
  the editor)

## Adaptation knobs

| Knob | Where | Effect |
|---|---|---|
| `tileW` | shared_platform_library entry | Middle-piece tile repeat width |
| `renderMode` | per platform | `three-piece` vs `natural` |
| Collider `h` | colliders[] entry | Thin top vs full-body collision |
| `oneWay` | colliders[] entry | Jump-through ledges |

## Common mistakes

1. **Single sprite stretched** — generated platform.png at 64×64, applied
   to a 720px-wide platform → blurry/stretched. Always use three-piece
   for variable widths.

2. **Mid `tileW` mismatch with PNG width** — tiles overlap or gap. Set
   `tileW` to the PNG's actual pixel width.

3. **Forgetting to add the collider** — platform draws but player falls
   through. Visual platforms in `platforms[]` and collision boxes in
   `colliders[]` are SEPARATE — both required.

4. **Collider full-height** — `h` matches platform's visual height (e.g.
   88). Player jumping up into the side of the platform gets stuck.
   Always use thin top-surface colliders (h: 12–16) for normal grounds.

5. **`type: "wall"` on a floor** — wall blocks x-axis, platform blocks
   y-axis. Floors should be `platform`. Vertical walls (cliffs you can't
   pass through) are `wall`.

## Reference

`D:/Sengoku-Era-act-ogf/src/render.js:drawPlatformStrip` +
`data/border_road.json` shared_platform_library.
