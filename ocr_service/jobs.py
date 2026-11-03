"""Background OCR jobs: page-by-page processing, progress/status files, result assembly."""

from __future__ import annotations

import gc
import json
import logging
import queue
import re
import threading
import time
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from . import config
from .documents import DocumentError, SourceDocument, open_document, preview_path, render_preview, safe_path
from .engine import ENGINE, PROFILES, mean_score, resolve_device, versions
from .native import extract_native, font_stats
from .ocr_page import from_structure, from_text_lines
from .tables import CAPTION_RE, TABLE_REF_RE, caption_number, classify_table

log = logging.getLogger("ocr.jobs")

SCHEMA_VERSION = 1
MAX_OCR_SIDE = 3200  # px; very large scans are downscaled before inference

DEFAULT_OPTIONS = {"mode": "structure", "dpi": config.RENDER_DPI, "force_ocr": False, "ocr_embedded_images": True, "auto_rotate": False, "device": None}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1))
    tmp.replace(path)


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return None


@dataclass
class Job:
    document_id: str
    document_name: str
    mime_type: str
    file_path: Path
    work_dir: Path
    options: dict[str, Any]
    cancel: threading.Event = field(default_factory=threading.Event)
    status: dict[str, Any] = field(default_factory=dict)

    def update(self, **kw: Any) -> None:
        self.status.update(kw, updatedAt=now())
        write_json(self.work_dir / "status.json", self.status)


