#!/usr/bin/env python3
"""Put the actual face from the photo back into the generated plate.

    python3 tools/print-desk/facefix.py plate.png reference.png --out plate-fixed.png

The model restyles everything, and a 4B model at 4 steps will always drift a face a little — softened
jaw, wrong nose, slightly different eyes. No prompt fixes that reliably. So this does the one thing
that does: it takes the face region from the *reference photo itself*, grades it to the plate's light
(per-channel LAB mean/std match), and Poisson-blends it in with a feathered mask, leaving the
generated hair, body and city untouched.

Detail is preserved because those pixels are not generated — they are the photo.

Prints a JSON report: face boxes, mask coverage, and how far the face colour moved toward the plate.
"""

import argparse
import json
import sys

import cv2
import numpy as np
from PIL import Image

CASCADES = [
    "haarcascade_frontalface_default.xml",
    "haarcascade_frontalface_alt2.xml",
    "haarcascade_profileface.xml",
]


def find_face(image_bgr, prefer_centre=True):
    gray = cv2.equalizeHist(cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY))
    height, width = gray.shape[:2]
    for cascade_file in CASCADES:
        cascade = cv2.CascadeClassifier(cv2.data.haarcascades + cascade_file)
        if cascade.empty():
            continue
        faces = cascade.detectMultiScale(gray, scaleFactor=1.08, minNeighbors=6, minSize=(40, 40))
        if len(faces) == 0:
            continue
        centre = np.array([width / 2, height / 2])
        best = max(
            faces,
            key=lambda f: f[2] * f[3] * (1.0 - (0.5 * np.linalg.norm(np.array([f[0] + f[2] / 2, f[1] + f[3] / 2]) - centre) / max(width, height)) if prefer_centre else 1.0),
        )
        return tuple(int(v) for v in best)
    return None


def lab_stats(rgb_patch, mask):
    lab = cv2.cvtColor(rgb_patch, cv2.COLOR_RGB2LAB).astype(np.float32)
    flat = lab.reshape(-1, 3)
    weights = mask.reshape(-1).astype(np.float32) / 255.0
    total = max(weights.sum(), 1e-3)
    mean = (flat * weights[:, None]).sum(axis=0) / total
    var = (((flat - mean) ** 2) * weights[:, None]).sum(axis=0) / total
    return mean, np.sqrt(var + 1e-6)


def match_colour(source_rgb, target_rgb, mask):
    """Reinhard transfer in LAB: the photo's face takes on the plate's light without going grey."""
    s_mean, s_std = lab_stats(source_rgb, mask)
    t_mean, t_std = lab_stats(target_rgb, mask)
    src = cv2.cvtColor(source_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    out = (src - s_mean) * (t_std / np.maximum(s_std, 1e-3)) + t_mean
    out = np.clip(out, 0, 255).astype(np.uint8)
    return cv2.cvtColor(out, cv2.COLOR_LAB2RGB)


def zoned_mask(shape, box, grow=1.16, feather=0.13):
    """Ellipse over the face, grown a little, feathered so nothing lands as a pasted rectangle."""
    height, width = shape[:2]
    x, y, w, h = box
    cx, cy = int(x + w / 2), int(y + h / 2)
    axes = (int(w * grow / 2), int(h * grow / 2))
    mask = np.zeros((height, width), np.uint8)
    cv2.ellipse(mask, (cx, cy), axes, 0, 0, 360, 255, -1)
    # Closer to the eyes the blend is fullest; toward the jaw it tapers, so the model's own jawline wins.
    blur = max(3, int(w * feather) | 1)
    mask = cv2.GaussianBlur(mask, (blur, blur), 0)
    return mask, (cx, cy)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("plate")
    parser.add_argument("reference")
    parser.add_argument("--out", required=True)
    parser.add_argument("--mode", default="mixed", choices=["mixed", "normal", "alpha"])
    parser.add_argument("--alpha", type=float, default=0.82, help="opacity when --mode alpha")
    parser.add_argument("--grow", type=float, default=1.16)
    args = parser.parse_args()

    plate = np.array(Image.open(args.plate).convert("RGB"))
    reference = np.array(Image.open(args.reference).convert("RGB"))
    report = {"plate": args.plate, "reference": args.reference, "mode": args.mode}

    plate_face = find_face(cv2.cvtColor(plate, cv2.COLOR_RGB2BGR))
    ref_face = find_face(cv2.cvtColor(reference, cv2.COLOR_RGB2BGR))
    report["faces"] = {"plate": plate_face, "reference": ref_face}
    if plate_face is None or ref_face is None:
        report["skipped"] = "no face found" if plate_face is None else "no face in the reference"
        report["out"] = args.plate
        json.dump(report, sys.stdout, indent=2)
        print()
        print(report["skipped"], file=sys.stderr)
        sys.exit(0 if plate_face is None else 3)

    px, py, pw, ph = plate_face
    rx, ry, rw, rh = ref_face

    # Cut the reference's face (plus a margin), then scale it to the plate's face box.
    margin = 0.18
    rx0 = max(0, int(rx - rw * margin))
    ry0 = max(0, int(ry - rh * margin))
    rx1 = min(reference.shape[1], int(rx + rw * (1 + margin)))
    ry1 = min(reference.shape[0], int(ry + rh * (1 + margin)))
    patch = reference[ry0:ry1, rx0:rx1]
    patch = cv2.resize(patch, (int(pw * (1 + 2 * margin)), int(ph * (1 + 2 * margin))), interpolation=cv2.INTER_LANCZOS4)

    region = np.zeros_like(plate)
    x0 = max(0, int(px - pw * margin))
    y0 = max(0, int(py - ph * margin))
    region[y0 : y0 + patch.shape[0], x0 : x0 + patch.shape[1]] = patch[: region.shape[0] - y0, : region.shape[1] - x0]

    mask, centre = zoned_mask(plate.shape, (px, py, pw, ph), grow=args.grow)
    graded = match_colour(region, plate, mask)

    before = float(np.abs(lab_stats(region, mask)[0] - lab_stats(plate, mask)[0]).mean())
    after = float(np.abs(lab_stats(graded, mask)[0] - lab_stats(plate, mask)[0]).mean())
    report["colour_gap"] = {"before": round(before, 2), "after": round(after, 2)}
    report["mask_pixels"] = int((mask > 32).sum())
    report["face_share_of_plate"] = round((pw * ph) / (plate.shape[0] * plate.shape[1]), 4)

    if args.mode == "alpha":
        blended = plate.copy()
        weight = (mask.astype(np.float32) / 255.0 * args.alpha)[:, :, None]
        blended = (graded * weight + plate * (1 - weight)).astype(np.uint8)
    else:
        flag = cv2.MIXED_CLONE if args.mode == "mixed" else cv2.NORMAL_CLONE
        blended = cv2.seamlessClone(graded, plate, mask, centre, flag)

    Image.fromarray(blended).save(args.out, quality=95)
    report["out"] = args.out
    json.dump(report, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
