#!/usr/bin/env python3
"""
Generate .icns icons from SVGs with proper transparency.
Strategy: Temporarily replace white character fills with unique colors
before qlmanage rendering, then restore them as white on transparent bg.
"""
import os, shutil, subprocess, re, json
from PIL import Image

THEMES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pet', 'themes')
ASSETS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets')
SIZE = 1024

def render_svg(svg_path, target_size):
    tmp = '/tmp/_gen_icons'
    os.makedirs(tmp, exist_ok=True)
    try:
        subprocess.run(['qlmanage', '-t', '-s', str(target_size), '-o', tmp, svg_path],
                       capture_output=True, timeout=30)
        name = os.path.splitext(os.path.basename(svg_path))[0]
        png = os.path.join(tmp, f'{name}.svg.png')
        if os.path.exists(png):
            img = Image.open(png).convert('RGBA')
            os.remove(png)
            return img
    except:
        pass
    return None

# Colors used for white character parts in each theme's SVG
# We detect these from the SVG source
CHARACTER_WHITE_COLORS = {
    # Format: theme_id -> [hex_colors_to_treat_as_character_white]
    'cherry': ['#fefefe', '#ffffff'],  # Cherry rabbit is "white" (#FEFEFE)
}
# For aggressive removal: which fill colors are pure background (empty)
BG_FILL_NONE = {'none', 'None', 'transparent'}

def find_white_fill_colors(svg_path, threshold=245):
    """Scan SVG for fill colors close to white that need special handling."""
    with open(svg_path) as f:
        content = f.read()
    fills = re.findall(r'fill\s*=\s*"([^"]*)"', content, re.IGNORECASE)
    colors = set()
    for f in fills:
        f = f.strip().lower()
        if f.startswith('#') and len(f) == 7:
            r = int(f[1:3], 16)
            g = int(f[3:5], 16)
            b = int(f[5:7], 16)
            if r >= threshold and g >= threshold and b >= threshold:
                colors.add(f)
    return colors

