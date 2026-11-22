"""Regenerate the favicon set and Open Graph image from the HDSAT mark.

Run from the repository root:
    python3 scripts/generate_brand_assets.py

The mark intentionally uses a flat accent fill. The previous favicon carried a
blue gradient that no longer matched the design system.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
ICONS = PUBLIC / "icons"
ACCENT = (31, 95, 208, 255)
ACCENT_DARK = (16, 58, 112, 255)
WHITE = (255, 255, 255, 255)
INK = (20, 24, 31, 255)
SOFT = (191, 219, 254, 255)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
        if bold
        else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


def rounded_icon(size: int, radius_ratio: float = 0.3) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        (0, 0, size - 1, size - 1),
        radius=round(size * radius_ratio),
        fill=ACCENT,
    )
    scale = size / 64
    stroke = max(1, round(7.5 * scale))
    left, right = 16 * scale, 48 * scale
    top, bottom = 14 * scale, 50 * scale
    mid = 32 * scale
    draw.line((left, top, left, bottom), fill=WHITE, width=stroke)
    draw.line((right, top, right, bottom), fill=WHITE, width=stroke)
    draw.line((left, mid, right, mid), fill=WHITE, width=stroke)
    dot = max(2, round(4.5 * scale))
    draw.ellipse((right - dot, top - dot, right + dot, top + dot), fill=SOFT)
    return image


def write_icon(path: Path, size: int, maskable: bool = False) -> None:
    if maskable:
        # Maskable icons need a safe-zone-friendly full-bleed background.
        image = Image.new("RGBA", (size, size), ACCENT)
        inner = rounded_icon(round(size * 0.68), radius_ratio=0.25)
        offset = (size - inner.width) // 2
        image.alpha_composite(inner, (offset, offset))
    else:
        image = rounded_icon(size)
    image.save(path)


def write_og_image() -> None:
    width, height = 1200, 630
    image = Image.new("RGB", (width, height), ACCENT)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 22, height), fill=ACCENT_DARK)

    tile = rounded_icon(132, radius_ratio=0.24)
    image.paste(tile, (92, 96), tile)

    draw.text((246, 105), "HDSAT", font=font(72, bold=True), fill=WHITE)
    draw.text(
        (249, 190),
        "Free Digital SAT & PSAT practice",
        font=font(27),
        fill=(224, 235, 255),
    )

    draw.text(
        (94, 300),
        "Practice the way",
        font=font(64, bold=True),
        fill=WHITE,
    )
    draw.text(
        (94, 376),
        "the test is built.",
        font=font(64, bold=True),
        fill=WHITE,
    )

    # A flat, quiet product-preview card rather than a decorative gradient.
    card = (712, 142, 1104, 488)
    draw.rounded_rectangle(card, radius=24, fill=(255, 255, 255))
    draw.text((752, 188), "TODAY'S PLAN", font=font(20, bold=True), fill=(92, 103, 118))
    draw.text((752, 230), "10-question drill", font=font(35, bold=True), fill=INK)
    draw.text((752, 277), "Advanced Math", font=font(25), fill=(31, 95, 208))
    draw.rounded_rectangle((752, 340, 1064, 352), radius=6, fill=(226, 231, 240))
    draw.rounded_rectangle((752, 340, 932, 352), radius=6, fill=ACCENT)
    draw.text((752, 382), "7 of 10 complete", font=font(20), fill=(92, 103, 118))
    draw.text((752, 425), "Keep the streak alive", font=font(22, bold=True), fill=INK)

    draw.text(
        (94, 548),
        "Adaptive practice · Full simulations · Flashcards",
        font=font(22),
        fill=(224, 235, 255),
    )
    image.save(PUBLIC / "og-image.png", optimize=True)


def main() -> None:
    ICONS.mkdir(parents=True, exist_ok=True)
    for size, name in [(16, "favicon-16.png"), (32, "favicon-32.png"), (180, "apple-touch-icon.png")]:
        write_icon(ICONS / name, size)
    for size, name in [(192, "icon-192.png"), (512, "icon-512.png")]:
        write_icon(ICONS / name, size)
    write_icon(ICONS / "maskable-512.png", 512, maskable=True)
    write_og_image()


if __name__ == "__main__":
    main()
