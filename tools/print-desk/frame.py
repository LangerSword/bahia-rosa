#!/usr/bin/env python3
"""Find the face in a photo and frame it like a character portrait, before the model ever sees it.

    python3 tools/print-desk/frame.py ~/me.jpg --out /tmp/me-framed.png

Why: the model cannot restyle what it cannot see. Feed it a 2592x1944 landscape with a person in the
middle and it produces mush, because the face occupies maybe 4% of the pixels. This finds the face,
crops to a head-and-shoulders frame with sensible headroom, squares it and hands *that* to the desk —
so the same photo prints far better without touching the generation settings.

Every crop decision is printed as JSON, because a wrong crop is the one failure a human can spot
instantly and a metric cannot.
"""

import argparse
import json
import sys

import cv2
import numpy as np
from PIL import Image, ImageFilter

# Frontal first, then alt and profile: a photo taken from the side is still a portrait worth printing.
CASCADES = [
    ("frontal", "haarcascade_frontalface_default.xml"),
    ("frontal-alt", "haarcascade_frontalface_alt2.xml"),
    ("profile", "haarcascade_profileface.xml"),
]


def detect(image_bgr):
    """Return (label, x, y, w, h, faces_found) for the most portrait-worthy face."""
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)
    height, width = gray.shape[:2]
    best = None
    for label, cascade_file in CASCADES:
        cascade = cv2.CascadeClassifier(cv2.data.haarcascades + cascade_file)
        if cascade.empty():
            continue
        faces = cascade.detectMultiScale(gray, scaleFactor=1.08, minNeighbors=6, minSize=(48, 48))
        if len(faces) == 0:
            continue
        # Prefer the biggest face, nudged toward the centre of the frame — the subject is rarely
        # the face pressed against the edge.
        centre = np.array([width / 2, height / 2])
        scored = []
        for x, y, w, h in faces:
            face_centre = np.array([x + w / 2, y + h / 2])
            distance = np.linalg.norm(face_centre - centre) / max(width, height)
            scored.append((w * h * (1.0 - 0.5 * distance), (x, y, w, h)))
        scored.sort(reverse=True)
        best = (label, *scored[0][1], len(faces))
        break
    return best


def frame(image, face, shape="square", scale=2.3, headroom=0.55):
    """Expand the face box into a head-and-shoulders crop, then square it."""
    _, x, y, w, h, _ = face
    width, height = image.size

    box_w = w * scale
    box_h = w * scale  # faces are roughly as wide as tall in a portrait crop
    cx = x + w / 2
    cy = y + h / 2 - box_h * (0.5 - headroom)  # push the crop up so the crown has air

    if shape == "square":
        side = max(box_w, box_h)
        left, top = cx - side / 2, cy - side / 2
        right, bottom = left + side, top + side
    else:  # portrait 4:5
        box_w, box_h = box_w * 1.05, box_w * 1.3
        left, top, right, bottom = cx - box_w / 2, cy - box_h / 2, cx + box_w / 2, cy + box_h / 2

    # Clamp into the image, then slide (never squash) so the crop keeps its aspect.
    side = right - left
    if left < 0:
        right -= left
        left = 0
    if top < 0:
        bottom -= top
        top = 0
    if right > width:
        left -= right - width
        right = width
    if bottom > height:
        top -= bottom - height
        bottom = height
    left, top = max(0, left), max(0, top)

    clamped = (right - left) < side * 0.6 or (bottom - top) < side * 0.6
    crop = tuple(int(round(v)) for v in (left, top, right, bottom))
    return crop, clamped


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("photo")
    parser.add_argument("--out", required=True)
    parser.add_argument("--size", type=int, default=1024)
    parser.add_argument("--max-pixels", type=int, default=None, help="also write a small copy at this pixel budget")
    parser.add_argument("--no-face-ok", action="store_true", help="still write a centred crop when no face is found")
    parser.add_argument("--shape", default="square", choices=["square", "portrait"])
    args = parser.parse_args()

    original = Image.open(args.photo).convert("RGB")
    face = detect(cv2.cvtColor(np.array(original), cv2.COLOR_RGB2BGR))

    report = {"photo": args.photo, "size": original.size}
    if face:
        label, x, y, w, h, count = face
        crop, clamped = frame(original, face, shape=args.shape)
        report.update(
            {
                "face": {"method": label, "box": [int(x), int(y), int(w), int(h)], "faces_found": int(count)},
                "crop": list(crop),
                "face_share_of_original": round((w * h) / (original.size[0] * original.size[1]), 4),
                "clamped": bool(clamped),
            }
        )
    elif args.no_face_ok:
        width, height = original.size
        side = int(min(width, height) * 0.85)
        crop = ((width - side) // 2, (height - side) // 2, (width + side) // 2, (height + side) // 2)
        report.update({"face": None, "crop": list(crop), "fallback": "centred crop"})
    else:
        report["face"] = None
        json.dump(report, sys.stdout, indent=2)
        print()
        print("no face found — pass --no-face-ok to centre-crop anyway, or upload a closer shot", file=sys.stderr)
        sys.exit(3)

    framed = original.crop(crop)
    side = max(framed.size)
    canvas = Image.new("RGB", (side, side), (0, 0, 0))
    canvas.paste(framed, ((side - framed.size[0]) // 2, (side - framed.size[1]) // 2))
    final = canvas.resize((args.size, args.size), Image.Resampling.LANCZOS).filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=3))
    final.save(args.out, quality=95)

    if args.max_pixels:
        small = final.copy()
        small.thumbnail((args.max_pixels, args.max_pixels), Image.LANCZOS)
        small_path = args.out.rsplit(".", 1)[0] + f"-{args.max_pixels}.png"
        small.save(small_path, quality=95)
        report["small"] = small_path

    report["out"] = args.out
    json.dump(report, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
