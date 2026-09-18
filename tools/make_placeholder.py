#!/usr/bin/env python3
"""Generate the boot placeholder plate used to mount the editor before real art exists.

Reproducible: run `python3 tools/make_placeholder.py` from the repo root.
Art direction: flat rose field (see src/index.css --color-rosa), white line-art city motif.

This file is deliberately NOT part of the build; it only writes a PNG into public/art/.
"""

from pathlib import Path

from PIL import Image, ImageDraw

W = H = 1200
ROSA = (125, 22, 22)
WHITE = (255, 255, 255, 46)  # low-opacity line art


def line(draw: ImageDraw.ImageDraw, points, width=5):
    draw.line(points, fill=WHITE, width=width, joint="curve")


def main() -> None:
    img = Image.new("RGB", (W, H), ROSA)
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)

    # suspension bridge
    line(d, [(80, 380), (240, 250), (430, 380)], 6)
    line(d, [(430, 380), (620, 250), (800, 380)], 6)
    line(d, [(80, 380), (800, 380)], 4)
    for x in range(120, 800, 60):
        line(d, [(x, 380), (x, 410)], 3)

    # palm
    line(d, [(980, 520), (1000, 330)], 8)
    for dx, dy in ((-120, -40), (120, -40), (-90, -110), (90, -110), (0, -140)):
        line(d, [(1000, 330), (1000 + dx, 330 + dy)], 6)

    # sun
    d.ellipse([(140, 700), (340, 900)], outline=WHITE, width=6)

    # arch / gateway
    line(d, [(700, 900), (700, 780), (820, 700), (940, 780), (940, 900)], 6)

    # horizon rules
    line(d, [(60, 1010), (1140, 1010)], 3)

    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")

    out = Path(__file__).resolve().parent.parent / "public" / "art" / "demo" / "placeholder.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "PNG", optimize=True)
    print(f"wrote {out} ({out.stat().st_size // 1024} KB, {W}x{H})")


if __name__ == "__main__":
    main()
