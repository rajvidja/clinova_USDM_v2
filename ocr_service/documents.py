"""Opening source documents, page classification (digital / scanned / mixed) and page rendering."""

from __future__ import annotations

import io
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

import pymupdf as fitz
import numpy as np
from PIL import Image, ImageSequence

from . import config

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".tif", ".tiff"}


class DocumentError(Exception):
    pass


def safe_path(p: str | Path) -> Path:
    path = Path(p).resolve()
    if path != config.DATA_ROOT and config.DATA_ROOT not in path.parents:
        raise DocumentError(f"Path is outside the ProtocolIQ data directory: {path}")
    return path


@dataclass
class PageInfo:
    page: int
    classification: str  # digital | scanned | mixed
    text_chars: int
    image_coverage: float
    invisible_text_ratio: float


class SourceDocument:
    """Uniform page access for PDFs and (multi-frame) images."""

    def __init__(self, path: Path):
        self.path = path
        self.ext = path.suffix.lower()
        self.kind = "image" if self.ext in IMAGE_EXTS else "pdf"
        self._pdf: fitz.Document | None = None
        self._frames: list[Image.Image] | None = None
        try:
            if self.kind == "pdf":
                self._pdf = fitz.open(path)
                if self._pdf.needs_pass:
                    raise DocumentError("The PDF is password-protected. Remove the password and upload it again.")
                if self._pdf.page_count == 0:
                    raise DocumentError("The PDF has no pages.")
            else:
                img = Image.open(path)
                self._frames = [f.copy() for f in ImageSequence.Iterator(img)] if getattr(img, "n_frames", 1) > 1 else [img.copy()]
                img.close()
        except DocumentError:
            raise
        except Exception as e:  # corrupt / unreadable file
            raise DocumentError(f"Could not open the document: {e}") from e

    @property
    def page_count(self) -> int:
        return self._pdf.page_count if self._pdf is not None else len(self._frames or [])

    @property
    def pdf(self) -> fitz.Document:
        assert self._pdf is not None
        return self._pdf

    def close(self) -> None:
        if self._pdf is not None:
            self._pdf.close()
        self._frames = None

    # ----- geometry -----

    def page_size(self, page: int) -> tuple[float, float, str]:
        if self._pdf is not None:
            r = self._pdf[page - 1].rect
            return float(r.width), float(r.height), "pt"
        f = self._frames[page - 1]  # type: ignore[index]
        return float(f.width), float(f.height), "px"

    # ----- classification -----

    def classify(self, page: int) -> PageInfo:
        if self._pdf is None:
            return PageInfo(page, "scanned", 0, 1.0, 0.0)
        p = self._pdf[page - 1]
        area = abs(p.rect) or 1.0
        text = p.get_text("text")
        chars = sum(1 for c in text if not c.isspace())

        invisible = 0
        total = 0
        try:
            for span in p.get_texttrace():
                n = len(span.get("chars", ()))
                total += n
                if span.get("type") == 3 or span.get("opacity", 1) == 0:  # render mode 3 = invisible (OCR layer)
                    invisible += n
        except Exception:
            pass
        invisible_ratio = invisible / total if total else 0.0

        coverage = 0.0
        for info in p.get_image_info():
            r = fitz.Rect(info["bbox"]) & p.rect
            if not r.is_empty:
                coverage += abs(r) / area
        coverage = min(1.0, coverage)

        if chars < config.MIN_NATIVE_CHARS or invisible_ratio > 0.8:
            blank = coverage < 0.05 and len(p.get_drawings()) < 20 and invisible_ratio <= 0.8
            cls = "digital" if blank else "scanned"
        elif coverage >= config.MIXED_IMAGE_COVERAGE:
            cls = "mixed"
        else:
            cls = "digital"
        return PageInfo(page, cls, chars, round(coverage, 3), round(invisible_ratio, 3))

    # ----- rendering -----

    def render(self, page: int, dpi: int, clip: fitz.Rect | None = None) -> np.ndarray:
        """RGB uint8 array of the page (or a clip of it, in PDF points)."""
        if self._pdf is not None:
            pix = self._pdf[page - 1].get_pixmap(dpi=dpi, clip=clip, colorspace=fitz.csRGB, alpha=False)
            return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).copy()
        img = self._frames[page - 1].convert("RGB")  # type: ignore[index]
        if clip is not None:
            img = img.crop((int(clip.x0), int(clip.y0), int(clip.x1), int(clip.y1)))
        return np.asarray(img).copy()

    def render_scale(self, dpi: int) -> float:
        """Pixels per page unit for render()."""
        return dpi / 72.0 if self._pdf is not None else 1.0


@contextmanager
def open_document(path: str | Path) -> Iterator[SourceDocument]:
    doc = SourceDocument(safe_path(path))
    try:
        yield doc
    finally:
        doc.close()


def save_png(arr: np.ndarray, out: Path, max_width: int | None = None) -> tuple[int, int]:
    img = Image.fromarray(arr)
    if max_width and img.width > max_width:
        img = img.resize((max_width, round(img.height * max_width / img.width)), Image.LANCZOS)
    out.parent.mkdir(parents=True, exist_ok=True)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    tmp = out.with_suffix(".tmp")
    tmp.write_bytes(buf.getvalue())
    tmp.replace(out)
    return img.width, img.height


def preview_path(work_dir: Path, page: int) -> Path:
    return work_dir / "preview" / f"page-{page:04d}.png"


def render_preview(doc: SourceDocument, work_dir: Path, page: int) -> Path:
    out = preview_path(work_dir, page)
    if not out.exists():
        dpi = config.PREVIEW_DPI if doc.kind == "pdf" else 72
        save_png(doc.render(page, dpi), out, max_width=1400)
    return out
