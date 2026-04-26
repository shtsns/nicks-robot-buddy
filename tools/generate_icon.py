"""Generates assets/buddy.ico — a multi-resolution Windows icon of Buddy's face.

Run from project root:
    .venv\\Scripts\\python.exe tools\\generate_icon.py
"""
from PIL import Image, ImageDraw
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "assets" / "buddy.ico"
OUT.parent.mkdir(parents=True, exist_ok=True)

SIZE = 512  # Master canvas size; PIL downsamples to icon resolutions

# Colors
HEAD_FILL = (229, 165, 96, 255)     # #E5A560
HEAD_STROKE = (139, 94, 42, 255)    # #8B5E2A
HEAD_LIGHT = (245, 200, 113, 200)   # #F5C871 with alpha
EAR_FILL = (139, 94, 42, 255)       # #8B5E2A
EAR_INNER = (216, 154, 63, 255)     # #D89A3F
SNOUT_FILL = (250, 232, 194, 255)   # #FAE8C2
SNOUT_STROKE = (198, 138, 56, 255)  # #C68A38
EYE = (26, 26, 26, 255)
NOSE = (26, 26, 26, 255)
WHITE = (255, 255, 255, 255)
COLLAR = (59, 130, 246, 255)        # #3B82F6
COLLAR_STROKE = (30, 64, 175, 255)  # #1E40AF
TAG = (251, 191, 36, 255)           # #FBBF24
TAG_STROKE = (180, 83, 9, 255)      # #B45309


def s(v: float) -> int:
    """Scale a 0–400 viewBox coord to the master canvas."""
    return int(v * SIZE / 400)


def draw_buddy(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)

    # Floppy ears (drawn first, behind head). PIL has no rotated ellipse, so
    # we draw onto a transparent layer, rotate it, and composite.
    for side in ("left", "right"):
        layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        if side == "left":
            cx, cy = 100, 240
            angle = 22  # PIL rotates counter-clockwise; -22 in SVG = +22 in PIL? actually we just pick what looks right
        else:
            cx, cy = 300, 240
            angle = -22
        ld.ellipse([s(cx - 42), s(cy - 85), s(cx + 42), s(cy + 85)],
                   fill=EAR_FILL, outline=HEAD_STROKE, width=s(0.75))
        ld.ellipse([s(cx - 26 + (5 if side == "left" else -5)), s(cy - 68 + 5),
                    s(cx + 26 + (5 if side == "left" else -5)), s(cy + 68 + 5)],
                   fill=EAR_INNER)
        rotated = layer.rotate(angle, resample=Image.BICUBIC, center=(s(cx), s(cy)))
        img.alpha_composite(rotated)

    # Re-draw with the head on top
    d = ImageDraw.Draw(img)

    # Head
    d.ellipse([s(200 - 135), s(200 - 125), s(200 + 135), s(200 + 125)],
              fill=HEAD_FILL, outline=HEAD_STROKE, width=s(1))

    # Forehead light patch
    d.ellipse([s(200 - 105), s(180 - 75), s(200 + 105), s(180 + 75)],
              fill=HEAD_LIGHT)

    # Snout
    d.ellipse([s(200 - 80), s(265 - 55), s(200 + 80), s(265 + 55)],
              fill=SNOUT_FILL, outline=SNOUT_STROKE, width=s(0.75))

    # Eyes
    for ex in (150, 250):
        d.ellipse([s(ex - 20), s(195 - 24), s(ex + 20), s(195 + 24)], fill=EYE)
        d.ellipse([s(ex + 6 - 7), s(188 - 7), s(ex + 6 + 7), s(188 + 7)], fill=WHITE)

    # Nose
    d.ellipse([s(200 - 20), s(240 - 15), s(200 + 20), s(240 + 15)], fill=NOSE)

    # Mouth — closed smile
    d.arc([s(170), s(265), s(230), s(305)], 0, 180,
          fill=EYE, width=s(1))


def main() -> None:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw_buddy(img)
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    img.save(OUT, format="ICO", sizes=sizes)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
