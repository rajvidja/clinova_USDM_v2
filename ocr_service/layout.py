"""Layout utilities shared by the native and OCR extractors: reading order, headings, list items."""

from __future__ import annotations

import re
from typing import Any, Callable, Sequence

BBox = Sequence[float]

NUMBERED_HEADING = re.compile(r"^(?:section\s+)?(\d{1,2}(?:\.\d{1,2}){0,4})\.?\s+([A-Z(][^\n]{1,160})$")
APPENDIX_HEADING = re.compile(r"^(appendix|annex|attachment|schedule)\s+[A-Z0-9]{1,4}\b[:.\-–]?\s*\S", re.I)
LIST_ITEM = re.compile(r"^\s*(?:[•●▪◦■□➢►\-–*]|\(?[0-9]{1,3}[.)]|\(?[a-z][.)]|\(?[ivx]{1,5}[.)])\s+\S", re.I)
PAGE_NUMBER = re.compile(r"^\s*(?:page\s*)?\d{1,4}(?:\s*(?:of|/)\s*\d{1,4})?\s*$", re.I)


def heading_level(text: str) -> int | None:
    m = NUMBERED_HEADING.match(text.strip())
    if m:
        return m.group(1).count(".") + 1
    return None


def looks_like_heading_text(text: str) -> bool:
    t = text.strip()
    if not t or len(t) > 180 or t.count("\n") > 2:
        return False
    if NUMBERED_HEADING.match(t):
        title = NUMBERED_HEADING.match(t).group(2)  # type: ignore[union-attr]
        return not re.search(r"[.;,]\s*$", title) and len(title.split()) <= 18
    if APPENDIX_HEADING.match(t):
        return True
    letters = re.sub(r"[^A-Za-z]", "", t)
    return len(letters) >= 4 and letters.isupper() and len(t.split()) <= 12


def is_list_item(text: str) -> bool:
    return bool(LIST_ITEM.match(text)) and not looks_like_heading_text(text)


def xy_cut_order(items: list[Any], bbox_of: Callable[[Any], BBox], min_gap: float = 6.0) -> list[Any]:
    """Recursive XY-cut: split at the widest whitespace band (rows or columns) to recover reading order.

    Column gutters are usually wider than paragraph spacing, so taking the widest band keeps two-column text
    column-by-column even when the paragraph gaps of both columns line up.
    """
    if len(items) <= 1:
        return list(items)

    def gaps(axis: int) -> list[tuple[float, float]]:
        spans = sorted((bbox_of(i)[axis], bbox_of(i)[axis + 2]) for i in items)
        out: list[tuple[float, float]] = []
        end = spans[0][1]
        for s, e in spans[1:]:
            if s - end >= min_gap:
                out.append((end, s))
            end = max(end, e)
        return out

    def split(axis: int, cut: tuple[float, float]) -> tuple[list[Any], list[Any]]:
        mid = (cut[0] + cut[1]) / 2
        first = [i for i in items if (bbox_of(i)[axis] + bbox_of(i)[axis + 2]) / 2 < mid]
        return first, [i for i in items if (bbox_of(i)[axis] + bbox_of(i)[axis + 2]) / 2 >= mid]

    candidates = [(g[1] - g[0], axis, g) for axis in (1, 0) for g in gaps(axis)]  # axis 1 = rows, 0 = columns
    for _, axis, cut in sorted(candidates, key=lambda c: (-c[0], -c[1])):
        a, b = split(axis, cut)
        if a and b:
            return xy_cut_order(a, bbox_of, min_gap) + xy_cut_order(b, bbox_of, min_gap)
    return sorted(items, key=lambda i: (round(bbox_of(i)[1] / 4), bbox_of(i)[0]))


def inside(inner: BBox, outer: BBox, tol: float = 2.0) -> bool:
    cx, cy = (inner[0] + inner[2]) / 2, (inner[1] + inner[3]) / 2
    return outer[0] - tol <= cx <= outer[2] + tol and outer[1] - tol <= cy <= outer[3] + tol


def overlap_ratio(a: BBox, b: BBox) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    area = max(1e-6, (a[2] - a[0]) * (a[3] - a[1]))
    return ix * iy / area


def rbox(b: BBox, scale: float = 1.0) -> list[float]:
    return [round(float(v) / scale, 2) for v in b[:4]]
