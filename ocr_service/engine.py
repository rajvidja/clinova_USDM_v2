"""PaddleOCR integration: PP-StructureV3 (layout + tables, with PP-OCRv5 inside) and PP-OCRv5 text-only OCR."""

from __future__ import annotations

import functools
import logging
import threading
import time
from statistics import mean
from typing import Any

import numpy as np

from . import config

config.configure_paddle_env()

log = logging.getLogger("ocr.engine")

PROFILES: dict[str, dict[str, str]] = {
    "balanced": {"text_detection_model_name": "PP-OCRv5_mobile_det", "text_recognition_model_name": "en_PP-OCRv5_mobile_rec"},
    "accurate": {"text_detection_model_name": "PP-OCRv5_server_det", "text_recognition_model_name": "PP-OCRv5_server_rec"},
}

STRUCTURE_FLAGS = dict(
    # Loaded so pages can be auto-rotated on request (enabled per call; see run_structure).
    use_doc_orientation_classify=True,
    use_doc_unwarping=False,
    use_textline_orientation=False,
    use_seal_recognition=False,
    use_formula_recognition=False,
    use_chart_recognition=False,
    use_table_recognition=True,
    use_region_detection=True,
)


@functools.lru_cache(maxsize=1)
def _gpu_available() -> bool:
    import paddle

    return bool(paddle.device.is_compiled_with_cuda() and paddle.device.cuda.device_count() > 0)


def resolve_device(requested: str | None = None) -> str:
    want = (requested or config.DEVICE or "auto").lower()
    has_gpu = _gpu_available()
    if want == "auto":
        return "gpu:0" if has_gpu else "cpu"
    if want.startswith("gpu"):
        if not has_gpu:
            raise RuntimeError("GPU inference was requested but this PaddlePaddle build has no CUDA GPU available. Use OCR_DEVICE=cpu or install paddlepaddle-gpu.")
        return want if ":" in want else "gpu:0"
    return "cpu"


class Engine:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._structure: dict[str, Any] = {}
        self._text: dict[str, Any] = {}

    def _common(self, device: str) -> dict[str, Any]:
        kw: dict[str, Any] = {"device": device, **PROFILES.get(config.MODEL_PROFILE, PROFILES["balanced"])}
        if device == "cpu":
            kw["cpu_threads"] = config.CPU_THREADS
        return kw

    def structure(self, device: str):
        with self._lock:
            if device not in self._structure:
                from paddleocr import PPStructureV3

                t = time.time()
                self._structure[device] = PPStructureV3(**self._common(device), **STRUCTURE_FLAGS)
                log.info("PP-StructureV3 loaded on %s in %.1fs", device, time.time() - t)
            return self._structure[device]

    def text(self, device: str):
        with self._lock:
            if device not in self._text:
                from paddleocr import PaddleOCR

                t = time.time()
                self._text[device] = PaddleOCR(
                    **self._common(device),
                    use_doc_orientation_classify=False,
                    use_doc_unwarping=False,
                    use_textline_orientation=False,
                )
                log.info("PP-OCRv5 loaded on %s in %.1fs", device, time.time() - t)
            return self._text[device]

    def loaded(self) -> dict[str, list[str]]:
        return {"structure": list(self._structure), "text": list(self._text)}

    # ----- inference -----

    def run_structure(self, rgb: np.ndarray, device: str, auto_rotate: bool = False) -> tuple[dict[str, Any], int]:
        """PP-StructureV3 on one page. Returns (result, angle); with auto_rotate the page may be rotated by
        `angle` degrees before analysis, and all coordinates then refer to the rotated image."""
        pipeline = self.structure(device)
        out = list(
            pipeline.predict(
                input=np.ascontiguousarray(rgb[:, :, ::-1]),  # PaddleX expects BGR arrays
                use_doc_orientation_classify=auto_rotate,
                # The table-orientation classifier can flip upright tables on noisy scans; rely on page rotation instead.
                use_table_orientation_classify=False,
            )
        )
        if not out:
            return {}, 0
        res = out[0].json["res"]
        angle = int((res.get("doc_preprocessor_res") or {}).get("angle") or 0) if auto_rotate else 0
        return res, angle % 360

    def run_text(self, rgb: np.ndarray, device: str) -> list[dict[str, Any]]:
        pipeline = self.text(device)
        out = list(pipeline.predict(input=np.ascontiguousarray(rgb[:, :, ::-1])))
        if not out:
            return []
        res = out[0].json["res"]
        return ocr_lines(res)


ENGINE = Engine()


def ocr_lines(ocr_res: dict[str, Any]) -> list[dict[str, Any]]:
    texts = ocr_res.get("rec_texts") or []
    scores = ocr_res.get("rec_scores") or []
    boxes = ocr_res.get("rec_boxes")
    if boxes is None or len(boxes) != len(texts):
        polys = ocr_res.get("rec_polys") or []
        boxes = [[min(p[0] for p in poly), min(p[1] for p in poly), max(p[0] for p in poly), max(p[1] for p in poly)] for poly in polys]
    lines = []
    for t, s, b in zip(texts, scores, boxes):
        if str(t).strip():
            lines.append({"text": str(t).strip(), "score": float(s), "bbox": [float(v) for v in list(b)[:4]]})
    return lines


def mean_score(lines: list[dict[str, Any]]) -> float | None:
    return round(mean(l["score"] for l in lines), 4) if lines else None


def versions() -> dict[str, str]:
    out: dict[str, str] = {}
    for mod in ("paddle", "paddleocr", "paddlex", "pymupdf"):
        try:
            m = __import__(mod)
            out[mod] = getattr(m, "__version__", None) or getattr(m, "VersionBind", "")
        except Exception as e:  # pragma: no cover
            out[mod] = f"unavailable ({e})"
    return out
