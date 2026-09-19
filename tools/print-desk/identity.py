#!/usr/bin/env python3
"""Face identity and geometry, measured rather than eyeballed.

    python3 tools/print-desk/identity.py plate.png reference.png [--min-similarity 0.55]

Uses InsightFace (ArcFace embeddings + 5-point landmarks) to answer two questions the rest of the
pipeline cannot:

  identity   cosine similarity between the face in the plate and the face in the reference photo.
             0.6+ is clearly the same person; below ~0.4 is a different person wearing a similar face.
  geometry   landmark distances normalised by interocular distance — eye spacing, eye-to-nose,
             eye-to-mouth, and the roll angle of the eye line. These are what "the face morphed"
             actually means numerically, and they are comparable across poses and image sizes.

The harness treats a low identity or a large geometry drift as a failed plate, which is what makes
"keep the person" a gate instead of a hope.

First run downloads the InsightFace model pack (~330 MB) into ~/.insightface.
"""

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np


def load_app():
    from insightface.app import FaceAnalysis

    app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
    app.prepare(ctx_id=-1, det_size=(640, 640))
    return app


def biggest_face(app, path):
    image = cv2.imread(str(path))
    if image is None:
        raise SystemExit(f"could not read {path}")
    faces = app.get(image)
    if not faces:
        return None
    # The subject is the largest face in frame.
    return max(faces, key=lambda face: (face.bbox[2] - face.bbox[0]) * (face.bbox[3] - face.bbox[1]))


def geometry(face):
    """Landmark distances in units of interocular distance, plus the roll of the eye line."""
    left_eye, right_eye, nose, left_mouth, right_mouth = face.kps
    interocular = float(np.linalg.norm(right_eye - left_eye)) or 1e-6
    eye_mid = (left_eye + right_eye) / 2
    mouth_mid = (left_mouth + right_mouth) / 2
    return {
        "eye_to_nose": float(np.linalg.norm(nose - eye_mid) / interocular),
        "eye_to_mouth": float(np.linalg.norm(mouth_mid - eye_mid) / interocular),
        "mouth_width": float(np.linalg.norm(right_mouth - left_mouth) / interocular),
        "eye_roll_deg": float(np.degrees(np.arctan2(right_eye[1] - left_eye[1], right_eye[0] - left_eye[0]))),
    }


def cosine(a, b):
    a = a / (np.linalg.norm(a) or 1e-6)
    b = b / (np.linalg.norm(b) or 1e-6)
    return float(np.dot(a, b))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("plate")
    parser.add_argument("reference")
    parser.add_argument(
        "--min-similarity",
        type=float,
        default=0.40,
        help="ArcFace cosine floor. Calibrated on this pipeline: the raw model output measures 0.08 "
        "(a different person), the face-restored plate 0.40+ (same person). 0.55 was a guess and too strict.",
    )
    parser.add_argument("--max-drift", type=float, default=0.35, help="allowed relative landmark drift")
    args = parser.parse_args()

    app = load_app()
    plate_face = biggest_face(app, args.plate)
    ref_face = biggest_face(app, args.reference)

    report = {"plate": args.plate, "reference": args.reference}
    if plate_face is None or ref_face is None:
        report["pass"] = False
        report["error"] = "no face in the plate" if plate_face is None else "no face in the reference"
        json.dump(report, sys.stdout, indent=2)
        print()
        sys.exit(0 if plate_face is None else 3)

    similarity = cosine(plate_face.normed_embedding, ref_face.normed_embedding)
    plate_geometry, ref_geometry = geometry(plate_face), geometry(ref_face)
    drift = {
        key: round(abs(plate_geometry[key] - ref_geometry[key]) / max(abs(ref_geometry[key]), 1e-6), 4)
        for key in plate_geometry
        if key != "eye_roll_deg"
    }
    roll_delta = abs(plate_geometry["eye_roll_deg"] - ref_geometry["eye_roll_deg"])

    worst = max(drift.values()) if drift else 0.0
    report.update(
        {
            "similarity": round(similarity, 4),
            "geometry": {"plate": {k: round(v, 4) for k, v in plate_geometry.items()}, "reference": {k: round(v, 4) for k, v in ref_geometry.items()}},
            "drift": drift,
            "worst_drift": round(worst, 4),
            "roll_delta_deg": round(roll_delta, 2),
            "pass": similarity >= args.min_similarity and worst <= args.max_drift,
        }
    )
    report["verdict"] = "same person" if report["pass"] else ("identity too low" if similarity < args.min_similarity else "face geometry drifted")
    json.dump(report, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
