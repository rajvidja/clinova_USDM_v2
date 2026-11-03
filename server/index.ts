import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { buildDocModel } from '../shared/docModel.ts';
import { TEMPLATES } from '../shared/template/index.ts';
import type { FieldType, ProtocolStatus, SaveRequest } from '../shared/types.ts';
import { validateProtocol } from '../shared/validation.ts';
import { digitiseDocument, listSourceDocuments } from './digitise.ts';
import { renderDocx } from './export/docx.ts';
import { renderJson } from './export/json.ts';
import { renderPdf } from './export/pdf.ts';
import { ocrRouter } from './ocr.ts';
import * as repo from './repo.ts';

const app = express();
app.use(express.json({ limit: '25mb' }));

type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res)).catch(next);
const p = (req: Request, key: string) => String(req.params[key]);

const safeName = (s: string) => (s || 'protocol').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/dashboard', h((_req, res) => res.json(repo.dashboardStats())));
app.get('/api/templates', h((_req, res) => res.json(TEMPLATES)));
app.get('/api/studies', h((_req, res) => res.json(repo.listStudies())));

// Protocols
app.get('/api/protocols', h((_req, res) => res.json(repo.listSummaries())));
app.post('/api/protocols', h((req, res) => res.status(201).json({ id: repo.createProtocol(req.body ?? {}, 'builder') })));
app.get('/api/protocols/:id', h((req, res) => {
  const id = p(req, 'id');
  const bundle = repo.getBundle(id);
  if (req.query.open) repo.touchOpened(id);
  res.json(bundle);
}));
app.post('/api/protocols/:id/save', h((req, res) => res.json(repo.saveProtocol(p(req, 'id'), (req.body ?? {}) as SaveRequest))));
app.patch('/api/protocols/:id/status', h((req, res) => res.json(repo.setStatus(p(req, 'id'), req.body?.status as ProtocolStatus))));
app.delete('/api/protocols/:id', h((req, res) => {
  repo.deleteProtocol(p(req, 'id'));
  res.status(204).end();
}));
app.post('/api/protocols/:id/duplicate', h((req, res) => res.status(201).json({ id: repo.duplicateProtocol(p(req, 'id'), req.body?.mode === 'new-version' ? 'new-version' : 'new-study') })));
app.get('/api/protocols/:id/validation', h((req, res) => res.json(validateProtocol(repo.getBundle(p(req, 'id'))))));

// Subsection structure
app.post('/api/protocols/:id/sections/:sectionId/subsections', h((req, res) => {
  const id = repo.addSubsection(p(req, 'id'), p(req, 'sectionId'), req.body?.title, req.body?.contentType as FieldType, req.body?.afterId);
  res.status(201).json({ id });
}));
app.patch('/api/subsections/:id', h((req, res) => {
  repo.updateSubsectionMeta(p(req, 'id'), { title: req.body?.title, fields: req.body?.fields });
  res.json({ ok: true });
}));
app.delete('/api/subsections/:id', h((req, res) => {
  repo.deleteSubsection(p(req, 'id'));
  res.status(204).end();
}));
app.post('/api/subsections/:id/duplicate', h((req, res) => res.status(201).json({ id: repo.duplicateSubsection(p(req, 'id')) })));
app.post('/api/subsections/:id/move', h((req, res) => {
  repo.moveSubsection(p(req, 'id'), req.body?.direction === 'down' ? 'down' : 'up');
  res.json({ ok: true });
}));

// Versions
app.get('/api/protocols/:id/versions', h((req, res) => res.json(repo.listSnapshots(p(req, 'id')))));
app.post('/api/protocols/:id/versions', h((req, res) => res.status(201).json(repo.createSnapshot(p(req, 'id'), String(req.body?.note ?? '')))));
app.get('/api/protocols/:id/versions/:vid', h((req, res) => res.json(repo.getSnapshot(p(req, 'id'), p(req, 'vid')))));
app.post('/api/protocols/:id/versions/:vid/restore', h((req, res) => {
  repo.restoreSnapshot(p(req, 'id'), p(req, 'vid'));
  res.json({ ok: true });
}));

// Attachments: raw body upload, filename in query string.
app.post('/api/protocols/:id/attachments', express.raw({ type: () => true, limit: '20mb' }), h((req, res) => {
  const filename = String(req.query.filename ?? 'file');
  const subsectionId = req.query.subsectionId ? String(req.query.subsectionId) : null;
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || !body.length) throw new repo.HttpError(400, 'Empty upload');
  res.status(201).json(repo.addAttachment(p(req, 'id'), subsectionId, filename, String(req.headers['content-type'] ?? ''), body));
}));
app.get('/api/attachments/:id', h((req, res) => {
  const att = repo.getAttachment(p(req, 'id'));
  if (!att) throw new repo.HttpError(404, 'Attachment not found');
  res.setHeader('Content-Type', att.mimeType);
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${safeName(att.filename)}"`);
  res.send(Buffer.from(att.data));
}));

// Exports
app.get('/api/protocols/:id/export/:format', h(async (req, res) => {
  const bundle = repo.getBundle(p(req, 'id'));
  const format = p(req, 'format');
  const base = safeName(`${bundle.study.protocolNumber || 'protocol'}_v${bundle.protocol.version || 'draft'}`);
  const disposition = req.query.inline ? 'inline' : 'attachment';
  if (format === 'json') {
    res.setHeader('Content-Disposition', `${disposition}; filename="${base}.json"`);
    return res.json(renderJson(bundle));
  }
  const model = buildDocModel(bundle);
  if (format === 'pdf') {
    const buf = await renderPdf(model);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${base}.pdf"`);
    return res.send(buf);
  }
  if (format === 'docx') {
    const buf = await renderDocx(model);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.docx"`);
    return res.send(buf);
  }
  throw new repo.HttpError(400, 'Unknown export format');
}));

// Protocol Digitisation
app.get('/api/digitisation/documents', h((_req, res) => res.json(listSourceDocuments())));
app.post('/api/digitisation/upload', express.raw({ type: () => true, limit: '30mb' }), h(async (req, res) => {
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || !body.length) throw new repo.HttpError(400, 'Empty upload');
  const result = await digitiseDocument(String(req.query.filename ?? 'document.txt'), String(req.headers['content-type'] ?? ''), body);
  res.status(201).json(result);
}));

// OCR (PDF, scanned PDF and image documents) via the local PaddleOCR service
app.use('/api/ocr', ocrRouter());

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Production: serve the built client.
const dist = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof repo.HttpError ? err.status : err.status ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Server error' });
});

const port = Number(process.env.PORT ?? 4100);
if (process.env.PROTOCOLIQ_NO_LISTEN !== '1') {
  app.listen(port, () => console.log(`ProtocolIQ API listening on http://localhost:${port}`));
}

export { app };
