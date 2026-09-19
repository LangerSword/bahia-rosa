#!/usr/bin/env python3
"""The judge — a local vision model that looks at a plate and scores it against a rubric.

    python3 tools/print-desk/judge.py plate.png [--reference photo.jpg] [--expect-portrait]

Why this exists: the numeric critic (critique.py) can only catch broken frames. It scored a plate
the human called "shitty" at 0.877 — exposure, contrast and entropy were all in band, because those
numbers cannot see that a face drifted or a lighting idea failed. A vision model can. This is the
harness's real quality gate; critique.py stays as the cheap pre-filter.

Output: one JSON object with per-axis scores and a short note per axis, so the harness can both rank
candidates and print a reason a human can argue with.
"""

import argparse
import json
import re
import sys

import torch
from PIL import Image
from transformers import AutoProcessor, Qwen2_5_VLForConditionalGeneration

MODEL_DIR = "/home/lakshaya/models/qwen2.5-vl-3b"

RUBRIC = """You are judging one image for a game-styled character portrait pipeline.
{reference_note}
Score each axis from 0 to 10 and reply with JSON only, no prose outside the JSON:

{{
  "identity": <how clearly this is the same person as in the reference; 0 if no clear single face>,
  "lighting": <is the light on the face clean and believable: shape, direction, rim, no blown or muddy patches>,
  "background": <is the background a deliberate, uncluttered, out-of-focus city or studio setting rather than noise or mush>,
  "composition": <head-and-shoulders framing, subject well placed, nothing oddly cropped>,
  "artifacts": <10 = clean; lower for warped features, extra limbs, melted hands, smears, text-like gibberish>,
  "notes": "<one short sentence naming the single worst problem>"
}}
"""


def build_prompt(reference_path):
    if reference_path:
        note = "The first image is the reference photo. The second image is the generated plate made from it."
    else:
        note = "There is one generated plate."
    return RUBRIC.format(reference_note=note)


def parse(text):
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        return {"raw": text.strip()[:400], "parse_error": True}
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return {"raw": match.group(0)[:400], "parse_error": True}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("plate")
    parser.add_argument("--reference")
    parser.add_argument("--expect-portrait", action="store_true")
    parser.add_argument("--model", default=MODEL_DIR)
    parser.add_argument("--max-new-tokens", type=int, default=220)
    args = parser.parse_args()

    images = []
    if args.reference:
        images.append(Image.open(args.reference).convert("RGB"))
    images.append(Image.open(args.plate).convert("RGB"))

    processor = AutoProcessor.from_pretrained(args.model)
    model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
        args.model, torch_dtype=torch.float16, device_map="cuda"
    )
    model.eval()

    content = [{"type": "image"} for _ in images]
    content.append({"type": "text", "text": build_prompt(args.reference)})
    messages = [{"role": "user", "content": content}]
    text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = processor(text=[text], images=images, return_tensors="pt").to("cuda")

    with torch.inference_mode():
        output = model.generate(**inputs, max_new_tokens=args.max_new_tokens, do_sample=False)
    reply = processor.batch_decode(output[:, inputs["input_ids"].shape[1] :], skip_special_tokens=True)[0]

    verdict = parse(reply)
    axes = ["identity", "lighting", "background", "composition", "artifacts"]
    scored = [verdict.get(axis) for axis in axes if isinstance(verdict.get(axis), (int, float))]
    verdict["mean"] = round(sum(scored) / len(scored), 2) if scored else 0.0
    verdict["file"] = args.plate
    verdict["model"] = args.model
    json.dump(verdict, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
