"""Convert PaddleOCR output for one page image into ProtocolIQ OCR elements."""

from __future__ import annotations

import re
from statistics import mean, median
from typing import Any

from .engine import mean_score, ocr_lines
from .layout import PAGE_NUMBER, heading_level, inside, is_list_item, looks_like_heading_text, overlap_ratio, rbox
from .tables import CAPTION_RE, FOOTNOTE_START, html_to_table

# PP-StructureV3 (PP-DocLayout) labels → ProtocolIQ element types.
LABEL_MAP = {
    "doc_title": "title",
    "paragraph_title": "heading",
    "abstract_title": "heading",
    "reference_title": "heading",
    "content_title": "heading",
    "text": "paragraph",
    "abstract": "paragraph",
    "content": "paragraph",
    "algorithm": "paragraph",
    "table": "table",
    "image": "image",
    "figure": "image",
    "chart": "image",
    "flowchart": "image",
    "seal": "image",
    "header_image": "page_header",
    "footer_image": "page_footer",
    "table_title": "caption",
    "figure_title": "caption",
    "chart_title": "caption",
    "figure_table_chart_title": "caption",
    "footnote": "footnote",
    "vision_footnote": "footnote",
    "header": "page_header",
    "footer": "page_footer",
    "number": "page_number",
    "formula": "formula",
    "formula_number": "other",
    "reference": "reference",
    "reference_content": "reference",
    "aside_text": "other",
}


def _lines_in(lines: list[dict[str, Any]], bbox: list[float]) -> list[dict[str, Any]]:
    return [l for l in lines if inside(l["bbox"], bbox, tol=4)]


def _strip_html(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).strip()


REGION_LABELS = {"image", "figure", "chart", "flowchart", "seal", "header", "footer", "number", "header_image", "footer_image"}


def from_structure(res: dict[str, Any], scale: float) -> tuple[list[dict[str, Any]], float | None]:
    """Elements (bboxes in page units = pixels / scale) from a PP-StructureV3 JSON result.

    parsing_res_list is already in reading order (block_order is only set for text blocks)."""
    lines = ocr_lines(res.get("overall_ocr_res") or {})
    tables = list(res.get("table_res_list") or [])
    blocks = list(res.get("parsing_res_list") or [])
    elements: list[dict[str, Any]] = []
    used_tables: set[int] = set()

    for b in blocks:
        label = b.get("block_label", "text")
        etype = LABEL_MAP.get(label, "other")
        bbox = [float(v) for v in b["block_bbox"]]
        content = b.get("block_content") or ""
        inner = _lines_in(lines, bbox)
        el: dict[str, Any] = {"type": etype, "bbox": rbox(bbox, scale), "_px": bbox, "source": "ocr", "layoutLabel": label, "confidence": mean_score(inner)}

        if etype == "table":
            tres = _match_table(tables, bbox, used_tables)
            html = (tres or {}).get("pred_html") or (content if "<table" in content.lower() else "")
            table = html_to_table(html)
            _table_cell_geometry(table, tres, scale)
            table["html"] = html or None
            el["table"] = table
            el["text"] = "\n".join(" | ".join(c["text"] for c in table["cells"] if c["row"] == r) for r in range(table["rows"]))
            if tres:
                tlines = ocr_lines(tres.get("table_ocr_pred") or {})
                el["confidence"] = mean_score(tlines) or el["confidence"]
        elif etype == "image":
            el["text"] = _strip_html(content) if "<" in content else content.strip()
            el["imageText"] = "\n".join(l["text"] for l in inner) or None
        else:
            text = _strip_html(content) if "<" in content else content
            el["text"] = re.sub(r"[ \t]+", " ", text).strip()
            if etype == "heading":
                el["level"] = heading_level(el["text"]) or 2
            elif etype == "paragraph" and el["text"]:
                if CAPTION_RE.match(el["text"]) and len(el["text"]) < 300:
                    el["type"] = "caption"
                elif looks_like_heading_text(el["text"]) and len(el["text"]) < 120 and heading_level(el["text"]):
                    el["type"] = "heading"
                    el["level"] = heading_level(el["text"])
        if etype in ("paragraph",) and el["type"] == "paragraph":
            elements.extend(_split_list_items(el))
        elif el.get("text") or etype in ("table", "image"):
            elements.append(el)

    _add_layout_regions(elements, res, lines, scale)
    _add_uncovered_lines(elements, lines, scale, float(res.get("height") or 0))
    _mark_footnotes(elements)
    for e in elements:
        e.pop("_px", None)
    return elements, mean_score(lines)


