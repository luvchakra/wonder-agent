#!/usr/bin/env python3
"""
WonderID brand assets (BRAND-001, EXPERIENCE-P0-22), cut from the brand
sheet the user supplied: docs/requirements/wonderid-brand-sheet.png.

    python3 scripts/brand/extract-assets.py      # needs Pillow and numpy

Nothing is redrawn. Each asset is a crop of the supplied artwork; the only
processing is (1) removing the panel's flat background colour so a logo
sits on any surface ("colour to alpha" against that exact colour), (2)
blanking the tagline where a lockup is needed without it, and (3)
resampling for the fixed icon sizes. When the official vector files
arrive, drop them in public/brand/ and retire this script.

Writes public/brand/{logo,favicon,social}/*, app/icon.png,
app/apple-icon.png, app/favicon.ico and modules/ui/brandAssets.generated.json.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SHEET = ROOT / "docs" / "requirements" / "wonderid-brand-sheet.png"
OUT = ROOT / "public" / "brand"

# Regions of the sheet (x0, y0, x1, y1), each a flat background with one
# piece of artwork on it. The artwork's exact bounds are found inside.
LIGHT_HERO = (60, 30, 900, 262)  # lockup + tagline, white
DARK_HERO = (985, 70, 1515, 225)  # lockup + tagline, navy
MARK_PANEL = (30, 335, 250, 485)  # "Logo Mark (Symbol)"
MONO_DARK_TILE = (575, 590, 795, 648)  # "Monochrome (Dark)": white ink on near-black
MONO_LIGHT_TILE = (850, 590, 1070, 648)  # "Monochrome (Light)": black ink on light grey
APP_ICON_LIGHT = (966, 344, 1086, 466)
FAVICON_TILE = (1450, 350, 1511, 411)


def load() -> Image.Image:
    return Image.open(SHEET).convert("RGB")


def bg_of(a: np.ndarray) -> np.ndarray:
    """The region's background: the median of its border pixels."""
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    return np.median(border, axis=0)


def bbox(a: np.ndarray, bg: np.ndarray, threshold: float = 38.0, pad: int = 4):
    d = np.sqrt(((a.astype(float) - bg) ** 2).sum(axis=2))
    ys, xs = np.where(d > threshold)
    h, w = d.shape
    return max(xs.min() - pad, 0), max(ys.min() - pad, 0), min(xs.max() + pad + 1, w), min(ys.max() + pad + 1, h)


def color_to_alpha(a: np.ndarray, bg: np.ndarray) -> np.ndarray:
    """GIMP's colour-to-alpha: the least-alpha colour that, over `bg`, gives the pixel."""
    p = a.astype(float) / 255.0
    b = bg.astype(float) / 255.0
    # A near-white or near-black panel is treated as pure, and differences
    # within the sheet's compression noise count as background.
    b = np.where(b > 0.97, 1.0, np.where(b < 0.03, 0.0, b))
    p = np.where(np.abs(p - b) < 10 / 255, b, p)
    ratio = np.where(p > b, (p - b) / np.maximum(1 - b, 1e-6), (b - p) / np.maximum(b, 1e-6))
    alpha = np.clip(ratio.max(axis=2), 0, 1)
    alpha = np.where(alpha < 0.05, 0, alpha)
    safe = np.maximum(alpha, 1e-6)[..., None]
    rgb = np.clip((p - b) / safe + b, 0, 1)
    rgb = np.where(alpha[..., None] > 0, rgb, 0)
    return np.dstack([rgb, alpha]).__mul__(255).round().astype(np.uint8)


def cut(sheet: Image.Image, region, transparent: bool = True, threshold: float = 38.0):
    """(RGBA image of the artwork in `region`, its left/top in sheet coordinates)."""
    a = np.asarray(sheet.crop(region))
    bg = bg_of(a)
    x0, y0, x1, y1 = bbox(a, bg, threshold)
    a = a[y0:y1, x0:x1]
    img = Image.fromarray(color_to_alpha(a, bg), "RGBA") if transparent else Image.fromarray(a, "RGB").convert("RGBA")
    return img, (region[0] + x0, region[1] + y0)


