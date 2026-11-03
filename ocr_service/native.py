"""Native text extraction for digitally generated PDF pages (no OCR)."""

from __future__ import annotations

import re
from collections import Counter
from statistics import mean
from typing import Any, Callable

import pymupdf as fitz

from . import config
from .documents import SourceDocument
from .layout import PAGE_NUMBER, heading_level, inside, is_list_item, looks_like_heading_text, rbox, xy_cut_order
from .tables import CAPTION_RE, FOOTNOTE_START, geometry_to_table

OcrLines = Callable[[Any], list[dict[str, Any]]]

BOLD_FLAG = 16


def font_stats(doc: SourceDocument, pages: list[int]) -> dict[str, float]:
    """Body font size estimated from character counts on (a sample of) the digital pages."""
    sizes: Counter[float] = Counter()
    for pno in pages[:40]:
        d = doc.pdf[pno - 1].get_text("dict")
        for b in d["blocks"]:
            for line in b.get("lines", []):
                for s in line["spans"]:
                    n = len(s["text"].strip())
                    if n:
                        sizes[round(s["size"], 1)] += n
    body = sizes.most_common(1)[0][0] if sizes else 10.0
    return {"body": float(body)}


def _spans(page: fitz.Page) -> list[dict[str, Any]]:
    out = []
    for b in page.get_text("dict")["blocks"]:
        if b.get("type") != 0:
            continue
        for line in b.get("lines", []):
            for s in line["spans"]:
                if not s["text"].strip():
                    continue
                bold = bool(s["flags"] & BOLD_FLAG) or bool(re.search(r"bold|black|heavy|semibold", s["font"], re.I))
                out.append({"text": s["text"], "bbox": list(s["bbox"]), "size": float(s["size"]), "bold": bold})
    return out


def _union(a: list[float], b: list[float]) -> list[float]:
    return [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]


