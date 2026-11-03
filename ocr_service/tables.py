"""Table structure helpers: HTML → cell grid (with spans), native PDF table geometry → cell grid, table typing."""

from __future__ import annotations

import re
from html.parser import HTMLParser
from typing import Any

Cell = dict[str, Any]


class _TableHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[Cell]] = []
        self._cell: Cell | None = None
        self._in_thead = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = dict(attrs)
        if tag == "thead":
            self._in_thead = True
        elif tag == "tr":
            self.rows.append([])
        elif tag in ("td", "th"):
            if not self.rows:
                self.rows.append([])
            self._cell = {
                "text": "",
                "rowSpan": _int(a.get("rowspan")),
                "colSpan": _int(a.get("colspan")),
                "header": tag == "th" or self._in_thead,
            }
        elif tag == "br" and self._cell is not None:
            self._cell["text"] += "\n"

    def handle_endtag(self, tag: str) -> None:
        if tag == "thead":
            self._in_thead = False
        elif tag in ("td", "th") and self._cell is not None:
            self.rows[-1].append(self._cell)
            self._cell = None

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell["text"] += data


def _int(v: str | None) -> int:
    try:
        return max(1, int(v or 1))
    except ValueError:
        return 1


def clean_text(t: str) -> str:
    t = t.replace("\u00a0", " ")
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\s*\n\s*", "\n", t)
    return t.strip()


def html_to_table(html: str) -> dict[str, Any]:
    """Parse table HTML into anchor cells positioned on a dense grid (row/col honour row- and col-spans)."""
    p = _TableHTMLParser()
    p.feed(html or "")
    occupied: set[tuple[int, int]] = set()
    cells: list[Cell] = []
    n_cols = 0
    for r, row in enumerate(p.rows):
        c = 0
        for cell in row:
            while (r, c) in occupied:
                c += 1
            for dr in range(cell["rowSpan"]):
                for dc in range(cell["colSpan"]):
                    occupied.add((r + dr, c + dc))
            cells.append({"row": r, "col": c, "rowSpan": cell["rowSpan"], "colSpan": cell["colSpan"], "text": clean_text(cell["text"]), "header": cell["header"], "bbox": None, "confidence": None})
            c += cell["colSpan"]
            n_cols = max(n_cols, c)
    n_rows = max([r for r, _ in occupied], default=-1) + 1
    return finalize_table(cells, n_rows, n_cols)


def geometry_to_table(raw_cells: list[tuple[tuple[float, float, float, float], str]], header_rows_hint: int = 0) -> dict[str, Any]:
    """Build a grid from cell rectangles (native PDF tables). Merged cells span several grid lines."""
    if not raw_cells:
        return finalize_table([], 0, 0)
    tol = 2.0

    def lines(values: list[float]) -> list[float]:
        out: list[float] = []
        for v in sorted(values):
            if not out or v - out[-1] > tol:
                out.append(v)
        return out

    xs = lines([b[0] for b, _ in raw_cells])
    ys = lines([b[1] for b, _ in raw_cells])

    def index(grid: list[float], v: float) -> int:
        return min(range(len(grid)), key=lambda i: abs(grid[i] - v))

    cells: list[Cell] = []
    seen: set[tuple[int, int]] = set()
    for (x0, y0, x1, y1), text in raw_cells:
        r, c = index(ys, y0), index(xs, x0)
        if (r, c) in seen:
            continue
        seen.add((r, c))
        row_span = max(1, sum(1 for y in ys if y0 - tol <= y < y1 - tol))
        col_span = max(1, sum(1 for x in xs if x0 - tol <= x < x1 - tol))
        cells.append({"row": r, "col": c, "rowSpan": row_span, "colSpan": col_span, "text": clean_text(text or ""), "header": False, "bbox": [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)], "confidence": None})
    n_rows = max(c["row"] + c["rowSpan"] for c in cells)
    n_cols = max(c["col"] + c["colSpan"] for c in cells)
    if header_rows_hint:
        for c in cells:
            if c["row"] < header_rows_hint:
                c["header"] = True
    return finalize_table(cells, n_rows, n_cols)


def finalize_table(cells: list[Cell], n_rows: int, n_cols: int) -> dict[str, Any]:
    cells.sort(key=lambda c: (c["row"], c["col"]))
    header_rows = _header_rows(cells, n_rows)
    for c in cells:
        if c["row"] < header_rows:
            c["header"] = True
    return {"rows": n_rows, "cols": n_cols, "headerRows": header_rows, "cells": cells, "caption": None, "kind": "other", "footnoteIds": [], "referencedBy": []}


