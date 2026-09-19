#!/usr/bin/env python3
"""Plate critic — score a generated plate and say why, in numbers the harness can act on.

    python3 tools/print-desk/critique.py plate.png --palette neon-wet --expect-portrait

Prints one JSON object. Every metric is deliberately simple enough to explain to a human, because
the harness uses these to decide whether to keep a candidate or reprint it:

  exposure      mean luma in a usable band (kills black frames and blown ones)
  contrast      spread of luma (kills flat, washed-out plates)
  saturation    mean HSV saturation in the band the look spec wants (neon registers sit high)
  detail        variance of the Laplacian — sharpness / how much is actually rendered
  skin          skin-tone fraction in the centre third (a portrait with no face is broken)
  palette_fit   1 - normalised distance from the plate's background colour to the register's anchors
  entropy       unique-colour spread, catches degenerate single-tone output
"""

import argparse
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageFilter, ImageStat

SPEC = Path(__file__).resolve().parents[2] / "src" / "look" / "look.json"


def load_palettes():
    """Palettes come from the look spec, so this file cannot drift from what the desk actually prints."""
    try:
        spec = json.loads(SPEC.read_text())
        return {key: value["anchors"] for key, value in spec["palette"].items() if "anchors" in value}
    except (OSError, KeyError, json.JSONDecodeError) as error:
        print(f"could not read palettes from {SPEC}: {error}", file=sys.stderr)
        return {"neon-wet": ["#FF3E8E", "#25D8E8", "#FFB347", "#0B1030", "#2A0E4A"]}


PALETTES = load_palettes()

# What each palette is allowed to look like. Contrast floor and saturation window per palette.
BANDS = {
    "default": {"contrast": 30, "saturation": (25, 110)},
    "neon-wet": {"contrast": 28, "saturation": (30, 150)},
    "cinematic-warm": {"contrast": 26, "saturation": (20, 115)},
    "bleached-day": {"contrast": 20, "saturation": (8, 80)},
    "deco-pastel": {"contrast": 18, "saturation": (12, 95)},
    "warm-dusk": {"contrast": 22, "saturation": (18, 110)},
}


def hex_to_rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def skin_fraction(image):
    """Fraction of centre-region pixels inside the usual YCbCr skin box."""
    width, height = image.size
    centre = image.crop((width // 3, height // 4, width * 2 // 3, height * 3 // 4)).convert("YCbCr")
    pixels = list(centre.getdata())
    if not pixels:
        return 0.0
    hits = sum(1 for y, cb, cr in pixels if 80 <= y <= 240 and 85 <= cb <= 135 and 135 <= cr <= 180)
    return hits / len(pixels)


def palette_fit(image, palette):
    anchors = [hex_to_rgb(c) for c in PALETTES[palette]]
    small = image.resize((32, 32))
    border = []
    size = 32
    for x in range(size):
        for y in range(size):
            if x < 4 or y < 4 or x >= size - 4 or y >= size - 4:
                border.append(small.getpixel((x, y)))
    if not border:
        return 0.0
    mean = tuple(sum(c[i] for c in border) / len(border) for i in range(3))
    best = min(math.dist(mean, anchor) for anchor in anchors)
    return max(0.0, 1.0 - best / (math.sqrt(3) * 255))


def entropy(image):
    histogram = image.convert("RGB").resize((128, 128)).histogram()
    total = sum(histogram[:256])
    if not total:
        return 0.0
    result = 0.0
    for count in histogram[:256]:
        if count:
            p = count / total
            result -= p * math.log2(p)
    return result


def critique(path, palette, expect_portrait):
    image = Image.open(path).convert("RGB")
    luma = image.convert("L")
    stat = ImageStat.Stat(luma)
    sat = ImageStat.Stat(image.convert("HSV")).mean[1]
    detail = ImageStat.Stat(luma.filter(ImageFilter.FIND_EDGES)).stddev[0]
    skin = skin_fraction(image)
    fit = palette_fit(image, palette)
    ent = entropy(image)

    exposure = stat.mean[0]
    contrast = stat.stddev[0]

    # Bands are palette-aware: a night market plate is meant to be saturated and a bleached midday
    # plate is meant to be low-contrast, so one global band would flag correct plates as failures.
    band = BANDS.get(palette, BANDS["default"])
    checks = {
        "exposure": {"value": round(exposure, 1), "ok": 45 <= exposure <= 190},
        "contrast": {"value": round(contrast, 1), "ok": contrast >= band["contrast"]},
        "saturation": {"value": round(sat, 1), "ok": band["saturation"][0] <= sat <= band["saturation"][1]},
        "detail": {"value": round(detail, 2), "ok": detail >= 12},
        "entropy": {"value": round(ent, 2), "ok": ent >= 3.0},
    }
    if expect_portrait:
        checks["skin"] = {"value": round(skin, 3), "ok": 0.06 <= skin <= 0.75}

    # Weighted score with the failures dominating: a plate that fails a hard check cannot win.
    weights = {"exposure": 1.0, "contrast": 1.0, "saturation": 0.8, "detail": 1.2, "entropy": 0.6, "skin": 1.4}
    earned = sum(weights.get(k, 1.0) for k, v in checks.items() if v["ok"])
    total = sum(weights.get(k, 1.0) for k in checks)
    score = round(earned / total, 3)
    score = round(score * (0.6 + 0.4 * fit), 3)

    failed = [name for name, v in checks.items() if not v["ok"]]
    return {
        "file": str(path),
        "size": image.size,
        "palette": palette,
        "palette_fit": round(fit, 3),
        "score": score,
        "checks": checks,
        "failed": failed,
        "verdict": "keep" if score >= 0.8 and not failed else ("maybe" if score >= 0.6 else "reprint"),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("plate")
    parser.add_argument("--palette", default="neon-wet", choices=sorted(PALETTES))
    parser.add_argument("--expect-portrait", action="store_true")
    args = parser.parse_args()
    print(json.dumps(critique(Path(args.plate), args.palette, args.expect_portrait), indent=2))


if __name__ == "__main__":
    main()