def _lines(spans: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Group spans that share a baseline into visual lines. Generators that emit one span per word are handled;
    a large horizontal gap starts a new line so side-by-side columns are not merged."""
    spans = sorted(spans, key=lambda s: ((s["bbox"][1] + s["bbox"][3]) / 2, s["bbox"][0]))
    lines: list[dict[str, Any]] = []
    for s in spans:
        sb, sh = s["bbox"], s["bbox"][3] - s["bbox"][1]
        target = None
        for ln in reversed(lines[-8:]):
            lb = ln["bbox"]
            overlap = min(lb[3], sb[3]) - max(lb[1], sb[1])
            gap = sb[0] - ln["spans"][-1]["bbox"][2]
            if overlap >= 0.5 * min(sh, lb[3] - lb[1]) and -s["size"] <= gap <= 2.2 * s["size"]:
                target = ln
                break
        if target is None:
            lines.append({"spans": [s], "bbox": list(sb)})
        else:
            target["spans"].append(s)
            target["bbox"] = _union(target["bbox"], sb)
    for ln in lines:
        ln["spans"].sort(key=lambda s: s["bbox"][0])
        text = ""
        prev = None
        for s in ln["spans"]:
            t = s["text"]
            if prev is not None and not text.endswith(" ") and not t.startswith(" ") and s["bbox"][0] - prev["bbox"][2] > 0.12 * s["size"]:
                text += " "
            text += t
            prev = s
        chars = sum(len(s["text"].strip()) for s in ln["spans"]) or 1
        ln["text"] = re.sub(r"\s+", " ", text).strip()
        ln["size"] = sum(s["size"] * len(s["text"].strip()) for s in ln["spans"]) / chars
        ln["bold"] = sum(len(s["text"].strip()) for s in ln["spans"] if s["bold"]) / chars > 0.8
    lines = [ln for ln in lines if ln["text"]]

    # Key/value layouts ("Protocol Number:    QX-301") keep the label and its value on one line.
    for ln in sorted(lines, key=lambda l: l["bbox"][0]):
        if ln.get("merged") or not ln["text"].endswith(":") or len(ln["text"]) > 40:
            continue
        lb = ln["bbox"]
        right = [o for o in lines if o is not ln and not o.get("merged") and o["bbox"][0] > lb[2] and min(lb[3], o["bbox"][3]) - max(lb[1], o["bbox"][1]) >= 0.5 * (lb[3] - lb[1])]
        if right:
            val = min(right, key=lambda o: o["bbox"][0])
            ln["text"] = f"{ln['text']} {val['text']}"
            ln["bbox"] = _union(lb, val["bbox"])
            val["merged"] = True
    return [ln for ln in lines if not ln.get("merged")]


def _starts_unit(text: str) -> bool:
    return is_list_item(text) or heading_level(text) is not None or bool(FOOTNOTE_START.match(text) and len(text) > 3 and text[:1] in "abcdefghij*†‡§¶" and text[1:2] in ".) ") or bool(re.match(r"^(notes?|abbreviations?|source|key)\s*:", text, re.I))


def _units(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Group lines into paragraph-level units: same style, small vertical gap, horizontally overlapping."""
    units: list[dict[str, Any]] = []
    for ln in sorted(lines, key=lambda l: (l["bbox"][1], l["bbox"][0])):
        lb = ln["bbox"]
        best = None
        for u in reversed(units[-12:]):
            last = u["last"]
            gap = lb[1] - last["bbox"][3]
            h_overlap = min(lb[2], u["bbox"][2]) - max(lb[0], u["bbox"][0])
            if (
                -0.3 * ln["size"] <= gap <= 0.75 * ln["size"]
                and h_overlap > 0.3 * min(lb[2] - lb[0], u["bbox"][2] - u["bbox"][0])
                and abs(ln["size"] - u["size"]) <= 0.6
                and ln["bold"] == u["bold"]
                and not _starts_unit(ln["text"])
                and not (u["bold"] and u["last"]["text"].endswith((":",)))
            ):
                best = u
                break
        if best is None:
            units.append({"lines": [ln["text"]], "last": ln, "bbox": list(lb), "size": ln["size"], "bold": ln["bold"]})
        else:
            best["lines"].append(ln["text"])
            best["last"] = ln
            best["bbox"] = _union(best["bbox"], lb)
    for u in units:
        out = ""
        for t in u["lines"]:
            out = t if not out else (out[:-1] + t if out.endswith("-") and t[:1].islower() else out + " " + t)
        u["text"] = out.strip()
    return units


def _cell_text(words: list[tuple], bbox: tuple[float, float, float, float]) -> str:
    inside_words = [w for w in words if bbox[0] - 1 <= (w[0] + w[2]) / 2 <= bbox[2] + 1 and bbox[1] - 1 <= (w[1] + w[3]) / 2 <= bbox[3] + 1]
    inside_words.sort(key=lambda w: ((w[1] + w[3]) / 2, w[0]))
    rows: list[list[tuple]] = []
    for w in inside_words:
        yc, h = (w[1] + w[3]) / 2, w[3] - w[1]
        if rows and abs((rows[-1][0][1] + rows[-1][0][3]) / 2 - yc) < 0.5 * h:
            rows[-1].append(w)
        else:
            rows.append([w])
    return "\n".join(" ".join(w[4] for w in sorted(r, key=lambda w: w[0])) for r in rows)


def _native_tables(page: fitz.Page) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    try:
        found = page.find_tables()
    except Exception:
        return out
    # Cell text comes from positioned words: PyMuPDF's extract() drops spaces for generators that place words individually.
    # PyMuPDF "external" headers (text above the ruled area) are ignored: in protocols that text is usually the caption.
    words = page.get_text("words")
    for tab in found.tables:
        raw: list[tuple[tuple[float, float, float, float], str]] = []
        for row in tab.rows:
            for b in row.cells:
                if b is not None:
                    raw.append((tuple(b), _cell_text(words, tuple(b))))
        table = geometry_to_table(raw)
        if table["rows"] < 2 or table["cols"] < 2:
            continue
        out.append({"bbox": list(tab.bbox), "table": table})
    return out


def extract_native(doc: SourceDocument, pno: int, stats: dict[str, float], ocr_lines: OcrLines | None, ocr_images: bool, dpi: int) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    page = doc.pdf[pno - 1]
    W, H = page.rect.width, page.rect.height
    body = stats["body"]
    elements: list[dict[str, Any]] = []

    tables = _native_tables(page)
    for t in tables:
        text = "\n".join(" | ".join(c["text"] for c in t["table"]["cells"] if c["row"] == r) for r in range(t["table"]["rows"]))
        elements.append({"type": "table", "text": text, "bbox": rbox(t["bbox"]), "source": "native", "layoutLabel": "table", "table": t["table"], "confidence": None})

    used_ocr = False
    images: list[dict[str, Any]] = []
    for info in page.get_image_info(xrefs=True):
        r = fitz.Rect(info["bbox"]) & page.rect
        if r.is_empty or abs(r) / abs(page.rect) < 0.01:
            continue
        images.append({"type": "image", "text": "", "bbox": rbox(r), "source": "native", "layoutLabel": "image", "confidence": None, "imageText": None})

    spans = [s for s in _spans(page) if not any(inside(s["bbox"], t["bbox"]) for t in tables)]
    units = _units(_lines(spans))

    for u in units:
        text, bb, size = u["text"], u["bbox"], u["size"]
        el: dict[str, Any] = {"text": text, "bbox": rbox(bb), "source": "native", "confidence": None, "_size": size}
        lvl = heading_level(text)
        if bb[3] < H * 0.07 or bb[1] > H * 0.93:
            el["type"] = "page_number" if PAGE_NUMBER.match(text) else ("page_header" if bb[3] < H * 0.07 else "page_footer")
        elif CAPTION_RE.match(text) and len(text) < 300:
            el["type"] = "caption"
        elif pno == 1 and size >= body * 1.35 and not lvl and len(text) < 400:
            el["type"] = "title"
        elif (
            (size >= body * 1.12 or (u["bold"] and (lvl or looks_like_heading_text(text) or len(text) < 90)))
            and len(text) < 200
            and len(u["lines"]) <= 3
            and not text.endswith((".", ":", ";", ","))
        ) or (lvl and u["bold"] and len(text) < 200):
            el["type"] = "heading"
            el["level"] = lvl or (1 if size >= body * 1.5 else 2 if size >= body * 1.25 else 3)
        elif is_list_item(text):
            el["type"] = "list_item"
        elif size <= body * 0.9 and FOOTNOTE_START.match(text):
            el["type"] = "footnote"
        else:
            el["type"] = "paragraph"
        el["layoutLabel"] = "native_text"
        elements.append(el)

    if ocr_images and ocr_lines is not None:
        for img in images:
            bb = img["bbox"]
            area = (bb[2] - bb[0]) * (bb[3] - bb[1]) / (W * H)
            native_inside = sum(len(e["text"]) for e in elements if e["type"] != "table" and inside(e["bbox"], bb))
            if area >= config.EMBEDDED_IMAGE_MIN_AREA and native_inside < 20:
                arr = doc.render(pno, dpi, clip=fitz.Rect(bb))
                lines = ocr_lines(arr)
                if lines:
                    img["imageText"] = "\n".join(l["text"] for l in lines)
                    img["confidence"] = round(mean(l["score"] for l in lines), 4)
                    used_ocr = True
    elements.extend(images)

    header = [e for e in elements if e["type"] == "page_header"]
    footer = [e for e in elements if e["type"] in ("page_footer", "page_number")]
    content = [e for e in elements if e not in header and e not in footer]
    ordered = sorted(header, key=lambda e: (e["bbox"][1], e["bbox"][0])) + xy_cut_order(content, lambda e: e["bbox"]) + sorted(footer, key=lambda e: (e["bbox"][1], e["bbox"][0]))

    _mark_table_footnotes(ordered, body)
    for e in ordered:
        e.pop("_size", None)
    return ordered, {"method": "native+ocr" if used_ocr else "native", "width": W, "height": H, "unit": "pt"}


def _mark_table_footnotes(ordered: list[dict[str, Any]], body: float) -> None:
    """Small or marker-prefixed text directly below a table is a table footnote."""
    for i, el in enumerate(ordered):
        if el["type"] != "table":
            continue
        for nxt in ordered[i + 1 : i + 10]:
            if nxt["type"] in ("heading", "title", "table", "image", "page_footer", "page_number"):
                break
            if nxt["type"] == "caption":
                continue
            gap = nxt["bbox"][1] - el["bbox"][3]
            small = nxt.get("_size", body) <= body * 0.95
            if gap < 140 and (FOOTNOTE_START.match(nxt["text"]) or small):
                nxt["type"] = "footnote"
            else:
                break
