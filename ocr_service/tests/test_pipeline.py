"""Model-free tests: page classification, table reconstruction and the native (digital PDF) extraction path.

Run with `npm run test:ocr`. PaddleOCR models are not loaded; scanned-page OCR is covered by tools/run_local.py.
"""

from __future__ import annotations

import os
import shutil
import tempfile
import unittest
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="piq-ocr-test-"))
os.environ["PROTOCOLIQ_DATA"] = str(TMP)

from ocr_service.documents import DocumentError, open_document, safe_path  # noqa: E402
from ocr_service.jobs import DEFAULT_OPTIONS, Job, process, read_json  # noqa: E402
from ocr_service.layout import is_list_item, xy_cut_order  # noqa: E402
from ocr_service.tables import classify_table, html_to_table  # noqa: E402

FIXTURES = TMP / "fixtures"
shutil.copytree(Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "ocr", FIXTURES)


def cell(table: dict, text: str) -> dict:
    return next(c for c in table["cells"] if c["text"] == text)


class TableTests(unittest.TestCase):
    def test_html_spans_become_anchor_cells(self) -> None:
        t = html_to_table(
            "<table><tr><td rowspan='2'>Assessment</td><td colspan='2'>Treatment</td></tr>"
            "<tr><td>Day 1</td><td>Week 4</td></tr><tr><td>Vital signs</td><td>X</td><td></td></tr></table>"
        )
        self.assertEqual((t["rows"], t["cols"]), (3, 3))
        self.assertEqual(cell(t, "Assessment")["rowSpan"], 2)
        self.assertEqual(cell(t, "Treatment")["colSpan"], 2)
        self.assertEqual(cell(t, "Week 4")["col"], 2, "cells after a rowspan shift right")
        self.assertEqual(t["headerRows"], 2)

    def test_schedule_of_activities_is_recognised(self) -> None:
        t = html_to_table(
            "<table><tr><td>Procedure</td><td>Screening</td><td>Day 1</td><td>Week 4</td><td>Week 8</td></tr>"
            + "".join(f"<tr><td>Proc {i}</td><td>X</td><td>X</td><td></td><td>X</td></tr>" for i in range(5))
            + "</table>"
        )
        self.assertEqual(classify_table(t, None), "schedule_of_activities")
        self.assertEqual(classify_table(t, "Table 4: Inclusion criteria"), "eligibility_criteria")

    def test_list_items_vs_numbered_headings(self) -> None:
        self.assertTrue(is_list_item("1. Adults aged 18 years or older at screening."))
        self.assertFalse(is_list_item("5. STUDY POPULATION"))

    def test_two_column_reading_order(self) -> None:
        boxes = [("R1", (320, 100, 560, 140)), ("L1", (40, 100, 280, 140)), ("L2", (40, 150, 280, 190)), ("R2", (320, 150, 560, 190))]
        self.assertEqual([n for n, _ in xy_cut_order(boxes, lambda x: x[1])], ["L1", "L2", "R1", "R2"])


class DocumentTests(unittest.TestCase):
    def test_classification_of_digital_scanned_and_mixed_pdfs(self) -> None:
        with open_document(FIXTURES / "protocol-digital.pdf") as d:
            self.assertEqual({d.classify(p).classification for p in range(1, d.page_count + 1)}, {"digital"})
        with open_document(FIXTURES / "protocol-scanned.pdf") as d:
            self.assertEqual({d.classify(p).classification for p in range(1, d.page_count + 1)}, {"scanned"})
        with open_document(FIXTURES / "protocol-mixed.pdf") as d:
            self.assertEqual([d.classify(p).classification for p in range(1, 6)], ["digital", "scanned", "digital", "scanned", "digital"])

    def test_images_and_multipage_tiff(self) -> None:
        with open_document(FIXTURES / "protocol-pages.tiff") as d:
            self.assertEqual(d.page_count, 2)
            self.assertEqual(d.classify(1).classification, "scanned")
            self.assertEqual(d.render(2, 200).shape[2], 3)
        with open_document(FIXTURES / "soa-page-scan.jpg") as d:
            self.assertEqual(d.page_count, 1)

    def test_paths_outside_the_data_root_are_rejected(self) -> None:
        with self.assertRaises(DocumentError):
            safe_path("/etc/passwd")


class NativeExtractionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        work = TMP / "documents" / "digital"
        work.mkdir(parents=True)
        src = work / "original.pdf"
        shutil.copyfile(FIXTURES / "protocol-digital.pdf", src)
        job = Job("digital", "protocol-digital.pdf", "application/pdf", src, work / "ocr", {**DEFAULT_OPTIONS, "ocr_embedded_images": False})
        process(job)
        cls.status = job.status
        cls.result = read_json(work / "ocr" / "result.json")

    def test_job_completes_without_models(self) -> None:
        self.assertEqual(self.status["status"], "completed")
        self.assertEqual(self.result["pageCount"], 5)
        self.assertTrue(all(p["method"] == "native" for p in self.result["pages"]))

    def test_every_element_carries_document_page_type_and_bbox(self) -> None:
        for e in self.result["elements"]:
            self.assertEqual(e["documentId"], "digital")
            self.assertEqual(e["documentName"], "protocol-digital.pdf")
            self.assertIn(e["page"], range(1, 6))
            self.assertEqual(len(e["bbox"]), 4)
            self.assertTrue(e["id"].startswith(f"p{e['page']}-e"))

    def test_title_headings_and_lists(self) -> None:
        els = self.result["elements"]
        self.assertEqual(next(e for e in els if e["type"] == "title")["text"], "CLINICAL STUDY PROTOCOL")
        headings = [e["text"] for e in els if e["type"] == "heading"]
        self.assertTrue(any(h.startswith("1") and "INTRODUCTION" in h for h in headings), headings)
        self.assertGreaterEqual(sum(e["type"] == "list_item" for e in els), 4)

    def test_schedule_of_activities_keeps_merged_cells_and_footnotes(self) -> None:
        tables = [e for e in self.result["elements"] if e["type"] == "table"]
        soa = next(e for e in tables if e["table"]["kind"] == "schedule_of_activities")
        t = soa["table"]
        self.assertEqual((t["rows"], t["cols"], t["headerRows"]), (11, 7, 2))
        self.assertEqual(cell(t, "Treatment Period")["colSpan"], 4)
        self.assertEqual(cell(t, "Screening")["rowSpan"], 2)
        self.assertTrue(t["caption"].startswith("Table 2"))
        self.assertGreaterEqual(len(t["footnoteIds"]), 2)
        footnotes = {e["id"]: e for e in self.result["elements"]}
        self.assertTrue(all(footnotes[i]["type"] == "footnote" for i in t["footnoteIds"]))
        self.assertTrue(t["referencedBy"], "the 'see Table 2' paragraph is linked")

    def test_endpoint_table(self) -> None:
        t = next(e["table"] for e in self.result["elements"] if e["type"] == "table" and e["table"]["caption"].startswith("Table 1"))
        self.assertEqual(t["kind"], "endpoints")
        self.assertEqual(t["headerRows"], 1)


def tearDownModule() -> None:
    shutil.rmtree(TMP, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
