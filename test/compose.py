"""Compose the palette contact sheets used during design review.

    python test/compose.py

Reads test/pal-<name>.png and test/pald-<name>.png, writes
test/sheet-light.png and test/sheet-dark.png. Not part of the plugin.
"""

import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))

NAMES = [
    ("aurora", "极光 Aurora"),
    ("mist", "雾蓝 Mist"),
    ("celadon", "青瓷 Celadon"),
    ("paper", "宣纸 Paper"),
    ("blush", "藕粉 Blush"),
    ("glass", "玻璃白 Glass"),
]

CELL_W, CELL_H = 420, 548
PAD = 18
LABEL_H = 30


def load_font(size):
    for candidate in (r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\msyhbd.ttc", r"C:\Windows\Fonts\simhei.ttf"):
        if os.path.exists(candidate):
            try:
                return ImageFont.truetype(candidate, size)
            except OSError:
                continue
    return ImageFont.load_default()


def compose(prefix, out_name, bg, fg):
    cols, rows = 3, 2
    width = PAD + cols * (CELL_W + PAD)
    height = PAD + rows * (CELL_H + LABEL_H + PAD)
    sheet = Image.new("RGB", (width, height), bg)
    draw = ImageDraw.Draw(sheet)
    font = load_font(17)

    for index, (key, label) in enumerate(NAMES):
        path = os.path.join(HERE, f"{prefix}{key}.png")
        if not os.path.exists(path):
            continue
        shot = Image.open(path).convert("RGB")
        shot = shot.resize((CELL_W, CELL_H), Image.LANCZOS)

        col = index % cols
        row = index // cols
        x = PAD + col * (CELL_W + PAD)
        y = PAD + row * (CELL_H + LABEL_H + PAD)
        draw.text((x + 2, y + 4), label, font=font, fill=fg)
        sheet.paste(shot, (x, y + LABEL_H))

    out = os.path.join(HERE, out_name)
    sheet.save(out)
    print("wrote", out, sheet.size)


compose("pal-", "sheet-light.png", (28, 30, 36), (235, 238, 245))
compose("pald-", "sheet-dark.png", (18, 19, 23), (235, 238, 245))
