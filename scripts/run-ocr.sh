#!/usr/bin/env bash
# Starts the local PaddleOCR service (http://127.0.0.1:4200 by default).
cd "$(dirname "$0")/.."
if [ ! -x .venv-ocr/bin/python ]; then
  echo "[ocr] The OCR service is not installed. Run 'npm run ocr:setup' once; PDF/image OCR is unavailable until then." >&2
  exit 1
fi
exec .venv-ocr/bin/python -m ocr_service
