#!/usr/bin/env python3
"""Process a parallax layer strip: resize raw image_gen output to runtime
dimensions + (optionally) chroma-key magenta to transparent.

Image gen models typically output ~1672x941 ish raw images. The runtime
expects 1280x720 (or whatever target dims) per-layer strips. Aspect ratio
is the same (16:9) so the resize is a clean downscale, no stretch.

Usage:
  python process_parallax_layer.py \\
    --input raw-image.png \\
    --output assets/maps/level_id/sky.png \\
    [--target-width 1280] \\
    [--target-height 720] \\
    [--keep-magenta]   # for sky (no chroma-key)

For far/mid/near layers, magenta -> transparent is the default.
For sky (opaque), pass --keep-magenta (or just don't generate magenta
in the prompt).
"""

from __future__ import annotations

import argparse
import math
import sys
from collections import deque
from pathlib import Path

from PIL import Image


MAGENTA = (255, 0, 255)


def color_distance(rgb: tuple[int, int, int], target: tuple[int, int, int] = MAGENTA) -> float:
    r, g, b = rgb
    tr, tg, tb = target
    return math.sqrt((r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2)


def remove_bg_magenta(img: Image.Image, threshold: int, edge_threshold: int) -> Image.Image:
    """Replace magenta pixels with transparent, then flood-fill from
    edges to clean up anti-aliased fringe. Same logic as
    extract_prop_pack.py's chroma-key — duplicated here to keep the
    parallax script self-contained (no cross-script import)."""
    img = img.convert("RGBA")
    pixels = img.load()
    width, height = img.size

    for x in range(width):
        for y in range(height):
            r, g, b, a = pixels[x, y]
            if a > 0 and color_distance((r, g, b)) < threshold:
                pixels[x, y] = (0, 0, 0, 0)

    visited: set[tuple[int, int]] = set()
    queue: deque[tuple[int, int]] = deque()
    for x in range(width):
        queue.append((x, 0))
        queue.append((x, height - 1))
    for y in range(height):
        queue.append((0, y))
        queue.append((width - 1, y))

    while queue:
        x, y = queue.popleft()
        if (x, y) in visited or x < 0 or x >= width or y < 0 or y >= height:
            continue
        visited.add((x, y))
        r, g, b, a = pixels[x, y]
        should_expand = a == 0
        if a > 0 and color_distance((r, g, b)) < edge_threshold:
            pixels[x, y] = (0, 0, 0, 0)
            should_expand = True
        if should_expand:
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    if dx == 0 and dy == 0:
                        continue
                    nxt = (x + dx, y + dy)
                    if nxt not in visited:
                        queue.append(nxt)

    return img


def resize_to_target(img: Image.Image, target_w: int, target_h: int) -> Image.Image:
    """Resize using LANCZOS for clean downscale. Aspect ratio of source
    and target should match (both 16:9 typically) — if they don't, the
    resize will skew but we don't pad/crop here (caller decides)."""
    if (img.width, img.height) == (target_w, target_h):
        return img
    return img.resize((target_w, target_h), Image.LANCZOS)


def check_seam(img: Image.Image, columns: int = 4) -> tuple[bool, float]:
    """Compare leftmost N columns with rightmost N columns. Returns
    (is_seamless, avg_diff). Image gen models requested with
    "seamlessly tileable" don't always honor it — this gives a confidence
    signal that the human/agent can act on."""
    img = img.convert("RGBA")
    pixels = img.load()
    width, height = img.size
    columns = min(columns, width // 4)
    total_diff = 0.0
    n_samples = 0
    for dx in range(columns):
        for y in range(height):
            lr, lg, lb, la = pixels[dx, y]
            rr, rg, rb, ra = pixels[width - 1 - dx, y]
            if la == 0 and ra == 0:
                continue
            total_diff += math.sqrt(
                (lr - rr) ** 2 + (lg - rg) ** 2 + (lb - rb) ** 2
            )
            n_samples += 1
    if n_samples == 0:
        return True, 0.0
    avg = total_diff / n_samples
    # Empirical: avg color distance < 40 is visually OK for tiling;
    # 40-80 is borderline; > 80 is a visible seam.
    return avg < 40, avg


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Process a parallax layer strip.")
    p.add_argument("--input", required=True, type=Path, help="Raw image_gen output.")
    p.add_argument("--output", required=True, type=Path, help="Final layer PNG.")
    p.add_argument("--target-width", type=int, default=1280)
    p.add_argument("--target-height", type=int, default=720)
    p.add_argument("--threshold", type=int, default=100,
                   help="Magenta chroma-key threshold (0..255).")
    p.add_argument("--edge-threshold", type=int, default=150,
                   help="Anti-aliased magenta edge cleanup threshold.")
    p.add_argument("--keep-magenta", action="store_true",
                   help="Skip chroma-key. Use for the opaque sky layer.")
    p.add_argument("--no-seam-check", action="store_true",
                   help="Skip the left/right edge match diagnostic.")
    return p


def main() -> int:
    args = build_parser().parse_args()
    if not args.input.exists():
        print(f"ERROR: input not found: {args.input}", file=sys.stderr)
        return 1

    args.output.parent.mkdir(parents=True, exist_ok=True)

    raw = Image.open(args.input).convert("RGBA")
    print(f"  raw size: {raw.width}x{raw.height}")

    # Step 1 — resize to target dims (clean downscale; aspect should match).
    resized = resize_to_target(raw, args.target_width, args.target_height)
    print(f"  resized to: {resized.width}x{resized.height}")

    # Step 2 — chroma-key magenta unless --keep-magenta (sky case).
    if args.keep_magenta:
        final = resized
        print("  kept opaque (sky / no chroma-key)")
    else:
        final = remove_bg_magenta(resized, args.threshold, args.edge_threshold)
        print(f"  chroma-keyed magenta -> transparent")

    # Step 3 — seam check (advisory, doesn't fail the script).
    if not args.no_seam_check:
        is_seamless, avg = check_seam(final)
        status = "OK" if is_seamless else "BORDERLINE/VISIBLE"
        print(f"  seam check: {status} (avg edge color delta {avg:.1f}; <40 OK, >80 visible)")

    final.save(args.output, "PNG")
    print(f"  saved: {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
