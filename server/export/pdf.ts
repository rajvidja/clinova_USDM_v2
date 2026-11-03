import { createRequire } from 'node:module';
import path from 'node:path';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { DocBlock, DocModel, DocRun } from '../../shared/docModel.ts';
import { loadImages } from './images.ts';

const require = createRequire(import.meta.url);
const pdfmake = require('pdfmake');
const fonts = require('pdfmake/fonts/Roboto.js');
const fontDir = path.dirname(require.resolve('pdfmake/fonts/Roboto.js'));
pdfmake.addFonts(fonts);
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((p: string) => path.resolve(p).startsWith(fontDir));

const NAVY = '#12264a';
const RULE = '#9aa5b8';

const runs = (rs: DocRun[]) =>
  rs.map((r) =>
    r.placeholder
      ? { text: r.text, italics: true, color: '#9a3412', background: '#fef3c7' }
      : { text: r.text, bold: r.bold, italics: r.italic, decoration: r.underline ? ('underline' as const) : undefined },
  );

function block(b: DocBlock, images: ReturnType<typeof loadImages>): Content | null {
  switch (b.t) {
    case 'heading':
      return b.level === 1
        ? { text: `${b.number}.  ${b.text}`, style: 'h1', tocItem: true, tocStyle: { bold: true }, tocMargin: [0, 6, 0, 0], id: b.anchor, headlineLevel: 1 }
        : { text: `${b.number}  ${b.text}`, style: 'h2', tocItem: true, tocMargin: [18, 1, 0, 0], id: b.anchor, headlineLevel: 2 };
    case 'label':
      return { text: b.text, style: 'label' };
    case 'para':
      return { text: runs(b.runs), style: 'body' };
    case 'list': {
      const items = b.items.map((i) => ({ text: runs(i) }));
      if (b.style === 'none') return { stack: items.map((i) => ({ ...i, margin: [0, 0, 0, 3] })), style: 'body' };
      return b.style === 'number' ? { ol: items, style: 'body' } : { ul: items, style: 'body' };
    }
    case 'table': {
      const total = b.widths?.reduce((a, c) => a + c, 0);
      return {
        style: b.compact ? 'tableCompact' : 'table',
        table: {
          headerRows: 1,
          dontBreakRows: true,
          widths: b.widths && total ? b.widths.map((w) => `${((w / total) * 100).toFixed(2)}%`) : b.headers.map(() => '*'),
          body: [b.headers.map((h) => ({ text: h, style: 'th' })), ...b.rows.map((r) => r.map((c) => ({ text: runs(c) })))],
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => RULE,
          vLineColor: () => RULE,
          fillColor: (row: number) => (row === 0 ? '#e8edf5' : null),
          paddingTop: () => 3,
          paddingBottom: () => 3,
        },
      };
    }
    case 'image': {
      const img = images.get(b.attachmentId);
      if (!img) return { text: `[Image unavailable: ${b.filename}]`, style: 'body', italics: true };
      return {
        stack: [
          { image: `data:${img.mimeType};base64,${img.data.toString('base64')}`, fit: [440, 420], alignment: 'center' },
          { text: b.filename, style: 'caption' },
        ],
        margin: [0, 4, 0, 8],
      };
    }
    case 'attachment':
      return { text: [{ text: 'Attachment: ', bold: true }, `${b.filename} (${Math.max(1, Math.round(b.size / 1024))} KB)`], style: 'body' };
  }
}

function soaContent(model: DocModel): Content[] {
  const out: Content[] = [{ text: 'SCHEDULE OF ACTIVITIES', style: 'h1', tocItem: true, tocStyle: { bold: true }, tocMargin: [0, 6, 0, 0] }];
  const soa = model.soa;
  if (!soa || !soa.rows.length) {
    out.push({ text: runs([{ text: model.draft ? '[Schedule of Activities not yet defined]' : '[Not provided]', placeholder: true }]), style: 'body' });
    return out;
  }
  const sup = (m: string) => (m ? [{ text: ` ${m}`, sup: true, fontSize: 6 }] : []);
  const header = [
    { text: 'Assessment / Procedure', style: 'th' },
    ...soa.visits.map((v) => ({
      stack: [{ text: [v.name, ...sup(v.markers)], bold: true }, ...(v.timing ? [{ text: v.timing, fontSize: 6.5 }] : []), ...(v.window ? [{ text: v.window, fontSize: 6.5, color: '#475569' }] : [])],
      style: 'th',
      alignment: 'center' as const,
    })),
  ];
  const body = soa.rows.map((r) => [
    { text: [r.name || '[Unnamed assessment]', ...sup(r.markers)], ...(r.category ? {} : {}) },
    ...r.cells.map((c) => ({ text: c, alignment: 'center' as const, bold: c === 'X' })),
  ]);
  out.push({
    style: 'tableCompact',
    table: { headerRows: 1, dontBreakRows: true, widths: [150, ...soa.visits.map(() => '*')], body: [header, ...body] },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => RULE,
      vLineColor: () => RULE,
      fillColor: (row: number) => (row === 0 ? '#e8edf5' : null),
    },
  });
  out.push({ text: 'X = required procedure;  (X) = optional procedure.', style: 'caption', alignment: 'left' });
  if (soa.footnotes.length) {
    out.push({ stack: soa.footnotes.map((f) => ({ text: [{ text: `${f.marker}  `, bold: true }, f.text], fontSize: 8, margin: [0, 1, 0, 1] })), margin: [0, 4, 0, 0] });
  }
  return out;
}

