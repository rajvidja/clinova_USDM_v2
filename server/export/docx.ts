import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
  type ISectionOptions,
} from 'docx';
import type { DocBlock, DocModel, DocRun } from '../../shared/docModel.ts';
import { loadImages } from './images.ts';

const FONT = 'Arial';
const NAVY = '12264A';
const MARGIN = 1134; // 2 cm
const A4_W = 11906;
const A4_H = 16838;
const PORTRAIT_TEXT = A4_W - 2 * MARGIN;
const LANDSCAPE_TEXT = A4_H - 2 * MARGIN;

function textRuns(runs: DocRun[], size = 20): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    const parts = r.text.split('\n');
    parts.forEach((p, i) => {
      out.push(
        new TextRun({
          text: p,
          break: i > 0 ? 1 : undefined,
          bold: r.bold,
          italics: r.italic || r.placeholder,
          underline: r.underline ? {} : undefined,
          color: r.placeholder ? '9A3412' : undefined,
          highlight: r.placeholder ? 'yellow' : undefined,
          size,
          font: FONT,
        }),
      );
    });
  }
  return out;
}

const border = { style: BorderStyle.SINGLE, size: 4, color: '9AA5B8' };
const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };

function table(headers: DocRun[][], rows: DocRun[][][], totalWidth: number, ratios?: number[], size = 18): Table {
  const n = headers.length;
  const r = ratios && ratios.length === n ? ratios : headers.map(() => 1);
  const sum = r.reduce((a, b) => a + b, 0);
  const widths = r.map((x) => Math.floor((x / sum) * totalWidth));
  const cell = (runs: DocRun[], i: number, header: boolean, align?: (typeof AlignmentType)[keyof typeof AlignmentType]) =>
    new TableCell({
      width: { size: widths[i], type: WidthType.DXA },
      shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: 'E8EDF5' } : undefined,
      margins: { top: 50, bottom: 50, left: 80, right: 80 },
      children: [new Paragraph({ alignment: align, children: textRuns(header ? runs.map((x) => ({ ...x, bold: true })) : runs, size) })],
    });
  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths: widths,
    borders,
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: headers.map((h, i) => cell(h, i, true)) }),
      ...rows.map((row) => new TableRow({ cantSplit: true, children: row.map((c, i) => cell(c, i, false)) })),
    ],
  });
}

let listInstance = 0;

function blocks(list: DocBlock[], images: ReturnType<typeof loadImages>): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const b of list) {
    switch (b.t) {
      case 'heading':
        out.push(
          new Paragraph({
            heading: b.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
            keepNext: true,
            children: [new TextRun({ text: b.level === 1 ? `${b.number}.\t${b.text}` : `${b.number}\t${b.text}` })],
            tabStops: [{ type: TabStopType.LEFT, position: 720 }],
          }),
        );
        break;
      case 'label':
        out.push(new Paragraph({ keepNext: true, spacing: { before: 120, after: 40 }, children: [new TextRun({ text: b.text, bold: true, size: 19, color: '334155', font: FONT })] }));
        break;
      case 'para':
        out.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 120 }, children: textRuns(b.runs) }));
        break;
      case 'list': {
        const instance = ++listInstance;
        for (const item of b.items) {
          out.push(
            new Paragraph({
              spacing: { after: 60 },
              ...(b.style === 'bullet'
                ? { bullet: { level: 0 } }
                : b.style === 'number'
                  ? { numbering: { reference: 'protocol-numbered', level: 0, instance } }
                  : { indent: { left: 360 } }),
              children: textRuns(item),
            }),
          );
        }
        break;
      }
      case 'table':
        out.push(table(b.headers.map((h) => [{ text: h }]), b.rows, PORTRAIT_TEXT, b.widths, b.compact ? 16 : 18));
        out.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
        break;
      case 'image': {
        const img = images.get(b.attachmentId);
        if (!img) {
          out.push(new Paragraph({ children: textRuns([{ text: `[Image unavailable: ${b.filename}]`, italic: true }]) }));
          break;
        }
        const maxW = 560;
        const maxH = 520;
        const scale = Math.min(1, maxW / img.width, maxH / img.height);
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new ImageRun({
                type: img.mimeType === 'image/png' ? 'png' : 'jpg',
                data: img.data,
                transformation: { width: Math.round(img.width * scale), height: Math.round(img.height * scale) },
              }),
            ],
          }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: b.filename, italics: true, size: 16, color: '475569', font: FONT })] }),
        );
        break;
      }
      case 'attachment':
        out.push(new Paragraph({ spacing: { after: 80 }, children: textRuns([{ text: 'Attachment: ', bold: true }, { text: `${b.filename} (${Math.max(1, Math.round(b.size / 1024))} KB)` }]) }));
        break;
    }
  }
  return out;
}

