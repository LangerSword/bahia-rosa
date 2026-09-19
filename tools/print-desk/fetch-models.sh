#!/usr/bin/env bash
# Print desk — model fetch.
#
# Brings the local (offline) plate generator online: FLUX.2 [klein] 4B, the same model family
# the hosted route used, but run on your own GPU. Apache-2.0 for the 4B weights; no account,
# no API key, no quota.
#
#   ./tools/print-desk/fetch-models.sh            # ~7 GB: fp8 diffusion + fp4 text encoder + VAE
#   ./tools/print-desk/fetch-models.sh --gguf     # also fetch the Q4_K_M GGUF (~2.6 GB) for 6-8 GB cards
#
# On an 8 GB card: try fp8 first; if ComfyUI runs out of memory, switch the diffusion model to
# the GGUF build (needs the ComfyUI-GGUF custom node, also installed by --gguf).
set -euo pipefail

COMFY="${COMFY_DIR:-$HOME/comfy/ComfyUI}"
HF="${HF_BIN:-$HOME/.venv/bin/hf}"

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }

say "ComfyUI at $COMFY"
[ -d "$COMFY/models" ] || { echo "no ComfyUI models dir at $COMFY (set COMFY_DIR)"; exit 1; }

mkdir -p "$COMFY/models/diffusion_models" "$COMFY/models/text_encoders" "$COMFY/models/vae"

say "diffusion model — FLUX.2 [klein] 4B fp8 (4.1 GB, distilled 4-step)"
"$HF" download black-forest-labs/FLUX.2-klein-4b-fp8 flux-2-klein-4b-fp8.safetensors \
  --local-dir "$COMFY/models/diffusion_models" --quiet

say "text encoder — Qwen3-4B fp4 (3.9 GB)"
"$HF" download Comfy-Org/vae-text-encorder-for-flux-klein-4b \
  split_files/text_encoders/qwen_3_4b_fp4_flux2.safetensors \
  --local-dir /tmp/klein-te --quiet
mv -f /tmp/klein-te/split_files/text_encoders/qwen_3_4b_fp4_flux2.safetensors "$COMFY/models/text_encoders/"

say "vae — flux2-vae (0.3 GB)"
"$HF" download Comfy-Org/vae-text-encorder-for-flux-klein-4b \
  split_files/vae/flux2-vae.safetensors \
  --local-dir /tmp/klein-vae --quiet
mv -f /tmp/klein-vae/split_files/vae/flux2-vae.safetensors "$COMFY/models/vae/"

if [ "${1:-}" = "--gguf" ]; then
  say "GGUF build — Q4_K_M (2.6 GB) for tight VRAM"
  "$HF" download unsloth/FLUX.2-klein-4B-GGUF flux-2-klein-4b-Q4_K_M.gguf \
    --local-dir "$COMFY/models/diffusion_models" --quiet

  say "ComfyUI-GGUF custom node"
  mkdir -p "$COMFY/custom_nodes"
  [ -d "$COMFY/custom_nodes/ComfyUI-GGUF" ] || \
    git clone --depth 1 https://github.com/city96/ComfyUI-GGUF "$COMFY/custom_nodes/ComfyUI-GGUF"
  echo "   note: the GGUF node needs its python deps — run:"
  echo "   $COMFY/../venv/bin/pip install -r $COMFY/custom_nodes/ComfyUI-GGUF/requirements.txt"
fi

say "done — models in place:"
ls -lh "$COMFY/models/diffusion_models" "$COMFY/models/text_encoders" "$COMFY/models/vae" | grep -v '^total' || true