def remove_white_bg_advanced(img, white_char_colors=None):
    """
    Remove white background with awareness of white character parts.

    Uses multi-pass approach:
    1. Standard flood fill from edges
    2. Content boundary detection
    3. White-in-content preservation
    """
    px = img.load()
    w, h = img.size

    # Step 1: Everything not pure white is content
    content = [[False]*w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 0 and not (r == 255 and g == 255 and b == 255 and a == 255):
                content[y][x] = True

    # Step 2: Dilate content into surrounding white
    # Any pure white pixel within 3px of content is character, not bg
    for y in range(h):
        for x in range(w):
            if not content[y][x]:
                r, g, b, a = px[x, y]
                if r == 255 and g == 255 and b == 255 and a == 255:
                    # Check if near content
                    near_content = False
                    for dy in range(-5, 6):
                        for dx in range(-5, 6):
                            ny, nx = y+dy, x+dx
                            if 0 <= ny < h and 0 <= nx < w and content[ny][nx]:
                                near_content = True
                                break
                        if near_content:
                            break
                    if near_content:
                        content[y][x] = True  # This white pixel is part of character

    # Step 3: Flood fill from corners for remaining background
    # (only pure white that's NOT marked as content)
    for sx, sy in [(0,0), (w-1,0), (0,h-1), (w-1,h-1)]:
        if px[sx, sy][3] > 0:
            visited = set()
            q = [(sx, sy)]
            while q:
                x, y = q.pop(0)
                if (x, y) in visited:
                    continue
                if not (0 <= x < w and 0 <= y < h):
                    continue
                visited.add((x, y))
                r, g, b, a = px[x, y]
                if a == 0:
                    continue
                # If this is pure white and NOT content, erase it
                if r == 255 and g == 255 and b == 255 and a == 255 and not content[y][x]:
                    px[x, y] = (r, g, b, 0)
                    for nx, ny in [(x+1,y),(x-1,y),(x,y+1),(x,y-1)]:
                        if 0 <= nx < w and 0 <= ny < h:
                            q.append((nx, ny))

    # Step 4: Final pass - any pure white pixel not touching any content = bg
    for y in range(1, h-1):
        for x in range(1, w-1):
            r, g, b, a = px[x, y]
            if r == 255 and g == 255 and b == 255 and a == 255:
                # Check all 8 neighbors
                has_nearby_content = False
                for dy in [-1, 0, 1]:
                    for dx in [-1, 0, 1]:
                        if dx == 0 and dy == 0:
                            continue
                        nr, ng, nb, na = px[y+dy, x+dx]
                        if not (nr == 255 and ng == 255 and nb == 255 and na == 255):
                            has_nearby_content = True
                            break
                    if has_nearby_content:
                        break
                if not has_nearby_content:
                    px[x, y] = (r, g, b, 0)

    return img

def process_theme(theme_id):
    svg_path = os.path.join(THEMES_DIR, theme_id, 'normal.svg')
    if not os.path.exists(svg_path):
        print(f"  ✗ {theme_id}: no SVG"); return
    print(f"  {theme_id}...")

    # Render at 4K
    img = render_svg(svg_path, 4096)
    if not img:
        print(f"    failed"); return

    # Detect white character colors from SVG
    white_fills = find_white_fill_colors(svg_path)
    print(f"    white fills in SVG: {white_fills}")

    # Remove white bg with awareness of character white
    img = remove_white_bg_advanced(img)

    # Find content bounds
    px = img.load()
    w, h = img.size
    min_x, max_x, min_y, max_y = w, 0, h, 0
    for y in range(h):
        for x in range(w):
            if px[x, y][3] > 10:
                min_x = min(min_x, x); max_x = max(max_x, x)
                min_y = min(min_y, y); max_y = max(max_y, y)

    if max_x == 0:
        print(f"    no content"); return

    print(f"    content: ({min_x},{min_y})-({max_x},{max_y})")

    pad = 30
    img = img.crop((max(0,min_x-pad), max(0,min_y-pad),
                     min(w,max_x+pad), min(h,max_y+pad)))

    # Resize to 1024
    cw, ch = img.size
    scale = min(SIZE / cw, SIZE / ch) * 0.88
    new_w, new_h = int(cw * scale), int(ch * scale)
    img = img.resize((new_w, new_h), Image.LANCZOS)

    canvas = Image.new('RGBA', (SIZE, SIZE), (0,0,0,0))
    canvas.paste(img, ((SIZE - new_w)//2, (SIZE - new_h)//2), img)

    # Generate iconset
    iconset = f'/tmp/icon_{theme_id}.iconset'
    if os.path.exists(iconset): shutil.rmtree(iconset)
    os.makedirs(iconset)
    for name, size in [
        ('icon_16x16.png',16), ('icon_16x16@2x.png',32),
        ('icon_32x32.png',32), ('icon_32x32@2x.png',64),
        ('icon_128x128.png',128), ('icon_128x128@2x.png',256),
        ('icon_256x256.png',256), ('icon_256x256@2x.png',512),
        ('icon_512x512.png',512), ('icon_512x512@2x.png',1024),
    ]:
        canvas.resize((size,size), Image.LANCZOS).save(f'{iconset}/{name}')

    icns = os.path.join(ASSETS_DIR, f'icon_{theme_id}.icns')
    subprocess.run(['iconutil','-c','icns','-o',icns,iconset], capture_output=True)
    if os.path.exists(icns):
        print(f"    ✓ {os.path.getsize(icns)//1024}KB")
    shutil.rmtree(iconset)

print("=== Generating icons (advanced bg removal) ===")
for t in ['orange','yellow','warrior','claude','cherry','ganganji']:
    process_theme(t)

# Verify
print("\n=== Verification ===")
for theme in ['orange','yellow','warrior','claude','cherry','ganganji']:
    iconset = f'/tmp/v_{theme}.iconset'
    subprocess.run(['iconutil','-c','iconset',f'{ASSETS_DIR}/icon_{theme}.icns','-o',iconset], capture_output=True)
    vimg = Image.open(f'{iconset}/icon_128x128.png').convert('RGBA')
    vpx = vimg.load()
    vw, vh = vimg.size
    pure_white = sum(1 for yy in range(vh) for xx in range(vw)
                     if vpx[xx,yy][3]==255 and vpx[xx,yy][0]==255 and vpx[xx,yy][1]==255 and vpx[xx,yy][2]==255)
    c = [vpx[2,2][3], vpx[vw-3,2][3], vpx[2,vh-3][3], vpx[vw-3,vh-3][3]]
    content_px = sum(1 for yy in range(vh) for xx in range(vw) if vpx[xx,yy][3]>10)
    print(f"  {theme}: corners_ok={all(cc==0 for cc in c)} pure_white_remnants={pure_white} content={content_px}")
    shutil.rmtree(iconset)
print("Done!")