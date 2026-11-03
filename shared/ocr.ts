// Structured OCR / document-layout output shared by the Python OCR service, the Node API and the UI.
// The Python service (ocr_service/) writes this schema; keep both sides in sync via OCR_SCHEMA_VERSION.

export const OCR_SCHEMA_VERSION = 1;

export const OCR_FORMATS = ['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff'] as const;

export type OcrStatus = 'uploaded' | 'queued' | 'processing' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled';

export type OcrElementType =
  | 'title'
  | 'heading'
  | 'paragraph'
  | 'list_item'
  | 'table'
  | 'image'
  | 'caption'
  | 'footnote'
  | 'page_header'
  | 'page_footer'
  | 'page_number'
  | 'formula'
  | 'reference'
  | 'other';

export type OcrTableKind = 'schedule_of_activities' | 'visit_schedule' | 'study_procedures' | 'eligibility_criteria' | 'endpoints' | 'other';

/** [x0, y0, x1, y1] in the owning page's coordinate space (see OcrPage.width/height/unit). */
export type BBox = [number, number, number, number];

export interface OcrTableCell {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  text: string;
  header: boolean;
  bbox?: BBox | null;
  confidence?: number | null;
}

export interface OcrTable {
  rows: number;
  cols: number;
  headerRows: number;
  /** Anchor cells only; a merged cell appears once with rowSpan/colSpan > 1. */
  cells: OcrTableCell[];
  caption: string | null;
  kind: OcrTableKind;
  /** Element ids of footnotes that belong to this table. */
  footnoteIds: string[];
  /** Element ids of text that refers to this table (e.g. "see Table 3"). */
  referencedBy: string[];
  /** Id of the table on the previous page that this table continues (multi-page tables). */
  continuedFrom?: string | null;
  html?: string | null;
}

export interface OcrElement {
  id: string;
  documentId: string;
  documentName: string;
  page: number;
  /** Reading order within the page, starting at 0. */
  order: number;
  type: OcrElementType;
  level?: number | null;
  text: string;
  bbox: BBox | null;
  confidence: number | null;
  source: 'native' | 'ocr';
  /** Raw layout label from PP-StructureV3 or the native extractor. */
  layoutLabel?: string | null;
  table?: OcrTable | null;
  /** Text recognised inside an embedded raster image on a digital page. */
  imageText?: string | null;
  corrected?: boolean;
}

export interface OcrPage {
  page: number;
  width: number;
  height: number;
  unit: 'pt' | 'px';
  /** How the page was read: native PDF text, PaddleOCR, or native text plus OCR of embedded images. */
  method: 'native' | 'ocr' | 'native+ocr';
  classification: 'digital' | 'scanned' | 'mixed';
  textChars: number;
  imageCoverage: number;
  image: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  meanConfidence: number | null;
  durationMs: number;
  /** Degrees the page was rotated to make it upright before analysis; coordinates and `image` are upright. */
  rotation?: number;
  error?: string | null;
}

export interface OcrResult {
  schemaVersion: number;
  documentId: string;
  documentName: string;
  mimeType: string;
  pageCount: number;
  pages: OcrPage[];
  elements: OcrElement[];
  engine: Record<string, unknown>;
  options: Record<string, unknown>;
  createdAt: string;
  /** Present when the result includes manual corrections. */
  correctedAt?: string | null;
}

export interface OcrJobStatus {
  documentId: string;
  status: OcrStatus;
  stage: string;
  message: string;
  pagesDone: number;
  pageCount: number;
  currentPage: number | null;
  pageErrors: { page: number; error: string }[];
  startedAt: string | null;
  updatedAt: string;
  finishedAt: string | null;
}

export interface OcrInspection {
  pageCount: number;
  kind: 'pdf' | 'image';
  pages: { page: number; classification: 'digital' | 'scanned' | 'mixed'; textChars: number; imageCoverage: number; image: string | null }[];
}

export interface OcrDocument {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  status: OcrStatus;
  pageCount: number | null;
  error: string | null;
  protocolId: string | null;
  inspection: OcrInspection | null;
  job: OcrJobStatus | null;
}

export interface OcrCorrection {
  text?: string;
  table?: OcrTable;
}

export function applyCorrections(result: OcrResult, corrections: Map<string, OcrCorrection & { updatedAt: string }>): OcrResult {
  if (!corrections.size) return result;
  let latest = '';
  const elements = result.elements.map((el) => {
    const c = corrections.get(el.id);
    if (!c) return el;
    if (c.updatedAt > latest) latest = c.updatedAt;
    const table = c.table && el.table ? { ...el.table, ...c.table } : el.table;
    return { ...el, text: c.text ?? (table && c.table ? tableText(table) : el.text), table, corrected: true };
  });
  return { ...result, elements, correctedAt: latest || null };
}

