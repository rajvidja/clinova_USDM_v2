"""ProtocolIQ OCR service (FastAPI). Internal API used by the Node backend; binds to localhost by default.

Run:  .venv-ocr/bin/python -m ocr_service
"""

from __future__ import annotations

import logging
import sys
import threading
import time
from typing import Any

from . import config

config.configure_paddle_env()

from fastapi import FastAPI, HTTPException  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from .documents import DocumentError  # noqa: E402
from .engine import ENGINE, PROFILES, resolve_device, versions  # noqa: E402
from .jobs import JobManager, inspect, render  # noqa: E402

logging.basicConfig(level=logging.INFO, stream=sys.stdout, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("ocr")

app = FastAPI(title="ProtocolIQ OCR service", version="1.0")
jobs = JobManager()
STARTED = time.time()
WARM = threading.Event()


def _warm_up() -> None:
    """Import PaddlePaddle and resolve the device in the background (the first import takes tens of seconds)."""
    try:
        log.info("Inference device: %s", resolve_device())
    except Exception as e:
        log.error("Device check failed: %s", e)
    WARM.set()


threading.Thread(target=_warm_up, name="ocr-warmup", daemon=True).start()


class InspectRequest(BaseModel):
    document_id: str
    file_path: str
    work_dir: str


class RenderRequest(BaseModel):
    file_path: str
    work_dir: str
    page: int = Field(ge=1)


class JobRequest(BaseModel):
    document_id: str
    document_name: str
    mime_type: str
    file_path: str
    work_dir: str
    options: dict[str, Any] = {}


def _models_present() -> list[str]:
    root = config.MODELS_DIR / "official_models"
    return sorted(p.name for p in root.iterdir() if p.is_dir()) if root.exists() else []


@app.get("/health")
def health() -> dict[str, Any]:
    device, device_error = None, None
    if WARM.is_set():
        try:
            device = resolve_device()
        except RuntimeError as e:
            device_error = str(e)
    return {
        "ok": device_error is None,
        "warming": not WARM.is_set(),
        "uptimeSeconds": round(time.time() - STARTED),
        "device": device,
        "deviceError": device_error,
        "configuredDevice": config.DEVICE,
        "profile": config.MODEL_PROFILE,
        "textModels": PROFILES.get(config.MODEL_PROFILE),
        "modelsDir": str(config.MODELS_DIR),
        "modelsDownloaded": _models_present(),
        "pipelinesLoaded": ENGINE.loaded(),
        "activeJobs": jobs.active(),
        "versions": versions(),
    }


@app.post("/inspect")
def inspect_document(req: InspectRequest) -> dict[str, Any]:
    try:
        return inspect(req.file_path, req.work_dir)
    except DocumentError as e:
        raise HTTPException(422, str(e)) from e


@app.post("/render")
def render_page(req: RenderRequest) -> dict[str, Any]:
    try:
        return {"path": str(render(req.file_path, req.work_dir, req.page))}
    except DocumentError as e:
        raise HTTPException(422, str(e)) from e


@app.post("/jobs", status_code=202)
def submit(req: JobRequest) -> dict[str, Any]:
    opts = req.options or {}
    if opts.get("mode") not in (None, "structure", "text"):
        raise HTTPException(400, "mode must be 'structure' or 'text'")
    if opts.get("device"):
        try:
            resolve_device(opts["device"])
        except RuntimeError as e:
            raise HTTPException(400, str(e)) from e
    try:
        return jobs.submit(req.document_id, req.document_name, req.mime_type, req.file_path, req.work_dir, opts)
    except DocumentError as e:
        raise HTTPException(422, str(e)) from e


@app.get("/jobs/{document_id}")
def job_status(document_id: str) -> dict[str, Any]:
    status = jobs.get(document_id)
    if status is None:
        raise HTTPException(404, "No job for this document in the running service")
    return status


@app.delete("/jobs/{document_id}")
def cancel(document_id: str) -> dict[str, Any]:
    status = jobs.cancel(document_id)
    if status is None:
        raise HTTPException(404, "No job for this document in the running service")
    return status
