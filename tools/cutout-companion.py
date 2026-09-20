# -*- coding: utf-8 -*-
"""Companion sprite cutout: remove the fake-transparency checkerboard from AI-generated
character art (image models often paint the checkerboard as real pixels instead of
emitting an alpha channel), then crop/trim and export aligned frames.

Usage:
    python cutout-companion.py <open-eyes.png> <closed-eyes.png> --dst <assets-dir>

Pipeline: checkerboard color detection -> BFS flood fill from the borders ->
largest-connected-component filter (drops noise islands and watermark remnants)
-> edge feathering -> unified crop (both frames share one bounding box so the
blink crossfade stays pixel-aligned) -> 512px height export.

Requires: pillow, numpy
"""
import argparse
import os
import sys
from collections import deque

try:
    import numpy as np
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("pip install pillow numpy")

TOL = 26.0
OUT_HEIGHT = 512


def load(path):
    return np.array(Image.open(path).convert("RGB"), dtype=np.int16)


def detect_checker_colors(img, sample=200, cell=64):
    region = img[:sample, :sample]
    group0, group1 = [], []
    for y in range(0, sample, 4):
        for x in range(0, sample, 4):
            (group0 if ((y // cell) + (x // cell)) % 2 == 0 else group1).append(region[y, x])
    return np.median(np.array(group0), axis=0), np.median(np.array(group1), axis=0)


def flood_background(img, colors, tol=TOL):
    h, w, _ = img.shape
    cand = np.zeros((h, w), dtype=bool)
    for c in colors:
        cand |= np.linalg.norm(img - c, axis=2) < tol
    bg = np.zeros((h, w), dtype=bool)
    queue = deque()
    for x in range(w):
        for y in (0, h - 1):
            if cand[y, x] and not bg[y, x]:
                bg[y, x] = True
                queue.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if cand[y, x] and not bg[y, x]:
                bg[y, x] = True
                queue.append((y, x))
    while queue:
        y, x = queue.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and cand[ny, nx] and not bg[ny, nx]:
                bg[ny, nx] = True
                queue.append((ny, nx))
    return bg, cand


def largest_component(fg):
    """Keep only the biggest connected foreground blob: noise islands and the
    watermark (never attached to the character) get dropped in one pass."""
    h, w = fg.shape
    labels = np.zeros((h, w), dtype=np.int32)
    label_id = 0
    best_id, best_size = 0, 0
    queue = deque()
    for y in range(h):
        for x in range(w):
            if fg[y, x] and labels[y, x] == 0:
                label_id += 1
                size = 0
                labels[y, x] = label_id
                queue.append((y, x))
                while queue:
                    cy, cx = queue.popleft()
                    size += 1
                    for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                        if 0 <= ny < h and 0 <= nx < w and fg[ny, nx] and labels[ny, nx] == 0:
                            labels[ny, nx] = label_id
                            queue.append((ny, nx))
                if size > best_size:
                    best_size, best_id = size, label_id
    print(f"components: {label_id}, largest: {best_size}px")
    return labels == best_id


def compose_alpha(img, bg, keep, feather):
    h, w = bg.shape
    rgba = np.dstack([img.astype(np.uint8), np.full((h, w), 255, dtype=np.uint8)])
    rgba[bg, 3] = 0
    rgba[feather, 3] = 110
    rgba[~keep & ~bg, 3] = 0
    return rgba


def main():
    ap = argparse.ArgumentParser(description="Cut checkerboard background out of companion sprites")
    ap.add_argument("open_png", help="open-eyes frame")
    ap.add_argument("closed_png", help="closed-eyes frame (same composition)")
    ap.add_argument("--dst", default=None, help="output directory (default: alongside inputs)")
    ap.add_argument("--open-name", default="companion-open.png")
    ap.add_argument("--closed-name", default="companion-closed.png")
    args = ap.parse_args()

    dst = args.dst or os.path.dirname(os.path.abspath(args.open_png))
    os.makedirs(dst, exist_ok=True)

    img_open = load(args.open_png)
    img_closed = load(args.closed_png)
    if img_open.shape != img_closed.shape:
        sys.exit("frames must share the same canvas size")

    colors = detect_checker_colors(img_open)
    print("checker colors:", colors)
    bg, cand = flood_background(img_open, colors)
    keep = largest_component(~bg)

    h, w = bg.shape
    feather = np.zeros((h, w), dtype=bool)
    bgp = np.pad(bg, 1, constant_values=True)
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        feather |= ~bg & bgp[1 + dy:1 + h + dy, 1 + dx:1 + w + dx]
    feather &= keep

    rgba_open = compose_alpha(img_open, bg, keep, feather)
    # closed frame reuses the same background mask and keep mask (frames are aligned)
    bg_closed = bg & cand
    rgba_closed = compose_alpha(img_closed, bg_closed, keep, feather & ~bg_closed)

    def union_bbox(frames):
        """One shared crop box for both frames - per-frame boxes would misalign the blink."""
        l = t = 10**9
        r = b = -1
        for rgba in frames:
            ys, xs = np.where(rgba[:, :, 3] > 8)
            l, t = min(l, xs.min()), min(t, ys.min())
            r, b = max(r, xs.max() + 1), max(b, ys.max() + 1)
        mw, mh = int((r - l) * 0.02), int((b - t) * 0.02)
        return max(0, l - mw), max(0, t - mh), min(w, r + mw), min(h, b + mh)

    box = union_bbox((rgba_open, rgba_closed))

    def export(rgba, name):
        im = Image.fromarray(rgba[box[1]:box[3], box[0]:box[2]])
        scale = OUT_HEIGHT / im.size[1]
        im = im.resize((round(im.size[0] * scale), OUT_HEIGHT), Image.LANCZOS)
        out = os.path.join(dst, name)
        im.save(out, optimize=True)
        print("saved", out, im.size, os.path.getsize(out) // 1024, "KB")

    export(rgba_open, args.open_name)
    export(rgba_closed, args.closed_name)


if __name__ == "__main__":
    main()