def _insert_by_position(elements: list[dict[str, Any]], el: dict[str, Any]) -> None:
    y0 = el["_px"][1]
    for i, e in enumerate(elements):
        if e["type"] == "page_header":
            continue
        if e["type"] in ("page_footer", "page_number") or e["_px"][1] > y0:
            elements.insert(i, el)
            return
    elements.append(el)


def _add_layout_regions(elements: list[dict[str, Any]], res: dict[str, Any], lines: list[dict[str, Any]], scale: float) -> None:
    """Images, running headers/footers and page numbers that the layout model found but parsing_res_list omitted."""
    boxes = (res.get("layout_det_res") or {}).get("boxes") or []
    for box in boxes:
        label = box.get("label")
        if label not in REGION_LABELS or float(box.get("score", 0)) < 0.5:
            continue
        bbox = [float(v) for v in box["coordinate"]]
        if any(overlap_ratio(bbox, e["_px"]) > 0.5 for e in elements):
            continue
        etype = LABEL_MAP.get(label, "other")
        inner = _lines_in(lines, bbox)
        el: dict[str, Any] = {"type": etype, "bbox": rbox(bbox, scale), "_px": bbox, "source": "ocr", "layoutLabel": label, "confidence": mean_score(inner)}
        if etype == "image":
            # Text recognised inside the figure belongs to the figure, not to the body text.
            absorbed = [e for e in elements if e["type"] in ("paragraph", "list_item", "other") and overlap_ratio(e["_px"], bbox) > 0.8]
            for e in absorbed:
                elements.remove(e)
            el["text"] = ""
            el["imageText"] = "\n".join(l["text"] for l in inner) or None
            _insert_by_position(elements, el)
        else:
            el["text"] = " ".join(l["text"] for l in inner)
            if not el["text"]:
                continue
            if etype == "page_header":
                elements.insert(0, el)
            else:
                elements.append(el)


def _add_uncovered_lines(elements: list[dict[str, Any]], lines: list[dict[str, Any]], scale: float, height: float) -> None:
    """Recognised text that no layout block covers is kept as its own element instead of being dropped."""
    loose = [l for l in lines if not any(inside(l["bbox"], e["_px"], tol=4) for e in elements)]
    if not loose:
        return
    for el in from_text_lines(loose, 1.0):
        px = el["bbox"]
        el["_px"] = px
        el["bbox"] = rbox(px, scale)
        el["layoutLabel"] = "uncovered_text"
        if height and px[3] < height * 0.08:
            el["type"] = "page_header"
            elements.insert(0, el)
        elif height and px[1] > height * 0.92:
            el["type"] = "page_number" if PAGE_NUMBER.match(el["text"]) else "page_footer"
            elements.append(el)
        else:
            _insert_by_position(elements, el)


def _match_table(tables: list[dict[str, Any]], bbox: list[float], used: set[int]) -> dict[str, Any] | None:
    best, best_iou = None, 0.0
    for i, t in enumerate(tables):
        if i in used:
            continue
        boxes = t.get("cell_box_list") or []
        if len(boxes):
            tb = [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]
            ix = max(0.0, min(tb[2], bbox[2]) - max(tb[0], bbox[0]))
            iy = max(0.0, min(tb[3], bbox[3]) - max(tb[1], bbox[1]))
            area = max(1.0, (tb[2] - tb[0]) * (tb[3] - tb[1]))
            score = ix * iy / area
        else:
            score = 0.01  # no geometry: fall back to document order
        if score > best_iou:
            best, best_iou = i, score
    if best is None:
        return None
    used.add(best)
    return tables[best]


