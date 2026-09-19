#!/usr/bin/env python3
"""Put the actual face from the photo back into the generated plate — aligned, graded, and sharp.

    python3 tools/print-desk/facefix.py plate.png reference.png --source ~/original.jpg --out fixed.png

A 4B model at any step count drifts a face — measured with ArcFace embeddings, the raw plate scores
0.08 cosine against the photo (a different person), while the restored plate scores 0.40+. No prompt
fixes that. This does: it takes the face region from the *photograph itself* and blends it in, leaving
the generated hair, body and city untouched.

How it works:

  landmarks   InsightFace finds the face and its 5 keypoints (falling back to OpenCV cascades if it is
              not installed). Haar alone was not good enough: on this subject it found no eyes at all,
              so the eye-aligned path never ran and every blend fell back to a plain box scale.
  source      the face is cut from the ORIGINAL photo at full resolution, not the 1024px framed copy,
              so the face in the plate carries more real detail than the plate's own pixels do
  alignment   the patch is warped (rotate + scale + translate) so the two eye lines coincide
  colour      Reinhard transfer in LAB with the colour channels clamped, so the face takes the plate's
              light without being dragged into a colour cast
  finish      a light unsharp pass over the blended region, because Poisson blending softens edges

Prints a JSON report: boxes, alignment mode, colour gap before/after, mask coverage.
"""

import argparse
import json
import math
import sys

import cv2
import numpy as np
from PIL import Image

CASCADES = [
    "haarcascade_frontalface_default.xml",
    "haarcascade_frontalface_alt2.xml",
    "haarcascade_profileface.xml",
]

_APP = None


def insight_face(image_bgr):
    """Face box + eye centres from InsightFace. Returns None when the package is unavailable."""
    global _APP
    try:
        from insightface.app import FaceAnalysis
    except ImportError:
        return None
    if _APP is None:
        _APP = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        _APP.prepare(ctx_id=-1, det_size=(640, 640))
    faces = _APP.get(image_bgr)
    if not faces:
        return None
    face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
    x0, y0, x1, y1 = (float(v) for v in face.bbox)
    return {
        "box": (int(x0), int(y0), int(x1 - x0), int(y1 - y0)),
        "left_eye": np.asarray(face.kps[0], dtype=np.float32),
        "right_eye": np.asarray(face.kps[1], dtype=np.float32),
    }


def cascade_face(image_bgr, prefer_centre=True):
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
            key=lambda f: f[2]
            * f[3]
            * (1.0 - (0.5 * np.linalg.norm(np.array([f[0] + f[2] / 2, f[1] + f[3] / 2]) - centre) / max(width, height)) if prefer_centre else 1.0),
        )
        return tuple(int(v) for v in best)
    return None