export async function renderPdf(model: DocModel): Promise<Buffer> {
  const images = loadImages(model);
  const c = model.cover;
  const coverRow = (label: string, value: string) => [{ text: label, bold: true, color: '#334155' }, value ? { text: value } : { text: model.draft ? '[Not entered]' : '—', italics: true, color: '#9a3412' }];
  const cover: Content[] = [
    { text: 'CLINICAL TRIAL PROTOCOL', fontSize: 11, bold: true, color: '#475569', characterSpacing: 2, margin: [0, 80, 0, 18] },
    { text: c.title || '[Enter protocol title]', fontSize: 20, bold: true, color: NAVY, lineHeight: 1.15, margin: [0, 0, 0, 26] },
    {
      table: {
        widths: [150, '*'],
        body: [
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
      },
      layout: { hLineWidth: (i: number) => (i === 0 ? 0 : 0.5), vLineWidth: () => 0, hLineColor: () => '#d4dae4', paddingTop: () => 5, paddingBottom: () => 5 },
      fontSize: 10,
    },
    {
      text: 'CONFIDENTIAL: This document contains confidential information belonging to the sponsor. It may not be disclosed, reproduced or used without written permission of the sponsor.',
      fontSize: 8,
      color: '#64748b',
      margin: [0, 60, 0, 0],
    },
    { text: `Prepared with ProtocolIQ using the ${c.templateName} (template v${c.templateVersion}).`, fontSize: 7.5, color: '#94a3b8', margin: [0, 6, 0, 0] },
  ];

  const doc: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [62, 72, 62, 64],
    info: { title: c.title, subject: `Protocol ${c.protocolNumber}`, creator: 'ProtocolIQ' },
    watermark: model.draft ? { text: 'DRAFT', color: '#64748b', opacity: 0.06, bold: true, angle: -45 } : undefined,
    header: (page: number) =>
      page === 1
        ? null
        : {
            columns: [
              { text: (c.title || '').length > 90 ? c.title.slice(0, 87) + '…' : c.title, fontSize: 7.5, color: '#64748b' },
              { text: model.headerText, fontSize: 7.5, color: model.draft ? '#b45309' : '#64748b', alignment: 'right', width: 'auto', bold: model.draft },
            ],
            margin: [62, 34, 62, 0],
          },
    footer: (page: number, pages: number, size: { width: number }) =>
      page === 1
        ? null
        : {
            stack: [
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: size.width - 124, y2: 0, lineWidth: 0.5, lineColor: RULE }] },
              {
                columns: [
                  { text: model.footerText, fontSize: 7.5, color: '#475569' },
                  { text: `Page ${page} of ${pages}`, fontSize: 7.5, color: '#475569', alignment: 'right', width: 'auto' },
                ],
                margin: [0, 5, 0, 0],
              },
            ],
            margin: [62, 18, 62, 0],
          },
    content: [
      ...cover,
      { toc: { title: { text: 'TABLE OF CONTENTS', style: 'h1' }, numberStyle: { fontSize: 9 }, textStyle: { fontSize: 9 } }, pageBreak: 'before' },
      { stack: soaContent(model), pageOrientation: 'landscape', pageBreak: 'before' } as Content,
      { stack: model.body.map((b) => block(b, images)).filter(Boolean) as Content[], pageOrientation: 'portrait', pageBreak: 'before' } as Content,
    ],
    pageBreakBefore: (node: any) => node.headlineLevel === 1 && node.startPosition?.verticalRatio > 0.82,
    defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.25, color: '#0f172a' },
    styles: {
      h1: { fontSize: 13, bold: true, color: NAVY, margin: [0, 16, 0, 6] },
      h2: { fontSize: 11, bold: true, color: '#1e293b', margin: [0, 10, 0, 4] },
      label: { fontSize: 9.5, bold: true, color: '#334155', margin: [0, 6, 0, 2] },
      body: { margin: [0, 0, 0, 6], alignment: 'justify' },
      table: { fontSize: 9, margin: [0, 2, 0, 10] },
      tableCompact: { fontSize: 7.5, margin: [0, 2, 0, 10] },
      th: { bold: true, color: NAVY },
      caption: { fontSize: 8, italics: true, color: '#475569', alignment: 'center', margin: [0, 2, 0, 6] },
    },
  };
  return pdfmake.createPdf(doc).getBuffer();
}
