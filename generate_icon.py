from PIL import Image, ImageDraw
import os, shutil, math, subprocess, sys

SIZE = 1024
CX = SIZE // 2
CY = SIZE // 2
R = SIZE // 2 - 40

# --- Colors ---
bg_orange = (255, 179, 71)
bg_orange_dark = (255, 140, 50)
white = (255, 255, 255)
dark = (60, 30, 10)
nose_color = (255, 120, 100)

# --- Build clean circle with gradient ---
img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

for y in range(CY - R, CY + R):
    dy = (y - CY) / R
    if abs(dy) >= 1:
        continue
    dx = int(R * math.sqrt(1 - dy * dy))
    x_start = CX - dx
    x_end = CX + dx
    t = (y - (CY - R)) / (2 * R)
    t = max(0, min(1, t))
    for x in range(x_start, x_end):
        h_dist = abs(x - CX) / max(dx, 1)
        light = 1 - h_dist * 0.12
        r = min(255, int((bg_orange[0] + (bg_orange_dark[0] - bg_orange[0]) * t) * light + 15))
        g = min(255, int((bg_orange[1] + (bg_orange_dark[1] - bg_orange[1]) * t) * light + 10))
        b = min(255, int((bg_orange[2] + (bg_orange_dark[2] - bg_orange[2]) * t) * light + 5))
        img.putpixel((x, y), (r, g, b))

# Clean alpha mask for smooth circle edge
mask = Image.new('L', (SIZE, SIZE), 0)
mask_draw = ImageDraw.Draw(mask)
mask_draw.ellipse([CX - R, CY - R, CX + R, CY + R], fill=255)
img.putalpha(mask)

draw = ImageDraw.Draw(img)

# --- Ears ---
ear_y_base = CY - int(R * 0.72)
ear_h = int(R * 0.45)
ear_w = int(R * 0.18)
ear_gap = int(R * 0.35)

def draw_ear(ex, ey_top):
    points = [(ex - ear_w, ear_y_base), (ex, ey_top), (ex + ear_w, ear_y_base)]
    draw.polygon(points, fill=bg_orange)
    iw = int(ear_w * 0.55)
    io = int(ear_w * 0.25)
    ip = [(ex - iw, ear_y_base - io), (ex, ey_top + int(ear_w * 0.35)), (ex + iw, ear_y_base - io)]
    draw.polygon(ip, fill=(255, 200, 160))

draw_ear(CX - ear_gap, CY - int(R * 1.05))
draw_ear(CX + ear_gap, CY - int(R * 1.05))

# --- Eyes ---
eye_y = CY - int(R * 0.08)
eye_r = int(R * 0.1)
eye_gap = int(R * 0.28)
pupil_r = int(eye_r * 0.5)

for ex in [CX - eye_gap, CX + eye_gap]:
    draw.ellipse([ex - eye_r, eye_y - eye_r, ex + eye_r, eye_y + eye_r], fill=white)
    draw.ellipse([ex - pupil_r, eye_y - pupil_r, ex + pupil_r, eye_y + pupil_r], fill=dark)
    hl_r = max(1, int(pupil_r * 0.35))
    hl_off = int(pupil_r * 0.35)
    draw.ellipse(
        [ex - hl_off - hl_r, eye_y - int(pupil_r * 0.3) - hl_r,
         ex - hl_off + hl_r, eye_y - int(pupil_r * 0.3) + hl_r],
        fill=white
    )

# --- Nose ---
nose_y = CY + int(R * 0.15)
nose_rx = int(R * 0.06)
nose_ry = int(R * 0.04)
draw.ellipse([CX - nose_rx, nose_y - nose_ry, CX + nose_rx, nose_y + nose_ry], fill=nose_color)