def cascade_eyes(image_bgr, face_box):
    x, y, w, h = face_box
    x0, y0 = max(0, x), max(0, y)
    roi = image_bgr[y0 : y + h, x0 : x + w]
    if roi.size == 0:
        return None
    gray = cv2.equalizeHist(cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY))
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_eye.xml")
    if cascade.empty():
        return None
    upper = gray[: h // 2 + h // 8, :]
    eyes = cascade.detectMultiScale(upper, scaleFactor=1.06, minNeighbors=4, minSize=(int(w * 0.08), int(w * 0.08)))
    if len(eyes) < 2:
        return None
    centres = sorted(((ex + ew / 2 + x0, ey + eh / 2 + y0) for ex, ey, ew, eh in eyes), key=lambda p: p[0])
    pair = max(((a, b) for i, a in enumerate(centres) for b in centres[i + 1 :]), key=lambda p: abs(p[1][0] - p[0][0]))
    return np.array(pair[0], dtype=np.float32), np.array(pair[1], dtype=np.float32)


def locate(image_bgr):
    """(box, left_eye, right_eye, how) — landmarks first, cascades as the fallback."""
    found = insight_face(image_bgr)
    if found:
        return found["box"], found["left_eye"], found["right_eye"], "landmarks"
    box = cascade_face(image_bgr)
    if box is None:
        return None, None, None, "none"
    eyes = cascade_eyes(image_bgr, box)
    if eyes:
        return box, eyes[0], eyes[1], "cascade"
    return box, None, None, "box-only"


def lab_stats(rgb_patch, mask):
    lab = cv2.cvtColor(rgb_patch, cv2.COLOR_RGB2LAB).astype(np.float32)
    flat = lab.reshape(-1, 3)
    weights = mask.reshape(-1).astype(np.float32) / 255.0
    total = max(weights.sum(), 1e-3)
    mean = (flat * weights[:, None]).sum(axis=0) / total
    var = (((flat - mean) ** 2) * weights[:, None]).sum(axis=0) / total
    return mean, np.sqrt(var + 1e-6)


def match_colour(source_rgb, target_rgb, mask, max_ab_shift=14.0):
    """Reinhard transfer in LAB, colour channels clamped so skin cannot be tinted magenta."""
    s_mean, s_std = lab_stats(source_rgb, mask)
    t_mean, t_std = lab_stats(target_rgb, mask)
    delta = t_mean - s_mean
    delta[1:] = np.clip(delta[1:], -max_ab_shift, max_ab_shift)
    src = cv2.cvtColor(source_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    out = (src - s_mean) * (t_std / np.maximum(s_std, 1e-3)) + s_mean + delta
    out = np.clip(out, 0, 255).astype(np.uint8)
    return cv2.cvtColor(out, cv2.COLOR_LAB2RGB)


def zoned_mask(shape, box, grow=1.16, feather=0.13):
    height, width = shape[:2]
    x, y, w, h = box
    cx, cy = int(x + w / 2), int(y + h / 2)
    mask = np.zeros((height, width), np.uint8)
    cv2.ellipse(mask, (cx, cy), (int(w * grow / 2), int(h * grow / 2)), 0, 0, 360, 255, -1)
    blur = max(3, int(w * feather) | 1)
    return cv2.GaussianBlur(mask, (blur, blur), 0), (cx, cy)


def reframe(plate, box, size, min_share, headroom=0.55, max_upscale=1.6):
    """
    If the model put the subject small in the frame, crop in on them and scale back up.

    This is the framing half of quality: the same seed can render a wide shot where the face covers
    18% of the frame height instead of 35%, and then the restored face is small and soft however good
    the restore is. Cropping to the subject makes every candidate comparable and gives the face more
    real pixels than the plate had.

    The crop never shrinks below size / max_upscale, so the plate is never blown up more than that —
    upscaling a background to fix a face trades one kind of mush for another.
    """
    height, width = plate.shape[:2]
    x, y, w, h = box
    share = h / height
    if share >= min_share:
        return plate, {"reframed": False, "face_share_before": round(share, 4)}

    factor = min_share / max(share, 1e-4)
    floor = size / max_upscale
    side = min(max(w * factor * 1.6, w * 2.2), min(width, height))
    side = max(side, min(floor, min(width, height)))
    cx = x + w / 2
    cy = y + h / 2 - side * (0.5 - headroom)
    left = max(0, min(cx - side / 2, width - side))
    top = max(0, min(cy - side / 2, height - side))
    crop = plate[int(top) : int(top + side), int(left) : int(left + side)]
    if crop.size == 0:
        return plate, {"reframed": False, "face_share_before": round(share, 4)}
    scaled = cv2.resize(crop, (size, size), interpolation=cv2.INTER_LANCZOS4)
    return scaled, {
        "reframed": True,
        "face_share_before": round(share, 4),
        "upscale": round(size / side, 2),
        "crop": [int(left), int(top), int(side)],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("plate")
    parser.add_argument("reference", help="the framed reference the desk printed from")
    parser.add_argument("--source", help="the original photo at full resolution (defaults to the reference)")
    parser.add_argument("--out", required=True)
    parser.add_argument(
        "--mode",
        default="alpha",
        choices=["alpha", "normal", "mixed"],
        help="how the face is blended. Measured identity against the photo: alpha 0.93, normal-clone 0.92, "
        "mixed-clone 0.54 — MIXED_CLONE keeps the plate's high-frequency texture over the patch, which is "
        "exactly wrong for a face we are trying to preserve. Alpha is the default for that reason.",
    )
    parser.add_argument("--alpha", type=float, default=0.92, help="opacity of the restored face")
    parser.add_argument("--grow", type=float, default=1.16)
    parser.add_argument("--sharpen", type=float, default=0.25, help="unsharp amount on the blended face, 0 disables")
    parser.add_argument("--min-face-share", type=float, default=0.28, help="reframe until the face is this share of the frame height")
    parser.add_argument("--reframe-size", type=int, default=1024)
    parser.add_argument("--max-upscale", type=float, default=1.6, help="never blow the plate up more than this to reach the target")
    args = parser.parse_args()

    plate = np.array(Image.open(args.plate).convert("RGB"))
    reference = np.array(Image.open(args.reference).convert("RGB"))
    source = np.array(Image.open(args.source).convert("RGB")) if args.source else reference
    report = {"plate": args.plate, "reference": args.reference, "source": args.source or args.reference, "mode": args.mode}

    # Reframe first: everything downstream (alignment, mask, blend) is easier with a properly sized face.
    pre_box, _, _, _ = locate(cv2.cvtColor(plate, cv2.COLOR_RGB2BGR))
    if pre_box is not None:
        plate, reframe_report = reframe(plate, pre_box, args.reframe_size, args.min_face_share, max_upscale=args.max_upscale)
        report["reframe"] = reframe_report

    plate_box, plate_left, plate_right, plate_how = locate(cv2.cvtColor(plate, cv2.COLOR_RGB2BGR))
    source_box, source_left, source_right, source_how = locate(cv2.cvtColor(source, cv2.COLOR_RGB2BGR))
    report["faces"] = {"plate": plate_box, "source": source_box, "plate_found_by": plate_how, "source_found_by": source_how}

    if plate_box is None or source_box is None:
        report["skipped"] = "no face in the plate" if plate_box is None else "no face in the source photo"
        report["out"] = args.plate
        json.dump(report, sys.stdout, indent=2)
        print()
        print(report["skipped"], file=sys.stderr)
        sys.exit(0 if plate_box is None else 3)

    height, width = plate.shape[:2]
    px, py, pw, ph = plate_box
    margin = 0.20

    if source_left is not None and plate_left is not None:
        s_vec, p_vec = source_right - source_left, plate_right - plate_left
        angle = math.degrees(math.atan2(p_vec[1], p_vec[0]) - math.atan2(s_vec[1], s_vec[0]))
        scale = float(np.linalg.norm(p_vec) / max(np.linalg.norm(s_vec), 1e-6))
        s_mid = (source_left + source_right) / 2
        p_mid = (plate_left + plate_right) / 2
        matrix = cv2.getRotationMatrix2D((float(s_mid[0]), float(s_mid[1])), angle, scale)
        matrix[0, 2] += p_mid[0] - s_mid[0]
        matrix[1, 2] += p_mid[1] - s_mid[1]
        warped = cv2.warpAffine(source, matrix, (width, height), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REPLICATE)
        report["alignment"] = {"mode": "eyes", "angle_deg": round(angle, 2), "scale": round(scale, 3)}
    else:
        sx, sy, sw, sh = source_box
        pad = int(sw * margin)
        crop = source[max(0, sy - pad) : sy + sh + pad, max(0, sx - pad) : sx + sw + pad]
        target_w, target_h = int(pw * (1 + 2 * margin)), int(ph * (1 + 2 * margin))
        resized = cv2.resize(crop, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)
        warped = np.zeros_like(plate)
        ox, oy = max(0, int(px - pw * margin)), max(0, int(py - ph * margin))
        h_avail, w_avail = warped.shape[0] - oy, warped.shape[1] - ox
        warped[oy : oy + min(target_h, h_avail), ox : ox + min(target_w, w_avail)] = resized[: min(target_h, h_avail), : min(target_w, w_avail)]
        report["alignment"] = {"mode": "box"}

    mask, centre = zoned_mask(plate.shape, (px, py, pw, ph), grow=args.grow)
    graded = match_colour(warped, plate, mask)
    before = float(np.abs(lab_stats(warped, mask)[0] - lab_stats(plate, mask)[0]).mean())
    after = float(np.abs(lab_stats(graded, mask)[0] - lab_stats(plate, mask)[0]).mean())
    report["colour_gap"] = {"before": round(before, 2), "after": round(after, 2)}
    report["mask_pixels"] = int((mask > 32).sum())
    report["face_share_of_plate"] = round((pw * ph) / (height * width), 4)

    if args.mode == "alpha":
        weight = (mask.astype(np.float32) / 255.0 * args.alpha)[:, :, None]
        blended = (graded * weight + plate * (1 - weight)).astype(np.uint8)
    else:
        flag = cv2.MIXED_CLONE if args.mode == "mixed" else cv2.NORMAL_CLONE
        blended = cv2.seamlessClone(graded, plate, mask, centre, flag)

    if args.sharpen > 0:
        soft = cv2.GaussianBlur(blended, (0, 0), 1.2)
        sharp = cv2.addWeighted(blended, 1 + args.sharpen, soft, -args.sharpen, 0)
        weight = (mask.astype(np.float32) / 255.0)[:, :, None]
        blended = (sharp * weight + blended * (1 - weight)).astype(np.uint8)

    Image.fromarray(blended).save(args.out, quality=95)
    report["out"] = args.out
    json.dump(report, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