def _header_rows(cells: list[Cell], n_rows: int) -> int:
    if n_rows <= 1:
        return 0
    explicit = {c["row"] for c in cells if c["header"]}
    if explicit:
        h = 0
        while h in explicit:
            h += 1
        return h
    first = [c for c in cells if c["row"] == 0]
    # A spanning first row (e.g. "Treatment period" over several visits) is followed by a second header row.
    if any(c["colSpan"] > 1 for c in first) and n_rows > 2:
        return 2
    texts = [c["text"] for c in first if c["text"]]
    if texts and all(len(t) < 60 and not re.fullmatch(r"[\dX✓✔•x\s.,%()-]+", t) for t in texts):
        return 1
    return 0


VISIT_RE = re.compile(r"\b(screening|baseline|day\s*-?\d+|week\s*\d+|wk\s*\d+|month\s*\d+|visit\s*\d+|v\d+\b|end of (?:treatment|study)|eot|eos|follow[- ]?up|randomi[sz]ation|early termination|unscheduled)", re.I)
MARK_RE = re.compile(r"^\s*(x|✓|✔|•|●|\(x\)|x\s*[a-z\d*†‡]?|yes)\s*$", re.I)


def classify_table(table: dict[str, Any], caption: str | None, context: str = "") -> str:
    """Rule-based table typing for clinical protocols."""
    header = " ".join(c["text"] for c in table["cells"] if c["header"] or c["row"] == 0).lower()
    first_col = " ".join(c["text"] for c in table["cells"] if c["col"] == 0).lower()
    cap = f"{caption or ''} {context}".lower()
    marks = sum(1 for c in table["cells"] if MARK_RE.match(c["text"] or ""))
    data_cells = max(1, sum(1 for c in table["cells"] if not c["header"]))
    visit_headers = len(VISIT_RE.findall(header))

    # An explicit caption is the strongest signal; table shape and the surrounding heading come after it.
    own = (caption or "").lower()
    if re.search(r"schedule of (activities|assessments|events|procedures)|\bsoa\b|study flow ?chart|flowchart", own):
        return "schedule_of_activities"
    if re.search(r"visit schedule|visit windows?|schedule of visits", own):
        return "visit_schedule"
    if re.search(r"inclusion|exclusion|eligibility", own):
        return "eligibility_criteria"
    if re.search(r"endpoint|outcome measure|objective", own):
        return "endpoints"

    if re.search(r"schedule of (activities|assessments|events|procedures)|\bsoa\b|study flow ?chart|flowchart", cap) or (visit_headers >= 3 and marks / data_cells > 0.15):
        return "schedule_of_activities"
    if re.search(r"visit schedule|visit windows?|schedule of visits", cap) or (visit_headers >= 2 and re.search(r"window|day|week", header) and marks / data_cells <= 0.15):
        return "visit_schedule"
    if re.search(r"inclusion|exclusion|eligibility", cap + " " + header) or len(re.findall(r"\b(inclusion|exclusion)\b", first_col)) >= 2:
        return "eligibility_criteria"
    if re.search(r"endpoint|outcome measure|objective", cap + " " + header):
        return "endpoints"
    if re.search(r"procedure|assessment", cap + " " + header):
        return "study_procedures"
    return "other"


FOOTNOTE_START = re.compile(r"^\s*(?:[a-z]\s*[.)]?\s+|[*†‡§¶#]+\s*|\d{1,2}\s*[.)]?\s+(?=[A-Z])|\(\w\)\s*|notes?\s*:|abbreviations?\s*:|source\s*:|key\s*:)", re.I)
CAPTION_RE = re.compile(r"^\s*(table|figure|fig\.?|exhibit|appendix\s+table)\s*([A-Z]?\d+(?:[.\-]\d+)*)\s*[:.\-–]?\s*", re.I)
TABLE_REF_RE = re.compile(r"\b(?:table)\s+([A-Z]?\d+(?:[.\-]\d+)*)", re.I)


def caption_number(text: str) -> str | None:
    m = CAPTION_RE.match(text or "")
    return m.group(2) if m and m.group(1).lower().startswith(("table", "appendix")) else None
