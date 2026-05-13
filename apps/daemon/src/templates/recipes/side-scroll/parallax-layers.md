# Recipe — Parallax background layers (tileable strips)

Implements 4-layer scrolling background using 1280×720 tileable strips +
horizontal repeat. Each layer scrolls at its own parallax factor so depth
emerges as the camera moves. Far/mid/near layers use magenta chroma-key
transparency so they don't cover the layers behind them.

## When to use

- Side-scroll where camera scrolls horizontally
- Level width > viewport width (typical normal level = 5120, short side
  quest = 3840-5120, long story level = 7680-10240, boss room = 1280)
- Want layered depth, not a single flat background image
- Generated maps come from `generate2dmap` with `map_mode: side_scroll_mode`

## When NOT to use

- **Boss-room with locked camera** — use a single `background.image`
  field instead, no layers / no parallax
- **Top-down RPG** — use `background` (single full-map image) not layers
- **Vertical scroll** (shmup vertical) — parallax direction differs;
  rewrite renderer or accept jank

## Files this affects

- `data/<level>.json` — `layers[]` array
- `assets/maps/<level_id>/sky.png + far_bg.png + mid_bg.png + near_bg.png`
- `src/parallax.js` — already supports `repeatX + opacity + zIndex` (no
  changes needed; this is the runtime side)
- `generate2dmap` skill with `map_mode: side_scroll_mode` (asset side)

## The contract — 4 layers, all tileable, all repeatX

```json
"layers": [
  { "id": "sky",     "image": "assets/maps/lvl1/sky.png",     "parallax": 0.04, "zIndex": 0, "repeatX": true },
  { "id": "far_bg",  "image": "assets/maps/lvl1/far_bg.png",  "parallax": 0.20, "zIndex": 1, "repeatX": true },
  { "id": "mid_bg",  "image": "assets/maps/lvl1/mid_bg.png",  "parallax": 0.50, "zIndex": 2, "repeatX": true },
  { "id": "near_bg", "image": "assets/maps/lvl1/near_bg.png", "parallax": 0.85, "zIndex": 3, "repeatX": true }
]
```

**Every layer is 1280×720** (or 1664×720 if you want slightly wider — must
be divisible by 16 for gpt-image-2). **Every layer has `repeatX: true`**.
**No single 5120×720 mega-images** — they cost more to generate, look
worse (often blurry from upscale), and pin the level width.

## Per-layer transparency rule (CRITICAL)

Parallax falls flat when every layer is fully opaque — the topmost layer
just covers everything below. For depth to show:

| Layer | Opaque or Transparent | Why |
|---|---|---|
| **sky** | OPAQUE (entire frame) | It's the backdrop; nothing draws behind it |
| **far_bg** | TRANSPARENT above silhouette line | Sky shows through the gaps |
| **mid_bg** | TRANSPARENT above silhouette + around buildings | Sky + far_bg show through |
| **near_bg** | TRANSPARENT everywhere except foreground objects | All 3 layers behind show through |