function soaBlocks(model: DocModel): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('SCHEDULE OF ACTIVITIES')] })];
  const soa = model.soa;
  if (!soa || !soa.rows.length) {
    out.push(new Paragraph({ children: textRuns([{ text: model.draft ? '[Schedule of Activities not yet defined]' : '[Not provided]', placeholder: true }]) }));
    return out;
  }
  const headers: DocRun[][] = [
    [{ text: 'Assessment / Procedure' }],
    ...soa.visits.map((v) => [
      { text: v.name + (v.markers ? ` ${v.markers}` : '') },
      ...(v.timing ? [{ text: `\n${v.timing}` }] : []),
      ...(v.window ? [{ text: `\n${v.window}` }] : []),
    ]),
  ];
  const rows: DocRun[][][] = soa.rows.map((r) => [[{ text: (r.name || '[Unnamed assessment]') + (r.markers ? ` ${r.markers}` : '') }], ...r.cells.map((c) => [{ text: c, bold: c === 'X' }])]);
  out.push(table(headers, rows, LANDSCAPE_TEXT, [4, ...soa.visits.map(() => 1.4)], 16));
  out.push(new Paragraph({ spacing: { before: 80 }, children: [new TextRun({ text: 'X = required procedure;  (X) = optional procedure.', italics: true, size: 16, font: FONT })] }));
  for (const f of soa.footnotes) {
    out.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: `${f.marker}  `, bold: true, size: 16, font: FONT }), new TextRun({ text: f.text, size: 16, font: FONT })] }));
  }
  return out;
}