class JobManager:
    def __init__(self) -> None:
        self._queue: queue.Queue[Job] = queue.Queue()
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._worker = threading.Thread(target=self._run, name="ocr-worker", daemon=True)
        self._worker.start()

    def submit(self, document_id: str, document_name: str, mime_type: str, file_path: str, work_dir: str, options: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            existing = self._jobs.get(document_id)
            if existing and existing.status.get("status") in ("queued", "processing"):
                return existing.status
            opts = {**DEFAULT_OPTIONS, **{k: v for k, v in (options or {}).items() if k in DEFAULT_OPTIONS}}
            job = Job(document_id, document_name, mime_type, safe_path(file_path), safe_path(work_dir), opts)
            job.status = {
                "documentId": document_id,
                "status": "queued",
                "stage": "queued",
                "message": f"Waiting in queue ({self._queue.qsize()} ahead)",
                "pagesDone": 0,
                "pageCount": 0,
                "currentPage": None,
                "pageErrors": [],
                "startedAt": None,
                "updatedAt": now(),
                "finishedAt": None,
            }
            job.update()
            self._jobs[document_id] = job
            self._queue.put(job)
            return job.status

    def get(self, document_id: str) -> dict[str, Any] | None:
        job = self._jobs.get(document_id)
        return job.status if job else None

    def cancel(self, document_id: str) -> dict[str, Any] | None:
        job = self._jobs.get(document_id)
        if not job:
            return None
        job.cancel.set()
        if job.status.get("status") == "queued":
            job.update(status="cancelled", stage="cancelled", message="Cancelled before processing started", finishedAt=now())
        return job.status

    def active(self) -> list[dict[str, Any]]:
        return [j.status for j in self._jobs.values() if j.status.get("status") in ("queued", "processing")]

    def _run(self) -> None:
        while True:
            job = self._queue.get()
            if job.cancel.is_set():
                continue
            handler = _job_log_handler(job.work_dir)
            logging.getLogger("ocr").addHandler(handler)
            try:
                process(job)
            except Exception as e:  # never let the worker die
                log.error("Job %s failed: %s\n%s", job.document_id, e, traceback.format_exc())
                job.update(status="failed", stage="failed", message=str(e) or e.__class__.__name__, finishedAt=now())
            finally:
                logging.getLogger("ocr").removeHandler(handler)
                handler.close()
                gc.collect()


def _job_log_handler(work_dir: Path) -> logging.Handler:
    work_dir.mkdir(parents=True, exist_ok=True)
    h = logging.FileHandler(work_dir / "process.log", encoding="utf-8")
    h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    return h


# ---------------------------------------------------------------- inspection


def inspect(file_path: str, work_dir: str) -> dict[str, Any]:
    with open_document(file_path) as doc:
        pages = []
        for p in range(1, doc.page_count + 1):
            info = doc.classify(p)
            pages.append({"page": p, "classification": info.classification, "textChars": info.text_chars, "imageCoverage": info.image_coverage, "image": f"preview/page-{p:04d}.png"})
        result = {"pageCount": doc.page_count, "kind": doc.kind, "pages": pages}
    write_json(safe_path(work_dir) / "inspection.json", result)
    return result


def render(file_path: str, work_dir: str, page: int) -> Path:
    with open_document(file_path) as doc:
        if not 1 <= page <= doc.page_count:
            raise DocumentError(f"Page {page} does not exist (document has {doc.page_count} pages)")
        return render_preview(doc, safe_path(work_dir), page)


# ---------------------------------------------------------------- processing


def _options_key(opts: dict[str, Any]) -> str:
    return json.dumps({k: opts[k] for k in ("mode", "dpi", "force_ocr", "ocr_embedded_images", "auto_rotate")} | {"profile": config.MODEL_PROFILE, "schema": SCHEMA_VERSION}, sort_keys=True)


def _downscale(arr: np.ndarray) -> tuple[np.ndarray, float]:
    h, w = arr.shape[:2]
    side = max(h, w)
    if side <= MAX_OCR_SIDE:
        return arr, 1.0
    f = MAX_OCR_SIDE / side
    img = Image.fromarray(arr).resize((round(w * f), round(h * f)), Image.LANCZOS)
    return np.asarray(img), f


def process(job: Job) -> None:
    opts = job.options
    key = _options_key(opts)
    pages_dir = job.work_dir / "pages"
    started = time.time()
    job.update(status="processing", stage="opening", message="Opening document", startedAt=now(), pageErrors=[])
    log.info("Processing %s (%s) options=%s", job.document_name, job.document_id, opts)

    with open_document(job.file_path) as doc:
        n = doc.page_count
        if n > config.MAX_PAGES:
            raise DocumentError(f"The document has {n} pages; the configured limit is {config.MAX_PAGES} (OCR_MAX_PAGES).")
        job.update(pageCount=n, stage="classifying", message="Detecting digital and scanned pages")
        infos = [doc.classify(p) for p in range(1, n + 1)]
        digital = [i.page for i in infos if i.classification != "scanned"]
        stats = font_stats(doc, digital) if doc.kind == "pdf" and digital else {"body": 10.0}
        needs_models = doc.kind == "image" or opts["force_ocr"] or any(i.classification != "digital" for i in infos)
        device = resolve_device(opts.get("device"))
        if needs_models:
            job.update(stage="loading_models", message=f"Loading PaddleOCR models on {device} (first run downloads them once)")
            (ENGINE.structure if opts["mode"] == "structure" else ENGINE.text)(device)

        page_errors: list[dict[str, Any]] = []
        for p in range(1, n + 1):
            if job.cancel.is_set():
                job.update(status="cancelled", stage="cancelled", message=f"Cancelled after {p - 1} of {n} pages", finishedAt=now())
                return
            info = infos[p - 1]
            cache_file = pages_dir / f"page-{p:04d}.json"
            cached = read_json(cache_file)
            if cached and cached.get("optionsKey") == key and not cached["page"].get("error"):
                job.update(pagesDone=p, currentPage=p, stage="cached", message=f"Page {p} of {n} reused from a previous run")
                continue
            use_ocr = doc.kind == "image" or opts["force_ocr"] or info.classification == "scanned"
            job.update(currentPage=p, stage="ocr" if use_ocr else "native", message=f"Page {p} of {n}: {'PaddleOCR' if use_ocr else 'native PDF text'}")
            t0 = time.time()
            width, height, unit = doc.page_size(p)
            page_rec: dict[str, Any] = {
                "page": p, "width": round(width, 2), "height": round(height, 2), "unit": unit,
                "method": "ocr" if use_ocr else "native", "classification": info.classification,
                "textChars": info.text_chars, "imageCoverage": info.image_coverage,
                "image": None, "imageWidth": None, "imageHeight": None, "meanConfidence": None, "durationMs": 0, "rotation": 0, "error": None,
            }
            elements: list[dict[str, Any]] = []
            try:
                angle = 0
                if use_ocr:
                    arr = doc.render(p, opts["dpi"])
                    arr, f = _downscale(arr)
                    scale = doc.render_scale(opts["dpi"]) * f
                    if opts["mode"] == "structure":
                        res, angle = ENGINE.run_structure(arr, device, bool(opts["auto_rotate"]))
                        elements, conf = from_structure(res, scale)
                    else:
                        lines = ENGINE.run_text(arr, device)
                        elements, conf = from_text_lines(lines, scale), mean_score(lines)
                    page_rec["meanConfidence"] = conf
                    del arr
                else:
                    ocr_fn = (lambda a: ENGINE.run_text(a, device)) if opts["ocr_embedded_images"] else None
                    elements, meta = extract_native(doc, p, stats, ocr_fn, opts["ocr_embedded_images"], opts["dpi"])
                    page_rec["method"] = meta["method"]
                prev = render_preview(doc, job.work_dir, p)
                if angle:
                    # Coordinates refer to the upright page, so store the page (and its preview) upright as well.
                    page_rec["rotation"] = angle
                    if angle in (90, 270):
                        page_rec["width"], page_rec["height"] = page_rec["height"], page_rec["width"]
                    rotated = prev.with_name(f"{prev.stem}-r{angle}.png")
                    with Image.open(prev) as im:
                        im.rotate(angle, expand=True).save(rotated)
                    prev = rotated
                with Image.open(prev) as im:
                    page_rec["image"], page_rec["imageWidth"], page_rec["imageHeight"] = str(prev.relative_to(job.work_dir)), im.width, im.height
            except Exception as e:
                log.error("Page %s failed: %s\n%s", p, e, traceback.format_exc())
                page_rec["error"] = f"{e.__class__.__name__}: {e}"
                page_errors.append({"page": p, "error": page_rec["error"]})
                elements = []
            page_rec["durationMs"] = round((time.time() - t0) * 1000)
            write_json(cache_file, {"optionsKey": key, "page": page_rec, "elements": elements})
            log.info("Page %s/%s %s: %s elements in %sms", p, n, page_rec["method"], len(elements), page_rec["durationMs"])
            job.update(pagesDone=p, pageErrors=page_errors)
            gc.collect()

        job.update(stage="assembling", message="Assembling structured output")
        pages, elements = [], []
        for p in range(1, n + 1):
            rec = read_json(pages_dir / f"page-{p:04d}.json") or {"page": {"page": p, "error": "missing"}, "elements": []}
            pages.append(rec["page"])
            elements.append(rec["elements"])
        result = assemble(job, pages, elements, device)
        write_json(job.work_dir / "result.json", result)

    failed = [p for p in pages if p.get("error")]
    status = "failed" if failed and len(failed) == len(pages) else "completed_with_errors" if failed else "completed"
    elapsed = time.time() - started
    msg = f"Processed {n} page(s) in {elapsed:.1f}s" + (f"; {len(failed)} page(s) failed" if failed else "")
    log.info(msg)
    job.update(status=status, stage="done", message=msg, finishedAt=now(), currentPage=None)


# ---------------------------------------------------------------- document-level post-processing


def _norm(t: str) -> str:
    return re.sub(r"\d+", "#", re.sub(r"\s+", " ", t.strip().lower()))


def assemble(job: Job, pages: list[dict[str, Any]], per_page: list[list[dict[str, Any]]], device: str) -> dict[str, Any]:
    n = len(pages)
    # Repeated running headers/footers (same text in the top/bottom band of many pages).
    if n >= 3:
        counts: dict[str, int] = {}
        for p, els in zip(pages, per_page):
            for e in els:
                if e.get("bbox") and e["type"] in ("paragraph", "heading", "title", "other") and (e["bbox"][3] < p["height"] * 0.1 or e["bbox"][1] > p["height"] * 0.9):
                    counts[_norm(e["text"])] = counts.get(_norm(e["text"]), 0) + 1
        repeated = {k for k, v in counts.items() if v >= max(3, n * 0.5)}
        for p, els in zip(pages, per_page):
            for e in els:
                if e.get("bbox") and _norm(e.get("text", "")) in repeated:
                    e["type"] = "page_header" if e["bbox"][3] < p["height"] * 0.5 else "page_footer"

    elements: list[dict[str, Any]] = []
    for p, els in zip(pages, per_page):
        for i, e in enumerate(els):
            e.update(id=f"p{p['page']}-e{i}", documentId=job.document_id, documentName=job.document_name, page=p["page"], order=i)
            e.setdefault("level", None)
            e.setdefault("table", None)
            e.setdefault("imageText", None)
            e.setdefault("confidence", None)
            elements.append(e)

    _link_tables(elements)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "documentId": job.document_id,
        "documentName": job.document_name,
        "mimeType": job.mime_type,
        "pageCount": n,
        "pages": pages,
        "elements": elements,
        "engine": {
            "name": "PaddleOCR",
            "versions": versions(),
            "device": device,
            "profile": config.MODEL_PROFILE,
            "layoutPipeline": "PP-StructureV3" if job.options["mode"] == "structure" else None,
            "textModels": PROFILES.get(config.MODEL_PROFILE, PROFILES["balanced"]),
            "nativePdfText": "PyMuPDF",
        },
        "options": job.options,
        "createdAt": now(),
    }


