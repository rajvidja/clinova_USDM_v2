"""Run the OCR pipeline synchronously on a file and print a summary (development / verification aid).

  PROTOCOLIQ_DATA=/tmp/ocr-data python -m ocr_service.tools.run_local FILE [--mode structure|text] [--force-ocr] [--json]
"""

from __future__ import annotations

import argparse
import json
import shutil
import time
from pathlib import Path

from .. import config

config.configure_paddle_env()

from ..jobs import DEFAULT_OPTIONS, Job, process, read_json  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--mode", default="structure")
    ap.add_argument("--force-ocr", action="store_true")
    ap.add_argument("--json", action="store_true", help="print the full result JSON")
    ap.add_argument("--fresh", action="store_true", help="ignore cached pages")
    a = ap.parse_args()

    src = Path(a.file).resolve()
    work = config.DATA_ROOT / "local-runs" / src.stem
    if a.fresh and work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True, exist_ok=True)
    dst = work / f"original{src.suffix.lower()}"
    shutil.copyfile(src, dst)
    job = Job(src.stem, src.name, "application/octet-stream", dst, work / "ocr", {**DEFAULT_OPTIONS, "mode": a.mode, "force_ocr": a.force_ocr})
    t = time.time()
    process(job)
    result = read_json(work / "ocr" / "result.json")
    if a.json:
        print(json.dumps(result, indent=1, ensure_ascii=False))
        return
    print(f"\n== {src.name}: {job.status['status']} in {time.time() - t:.1f}s — {job.status['message']}")
    for p in result["pages"]:
        print(f"-- page {p['page']} [{p['classification']} → {p['method']}] conf={p['meanConfidence']} {p['durationMs']}ms {p.get('error') or ''}")
        for e in [e for e in result["elements"] if e["page"] == p["page"]]:
            conf = f" ({e['confidence']:.2f})" if e.get("confidence") else ""
            text = (e["text"] or e.get("imageText") or "").replace("\n", " / ")
            print(f"   {e['order']:>2} {e['type']:<12}{' L' + str(e['level']) if e.get('level') else '   '}{conf} {text[:110]}")
            t_ = e.get("table")
            if t_:
                spans = [f"{c['text'] or '∅'}@{c['row']},{c['col']}" + (f" r{c['rowSpan']}" if c["rowSpan"] > 1 else "") + (f" c{c['colSpan']}" if c["colSpan"] > 1 else "") for c in t_["cells"] if c["rowSpan"] > 1 or c["colSpan"] > 1]
                print(f"        table {t_['rows']}x{t_['cols']} header={t_['headerRows']} kind={t_['kind']} caption={t_['caption']!r} footnotes={t_['footnoteIds']} refs={t_['referencedBy']} cont={t_.get('continuedFrom')}")
                print(f"        merged: {spans}")
                for r in range(min(t_["rows"], 4)):
                    print("        | " + " | ".join(c["text"] for c in t_["cells"] if c["row"] == r))


if __name__ == "__main__":
    main()
