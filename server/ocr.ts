import express, { Router, type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyCorrections,
  ocrToMarkdown,
  tableText,
  type OcrCorrection,
  type OcrDocument,
  type OcrInspection,
  type OcrJobStatus,
  type OcrResult,
  type OcrStatus,
  type OcrTable,
} from '../shared/ocr.ts';
import { DATA_DIR, db } from './db.ts';
import { digitiseBlocks, type Block } from './digitise.ts';
import { HttpError, uid } from './repo.ts';

// OCR documents are registered in source_documents (kind = 'ocr'); files live under data/documents/<id>/.
// Text detection, layout analysis and table recognition run in the local Python PaddleOCR service (ocr_service/).

const OCR_URL = (process.env.OCR_SERVICE_URL ?? 'http://127.0.0.1:4200').replace(/\/$/, '');
const DOCS_DIR = path.join(DATA_DIR, 'documents');
const MAX_UPLOAD = process.env.OCR_MAX_UPLOAD ?? '200mb';
const STALE_MS = 3 * 60_000;

const FORMATS: Record<string, { mime: string; magic: (b: Buffer) => boolean }> = {
  '.pdf': { mime: 'application/pdf', magic: (b) => b.subarray(0, 1024).includes('%PDF-') },
  '.png': { mime: 'image/png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  '.jpg': { mime: 'image/jpeg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  '.jpeg': { mime: 'image/jpeg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  '.tif': { mime: 'image/tiff', magic: (b) => ['49492a00', '4d4d002a'].includes(b.subarray(0, 4).toString('hex')) },
  '.tiff': { mime: 'image/tiff', magic: (b) => ['49492a00', '4d4d002a'].includes(b.subarray(0, 4).toString('hex')) },
};

interface DocRow {
  id: string;
  filename: string;
  mime_type: string;
  size: number;
  uploaded_at: string;
  storage_path: string;
  ocr_status: OcrStatus;
  ocr_error: string | null;
  page_count: number | null;
  inspection_json: string | null;
  linked_protocol_id: string | null;
}

const docDir = (id: string) => path.join(DOCS_DIR, id);
const workDir = (id: string) => path.join(docDir(id), 'ocr');

function getRow(id: string): DocRow {
  const row = db.prepare(`SELECT * FROM source_documents WHERE id = ? AND kind = 'ocr'`).get(id) as DocRow | undefined;
  if (!row) throw new HttpError(404, 'OCR document not found');
  return row;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function service<T>(route: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  let res: globalThis.Response;
  try {
    res = await fetch(OCR_URL + route, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
    });
  } catch (e) {
    const reason = (e as Error).name === 'TimeoutError' ? 'did not respond in time' : 'is not reachable';
    throw new HttpError(503, `The local OCR service ${reason} at ${OCR_URL}. Start it with "npm run dev:ocr" (first-time setup: "npm run ocr:setup").`);
  }
  const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
  if (!res.ok) {
    const detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body);
    throw new HttpError(res.status >= 500 ? 502 : res.status, `OCR service error: ${detail}`);
  }
  return body as T;
}

function setStatus(id: string, status: OcrStatus, error: string | null = null) {
  db.prepare(`UPDATE source_documents SET ocr_status = ?, ocr_error = ? WHERE id = ?`).run(status, error, id);
}

const ACTIVE: OcrStatus[] = ['queued', 'processing'];

/** Current job status from the service's status file; detects jobs orphaned by a service restart. */
async function jobStatus(row: DocRow): Promise<OcrJobStatus | null> {
  const file = path.join(workDir(row.id), 'status.json');
  let status = readJson<OcrJobStatus>(file);
  if (!status) return null;
  if (ACTIVE.includes(status.status) && Date.now() - Date.parse(status.updatedAt) > STALE_MS) {
    const live = await service<OcrJobStatus>(`/jobs/${row.id}`, { timeoutMs: 5000 }).catch(() => null);
    if (!live || !ACTIVE.includes(live.status)) {
      status = {
        ...status,
        status: 'failed',
        message: 'Processing was interrupted (the OCR service stopped). Reprocess to continue; pages that already finished are reused.',
        updatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(file, JSON.stringify(status, null, 2));
    } else status = live;
  }
  if (status.status !== row.ocr_status) {
    setStatus(row.id, status.status, status.status === 'failed' ? status.message : null);
    row.ocr_status = status.status;
  }
  return status;
}

async function toDocument(row: DocRow): Promise<OcrDocument> {
  const job = await jobStatus(row);
  const protocolExists = row.linked_protocol_id ? !!db.prepare(`SELECT 1 FROM protocols WHERE id = ?`).get(row.linked_protocol_id) : false;
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mime_type,
    size: row.size,
    uploadedAt: row.uploaded_at,
    status: row.ocr_status,
    pageCount: row.page_count,
    error: row.ocr_status === 'failed' ? (job?.message ?? row.ocr_error) : row.ocr_error,
    protocolId: protocolExists ? row.linked_protocol_id : null,
    inspection: row.inspection_json ? (JSON.parse(row.inspection_json) as OcrInspection) : null,
    job,
  };
}

async function inspect(row: DocRow): Promise<OcrInspection> {
  const inspection = await service<OcrInspection>('/inspect', {
    method: 'POST',
    body: JSON.stringify({ document_id: row.id, file_path: path.join(DATA_DIR, row.storage_path), work_dir: workDir(row.id) }),
    timeoutMs: 120_000,
  });
  db.prepare(`UPDATE source_documents SET inspection_json = ?, page_count = ?, ocr_error = NULL WHERE id = ?`).run(JSON.stringify(inspection), inspection.pageCount, row.id);
  return inspection;
}

async function startJob(row: DocRow, options: Record<string, unknown>) {
  if (ACTIVE.includes(row.ocr_status)) {
    const live = await jobStatus(row);
    if (live && ACTIVE.includes(live.status)) throw new HttpError(409, 'This document is already being processed.');
  }
  const status = await service<OcrJobStatus>('/jobs', {
    method: 'POST',
    body: JSON.stringify({
      document_id: row.id,
      document_name: row.filename,
      mime_type: row.mime_type,
      file_path: path.join(DATA_DIR, row.storage_path),
      work_dir: workDir(row.id),
      options,
    }),
  });
  setStatus(row.id, status.status);
  return status;
}

function corrections(id: string) {
  const rows = db.prepare(`SELECT element_id, text, table_json, updated_at FROM ocr_corrections WHERE document_id = ?`).all(id) as {
    element_id: string;
    text: string | null;
    table_json: string | null;
    updated_at: string;
  }[];
  return new Map(
    rows.map((r) => [
      r.element_id,
      { ...(r.text !== null ? { text: r.text } : {}), ...(r.table_json ? { table: JSON.parse(r.table_json) as OcrTable } : {}), updatedAt: r.updated_at },
    ]),
  );
}

function loadResult(id: string, { raw = false } = {}): OcrResult {
  const result = readJson<OcrResult>(path.join(workDir(id), 'result.json'));
  if (!result) throw new HttpError(409, 'No OCR results yet. Process the document first.');
  return raw ? result : applyCorrections(result, corrections(id));
}

/** OCR elements → digitisation blocks, so the existing rule-based template mapping can consume OCR output. */
function toBlocks(result: OcrResult): Block[] {
  const blocks: Block[] = [];
  const ordered = [...result.elements].sort((a, b) => a.page - b.page || a.order - b.order);
  for (const el of ordered) {
    const text = el.text.replace(/\s+/g, ' ').trim();
    switch (el.type) {
      case 'title':
      case 'heading':
        if (text) blocks.push({ kind: 'heading', text, level: el.level ?? undefined });
        break;
      case 'list_item':
        if (text) blocks.push({ kind: 'item', text });
        break;
      case 'paragraph':
      case 'reference':
      case 'caption':
      case 'footnote':
        if (text) blocks.push({ kind: 'para', text });
        break;
      case 'table': {
        if (!el.table) break;
        const rows = tableText(el.table).split('\n');
        rows.forEach((r, i) => blocks.push({ kind: 'para', text: r, tableHeader: i < el.table!.headerRows || undefined }));
        break;
      }
      default:
        break;
    }
  }
  return blocks;
}

function safeName(name: string) {
  return path.basename(name).replace(/[^\w.\- ()]+/g, '_').slice(0, 180) || 'document';
}

function removeOrphanDirs() {
  if (!fs.existsSync(DOCS_DIR)) return;
  const known = new Set((db.prepare(`SELECT id FROM source_documents WHERE kind = 'ocr'`).all() as { id: string }[]).map((r) => r.id));
  for (const entry of fs.readdirSync(DOCS_DIR)) {
    if (!known.has(entry)) fs.rmSync(path.join(DOCS_DIR, entry), { recursive: true, force: true });
  }
}

type Handler = (req: Request, res: Response) => unknown;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res)).catch(next);
const param = (req: Request, key: string) => String(req.params[key]);

