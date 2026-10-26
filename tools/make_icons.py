#!/usr/bin/env python3
"""Render the HDSAT icon set for the web app manifest.

The mark is the same geometry as `public/favicon.svg` and `BrandMark.tsx`: a
rounded blue tile, a wide white H drawn with three round-capped strokes, and the
light-blue dot sitting on the right stroke's top cap. Drawing it here means the
installed app's icon is the same logo as the browser tab, without pulling an SVG
rasteriser or a Python imaging library into the build.

Shapes are sampled on a 4x supersampled grid and box-filtered down, which is
plenty of anti-aliasing for the sizes a phone actually shows. Output is RGBA so
a non-maskable icon keeps transparent corners.

    python tools/make_icons.py

Writes public/icons/*.png. Standard library only.
"""

from __future__ import annotations

import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "icons")

# Palette from public/favicon.svg.
BLUE_TOP = (0x25, 0x63, 0xEB)
BLUE_BOTTOM = (0x1D, 0x4E, 0xD8)
WHITE = (0xFF, 0xFF, 0xFF)
DOT = (0xBF, 0xDB, 0xFE)

SS = 4  # supersample factor


def write_png(path: str, width: int, height: int, rows: list[bytes]) -> None:
    """Minimal RGBA8 PNG writer (filter 0 on every scanline)."""
    raw = bytearray()
    for row in rows:
        raw.append(0)
        raw.extend(row)

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as fh:
        fh.write(png)


def inside_rounded(x: float, y: float, size: float, radius: float) -> bool:
    if x < 0 or y < 0 or x > size or y > size:
        return False
    cx = min(max(x, radius), size - radius)
    cy = min(max(y, radius), size - radius)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= radius * radius


def on_stroke(
    x: float, y: float, ax: float, ay: float, bx: float, by: float, half: float
) -> bool:
    vx, vy = bx - ax, by - ay
    length2 = vx * vx + vy * vy
    t = 0.0 if length2 == 0 else ((x - ax) * vx + (y - ay) * vy) / length2
    t = min(1.0, max(0.0, t))
    dx, dy = x - (ax + vx * t), y - (ay + vy * t)
    return dx * dx + dy * dy <= half * half


def render(size: int, maskable: bool) -> list[bytes]:
    """One icon at `size` px.

    A maskable icon bleeds its tile to the edges and shrinks the mark into the
    80% safe area, because the platform crops the tile into its own shape.
    """
    big = size * SS
    art = 0.80 if maskable else 1.0
    unit = big / 64.0 * art
    origin = (big - unit * 64.0) / 2.0
    half = 7.5 * unit / 2.0
    radius = big * 0.25

    def px(u: float) -> float:
        return origin + u * unit

    left_x, right_x = px(16), px(48)
    top_y, bottom_y, bar_y = px(14), px(50), px(32)
    dot_r, dot_x, dot_y = 4.5 * unit, right_x, top_y
    denom = float(big - 1) if big > 1 else 1.0

    # Accumulators for one output row: premultiplied colour plus coverage.
    sum_r = [0.0] * size
    sum_g = [0.0] * size
    sum_b = [0.0] * size
    sum_a = [0.0] * size
    rows: list[bytes] = []

    for sy in range(big):
        # One output row spans SS supersample rows, so the accumulators reset
        # at the start of a block, not at every scanline inside it.
        if sy % SS == 0:
            for i in range(size):
                sum_r[i] = sum_g[i] = sum_b[i] = sum_a[i] = 0.0

        for sx in range(big):
            covered = 1.0 if maskable else (1.0 if inside_rounded(sx, sy, big, radius) else 0.0)
            if not covered:
                continue
            mix = (sx + sy) / (2.0 * denom)
            r = BLUE_TOP[0] + (BLUE_BOTTOM[0] - BLUE_TOP[0]) * mix
            g = BLUE_TOP[1] + (BLUE_BOTTOM[1] - BLUE_TOP[1]) * mix
            b = BLUE_TOP[2] + (BLUE_BOTTOM[2] - BLUE_TOP[2]) * mix

            if (
                on_stroke(sx, sy, left_x, top_y, left_x, bottom_y, half)
                or on_stroke(sx, sy, right_x, top_y, right_x, bottom_y, half)
                or on_stroke(sx, sy, left_x, bar_y, right_x, bar_y, half)
            ):
                r, g, b = WHITE

            ddx, ddy = sx - dot_x, sy - dot_y
            if ddx * ddx + ddy * ddy <= dot_r * dot_r:
                r, g, b = DOT

            i = sx // SS
            sum_r[i] += r
            sum_g[i] += g
            sum_b[i] += b
            sum_a[i] += 1.0

        if sy % SS != SS - 1:
            continue

        samples = float(SS * SS)
        row = bytearray()
        for i in range(size):
            hits = sum_a[i]
            if hits <= 0:
                row.extend(b"\x00\x00\x00\x00")
                continue
            alpha = hits / samples
            row.extend(
                (
                    max(0, min(255, int(round(sum_r[i] / hits)))),
                    max(0, min(255, int(round(sum_g[i] / hits)))),
                    max(0, min(255, int(round(sum_b[i] / hits)))),
                    max(0, min(255, int(round(alpha * 255)))),
                )
            )
        rows.append(bytes(row))

    return rows


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    targets = [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("maskable-512.png", 512, True),
        ("apple-touch-icon.png", 180, True),
        ("favicon-32.png", 32, False),
        ("favicon-16.png", 16, False),
    ]
    for name, size, maskable in targets:
        rows = render(size, maskable)
        path = os.path.join(OUT, name)
        write_png(path, size, size, rows)
        print(f"{name}: {size}x{size} {os.path.getsize(path)} bytes")


if __name__ == "__main__":
    main()