# --- Mouth (w shape) ---
mouth_y = nose_y + nose_ry + int(R * 0.04)
mouth_w = int(R * 0.13)
mouth_h = int(R * 0.09)
lw = max(1, R // 55)

# Left arc
draw.arc(
    [CX - mouth_w, mouth_y - mouth_h // 2, CX, mouth_y + mouth_h],
    220, 320, fill=dark, width=lw
)
# Right arc
draw.arc(
    [CX, mouth_y - mouth_h // 2, CX + mouth_w, mouth_y + mouth_h],
    220, 320, fill=dark, width=lw
)
# Center W lines
cwx = int(mouth_w * 0.3)
cwy_top = mouth_y - int(mouth_h * 0.35)
cwy_bot = mouth_y + int(mouth_h * 0.25)
draw.line([(CX - cwx, cwy_bot), (CX, cwy_top)], fill=dark, width=lw)
draw.line([(CX, cwy_top), (CX + cwx, cwy_bot)], fill=dark, width=lw)

# --- Whiskers ---
whisker_y = nose_y + nose_ry
whisker_len = int(R * 0.24)
wl_w = max(1, R // 65)
for side, sx in [(-1, CX - int(eye_gap * 1.3)), (1, CX + int(eye_gap * 1.3))]:
    for angle_off in [-8, 0, 8]:
        angle = math.radians(side * (180 - 15) + angle_off)
        ex = int(sx + whisker_len * math.cos(angle))
        ey = int(whisker_y + whisker_len * math.sin(angle) * 0.5)
        draw.line([(sx, whisker_y), (ex, ey)], fill=(255, 255, 255, 180), width=wl_w)

# --- Subtle shadow under face ---
shadow = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
shadow_draw = ImageDraw.Draw(shadow)
shadow_draw.ellipse(
    [CX - int(R * 0.85), CY + int(R * 0.15), CX + int(R * 0.85), CY + int(R * 1.05)],
    fill=(0, 0, 0, 30)
)
img = Image.alpha_composite(img, shadow)

# --- Restore draw on composited image ---
draw = ImageDraw.Draw(img)

# --- Blush circles ---
blush_y = nose_y - int(R * 0.02)
blush_r = int(R * 0.07)
blush_gap = int(R * 0.5)
for bx in [CX - blush_gap, CX + blush_gap]:
    blush_img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    blush_draw = ImageDraw.Draw(blush_img)
    blush_draw.ellipse([bx - blush_r, blush_y - blush_r, bx + blush_r, blush_y + blush_r],
                       fill=(255, 180, 160, 80))
    img = Image.alpha_composite(img, blush_img)

# --- Generate macOS .iconset ---
iconset_dir = '/tmp/pet_icon.iconset'
if os.path.exists(iconset_dir):
    shutil.rmtree(iconset_dir)
os.makedirs(iconset_dir)

sizes = {
    'icon_16x16.png': 16, 'icon_16x16@2x.png': 32,
    'icon_32x32.png': 32, 'icon_32x32@2x.png': 64,
    'icon_128x128.png': 128, 'icon_128x128@2x.png': 256,
    'icon_256x256.png': 256, 'icon_256x256@2x.png': 512,
    'icon_512x512.png': 512, 'icon_512x512@2x.png': 1024,
}

for name, size in sizes.items():
    resized = img.resize((size, size), Image.LANCZOS)
    resized.save(os.path.join(iconset_dir, name))

print("Iconset generated successfully")

# --- Export for electron-builder ---
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.join(SCRIPT_DIR, 'assets')
os.makedirs(ASSETS_DIR, exist_ok=True)

# Copy 1024x1024 as the electron-builder icon source
icon_png_src = os.path.join(iconset_dir, 'icon_512x512@2x.png')
icon_png_dst = os.path.join(ASSETS_DIR, 'icon.png')
if os.path.exists(icon_png_src):
    shutil.copy(icon_png_src, icon_png_dst)
    print(f"Copied icon.png to {icon_png_dst}")
else:
    print("ERROR: 1024x1024 icon not found in iconset", file=sys.stderr)
    sys.exit(1)

# Generate .icns using iconutil (macOS only)
icns_dst = os.path.join(ASSETS_DIR, 'icon.icns')
result = subprocess.run(['iconutil', '-c', 'icns', '-o', icns_dst, iconset_dir],
                        capture_output=True, text=True)
if result.returncode == 0:
    print(f"Generated icon.icns at {icns_dst}")
else:
    print(f"Warning: iconutil failed (non-macOS or missing tool): {result.stderr}")