export function ocrRouter(): Router {
  removeOrphanDirs();
  const r = Router();

  r.get('/health', h(async (_req, res) => {
    const health = await service<Record<string, unknown>>('/health', { timeoutMs: 5000 }).catch((e: Error) => ({ ok: false, error: e.message }));
    res.json({ serviceUrl: OCR_URL, ...health });
  }));

  r.get('/documents', h(async (_req, res) => {
    const rows = db.prepare(`SELECT * FROM source_documents WHERE kind = 'ocr' ORDER BY uploaded_at DESC`).all() as unknown as DocRow[];
    res.json(await Promise.all(rows.map(toDocument)));
  }));

  r.get('/documents/:id', h(async (req, res) => res.json(await toDocument(getRow(param(req, 'id'))))));

  r.post('/upload', express.raw({ type: () => true, limit: MAX_UPLOAD }), h(async (req, res) => {
    const filename = safeName(String(req.query.filename ?? ''));
    const ext = path.extname(filename).toLowerCase();
    const format = FORMATS[ext];
    if (!format) throw new HttpError(415, `Unsupported file type "${ext || 'none'}". OCR accepts PDF, PNG, JPG/JPEG and TIFF.`);
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) throw new HttpError(400, 'Empty upload');
    if (!format.magic(body)) throw new HttpError(415, `The file content does not look like a valid ${ext.slice(1).toUpperCase()} file.`);

    const id = uid();
    const storagePath = path.join('documents', id, `original${ext}`);
    fs.mkdirSync(workDir(id), { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, storagePath), body);
    db.prepare(
      `INSERT INTO source_documents (id, filename, mime_type, size, parse_report_json, uploaded_at, kind, storage_path, ocr_status)
       VALUES (?, ?, ?, ?, 'null', ?, 'ocr', ?, 'uploaded')`,
    ).run(id, filename, format.mime, body.length, new Date().toISOString(), storagePath);

    const row = getRow(id);
    try {
      await inspect(row);
      if (req.query.process === '1') await startJob(getRow(id), {});
    } catch (e) {
      // The upload itself succeeded; inspection/processing can be retried once the service is available.
      db.prepare(`UPDATE source_documents SET ocr_error = ? WHERE id = ?`).run((e as Error).message, id);
    }
    res.status(201).json(await toDocument(getRow(id)));
  }));

  r.post('/process/:id', h(async (req, res) => {
    const row = getRow(param(req, 'id'));
    if (!row.inspection_json) await inspect(row);
    const { mode, forceOcr, dpi, ocrEmbeddedImages, autoRotate, device, keepCorrections } = (req.body ?? {}) as Record<string, unknown>;
    const options: Record<string, unknown> = {};
    if (mode === 'structure' || mode === 'text') options.mode = mode;
    if (typeof forceOcr === 'boolean') options.force_ocr = forceOcr;
    if (typeof ocrEmbeddedImages === 'boolean') options.ocr_embedded_images = ocrEmbeddedImages;
    if (typeof autoRotate === 'boolean') options.auto_rotate = autoRotate;
    if (typeof dpi === 'number' && dpi >= 72 && dpi <= 400) options.dpi = Math.round(dpi);
    if (typeof device === 'string' && /^(auto|cpu|gpu(:\d+)?)$/.test(device)) options.device = device;
    const status = await startJob(getRow(row.id), options);
    // Element ids can change between runs, so manual corrections only survive a reprocess when asked to.
    if (keepCorrections !== true) db.prepare(`DELETE FROM ocr_corrections WHERE document_id = ?`).run(row.id);
    res.status(202).json(status);
  }));

  r.post('/cancel/:id', h(async (req, res) => {
    const row = getRow(param(req, 'id'));
    res.json(await service<OcrJobStatus>(`/jobs/${row.id}`, { method: 'DELETE' }));
  }));

  r.get('/status/:id', h(async (req, res) => {
    const row = getRow(param(req, 'id'));
    const job = await jobStatus(row);
    res.json(
      job ?? {
        documentId: row.id,
        status: row.ocr_status,
        stage: 'idle',
        message: row.ocr_error ?? 'Not processed yet',
        pagesDone: 0,
        pageCount: row.page_count ?? 0,
        currentPage: null,
        pageErrors: [],
        startedAt: null,
        updatedAt: row.uploaded_at,
        finishedAt: null,
      },
    );
  }));

  r.get('/results/:id', h((req, res) => {
    const id = getRow(param(req, 'id')).id;
    const result = loadResult(id, { raw: req.query.raw === '1' });
    const format = String(req.query.format ?? 'json');
    const base = path.parse(result.documentName).name;
    if (format === 'markdown' || format === 'md') {
      if (req.query.download === '1') res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(base)}.ocr.md"`);
      res.type('text/markdown; charset=utf-8').send(ocrToMarkdown(result));
      return;
    }
    if (req.query.page) {
      const page = Number(req.query.page);
      res.json({ ...result, pages: result.pages.filter((p) => p.page === page), elements: result.elements.filter((e) => e.page === page) });
      return;
    }
    if (req.query.download === '1') res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(base)}.ocr.json"`);
    res.json(result);
  }));

  r.get('/tables/:id', h((req, res) => {
    const result = loadResult(getRow(param(req, 'id')).id);
    res.json(
      result.elements
        .filter((e) => e.type === 'table' && e.table)
        .map((e) => ({ id: e.id, documentId: e.documentId, documentName: e.documentName, page: e.page, bbox: e.bbox, confidence: e.confidence, source: e.source, corrected: !!e.corrected, table: e.table })),
    );
  }));

  r.put('/results/:id/elements/:elementId', h((req, res) => {
    const id = getRow(param(req, 'id')).id;
    const elementId = param(req, 'elementId');
    const original = loadResult(id, { raw: true }).elements.find((e) => e.id === elementId);
    if (!original) throw new HttpError(404, 'Element not found');
    const body = (req.body ?? {}) as OcrCorrection;
    const text = typeof body.text === 'string' ? body.text : null;
    let table: OcrTable | null = null;
    if (body.table) {
      if (!original.table) throw new HttpError(400, 'This element is not a table');
      const t = body.table;
      if (!Array.isArray(t.cells) || !t.cells.every((c) => Number.isInteger(c.row) && Number.isInteger(c.col) && typeof c.text === 'string')) {
        throw new HttpError(400, 'Invalid table structure');
      }
      table = { ...original.table, ...t, cells: t.cells.map((c) => ({ ...c, rowSpan: Math.max(1, c.rowSpan ?? 1), colSpan: Math.max(1, c.colSpan ?? 1), header: !!c.header })) };
    }
    if (text === null && !table) throw new HttpError(400, 'Provide corrected text or table');
    db.prepare(
      `INSERT INTO ocr_corrections (document_id, element_id, text, table_json, updated_at) VALUES (?,?,?,?,?)
       ON CONFLICT(document_id, element_id) DO UPDATE SET text = COALESCE(excluded.text, text), table_json = COALESCE(excluded.table_json, table_json), updated_at = excluded.updated_at`,
    ).run(id, elementId, text, table ? JSON.stringify(table) : null, new Date().toISOString());
    res.json(loadResult(id).elements.find((e) => e.id === elementId));
  }));

  r.delete('/results/:id/elements/:elementId', h((req, res) => {
    const id = getRow(param(req, 'id')).id;
    db.prepare(`DELETE FROM ocr_corrections WHERE document_id = ? AND element_id = ?`).run(id, param(req, 'elementId'));
    res.json(loadResult(id).elements.find((e) => e.id === param(req, 'elementId')) ?? null);
  }));

  r.get('/documents/:id/file', h((req, res) => {
    const row = getRow(param(req, 'id'));
    res.type(row.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.filename)}"`);
    res.sendFile(path.join(DATA_DIR, row.storage_path));
  }));

  r.get('/documents/:id/pages/:page/image', h(async (req, res) => {
    const row = getRow(param(req, 'id'));
    const page = Number(param(req, 'page'));
    if (!Number.isInteger(page) || page < 1 || (row.page_count && page > row.page_count)) throw new HttpError(404, 'Page not found');
    const processed = readJson<OcrResult>(path.join(workDir(row.id), 'result.json'))?.pages.find((p) => p.page === page)?.image;
    const candidate = processed ? path.resolve(workDir(row.id), processed) : null;
    const file =
      candidate && candidate.startsWith(workDir(row.id) + path.sep) && fs.existsSync(candidate)
        ? candidate
        : path.join(workDir(row.id), 'preview', `page-${String(page).padStart(4, '0')}.png`);
    if (!fs.existsSync(file)) {
      await service('/render', {
        method: 'POST',
        body: JSON.stringify({ file_path: path.join(DATA_DIR, row.storage_path), work_dir: workDir(row.id), page }),
        timeoutMs: 60_000,
      });
    }
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.type('image/png').sendFile(file);
  }));

  r.post('/documents/:id/digitise', h((req, res) => {
    const row = getRow(param(req, 'id'));
    const result = loadResult(row.id);
    const blocks = toBlocks(result);
    if (!blocks.length) throw new HttpError(422, 'The OCR result contains no text to structure.');
    res.status(201).json(digitiseBlocks(blocks, { filename: row.filename, mimeType: row.mime_type, size: row.size, sourceDocumentId: row.id }));
  }));

  r.delete('/documents/:id', h(async (req, res) => {
    const row = getRow(param(req, 'id'));
    if (ACTIVE.includes(row.ocr_status)) await service(`/jobs/${row.id}`, { method: 'DELETE', timeoutMs: 5000 }).catch(() => null);
    db.prepare(`DELETE FROM source_documents WHERE id = ?`).run(row.id);
    fs.rmSync(docDir(row.id), { recursive: true, force: true });
    res.status(204).end();
  }));

  return r;
}
