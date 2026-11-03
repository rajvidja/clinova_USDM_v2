import clsx from 'clsx';
import { AlertTriangle, ChevronLeft, ChevronRight, Download, ExternalLink, Eye, EyeOff, FileJson, FileText, Loader2, RefreshCw, RotateCcw, Square, Trash2, Wand2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { tableGrid, type OcrDocument, type OcrElement, type OcrElementType, type OcrJobStatus, type OcrResult, type OcrStatus, type OcrTable, type OcrTableKind } from '../../shared/ocr';
import { Page } from '../components/Layout';
import { Button, Card, FieldLabel, inputCls, Modal, Notice, PageHeader, Progress, Spinner, Tabs } from '../components/ui';
import { ocrApi, ocrExportUrl, ocrFileUrl, ocrPageImageUrl, type DigitisationReport, type OcrHealth, type OcrProcessOptions } from '../lib/api';

const ACTIVE: OcrStatus[] = ['queued', 'processing'];

const STATUS_LABEL: Record<OcrStatus, string> = {
  uploaded: 'Not processed',
  queued: 'Queued',
  processing: 'Processing',
  completed: 'Completed',
  completed_with_errors: 'Completed with errors',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function OcrStatusBadge({ status }: { status: OcrStatus }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1',
        status === 'completed' && 'bg-emerald-50 text-emerald-700 ring-emerald-200',
        status === 'completed_with_errors' && 'bg-amber-50 text-amber-700 ring-amber-200',
        (status === 'failed' || status === 'cancelled') && 'bg-red-50 text-red-700 ring-red-200',
        ACTIVE.includes(status) && 'bg-blue-50 text-blue-700 ring-blue-200',
        status === 'uploaded' && 'bg-slate-50 text-slate-600 ring-slate-200',
      )}
    >
      {ACTIVE.includes(status) && <Loader2 className="h-3 w-3 animate-spin" />}
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

const TYPE_STYLE: Partial<Record<OcrElementType, string>> = {
  title: 'border-violet-500 bg-violet-500/10',
  heading: 'border-violet-500 bg-violet-500/10',
  table: 'border-emerald-500 bg-emerald-500/10',
  image: 'border-amber-500 bg-amber-500/10',
  caption: 'border-orange-500 bg-orange-500/10',
  footnote: 'border-pink-500 bg-pink-500/10',
  list_item: 'border-sky-500 bg-sky-500/10',
  page_header: 'border-slate-400 bg-slate-400/10',
  page_footer: 'border-slate-400 bg-slate-400/10',
  page_number: 'border-slate-400 bg-slate-400/10',
};
const typeStyle = (t: OcrElementType) => TYPE_STYLE[t] ?? 'border-blue-500 bg-blue-500/10';

const TABLE_KINDS: { id: OcrTableKind; label: string }[] = [
  { id: 'schedule_of_activities', label: 'Schedule of Activities' },
  { id: 'visit_schedule', label: 'Visit schedule' },
  { id: 'study_procedures', label: 'Study procedures' },
  { id: 'eligibility_criteria', label: 'Eligibility criteria' },
  { id: 'endpoints', label: 'Objectives / endpoints' },
  { id: 'other', label: 'Other' },
];

const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);