def _table_cell_geometry(table: dict[str, Any], tres: dict[str, Any] | None, scale: float) -> None:
    """Cell boxes from the table structure model are in HTML cell order; attach them and per-cell confidence."""
    if not tres:
        return
    boxes = tres.get("cell_box_list") or []
    if len(boxes) != len(table["cells"]):
        return
    tlines = ocr_lines(tres.get("table_ocr_pred") or {})
    for cell, box in zip(table["cells"], boxes):
        box = [float(v) for v in list(box)[:4]]
        cell["bbox"] = rbox(box, scale)
        cell["confidence"] = mean_score(_lines_in(tlines, box))


INLINE_ENUM = re.compile(r"(?<=[.;:])\s*(?=(?:\d{1,2}|[a-z]|[ivx]{1,4})[.)]\s+[A-Z])")


def _split_list_items(el: dict[str, Any]) -> list[dict[str, Any]]:
    text = INLINE_ENUM.sub("\n", el["text"]) if is_list_item(el["text"]) else el["text"]
    parts = [p.strip() for p in re.split(r"\n+", text) if p.strip()]
    if len(parts) > 1 and sum(1 for p in parts if is_list_item(p)) >= 2:
        out: list[dict[str, Any]] = []
        for p in parts:
            if is_list_item(p) or not out:
                out.append({**el, "type": "list_item" if is_list_item(p) else "paragraph", "text": p})
            else:
                out[-1]["text"] += " " + p
        return out
    text = " ".join(parts)
    return [{**el, "text": text, "type": "list_item" if is_list_item(text) else "paragraph"}]


def _mark_footnotes(elements: list[dict[str, Any]]) -> None:
    for i, el in enumerate(elements):
        if el["type"] != "table":
            continue
        for nxt in elements[i + 1 : i + 8]:
            if nxt["type"] in ("heading", "title", "table", "image", "page_footer", "page_number"):
                break
            if nxt["type"] in ("caption", "footnote"):
                continue
            if FOOTNOTE_START.match(nxt.get("text", "")) and len(nxt.get("text", "")) < 600:
                nxt["type"] = "footnote"
            else:
                break


def from_text_lines(lines: list[dict[str, Any]], scale: float) -> list[dict[str, Any]]:
    """Text-only mode: group PP-OCRv5 lines into paragraphs and headings (no table recognition)."""
    if not lines:
        return []
    heights = [l["bbox"][3] - l["bbox"][1] for l in lines]
    h_med = median(heights) or 10
    lines = sorted(lines, key=lambda l: (round(l["bbox"][1] / (h_med * 0.6)), l["bbox"][0]))
    groups: list[list[dict[str, Any]]] = []
    for l in lines:
        g = groups[-1] if groups else None
        if g:
            last = g[-1]
            gap = l["bbox"][1] - last["bbox"][3]
            same_col = abs(l["bbox"][0] - g[0]["bbox"][0]) < h_med * 3 or (l["bbox"][0] < last["bbox"][2] and l["bbox"][2] > last["bbox"][0])
            if 0 <= gap < h_med * 0.9 and same_col and not is_list_item(l["text"]) and not looks_like_heading_text(last["text"]):
                g.append(l)
                continue
        groups.append([l])
    out: list[dict[str, Any]] = []
    for g in groups:
        text = " ".join(l["text"] for l in g)
        bbox = [min(l["bbox"][0] for l in g), min(l["bbox"][1] for l in g), max(l["bbox"][2] for l in g), max(l["bbox"][3] for l in g)]
        tall = mean(l["bbox"][3] - l["bbox"][1] for l in g) > h_med * 1.25
        if len(g) <= 2 and (looks_like_heading_text(text) or (tall and len(text) < 150)):
            etype, level = "heading", heading_level(text) or (1 if tall else 2)
        elif is_list_item(text):
            etype, level = "list_item", None
        else:
            etype, level = "paragraph", None
        if CAPTION_RE.match(text) and len(text) < 300:
            etype = "caption"
        out.append({"type": etype, "level": level, "text": text, "bbox": rbox(bbox, scale), "source": "ocr", "layoutLabel": "ocr_text", "confidence": mean_score(g)})
    return out
