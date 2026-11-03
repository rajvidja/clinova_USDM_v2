#!/usr/bin/env bash
# One-time setup of the local PaddleOCR service: Python venv (.venv-ocr), dependencies and models (models/paddlex).
# After this, OCR runs fully offline.
#   OCR_PYTHON=python3.12   interpreter to use (PaddlePaddle supports Python 3.9–3.13)
#   OCR_GPU=cu126           install the CUDA 12.6 GPU build of PaddlePaddle instead of the CPU build (Linux/Windows + NVIDIA)
set -euo pipefail
cd "$(dirname "$0")/.."

PY="${OCR_PYTHON:-}"
if [ -z "$PY" ]; then
  for c in python3.12 python3.11 python3.13 python3.10 python3; do
    if command -v "$c" >/dev/null 2>&1; then PY="$c"; break; fi
  done
fi
[ -n "$PY" ] || { echo "No Python 3 interpreter found. Install Python 3.10–3.13 and retry." >&2; exit 1; }
echo "Using $($PY --version) at $(command -v "$PY")"

if command -v uv >/dev/null 2>&1; then
  [ -d .venv-ocr ] || uv venv --python "$(command -v "$PY")" .venv-ocr
  PIP=(uv pip install --python .venv-ocr/bin/python)
else
  [ -d .venv-ocr ] || "$PY" -m venv .venv-ocr
  .venv-ocr/bin/python -m pip install --upgrade pip
  PIP=(.venv-ocr/bin/python -m pip install)
fi

if [ -n "${OCR_GPU:-}" ]; then
  "${PIP[@]}" "paddlepaddle-gpu==3.2.0" --index-url "https://www.paddlepaddle.org.cn/packages/stable/${OCR_GPU}/"
  grep -v '^paddlepaddle==' ocr_service/requirements.txt > /tmp/protocoliq-ocr-req.txt
  "${PIP[@]}" -r /tmp/protocoliq-ocr-req.txt
else
  "${PIP[@]}" -r ocr_service/requirements.txt
fi

.venv-ocr/bin/python -m ocr_service.download_models
echo "OCR service ready. Start everything with: npm run dev"