def split_columns(img: Image.Image, gap: int = 6):
    """Split artwork at its first empty vertical gap (mark | wordmark)."""
    alpha = np.asarray(img)[..., 3]
    empty = (alpha < 20).all(axis=0)
    run = 0
    for x, e in enumerate(empty):
        run = run + 1 if e else 0
        if run >= gap and x > img.width * 0.15:
            return x - run + 1
    raise SystemExit("no gap between mark and wordmark")


def without_tagline(img: Image.Image, mark_right: int) -> Image.Image:
    """Blank the tagline (the lowest band of text right of the mark), then trim."""
    a = np.asarray(img).copy()
    right = a[:, mark_right:, 3] > 20
    rows = right.any(axis=1)
    # From the bottom up: the tagline band, then an empty gap, then the wordmark.
    y = len(rows) - 1
    while y > 0 and not rows[y]:
        y -= 1
    while y > 0 and rows[y]:
        y -= 1
    tagline_top = y
    a[tagline_top:, mark_right:, :] = 0
    out = Image.fromarray(a, "RGBA")
    return out.crop(out.getbbox())


def save(img: Image.Image, rel: str, manifest: dict):
    path = OUT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)
    manifest[rel] = {"src": f"/brand/{rel}", "width": img.width, "height": img.height}


def square(img: Image.Image, size: int, pad_ratio: float = 0.0) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = round(size * (1 - 2 * pad_ratio))
    im = img.copy()
    im.thumbnail((inner, inner), Image.LANCZOS)
    canvas.paste(im, ((size - im.width) // 2, (size - im.height) // 2), im)
    return canvas


def main():
    sheet = load()
    manifest: dict = {}

    light, _ = cut(sheet, LIGHT_HERO)
    dark, _ = cut(sheet, DARK_HERO)
    split_light = split_columns(light)
    split_dark = split_columns(dark)

    save(light, "logo/wonderid-logo-tagline.png", manifest)
    save(dark, "logo/wonderid-logo-tagline-dark.png", manifest)
    save(without_tagline(light, split_light), "logo/wonderid-logo.png", manifest)
    save(without_tagline(dark, split_dark), "logo/wonderid-logo-dark.png", manifest)

    mark = light.crop((0, 0, split_light, light.height))
    mark = mark.crop(mark.getbbox())
    mark_dark = dark.crop((0, 0, split_dark, dark.height))
    mark_dark = mark_dark.crop(mark_dark.getbbox())
    save(mark, "logo/wonderid-mark.png", manifest)
    save(mark_dark, "logo/wonderid-mark-dark.png", manifest)

    mono_dark_ink, _ = cut(sheet, MONO_LIGHT_TILE)  # black ink, for light backgrounds
    mono_light_ink, _ = cut(sheet, MONO_DARK_TILE)  # white ink, for dark backgrounds
    save(mono_dark_ink, "logo/wonderid-monochrome.png", manifest)
    save(mono_light_ink, "logo/wonderid-monochrome-light.png", manifest)

    # Icons: the sheet's own mark, resampled; the Apple icon is its white app icon.
    for size in (16, 32, 48):
        save(square(mark, size, 0.02), f"favicon/favicon-{size}.png", manifest)
    app_icon, _ = cut(sheet, APP_ICON_LIGHT, transparent=False, threshold=12)
    touch = app_icon.convert("RGB").resize((180, 180), Image.LANCZOS)
    save(touch, "favicon/apple-touch-icon.png", manifest)

    # Social: the sheet's dark hero panel as it stands.
    og = sheet.crop((953, 0, 1536, 290))
    save(og, "social/wonderid-og.png", manifest)

    # Next.js site icons.
    Image.open(OUT / "favicon/favicon-32.png").save(ROOT / "app" / "icon.png")
    touch.save(ROOT / "app" / "apple-icon.png")
    icons = [Image.open(OUT / f"favicon/favicon-{s}.png") for s in (16, 32, 48)]
    icons[2].save(ROOT / "app" / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)], append_images=icons[:2])

    (ROOT / "modules" / "ui" / "brandAssets.generated.json").write_text(json.dumps(manifest, indent=2) + "\n")
    for k, v in manifest.items():
        print(f"{k:42} {v['width']}x{v['height']}")


if __name__ == "__main__":
    main()
