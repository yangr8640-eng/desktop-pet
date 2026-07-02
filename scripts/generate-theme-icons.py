#!/usr/bin/env python3
"""
Generate per-theme macOS .icns and Windows .ico files.

The source of truth is themes.js. Each theme's normal image is rendered or loaded,
centered on a transparent 1024x1024 canvas, then exported for both platforms.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageFilter

ROOT_DIR = Path(__file__).resolve().parents[1]
ASSETS_DIR = ROOT_DIR / "assets"
SIZE = 1024
ICON_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def load_theme_sources():
    script = """
const { themes } = require('./themes');
const result = {};
for (const [id, theme] of Object.entries(themes)) {
  const expressions = theme.expressions || theme.svgs || {};
  result[id] = expressions.normal || theme.svgs?.normal || null;
}
console.log(JSON.stringify(result));
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT_DIR,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def render_svg(svg_path, target_size):
    qlmanage = shutil.which("qlmanage")
    if not qlmanage:
        raise RuntimeError("qlmanage is required to render SVG theme icons on this machine")

    with tempfile.TemporaryDirectory(prefix="desktop-pet-icon-") as tmp:
        subprocess.run(
            [qlmanage, "-t", "-s", str(target_size), "-o", tmp, str(svg_path)],
            check=True,
            capture_output=True,
            timeout=30,
        )
        rendered_path = Path(tmp) / f"{svg_path.name}.png"
        if not rendered_path.exists():
            raise RuntimeError(f"qlmanage did not render {svg_path}")
        return Image.open(rendered_path).convert("RGBA")


def remove_edge_white_background(img):
    """Remove near-white edge-connected background while preserving interior whites."""
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size

    def is_background(x, y):
        r, g, b, a = px[x, y]
        if a == 0:
            return True
        mx = max(r, g, b)
        mn = min(r, g, b)
        sat = 0 if mx == 0 else (mx - mn) / mx
        lum = 0.299 * r + 0.587 * g + 0.114 * b
        return lum > 246 and sat < 0.04

    stack = []
    visited = bytearray(w * h)

    def add(x, y):
        if x < 0 or y < 0 or x >= w or y >= h:
            return
        idx = y * w + x
        if visited[idx] or not is_background(x, y):
            return
        visited[idx] = 1
        stack.append((x, y))

    for x in range(w):
        add(x, 0)
        add(x, h - 1)
    for y in range(h):
        add(0, y)
        add(w - 1, y)

    while stack:
        x, y = stack.pop()
        px[x, y] = (255, 255, 255, 0)
        add(x + 1, y)
        add(x - 1, y)
        add(x, y + 1)
        add(x, y - 1)

    return img


def load_theme_image(source_path):
    source = ROOT_DIR / "pet" / source_path
    if not source.exists():
        raise FileNotFoundError(source)

    if source.suffix.lower() == ".svg":
        return remove_edge_white_background(render_svg(source, 4096))

    img = Image.open(source).convert("RGBA")
    if img.getchannel("A").getbbox() is None:
        return remove_edge_white_background(img)
    return img


def content_bbox(img):
    alpha = img.getchannel("A").filter(ImageFilter.GaussianBlur(0.2))
    return alpha.point(lambda p: 255 if p > 10 else 0).getbbox()


def fit_on_canvas(img):
    bbox = content_bbox(img)
    if not bbox:
        raise RuntimeError("image has no visible content")

    cropped = img.crop(bbox)
    cw, ch = cropped.size
    scale = min(SIZE / cw, SIZE / ch) * 0.88
    new_size = (max(1, round(cw * scale)), max(1, round(ch * scale)))
    resampling = getattr(Image.Resampling, "LANCZOS", Image.LANCZOS)
    resized = cropped.resize(new_size, resampling)

    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    canvas.alpha_composite(resized, ((SIZE - new_size[0]) // 2, (SIZE - new_size[1]) // 2))
    return canvas


def save_icns(theme_id, canvas):
    iconutil = shutil.which("iconutil")
    if not iconutil:
        print(f"  ! {theme_id}: skipped .icns, iconutil not available")
        return

    iconset = Path(tempfile.mkdtemp(prefix=f"icon_{theme_id}_", suffix=".iconset"))
    try:
        resampling = getattr(Image.Resampling, "LANCZOS", Image.LANCZOS)
        for name, size in [
            ("icon_16x16.png", 16),
            ("icon_16x16@2x.png", 32),
            ("icon_32x32.png", 32),
            ("icon_32x32@2x.png", 64),
            ("icon_128x128.png", 128),
            ("icon_128x128@2x.png", 256),
            ("icon_256x256.png", 256),
            ("icon_256x256@2x.png", 512),
            ("icon_512x512.png", 512),
            ("icon_512x512@2x.png", 1024),
        ]:
            canvas.resize((size, size), resampling).save(iconset / name)
        subprocess.run(
            [iconutil, "-c", "icns", "-o", str(ASSETS_DIR / f"icon_{theme_id}.icns"), str(iconset)],
            check=True,
            capture_output=True,
        )
    finally:
        shutil.rmtree(iconset, ignore_errors=True)


def save_ico(theme_id, canvas):
    canvas.save(ASSETS_DIR / f"icon_{theme_id}.ico", format="ICO", sizes=ICON_SIZES)


def save_default_ico():
    default_icon = ASSETS_DIR / "icon.icns"
    fallback_png = ASSETS_DIR / "icon.png"
    if default_icon.exists():
        img = Image.open(default_icon).convert("RGBA")
    elif fallback_png.exists():
        img = Image.open(fallback_png).convert("RGBA")
    else:
        print("  ! skipped icon.ico, no default icon source found")
        return
    img.save(ASSETS_DIR / "icon.ico", format="ICO", sizes=ICON_SIZES)


def main():
    ASSETS_DIR.mkdir(exist_ok=True)
    themes = load_theme_sources()
    print("=== Generating theme icons (.icns + .ico) ===")
    for theme_id, source_path in themes.items():
        if not source_path:
            print(f"  ! {theme_id}: no normal image")
            continue
        try:
            canvas = fit_on_canvas(load_theme_image(source_path))
            save_icns(theme_id, canvas)
            save_ico(theme_id, canvas)
            print(f"  ✓ {theme_id}")
        except Exception as error:
            print(f"  ✗ {theme_id}: {error}", file=sys.stderr)
    save_default_ico()
    print("Done!")


if __name__ == "__main__":
    main()
