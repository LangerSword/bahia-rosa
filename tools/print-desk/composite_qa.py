#!/usr/bin/env python
"""
Composite QA — the checks ArcFace identity cannot make.

`identity.py` measures the *patch*: the photo's own pixels after they were pasted in. A plate can
score 0.95 there and still look wrong, because the failure the eye sees is at the join:

  seam      — is there a visible cut line where the patch meets the plate?
  sharpness — is the patch much sharper than the plate around it (a photo glued onto a painting)?
  ring      — does the light just inside the boundary differ from just outside it?
  head      — does the pasted face sit on the plate's own head, at the plate's own size and place?

Those four are what "it looks pasted / it looks like a mask" means numerically. Run this on the
composite and the raw plate it came from; compare candidates before shipping one.

Usage:
  composite_qa.py <composite.png> <raw-plate.png> <reference.png> [--json]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from facefix import locate, zoned_mask  # noqa: E402  (same detector and mask as the restore)


def _lab(image: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(image, cv2.COLOR_RGB2LAB).astype(np.float32)


def _ring(mask: np.ndarray, width: int) -> tuple[np.ndarray, np.ndarray]:
    """Two bands either side of the boundary: inside (erode) and outside (dilate minus mask)."""
    kernel = np.ones((width * 2 + 1, width * 2 + 1), np.uint8)
    inner = cv2.erode(mask, kernel, iterations=1)
    outer = cv2.dilate(mask, kernel, iterations=1)
    return inner, cv2.subtract(outer, mask)


def _gradient_energy(image: np.ndarray, region: np.ndarray) -> float:
    grey = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY).astype(np.float32)
    gx = cv2.Sobel(grey, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(grey, cv2.CV_32F, 0, 1, ksize=3)
    magnitude = cv2.magnitude(gx, gy)
    return float(magnitude[region > 0].mean()) if (region > 0).any() else 0.0


def _sharpness(image: np.ndarray, region: np.ndarray) -> float:
    grey = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    lap = cv2.Laplacian(grey, cv2.CV_32F, ksize=3)
    return float(lap[region > 0].var()) if (region > 0).any() else 0.0


def _boundary_ring(mask: np.ndarray, thickness: int) -> np.ndarray:
    """A thin band ON the mask edge — the only place a seam can actually show."""
    kernel = np.ones((thickness * 2 + 1, thickness * 2 + 1), np.uint8)
    return cv2.subtract(cv2.dilate(mask, kernel, iterations=1), cv2.erode(mask, kernel, iterations=1))


def _mean_lab(image: np.ndarray, region: np.ndarray) -> list[float]:
    lab = _lab(image)
    pixels = lab[region > 0]
    return [round(float(v), 2) for v in pixels.mean(axis=0)] if len(pixels) else [0.0, 0.0, 0.0]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("composite")
    parser.add_argument("raw")
    parser.add_argument("reference")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    composite = cv2.cvtColor(cv2.imread(args.composite), cv2.COLOR_BGR2RGB)
    raw = cv2.cvtColor(cv2.imread(args.raw), cv2.COLOR_BGR2RGB)
    reference = cv2.cvtColor(cv2.imread(args.reference), cv2.COLOR_BGR2RGB)

    plate_box, _, _, plate_how = locate(cv2.cvtColor(composite, cv2.COLOR_RGB2BGR))
    raw_box, _, _, raw_how = locate(cv2.cvtColor(raw, cv2.COLOR_RGB2BGR))
    ref_box, _, _, ref_how = locate(cv2.cvtColor(reference, cv2.COLOR_RGB2BGR))
    if plate_box is None or raw_box is None or ref_box is None:
        print(json.dumps({"error": "a face was not found in one of the three images",
                          "composite_face": plate_box is not None,
                          "raw_face": raw_box is not None,
                          "reference_face": ref_box is not None}))
        return 1

    # Measure on a HARD ellipse: the restore blends through a feathered one, and a feathered edge has
    # no line to measure. A seam, if there is one, is a step on the hard boundary.
    band = max(3, int(plate_box[2] * 0.05))
    hard, _ = zoned_mask(composite.shape, plate_box, grow=1.16, feather=0.0)
    boundary = _boundary_ring(hard, max(2, int(plate_box[2] * 0.01)))
    just_outside = cv2.subtract(cv2.dilate(hard, np.ones((band * 2 + 1, band * 2 + 1), np.uint8)), hard)

    edge_on_boundary = _gradient_energy(composite, boundary)
    edge_outside = _gradient_energy(composite, just_outside)
    seam_ratio = edge_on_boundary / edge_outside if edge_outside else 0.0

    inner = cv2.erode(hard, np.ones((band * 2 + 1, band * 2 + 1), np.uint8))
    sharp_patch = _sharpness(composite, inner)
    sharp_plate = _sharpness(composite, just_outside)
    sharp_ratio = sharp_patch / sharp_plate if sharp_plate else 0.0

    lab_in, lab_out = _mean_lab(composite, inner), _mean_lab(composite, just_outside)
    ring_delta = float(np.linalg.norm(np.array(lab_in) - np.array(lab_out)))

    # Head mismatch: where the model put its head versus where the photo's face was pasted.
    plate_area, raw_area = plate_box[2] * plate_box[3], raw_box[2] * raw_box[3]
    scale = (plate_area / raw_area) ** 0.5 if raw_area else 0.0
    plate_centre = (plate_box[0] + plate_box[2] / 2, plate_box[1] + plate_box[3] / 2)
    raw_centre = (raw_box[0] + raw_box[2] / 2, raw_box[1] + raw_box[3] / 2)
    shift = float(np.hypot(plate_centre[0] - raw_centre[0], plate_centre[1] - raw_centre[1]) / plate_box[2])

    report = {
        "composite": args.composite,
        "faces": {"composite": plate_box, "raw_plate": raw_box, "reference": ref_box},
        "seam": {"on_boundary": round(edge_on_boundary, 2), "outside": round(edge_outside, 2), "ratio": round(seam_ratio, 2),
                 "verdict": "visible cut" if seam_ratio > 1.35 else "ok"},
        "sharpness": {"patch": round(sharp_patch, 1), "plate": round(sharp_plate, 1), "ratio": round(sharp_ratio, 2),
                      "verdict": "pasted (patch far sharper)" if sharp_ratio > 2.2 else "ok"},
        "ring_light": {"inside": lab_in, "outside": lab_out, "delta": round(ring_delta, 2),
                       "verdict": "face reads clearly against its surroundings" if ring_delta > 15 else "flat — the face does not stand out"},
        "head": {"plate_face": plate_box, "pasted_face": raw_box, "scale": round(scale, 2),
                 "centre_shift_frac": round(shift, 3),
                 "verdict": "head does not match the paste" if (scale < 0.75 or scale > 1.35 or shift > 0.12) else "ok"},
    }
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"seam      {report['seam']['ratio']}  ({report['seam']['verdict']})")
        print(f"sharpness {report['sharpness']['ratio']}  ({report['sharpness']['verdict']})")
        print(f"ring      {report['ring_light']['delta']}  ({report['ring_light']['verdict']})")
        print(f"head      scale {report['head']['scale']} shift {report['head']['centre_shift_frac']}  ({report['head']['verdict']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