export function OcrReview() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<OcrDocument | null>(null);
  const [job, setJob] = useState<OcrJobStatus | null>(null);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [health, setHealth] = useState<OcrHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<'page' | 'tables' | 'markdown'>('page');
  const [selected, setSelected] = useState<string | null>(null);
  const [overlay, setOverlay] = useState(true);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [digitised, setDigitised] = useState<{ protocolId: string; report: DigitisationReport } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const status = job?.status ?? doc?.status ?? 'uploaded';
  const active = ACTIVE.includes(status);
  const hasResult = status === 'completed' || status === 'completed_with_errors';

  const load = useCallback(async () => {
    try {
      const d = await ocrApi.document(id);
      setDoc(d);
      setJob(d.job);
      const s = d.job?.status ?? d.status;
      if (s === 'completed' || s === 'completed_with_errors') setResult(await ocrApi.results(id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
    void ocrApi.health().then(setHealth, () => setHealth(null));
  }, [load]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(async () => {
      try {
        const s = await ocrApi.status(id);
        setJob(s);
        if (!ACTIVE.includes(s.status)) void load();
      } catch (e) {
        setError((e as Error).message);
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [active, id, load]);

  const pageCount = result?.pageCount ?? doc?.pageCount ?? doc?.inspection?.pageCount ?? 0;
  const pageInfo = result?.pages.find((p) => p.page === page) ?? null;
  const pageElements = useMemo(() => (result?.elements ?? []).filter((e) => e.page === page).sort((a, b) => a.order - b.order), [result, page]);
  const tables = useMemo(() => (result?.elements ?? []).filter((e) => e.type === 'table' && e.table), [result]);

  const replaceElement = (el: OcrElement | null, elementId: string) => {
    if (!el) return;
    setResult((r) => {
      if (!r) return r;
      const elements = r.elements.map((e) => (e.id === elementId ? el : e));
      return { ...r, elements, correctedAt: elements.some((e) => e.corrected) ? new Date().toISOString() : null };
    });
  };

  const saveCorrection = async (el: OcrElement, body: { text?: string; table?: OcrTable }) => {
    try {
      replaceElement(await ocrApi.correct(id, el.id, body), el.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const revert = async (el: OcrElement) => {
    try {
      replaceElement(await ocrApi.revert(id, el.id), el.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const startProcessing = (options: OcrProcessOptions) =>
    run('process', async () => {
      setOptionsOpen(false);
      const s = await ocrApi.process(id, options);
      setJob(s);
      if (!options.keepCorrections) setResult(null);
      setDigitised(null);
    });

  const goTo = (p: number) => {
    setPage(Math.min(Math.max(1, p), Math.max(1, pageCount)));
    setSelected(null);
  };

  const selectElement = (el: OcrElement) => {
    setPage(el.page);
    setSelected(el.id);
    setTab('page');
    requestAnimationFrame(() => document.getElementById(`ocr-el-${el.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };

  if (!doc && !error) return <Spinner />;
  if (!doc) {
    return (
      <Page>
        <Notice tone="error">{error}</Notice>
      </Page>
    );
  }

  const progress = job && job.pageCount ? Math.round((job.pagesDone / job.pageCount) * 100) : 0;
  const serviceDown = health !== null && health.ok === false;

  return (
    <Page wide>
      <div className="mb-2 text-sm">
        <Link to="/digitisation" className="text-brand-700 hover:underline">
          ← Protocol Digitisation
        </Link>
      </div>
      <PageHeader
        title={doc.filename}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <OcrStatusBadge status={status} />
            <span>
              {pageCount} page(s) · {(doc.size / 1024 / 1024).toFixed(1)} MB
              {result && ` · ${result.elements.length} elements · ${tables.length} table(s)`}
              {result?.correctedAt && ' · includes manual corrections'}
            </span>
          </span>
        }
        actions={
          <>
            {active ? (
              <Button onClick={() => run('cancel', async () => setJob(await ocrApi.cancel(id)))} loading={busy === 'cancel'}>
                <Square className="h-3.5 w-3.5" /> Cancel
              </Button>
            ) : (
              <Button onClick={() => setOptionsOpen(true)} loading={busy === 'process'}>
                <RefreshCw className="h-3.5 w-3.5" /> {status === 'uploaded' ? 'Process' : 'Reprocess'}
              </Button>
            )}
            <a href={ocrExportUrl(id, 'json')} className={clsx(!hasResult && 'pointer-events-none opacity-50')}>
              <Button disabled={!hasResult}>
                <FileJson className="h-3.5 w-3.5" /> JSON
              </Button>
            </a>
            <a href={ocrExportUrl(id, 'markdown')} className={clsx(!hasResult && 'pointer-events-none opacity-50')}>
              <Button disabled={!hasResult}>
                <Download className="h-3.5 w-3.5" /> Markdown
              </Button>
            </a>
            <Button
              variant="primary"
              disabled={!hasResult}
              loading={busy === 'digitise'}
              onClick={() => run('digitise', async () => setDigitised(await ocrApi.digitise(id)))}
              title="Run the rule-based protocol parser on the extracted text"
            >
              <Wand2 className="h-3.5 w-3.5" /> Structure into protocol
            </Button>
            <Button
              variant="danger"
              disabled={active}
              onClick={() => {
                if (!confirm(`Delete ${doc.filename} and its OCR results? Protocols already created from it are kept.`)) return;
                void run('delete', async () => {
                  await ocrApi.remove(id);
                  navigate('/digitisation');
                });
              }}
              aria-label="Delete document"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        }
      />

      {serviceDown && (
        <Notice tone="warn" className="mb-4">
          The local OCR service is not running ({health?.error}). Start it with <code>npm run dev:ocr</code> (first-time setup: <code>npm run ocr:setup</code>).
        </Notice>
      )}
      {health?.warming && <Notice className="mb-4">The OCR service is starting up and loading PaddleOCR. Processing starts as soon as it is ready.</Notice>}
      {error && (
        <Notice tone="error" className="mb-4">
          {error}
        </Notice>
      )}
      {!active && doc.error && status !== 'completed' && (
        <Notice tone="error" className="mb-4">
          {doc.error}
        </Notice>
      )}
      {digitised && (
        <Notice tone="success" className="mb-4">
          Structured into the study database: {digitised.report.mapped.length} template subsections populated, {digitised.report.unmapped.length} unmapped headings kept for review.{' '}
          <Link className="font-medium underline" to={`/builder/${digitised.protocolId}`}>
            Review in editor
          </Link>{' '}
          ·{' '}
          <Link className="font-medium underline" to={`/review/${digitised.protocolId}`}>
            Validate
          </Link>
        </Notice>
      )}
      {!digitised && doc.protocolId && hasResult && (
        <Notice className="mb-4">
          A protocol was already created from this document.{' '}
          <Link className="font-medium underline" to={`/builder/${doc.protocolId}`}>
            Open it
          </Link>
          . Structuring again creates a new protocol.
        </Notice>
      )}

      {job && (active || job.pageErrors.length > 0) && (
        <Card className="mb-4 p-4">
          {active && (
            <>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-slate-700">{job.message}</span>
                <span className="text-slate-500">
                  {job.pagesDone} / {job.pageCount || '?'} pages
                </span>
              </div>
              <Progress value={progress} />
            </>
          )}
          {job.pageErrors.length > 0 && (
            <ul className={clsx('space-y-1 text-sm text-amber-800', active && 'mt-3')}>
              {job.pageErrors.map((e) => (
                <li key={e.page} className="flex gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Page {e.page}: {e.error}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="flex min-h-[600px] flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2 text-sm">
            <Button size="sm" variant="ghost" onClick={() => goTo(page - 1)} disabled={page <= 1} aria-label="Previous page">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="flex items-center gap-1">
              Page
              <input
                type="number"
                min={1}
                max={pageCount}
                value={page}
                onChange={(e) => goTo(Number(e.target.value))}
                className="w-14 rounded border border-slate-300 px-1.5 py-0.5 text-center text-sm"
                aria-label="Page number"
              />
              of {pageCount || '?'}
            </span>
            <Button size="sm" variant="ghost" onClick={() => goTo(page + 1)} disabled={page >= pageCount} aria-label="Next page">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <div className="ml-auto flex items-center gap-2">
              {pageInfo && (
                <span className="text-xs text-slate-500">
                  {pageInfo.classification} · {pageInfo.method === 'ocr' ? 'PaddleOCR' : pageInfo.method === 'native+ocr' ? 'native text + image OCR' : 'native text'}
                  {pageInfo.meanConfidence != null && ` · ${pct(pageInfo.meanConfidence)} confidence`}
                  {pageInfo.rotation ? ` · rotated ${pageInfo.rotation}°` : ''} · {(pageInfo.durationMs / 1000).toFixed(1)}s
                </span>
              )}
              {!pageInfo && doc.inspection?.pages[page - 1] && <span className="text-xs text-slate-500">{doc.inspection.pages[page - 1].classification}</span>}
              <Button size="sm" variant="ghost" onClick={() => setOverlay((v) => !v)} disabled={!result} title="Toggle layout overlay">
                {overlay ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} Layout
              </Button>
              <a href={ocrFileUrl(id)} target="_blank" rel="noreferrer" className="text-xs text-brand-700 hover:underline">
                Original <ExternalLink className="inline h-3 w-3" />
              </a>
            </div>
          </div>
          <div className="flex-1 overflow-auto bg-slate-100 p-3">
            {pageCount > 0 && !serviceDown ? (
              <PageImage
                src={ocrPageImageUrl(id, page, result?.createdAt ?? '')}
                elements={overlay && pageInfo ? pageElements : []}
                width={pageInfo?.width ?? 0}
                height={pageInfo?.height ?? 0}
                selected={selected}
                onSelect={selectElement}
              />
            ) : (
              <div className="py-20 text-center text-sm text-slate-500">Page preview is available once the OCR service has inspected the document.</div>
            )}
            {pageInfo?.error && (
              <Notice tone="error" className="mt-3">
                {pageInfo.error}
              </Notice>
            )}
          </div>
        </Card>

        <Card className="flex min-h-[600px] flex-col">
          <div className="px-3 pt-1">
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'page', label: `Extracted page ${page}` },
                { id: 'tables', label: `Tables (${tables.length})` },
                { id: 'markdown', label: 'Markdown' },
              ]}
            />
          </div>
          <div className="max-h-[calc(100vh-220px)] flex-1 overflow-y-auto p-3">
            {!result ? (
              <div className="py-20 text-center text-sm text-slate-500">
                {active ? 'Extracted content appears here when processing finishes.' : status === 'uploaded' ? 'Process the document to extract text, layout and tables.' : 'No extraction result available.'}
              </div>
            ) : tab === 'page' ? (
              <div className="space-y-2">
                {pageElements.length === 0 && <p className="py-10 text-center text-sm text-slate-500">No content was found on this page.</p>}
                {pageElements.map((el) => (
                  <ElementEditor key={el.id} el={el} selected={selected === el.id} onSelect={() => setSelected(el.id)} onSave={saveCorrection} onRevert={revert} />
                ))}
              </div>
            ) : tab === 'tables' ? (
              <div className="space-y-4">
                {tables.length === 0 && <p className="py-10 text-center text-sm text-slate-500">No tables were detected.</p>}
                {tables.map((el) => (
                  <div key={el.id}>
                    <button className="mb-1 text-xs text-brand-700 hover:underline" onClick={() => selectElement(el)}>
                      Page {el.page} · show on page
                    </button>
                    <ElementEditor el={el} selected={false} onSelect={() => undefined} onSave={saveCorrection} onRevert={revert} />
                  </div>
                ))}
              </div>
            ) : (
              <MarkdownPreview id={id} version={`${result.createdAt}${result.correctedAt ?? ''}`} />
            )}
          </div>
        </Card>
      </div>

      <ProcessOptions open={optionsOpen} onClose={() => setOptionsOpen(false)} onStart={startProcessing} hasCorrections={!!result?.correctedAt} health={health} />
    </Page>
  );
}

function PageImage({
  src,
  elements,
  width,
  height,
  selected,
  onSelect,
}: {
  src: string;
  elements: OcrElement[];
  width: number;
  height: number;
  selected: string | null;
  onSelect: (el: OcrElement) => void;
}) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  useEffect(() => setState('loading'), [src]);
  return (
    <div className="relative mx-auto w-fit max-w-full bg-white shadow">
      {state === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      )}
      {state === 'error' && <div className="px-10 py-20 text-sm text-slate-500">The page image could not be rendered.</div>}
      <img src={src} alt="Original page" className={clsx('block max-w-full', state === 'error' && 'hidden', state === 'loading' && 'min-h-[400px] min-w-[300px]')} onLoad={() => setState('ok')} onError={() => setState('error')} />
      {state === 'ok' &&
        width > 0 &&
        elements
          .filter((e) => e.bbox)
          .map((e) => {
            const [x0, y0, x1, y1] = e.bbox!;
            return (
              <button
                key={e.id}
                title={`${e.type}${e.confidence != null ? ` · ${pct(e.confidence)}` : ''}`}
                onClick={() => onSelect(e)}
                className={clsx('absolute border transition-colors hover:border-2', typeStyle(e.type), selected === e.id && '!border-2 !border-red-500 !bg-red-500/15')}
                style={{ left: `${(x0 / width) * 100}%`, top: `${(y0 / height) * 100}%`, width: `${((x1 - x0) / width) * 100}%`, height: `${((y1 - y0) / height) * 100}%` }}
              />
            );
          })}
    </div>
  );
}

function ElementEditor({
  el,
  selected,
  onSelect,
  onSave,
  onRevert,
}: {
  el: OcrElement;
  selected: boolean;
  onSelect: () => void;
  onSave: (el: OcrElement, body: { text?: string; table?: OcrTable }) => Promise<void>;
  onRevert: (el: OcrElement) => Promise<void>;
}) {
  const [text, setText] = useState(el.text);
  useEffect(() => setText(el.text), [el.text]);
  const lowConfidence = el.confidence != null && el.confidence < 0.8;
  return (
    <div
      id={`ocr-el-${el.id}`}
      onClick={onSelect}
      className={clsx('rounded-md border p-2', selected ? 'border-red-400 ring-2 ring-red-200' : 'border-slate-200', el.type === 'page_header' || el.type === 'page_footer' || el.type === 'page_number' ? 'opacity-70' : '')}
    >
      <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className={clsx('rounded border px-1.5 py-0.5 font-medium text-slate-700', typeStyle(el.type))}>
          {el.type.replace('_', ' ')}
          {el.level ? ` H${el.level}` : ''}
        </span>
        {el.table && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">{TABLE_KINDS.find((k) => k.id === el.table!.kind)?.label}</span>}
        <span className="text-slate-400">{el.source === 'ocr' ? 'OCR' : 'native'}</span>
        {el.confidence != null && <span className={clsx(lowConfidence ? 'font-medium text-amber-600' : 'text-slate-400')}>{pct(el.confidence)}</span>}
        <span className="text-slate-300">{el.id}</span>
        {el.corrected && (
          <>
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">corrected</span>
            <button className="flex items-center gap-0.5 text-slate-500 hover:text-slate-800" onClick={() => void onRevert(el)} title="Discard the manual correction">
              <RotateCcw className="h-3 w-3" /> revert
            </button>
          </>
        )}
      </div>
      {el.table ? (
        <TableEditor table={el.table} onSave={(table) => onSave(el, { table })} />
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== el.text && void onSave(el, { text })}
          rows={Math.min(12, Math.max(1, Math.ceil(text.length / 90) + (text.match(/\n/g)?.length ?? 0)))}
          className={clsx('block w-full resize-y rounded border border-transparent px-1.5 py-1 text-sm text-slate-800 hover:border-slate-200 focus:border-brand-500 focus:outline-none', (el.type === 'title' || el.type === 'heading') && 'font-semibold')}
          aria-label={`${el.type} text`}
        />
      )}
      {el.imageText && <p className="mt-1 whitespace-pre-wrap rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">Text in image: {el.imageText}</p>}
    </div>
  );
}

function TableEditor({ table, onSave }: { table: OcrTable; onSave: (t: OcrTable) => Promise<void> }) {
  const grid = useMemo(() => tableGrid(table), [table]);
  const save = (patch: Partial<OcrTable>) => void onSave({ ...table, ...patch });
  const setCell = (row: number, col: number, text: string) => {
    const cell = table.cells.find((c) => c.row === row && c.col === col);
    if (!cell || cell.text === text) return;
    save({ cells: table.cells.map((c) => (c === cell ? { ...c, text } : c)) });
  };
  const rowIsSimple = (r: number) => table.cells.every((c) => c.row > r || c.row + c.rowSpan - 1 < r || c.rowSpan === 1);
  const addRow = () =>
    save({
      rows: table.rows + 1,
      cells: [...table.cells, ...Array.from({ length: table.cols }, (_, col) => ({ row: table.rows, col, rowSpan: 1, colSpan: 1, text: '', header: false }))],
    });
  const deleteRow = (r: number) =>
    save({
      rows: table.rows - 1,
      headerRows: r < table.headerRows ? table.headerRows - 1 : table.headerRows,
      cells: table.cells.filter((c) => c.row !== r).map((c) => (c.row > r ? { ...c, row: c.row - 1 } : c)),
    });
  const setHeaderRows = (n: number) => save({ headerRows: n, cells: table.cells.map((c) => ({ ...c, header: c.row < n })) });

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <input
          defaultValue={table.caption ?? ''}
          key={table.caption ?? ''}
          placeholder="No caption"
          onBlur={(e) => e.target.value !== (table.caption ?? '') && save({ caption: e.target.value || null })}
          className="min-w-[200px] flex-1 rounded border border-slate-200 px-2 py-1 text-xs font-medium"
          aria-label="Table caption"
        />
        <select value={table.kind} onChange={(e) => save({ kind: e.target.value as OcrTableKind })} className="rounded border border-slate-200 px-1.5 py-1" aria-label="Table type">
          {TABLE_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-slate-500">
          Header rows
          <input type="number" min={0} max={table.rows} value={table.headerRows} onChange={(e) => setHeaderRows(Math.max(0, Math.min(table.rows, Number(e.target.value))))} className="w-12 rounded border border-slate-200 px-1 py-0.5" />
        </label>
        <span className="text-slate-400">
          {table.rows} × {table.cols}
          {table.cells.some((c) => c.rowSpan > 1 || c.colSpan > 1) && ' · merged cells'}
          {table.continuedFrom && ` · continues ${table.continuedFrom}`}
          {table.footnoteIds.length > 0 && ` · ${table.footnoteIds.length} footnote(s)`}
          {table.referencedBy.length > 0 && ` · referenced by ${table.referencedBy.join(', ')}`}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <tbody>
            {grid.map((row, r) => (
              <tr key={r} className="group">
                {row.map((slot, c) =>
                  slot?.anchor ? (
                    <EditableCell key={c} cell={slot.cell} header={r < table.headerRows || slot.cell.header} onCommit={(text) => setCell(slot.cell.row, slot.cell.col, text)} />
                  ) : slot ? null : (
                    <td key={c} className="border border-dashed border-slate-200 bg-slate-50" />
                  ),
                )}
                <td className="w-6 border-0 pl-1">
                  {rowIsSimple(r) && table.rows > 1 && (
                    <button onClick={() => deleteRow(r)} className="invisible text-slate-400 hover:text-red-600 group-hover:visible" title="Delete row" aria-label={`Delete row ${r + 1}`}>
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={addRow} className="mt-1 text-xs text-brand-700 hover:underline">
        + Add row
      </button>
    </div>
  );
}

function EditableCell({ cell, header, onCommit }: { cell: OcrTable['cells'][number]; header: boolean; onCommit: (text: string) => void }) {
  const ref = useRef<HTMLTableCellElement>(null);
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) ref.current.innerText = cell.text;
  }, [cell.text]);
  const Tag = header ? 'th' : 'td';
  return (
    <Tag
      ref={ref}
      rowSpan={cell.rowSpan}
      colSpan={cell.colSpan}
      contentEditable
      suppressContentEditableWarning
      onBlur={(e) => onCommit(e.currentTarget.innerText.trim())}
      title={cell.confidence != null ? `Confidence ${pct(cell.confidence)}` : undefined}
      className={clsx(
        'whitespace-pre-wrap border border-slate-300 px-1.5 py-1 align-top focus:bg-white focus:outline focus:outline-2 focus:outline-brand-500',
        header ? 'bg-slate-100 text-left font-semibold text-slate-800' : 'text-slate-700',
        cell.confidence != null && cell.confidence < 0.8 && 'bg-amber-50',
      )}
    />
  );
}

function MarkdownPreview({ id, version }: { id: string; version: string }) {
  const [md, setMd] = useState<string | null>(null);
  useEffect(() => {
    setMd(null);
    void fetch(`/api/ocr/results/${id}?format=markdown`)
      .then((r) => r.text())
      .then(setMd);
  }, [id, version]);
  if (md === null) return <Spinner />;
  return (
    <div>
      <p className="mb-2 flex items-center gap-1 text-xs text-slate-500">
        <FileText className="h-3.5 w-3.5" /> Tables with merged cells or multi-row headers are exported as HTML tables so their structure is preserved.
      </p>
      <pre className="whitespace-pre-wrap rounded bg-slate-50 p-3 font-mono text-xs text-slate-700">{md}</pre>
    </div>
  );
}

function ProcessOptions({
  open,
  onClose,
  onStart,
  hasCorrections,
  health,
}: {
  open: boolean;
  onClose: () => void;
  onStart: (o: OcrProcessOptions) => void;
  hasCorrections: boolean;
  health: OcrHealth | null;
}) {
  const [o, setO] = useState<OcrProcessOptions>({ mode: 'structure', forceOcr: false, autoRotate: false, ocrEmbeddedImages: true, dpi: 200, keepCorrections: false });
  const check = (key: keyof OcrProcessOptions, label: string, hint: string) => (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-1" checked={!!o[key]} onChange={(e) => setO({ ...o, [key]: e.target.checked })} />
      <span>
        <span className="font-medium text-slate-700">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
    </label>
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="OCR processing options"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onStart(o)}>
            Start processing
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel htmlFor="ocr-mode">Analysis</FieldLabel>
            <select id="ocr-mode" className={inputCls} value={o.mode} onChange={(e) => setO({ ...o, mode: e.target.value as 'structure' | 'text' })}>
              <option value="structure">Layout + tables (PP-StructureV3)</option>
              <option value="text">Text only (PP-OCR, faster)</option>
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="ocr-dpi">Scan resolution</FieldLabel>
            <select id="ocr-dpi" className={inputCls} value={o.dpi} onChange={(e) => setO({ ...o, dpi: Number(e.target.value) })}>
              <option value={150}>150 DPI (faster)</option>
              <option value={200}>200 DPI (default)</option>
              <option value={300}>300 DPI (small print)</option>
            </select>
          </div>
        </div>
        {check('forceOcr', 'OCR every page', 'Ignore the embedded text layer of digital PDF pages, for example when it is garbled.')}
        {check('autoRotate', 'Correct page orientation', 'Detect and fix pages scanned sideways or upside down. Adds time per scanned page.')}
        {check('ocrEmbeddedImages', 'Read text inside figures', 'OCR large images on digital pages, such as study design diagrams.')}
        {hasCorrections && check('keepCorrections', 'Keep manual corrections', 'Corrections are matched by element id, which can change between runs. Leave unchecked to discard them.')}
        {hasCorrections && !o.keepCorrections && <Notice tone="warn">Reprocessing discards the manual corrections made to this document.</Notice>}
        {health?.ok && (
          <p className="text-xs text-slate-500">
            Runs locally on {health.device?.toUpperCase()} with the {health.profile} model profile. No data leaves this machine.
          </p>
        )}
      </div>
    </Modal>
  );
}