export async function renderDocx(model: DocModel): Promise<Buffer> {
  listInstance = 0;
  const images = loadImages(model);
  const c = model.cover;

  const makeHeader = (width: number) => new Header({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: width }],
        children: [
          new TextRun({ text: (c.title || '').length > 80 ? c.title.slice(0, 77) + '…' : c.title, size: 15, color: '64748B', font: FONT }),
          new TextRun({ text: `\t${model.headerText}`, size: 15, color: model.draft ? 'B45309' : '64748B', bold: model.draft, font: FONT }),
        ],
      }),
    ],
  });
  const makeFooter = (width: number) => new Footer({
    children: [
      new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: '9AA5B8', space: 4 } },
        tabStops: [{ type: TabStopType.RIGHT, position: width }],
        children: [
          new TextRun({ text: model.footerText, size: 15, color: '475569', font: FONT }),
          new TextRun({ children: ['\tPage ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 15, color: '475569', font: FONT }),
        ],
      }),
    ],
  });

  const header = makeHeader(PORTRAIT_TEXT);
  const footer = makeFooter(PORTRAIT_TEXT);

  const coverRow = (label: string, value: string) =>
    new TableRow({
      children: [
        new TableCell({ width: { size: 2800, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20, color: '334155', font: FONT })] })] }),
        new TableCell({
          width: { size: PORTRAIT_TEXT - 2800, type: WidthType.DXA },
          children: [new Paragraph({ children: value ? [new TextRun({ text: value, size: 20, font: FONT })] : textRuns([{ text: model.draft ? '[Not entered]' : '—', placeholder: model.draft }]) })],
        }),
      ],
    });
  const thin = { style: BorderStyle.SINGLE, size: 4, color: 'D4DAE4' };
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };

  const portrait = { size: { width: A4_W, height: A4_H }, margin: { top: MARGIN + 300, bottom: MARGIN, left: MARGIN, right: MARGIN, header: 600, footer: 500 } };

  const sections: ISectionOptions[] = [
    {
      properties: { page: portrait },
      children: [
        new Paragraph({ spacing: { before: 1800, after: 300 }, children: [new TextRun({ text: 'CLINICAL TRIAL PROTOCOL', bold: true, size: 22, color: '475569', characterSpacing: 40, font: FONT })] }),
        new Paragraph({ spacing: { after: 500 }, children: [new TextRun({ text: c.title || '[Enter protocol title]', bold: true, size: 40, color: NAVY, font: FONT, highlight: c.title ? undefined : 'yellow' })] }),
        new Table({
          width: { size: PORTRAIT_TEXT, type: WidthType.DXA },
          columnWidths: [2800, PORTRAIT_TEXT - 2800],
          borders: { top: none, left: none, right: none, insideVertical: none, bottom: thin, insideHorizontal: thin },
          rows: [
            coverRow('Protocol number', c.protocolNumber),
            coverRow('Version', c.version),
            coverRow('Protocol date', c.protocolDate),
            ...(c.amendmentNumber ? [coverRow('Amendment', `${c.amendmentNumber}${c.amendmentDate ? ` (${c.amendmentDate})` : ''}`)] : []),
            coverRow('Sponsor', c.sponsorName),
            coverRow('Clinical phase', c.phase),
            coverRow('Therapeutic area', c.therapeuticArea),
            coverRow('Indication', c.indication),
            coverRow('Study design', c.studyDesign),
            coverRow('Document status', c.status),
          ],
        }),
        new Paragraph({
          spacing: { before: 1200 },
          children: [
            new TextRun({
              text: 'CONFIDENTIAL: This document contains confidential information belonging to the sponsor. It may not be disclosed, reproduced or used without written permission of the sponsor.',
              size: 16,
              color: '64748B',
              font: FONT,
            }),
          ],
        }),
        new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: `Prepared with ProtocolIQ using the ${c.templateName} (template v${c.templateVersion}).`, size: 15, color: '94A3B8', font: FONT })] }),
      ],
    },
    {
      properties: { page: portrait },
      headers: { default: header },
      footers: { default: footer },
      children: [
        new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun('TABLE OF CONTENTS')] }),
        new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-2' }),
        new Paragraph({
          spacing: { before: 200 },
          children: [new TextRun({ text: 'If page numbers are not shown, right-click the table and choose "Update Field".', italics: true, size: 15, color: '94A3B8', font: FONT })],
        }),
      ],
    },
    {
      properties: { page: { size: { width: A4_W, height: A4_H, orientation: PageOrientation.LANDSCAPE }, margin: portrait.margin } },
      headers: { default: makeHeader(LANDSCAPE_TEXT) },
      footers: { default: makeFooter(LANDSCAPE_TEXT) },
      children: soaBlocks(model),
    },
    {
      properties: { page: portrait },
      headers: { default: header },
      footers: { default: footer },
      children: blocks(model.body, images),
    },
  ];

  const doc = new Document({
    creator: 'ProtocolIQ',
    title: c.title,
    description: `Clinical trial protocol ${c.protocolNumber}`,
    features: { updateFields: true },
    styles: {
      default: { document: { run: { font: FONT, size: 20 }, paragraph: { spacing: { line: 276 } } } },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { font: FONT, size: 26, bold: true, color: NAVY }, paragraph: { spacing: { after: 240 } } },
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 26, bold: true, color: NAVY }, paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 22, bold: true, color: '1E293B' }, paragraph: { spacing: { before: 240, after: 80 }, outlineLevel: 1 } },
      ],
    },
    numbering: {
      config: [
        {
          reference: 'protocol-numbered',
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }],
        },
      ],
    },
    sections,
  });
  return Packer.toBuffer(doc);
}
