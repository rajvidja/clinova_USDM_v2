"""Synthetic OCR test documents (scanned / mixed PDFs, PNG / JPG / TIFF) derived from a digital PDF.

  python -m ocr_service.tools.fixtures diagram OUT.png
  python -m ocr_service.tools.fixtures derive DIGITAL.pdf OUT_DIR
"""

from __future__ import annotations

import io
import random
import sys
from pathlib import Path

import pymupdf as fitz
from PIL import Image, ImageDraw, ImageFilter, ImageFont


def _font(size: int) -> ImageFont.ImageFont:
    for name in ("/System/Library/Fonts/Supplemental/Arial.ttf", "/Library/Fonts/Arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def diagram(out: Path) -> None:
    """A study-design schema as a raster image (text inside the image is only readable via OCR)."""
    img = Image.new("RGB", (1500, 560), "white")
    d = ImageDraw.Draw(img)
    f, small = _font(34), _font(26)
    boxes = [(40, 220, 300, 340, "Screening"), (380, 220, 660, 340, "Randomisation"), (760, 80, 1120, 200, "Drug Q 10 mg"), (760, 360, 1120, 480, "Placebo"), (1200, 220, 1460, 340, "Follow-up")]
    for x0, y0, x1, y1, label in boxes:
        d.rectangle((x0, y0, x1, y1), outline="black", width=4, fill=(235, 242, 250))
        w = d.textlength(label, font=f)
        d.text(((x0 + x1 - w) / 2, (y0 + y1) / 2 - 20), label, fill="black", font=f)
    for a, b in (((300, 280), (380, 280)), ((660, 280), (760, 140)), ((660, 280), (760, 420)), ((1120, 140), (1200, 280)), ((1120, 420), (1200, 280))):
        d.line((*a, *b), fill="black", width=4)
    d.text((40, 20), "Study Design Schema", fill="black", font=f)
    d.text((40, 500), "Week -4 to 0        Day 1        Weeks 1-12        Week 16", fill=(60, 60, 60), font=small)
    img.save(out)


def _scan(img: Image.Image, seed: int) -> Image.Image:
    rnd = random.Random(seed)
    img = img.convert("L").rotate(rnd.uniform(-0.8, 0.8), resample=Image.BICUBIC, expand=False, fillcolor=255)
    img = img.filter(ImageFilter.GaussianBlur(0.5))
    px = img.load()
    w, h = img.size
    for _ in range(w * h // 350):
        x, y = rnd.randrange(w), rnd.randrange(h)
        px[x, y] = rnd.choice((0, 90, 160))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=70)
    return Image.open(io.BytesIO(buf.getvalue()))


def _page_images(pdf: fitz.Document, dpi: int) -> list[Image.Image]:
    out = []
    for p in pdf:
        pix = p.get_pixmap(dpi=dpi, colorspace=fitz.csRGB, alpha=False)
        out.append(Image.frombytes("RGB", (pix.width, pix.height), pix.samples))
    return out


def _images_to_pdf(images: list[Image.Image], sizes: list[fitz.Rect]) -> fitz.Document:
    doc = fitz.open()
    for img, rect in zip(images, sizes):
        page = doc.new_page(width=rect.width, height=rect.height)
        buf = io.BytesIO()
        img.convert("RGB").save(buf, format="JPEG", quality=75)
        page.insert_image(page.rect, stream=buf.getvalue())
    return doc


def derive(digital: Path, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    src = fitz.open(digital)
    sizes = [p.rect for p in src]
    scans = [_scan(img, i) for i, img in enumerate(_page_images(src, 150))]

    scanned = _images_to_pdf(scans, sizes)
    scanned.save(out_dir / "protocol-scanned.pdf", garbage=4, deflate=True)

    # Mixed: digital pages with every other page replaced by its scan.
    mixed = fitz.open()
    for i in range(src.page_count):
        if i % 2 == 1:
            mixed.insert_pdf(scanned, from_page=i, to_page=i)
        else:
            mixed.insert_pdf(src, from_page=i, to_page=i)
    mixed.save(out_dir / "protocol-mixed.pdf", garbage=4, deflate=True)

    soa = next((i for i, p in enumerate(src) if "Schedule of Activities" in p.get_text()), 0)
    hi = _page_images(src, 200)
    hi[soa].save(out_dir / "soa-page.png")
    _scan(hi[soa], 99).convert("RGB").save(out_dir / "soa-page-scan.jpg", quality=80)
    frames = [_scan(hi[i], 10 + i).convert("L") for i in range(min(2, len(hi)))]
    frames[0].save(out_dir / "protocol-pages.tiff", save_all=True, append_images=frames[1:], compression="tiff_deflate")
    print(f"Wrote fixtures to {out_dir} (SoA on page {soa + 1})")


if __name__ == "__main__":
    cmd, *args = sys.argv[1:]
    if cmd == "diagram":
        diagram(Path(args[0]))
    elif cmd == "derive":
        derive(Path(args[0]), Path(args[1]))
    else:
        raise SystemExit(__doc__)