Implementation: generate far/mid/near with **solid #FF00FF magenta** in
the transparent regions, then chroma-key it to RGBA-transparent via
`scripts/process_parallax_layer.py` (post-processing, mirrors the sprite
pipeline's magenta-bg convention).

Sky stays opaque — no magenta, no chroma-key step.

## Generation procedure (per layer)

> **Image route**: under Codex CLI, call `image_gen` with the prompts below.
> Under Claude Code (or any other CLI), call
> `python .agents/tools/gen-image.py "<prompt>" raw-<layer>.png --no-magenta-bg`
> for **all four** parallax layers — the prompts already control magenta
> placement explicitly (sky has none; far/mid/near specify magenta where
> transparency is wanted), and `process_parallax_layer.py` handles the
> chroma-key + despill. Letting the wrapper auto-inject a generic
> "magenta background" instruction would fight the sky prompt's "fully
> opaque" rule. Both routes produce the same ~1672×941 raw output that
> the script then resizes to 1280×720.

### 1. Sky (~30-60s)

```
generate2dmap with map_mode: side_scroll_mode, single layer, opaque

Prompt:
[Style directive from spec §1]
[Map palette from spec §1]
Background sky panel, 1280×720, for side-scroll game level "<scene_name>".
Depicts <sky description: clouds at dawn / starry night / sunset gradient
/ overcast city haze>.

LOOSE horizontal tileability — the camera scrolls this layer very slowly
(parallax 0.04), so the tile seam will rarely show. Distribute clouds /
stars / atmospheric elements EVENLY across the frame. NO single dominant
feature (one big moon, one cluster of clouds at the far right).

Fully opaque. NO magenta — this layer is the backdrop.
NO frame borders, NO vignettes.
```

After image_gen output (typically 1672×941 raw):
```
python .agents/skills/generate2dmap/scripts/process_parallax_layer.py \
  --input <raw output path> \
  --output assets/maps/<level_id>/sky.png \
  --target-width 1280 --target-height 720 \
  --keep-magenta
```

### 2. Far BG (~30-60s)

```
Prompt:
[Style directive from spec §1]
[Map palette from spec §1]
Distant background silhouette strip, 1280×720, for side-scroll parallax.
Depicts <distant element: faraway mountains / distant city silhouette /
remote tree line / horizon towers>.

Silhouettes occupy the LOWER 30-50% of the frame. EVERYTHING ABOVE the
silhouette line AND ALL gaps between silhouette elements = SOLID #FF00FF
(pure magenta, NOT sky color, NOT gradient blue) for chroma-key removal.

SEAMLESSLY TILEABLE HORIZONTALLY — the rightmost pixel column content
must flow into the leftmost pixel column when this image tiles. Distribute
silhouette features evenly so the seam hides in the natural rhythm.

NO frame borders, NO vignettes, NO atmospheric haze fading at edges.
[Style palette restated, pixel art / hand-painted as per spec]
```

Post-processing:
```
python .agents/skills/generate2dmap/scripts/process_parallax_layer.py \
  --input <raw output path> \
  --output assets/maps/<level_id>/far_bg.png \
  --target-width 1280 --target-height 720
```
(Default mode — magenta → transparent.)

### 3. Mid BG (~30-60s)

```
Prompt:
[Style directive from spec §1]
Mid-distance silhouette strip, 1280×720, for side-scroll parallax.
Depicts <mid element: nearby buildings / urban skyline / forest mid-canopy /
hillside structures>.

Silhouettes occupy the LOWER 50-65% of the frame. ALL areas outside
silhouette shapes = SOLID #FF00FF for chroma removal.

SEAMLESSLY TILEABLE HORIZONTALLY — this layer scrolls about 3× faster
than far_bg (parallax 0.50), so seams will be MORE visible. Repeat-pattern
aesthetics are fine — distribute building/tree shapes in a rhythm that
hides the tile seam.

NO frame borders, NO vignettes.
```

Post-processing same as Far BG (default chroma-key).

### 4. Near BG (~30-60s)

**CRITICAL — near_bg must be visually DISTINCT from the gameplay
platforms.** The #1 mistake here is reusing the platform's material,
silhouette, or color palette so the player can't tell what's interactable
vs decoration. Before writing the prompt, identify the platform's visual
vocabulary (e.g. "brick wall + concrete top + plants" for rooftop level)
and forbid it explicitly.

Pick a near_bg subject from a DIFFERENT category than the platform:

| If platform vocabulary is... | near_bg should be... |
|---|---|
| Urban architecture (brick, concrete, AC units) | Vegetation, fence rail, debris, lamp posts |
| Forest branches / wooden ledges | Bushes, rocks, fern clusters, mushrooms |
| Cave / stone ledges | Stalagmites, crystals, drip puddles, moss |
| Castle stones / battlements | Banner posts, torch sconces, scattered shields |
| Metal industrial walkways | Steam pipes, gears, hanging chains, oil drums |

```
Prompt:
[Style directive from spec §1]
Foreground silhouette strip, 1280×720, for side-scroll parallax.
Depicts <foreground subject from the category table ABOVE — pick whatever
is DIFFERENT from the platform's material vocabulary>.

VISUALLY DISTINCT from gameplay platforms:
- Platforms in this level use <list platform's material/color/silhouette>.
  near_bg MUST NOT reuse that vocabulary.
- 30-50% DARKER overall than the platform tiles — near_bg reads as
  "behind" the play surface, not "alternate floor to maybe stand on".
- Low internal detail, near-silhouette style — small features blurred
  into the silhouette mass. Save the high-frequency detail for platforms.
- NO horizontal flat top edge that could be mistaken for a walkable
  surface.

Silhouettes occupy the LOWER 25-40% of the frame. ALL areas outside
silhouette shapes = SOLID #FF00FF for chroma removal.

PERFECTLY SEAMLESSLY TILEABLE HORIZONTALLY — this layer scrolls nearly
as fast as the player (parallax 0.85), so any tile seam will be obvious
to the player. The leftmost 4 pixel columns MUST visually match the
rightmost 4 pixel columns. Use a regular repeating pattern (evenly-spaced
fence posts, grass blade clusters at regular intervals) rather than
one-off prominent features.

NO frame borders, NO vignettes.
```

Post-processing same.

## Adaptation knobs

| Knob | Where | Effect |
|---|---|---|
| `parallax` per layer | level JSON | Scroll speed (0 = static, 1 = scrolls with player) |
| `opacity` per layer | level JSON | Atmospheric haze (use 0.7-0.9 on distant layers) |
| `zIndex` | level JSON | Sort order (back to front) |
| Number of layers | level JSON | 3 minimum (sky / mid / near); 4 typical; 5 max |
| Silhouette band height | image prompt | More "horizon" feel by lowering silhouettes; more "claustrophobic" by raising |

## Recommended parallax values per layer count

**4 layers** (typical):
- sky: 0.02-0.06
- far_bg: 0.15-0.25
- mid_bg: 0.40-0.55
- near_bg: 0.75-0.95

**3 layers** (lite):
- sky: 0.05
- mid_bg: 0.40
- near_bg: 0.80

**5 layers** (rich):
- sky: 0.03
- far_far: 0.10
- far_bg: 0.25
- mid_bg: 0.55
- near_bg: 0.90

Avoid `parallax: 1.0` — that's "scrolls 1:1 with the player", same speed
as platforms — defeats the parallax illusion (looks like a flat platform
layer).

## Common mistakes

1. **All layers opaque** — only the topmost (near_bg) is visible, parallax
   illusion broken. The recipe's #1 rule: far/mid/near MUST be magenta-bg
   → chroma-key transparent. Sky stays opaque.

2. **Generate a single 5120×720 layer + upscale** — produces blurry,
   aspect-distorted result that pins the level width. ALWAYS generate at
   1280×720 (or 1664×720) native + use `repeatX: true`.

3. **Image gen returns ~1672×941, double-stretch to 2560 then 5120** —
   this was test-2d-scroll-game's failure. The fix is `process_parallax_layer.py`
   which does a clean 16:9→16:9 downscale (1672→1280, no aspect change),
   and the runtime tiles via repeatX.

4. **`repeatX: false`** — the runtime won't tile, so as soon as the
   camera scrolls past 1280px, the layer's right edge appears. Always
   `true` for parallax layers (unless the layer is intentionally a
   single full-mapSize wide image, but then why use parallax).

5. **`parallax: 1.0` for any layer** — that's the same speed as the
   foreground platforms. Looks like a flat tile, not a parallax depth
   layer. Cap at 0.95.

6. **Prominent single feature in tileable image** — one big moon, one
   tall tower at random x. When tiled, the feature repeats every 1280px
   = obvious. Solution: distribute features evenly OR add the feature
   as a separate non-tiled prop layer.

7. **Forgot to call process_parallax_layer.py** — raw image_gen output
   has magenta backgrounds intact. Layer renders with magenta showing
   instead of being transparent. Always run the post-processing step.

8. **Sky generated with magenta** — by mistake (copy-pasted far_bg
   prompt). Sky becomes transparent → black void shows. Sky prompt
   should explicitly say "NO magenta — fully opaque".

9. **near_bg looks like a duplicate of platforms** — the agent generates
   near_bg with the same material/color/silhouette as the gameplay
   platform tiles, so the player can't tell what's interactable vs
   pure decoration. (Example failure: rooftop level with brick+plant
   platforms AND brick+plant near_bg.) Fix by explicitly listing the
   platform's visual vocabulary in the near_bg prompt and forbidding it,
   per the category table in §"Near BG" above.

## Reference

- `D:/Sengoku-Era-act-ogf/data/border_road.json` — example level with
  4-layer parallax setup
- `scripts/process_parallax_layer.py` — post-processing implementation
- `recipes/side-scroll/platform-three-piece.md` — related tile pattern
  for foreground platforms

## Quick checklist before declaring parallax phase done

- [ ] 4 PNGs at 1280×720 (or 1664×720) in `assets/maps/<level_id>/`
- [ ] Each has been through `process_parallax_layer.py` (look for
      transparency in far/mid/near via `python -c "from PIL import Image;
      print(Image.open('p').mode)"` — should be `RGBA` with alpha < 255 in
      some pixels)
- [ ] Sky is OPAQUE (`mode = RGBA` but no transparent pixels), no magenta
      remnants
- [ ] Level JSON `layers[]` has 4 entries, all with `repeatX: true`,
      parallax values per the table above, zIndex ordered 0→3
- [ ] `level.mapSize.width` can be ANY value (2560 / 5120 / 10240) — the
      layers tile to fill it automatically
- [ ] Open Play tab, walk left/right, see distinct depth (sky almost
      static, far_bg drifts slowly, near_bg keeps up with player)
- [ ] near_bg uses a DIFFERENT material/color/silhouette than the
      gameplay platforms — squint test: from across the room you can
      tell foreground from interactable. If they blur together, regen
      near_bg with the category swap from §"Near BG".