/** Expand a table into a dense grid; merged cells repeat their text and keep a pointer to the anchor cell. */
export function tableGrid(t: OcrTable): ({ cell: OcrTableCell; anchor: boolean } | null)[][] {
  const grid: ({ cell: OcrTableCell; anchor: boolean } | null)[][] = Array.from({ length: t.rows }, () => Array<null>(t.cols).fill(null));
  for (const cell of t.cells) {
    for (let r = cell.row; r < Math.min(t.rows, cell.row + cell.rowSpan); r++) {
      for (let c = cell.col; c < Math.min(t.cols, cell.col + cell.colSpan); c++) {
        grid[r][c] = { cell, anchor: r === cell.row && c === cell.col };
      }
    }
  }
  return grid;
}

export function tableText(t: OcrTable): string {
  return tableGrid(t)
    .map((row) => row.map((g) => (g?.anchor ? g.cell.text : '')).filter(Boolean).join(' | '))
    .filter(Boolean)
    .join('\n');
}

const mdEscape = (s: string) => s.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
const htmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function tableToMarkdown(t: OcrTable): string {
  const merged = t.cells.some((c) => c.rowSpan > 1 || c.colSpan > 1);
  if (merged || t.headerRows > 1) {
    // GitHub-flavoured Markdown cannot express merged cells, so keep them as an HTML table.
    const rows: string[] = [];
    for (let r = 0; r < t.rows; r++) {
      const cells = t.cells
        .filter((c) => c.row === r)
        .sort((a, b) => a.col - b.col)
        .map((c) => {
          const tag = c.header ? 'th' : 'td';
          const span = `${c.rowSpan > 1 ? ` rowspan="${c.rowSpan}"` : ''}${c.colSpan > 1 ? ` colspan="${c.colSpan}"` : ''}`;
          return `<${tag}${span}>${htmlEscape(c.text)}</${tag}>`;
        });
      rows.push(`  <tr>${cells.join('')}</tr>`);
    }
    return `<table>\n${rows.join('\n')}\n</table>`;
  }
  const grid = tableGrid(t).map((row) => row.map((g) => mdEscape(g?.cell.text ?? '')));
  if (!grid.length) return '';
  const header = t.headerRows > 0 ? grid[0] : grid[0].map((_, i) => `Column ${i + 1}`);
  const body = t.headerRows > 0 ? grid.slice(1) : grid;
  return [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...body.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

export function ocrToMarkdown(result: OcrResult, opts: { includePageMarkers?: boolean; includeHeadersFooters?: boolean } = {}): string {
  const { includePageMarkers = true, includeHeadersFooters = false } = opts;
  const out: string[] = [`# ${result.documentName}`, '', `> Extracted by ProtocolIQ OCR (${result.pageCount} page(s)). Document ID: ${result.documentId}`, ''];
  for (const page of result.pages) {
    if (includePageMarkers) out.push(`<!-- page ${page.page} · ${page.method} -->`, '');
    if (page.error) out.push(`> **Page ${page.page} could not be processed:** ${page.error}`, '');
    const els = result.elements.filter((e) => e.page === page.page).sort((a, b) => a.order - b.order);
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
    const tableCaptions = new Set(els.flatMap((e) => (e.table?.caption ? [norm(e.table.caption)] : [])));
    for (const el of els) {
      if (!includeHeadersFooters && (el.type === 'page_header' || el.type === 'page_footer' || el.type === 'page_number')) continue;
      if (el.type === 'caption' && tableCaptions.has(norm(el.text))) continue;
      const text = el.text.trim();
      switch (el.type) {
        case 'title':
          out.push(`## ${text}`);
          break;
        case 'heading':
          out.push(`${'#'.repeat(Math.min(6, 2 + (el.level ?? 1)))} ${text}`);
          break;
        case 'list_item':
          out.push(`- ${text}`);
          break;
        case 'table':
          if (el.table?.caption) out.push(`**${el.table.caption}**`, '');
          out.push(el.table ? tableToMarkdown(el.table) : text);
          break;
        case 'image':
          out.push(`*[Image${el.imageText ? `: ${mdEscape(el.imageText)}` : ''}]*`);
          break;
        case 'caption':
          out.push(`*${text}*`);
          break;
        case 'footnote':
          out.push(`<sub>${text}</sub>`);
          break;
        case 'formula':
          out.push(`$$${text}$$`);
          break;
        default:
          if (text) out.push(text);
      }
      out.push('');
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}