def _link_tables(elements: list[dict[str, Any]]) -> None:
    by_page: dict[int, list[dict[str, Any]]] = {}
    for e in elements:
        by_page.setdefault(e["page"], []).append(e)
    numbers: dict[str, dict[str, Any]] = {}
    prev_last_table: dict[str, Any] | None = None

    for page in sorted(by_page):
        els = [e for e in by_page[page] if e["type"] not in ("page_header", "page_footer", "page_number")]
        for i, e in enumerate(els):
            t = e.get("table")
            if e["type"] != "table" or not t:
                continue
            before = els[i - 1] if i > 0 else None
            after = els[i + 1] if i + 1 < len(els) else None
            cap = before if before and before["type"] == "caption" and not re.match(r"^\s*fig", before["text"], re.I) else None
            if not cap and after and after["type"] == "caption" and re.match(r"^\s*table", after["text"], re.I):
                cap = after
            if not cap and before and before["type"] in ("paragraph", "heading") and CAPTION_RE.match(before["text"]) and len(before["text"]) < 300:
                cap = before
                cap["type"] = "caption"
            t["caption"] = cap["text"] if cap else t.get("caption")
            num = caption_number(t["caption"] or "")
            if num:
                numbers[num.lower()] = e
            for nxt in els[i + 1 :]:
                if nxt["type"] == "footnote":
                    t["footnoteIds"].append(nxt["id"])
                elif nxt["type"] == "caption" and nxt is cap:
                    continue
                else:
                    break
            if i == 0 and not cap and prev_last_table is not None and prev_last_table["table"]["cols"] == t["cols"]:
                t["continuedFrom"] = prev_last_table["id"]
            heading = next((x["text"] for x in reversed(els[:i]) if x["type"] in ("heading", "title")), "")
            t["kind"] = classify_table(t, t["caption"], heading)
        last_content = next((x for x in reversed(els) if x["type"] not in ("footnote",)), None)
        prev_last_table = last_content if last_content and last_content["type"] == "table" else None

    # Continuations inherit the type of the table they continue.
    by_id = {e["id"]: e for e in elements}
    for e in elements:
        t = e.get("table")
        if t and t.get("continuedFrom") and t["kind"] == "other":
            t["kind"] = by_id[t["continuedFrom"]]["table"]["kind"]

    if numbers:
        for e in elements:
            if e["type"] in ("table", "caption"):
                continue
            for m in TABLE_REF_RE.finditer(e.get("text") or ""):
                target = numbers.get(m.group(1).lower())
                if target and e["id"] not in target["table"]["referencedBy"]:
                    target["table"]["referencedBy"].append(e["id"])
