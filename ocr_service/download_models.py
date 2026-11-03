"""Download and verify all PaddleOCR models into OCR_MODELS_DIR so later runs work offline.

Run:  .venv-ocr/bin/python -m ocr_service.download_models
"""

from __future__ import annotations

import os
import sys
import time

from . import config

# Downloads need the model-host check; never skip it here.
os.environ.pop("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", None)
os.environ["OCR_OFFLINE"] = "0"
config.configure_paddle_env()

import numpy as np  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

from .engine import ENGINE, resolve_device  # noqa: E402


def main() -> int:
    device = resolve_device()
    print(f"Models directory: {config.MODELS_DIR}\nDevice: {device}\nProfile: {config.MODEL_PROFILE}")
    img = Image.new("RGB", (900, 400), "white")
    d = ImageDraw.Draw(img)
    d.text((40, 30), "1. INTRODUCTION", fill="black")
    d.text((40, 70), "ProtocolIQ OCR model check.", fill="black")
    for i in range(4):
        d.line((40, 140 + i * 50, 860, 140 + i * 50), fill="black")
    for x in (40, 300, 580, 860):
        d.line((x, 140, x, 290), fill="black")
    arr = np.asarray(img)
    for name, run in (("PP-OCRv5 text", ENGINE.run_text), ("PP-StructureV3 layout/table", ENGINE.run_structure)):
        t = time.time()
        print(f"Loading {name} …", flush=True)
        run(arr, device)
        print(f"  ok ({time.time() - t:.1f}s)")
    models = sorted(p.name for p in (config.MODELS_DIR / "official_models").iterdir())
    print(f"{len(models)} models available offline:\n  " + "\n  ".join(models))
    return 0


if __name__ == "__main__":
    sys.exit(main())
