import clsx from 'clsx';
import { CheckCircle2, FileUp, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Page } from '../components/Layout';
import { Button, Card, Notice, PageHeader } from '../components/ui';
import { api, isOcrFile, ocrApi, type DigitisationReport } from '../lib/api';
import { OcrStatusBadge } from './OcrReview';
import { timeAgo } from '../lib/format';

const STEPS = ['Upload', 'Parse', 'Extract', 'Structure', 'Review', 'Export'];

export function Digitisation() {
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ protocolId: string; report: DigitisationReport } | null>(null);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof api.sourceDocuments>>>([]);
  useEffect(() => void api.sourceDocuments().then(setHistory), [result]);

  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      if (isOcrFile(file.name)) {
        const doc = await ocrApi.upload(file);
        navigate(`/digitisation/ocr/${doc.id}`);
        return;
      }
      setResult(await api.digitise(file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  const stage = result ? 4 : busy ? 1 : 0;

  return (
    <Page wide>
      <PageHeader
        title="Protocol Digitisation"
        subtitle="Upload an existing protocol. A rule-based parser detects headings, matches them to the ICH template by keyword and title similarity, and extracts objectives, endpoints and eligibility criteria into the shared study database. No AI is used, and anything it cannot match is kept for review."
      />
      <ol className="mb-6 flex flex-wrap gap-2">
        {STEPS.map((s, i) => (
          <li key={s} className={clsx('flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium', i < stage ? 'bg-emerald-50 text-emerald-700' : i === stage ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500')}>
            {i < stage ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span>{i + 1}</span>} {s}
          </li>
        ))}
      </ol>

      <Card
        className="mb-6 border-dashed p-10 text-center"
      >
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void upload(e.dataTransfer.files[0]);
          }}
        >
          {busy ? <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-brand-600" /> : <FileUp className="mx-auto mb-3 h-8 w-8 text-slate-400" />}
          <p className="font-medium text-slate-700">{busy ? 'Uploading document…' : 'Drop a protocol document here'}</p>
          <p className="mb-4 text-sm text-slate-500">
            Supported: .docx, .txt, .md, .html (max 30 MB), parsed directly. PDF (digital or scanned), PNG, JPG and TIFF (max 200 MB) go through local OCR and layout analysis first.
          </p>
          <input
            ref={input}
            type="file"
            accept=".docx,.txt,.md,.html,.htm,.pdf,.png,.jpg,.jpeg,.tif,.tiff"
            className="hidden"
            onChange={(e) => void upload(e.target.files?.[0])}
          />
          <Button variant="primary" onClick={() => input.current?.click()} disabled={busy}>
            Choose file
          </Button>
        </div>
      </Card>

      {error && <Notice tone="error" className="mb-6">{error}</Notice>}

      {result && <Report result={result} />}

      {history.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Digitised documents</h2>
          <Card>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">File</th>
                  <th className="px-2">Uploaded</th>
                  <th className="px-2">Mapped sections</th>
                  <th className="px-2">Unmapped</th>
                  <th className="px-2">Extracted</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {history.map((d) => (
                  <tr key={d.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-medium text-slate-700">{d.filename}</td>
                    <td className="px-2 text-slate-500">{timeAgo(d.uploadedAt)}</td>
                    {d.report ? (
                      <>
                        <td className="px-2">{d.report.mapped.length}</td>
                        <td className="px-2">{d.report.unmapped.length}</td>
                        <td className="px-2 text-xs text-slate-500">
                          {d.report.counts.objectives} obj · {d.report.counts.endpoints} ep · {d.report.counts.inclusion + d.report.counts.exclusion} criteria
                        </td>
                      </>
                    ) : (
                      <td className="px-2 text-xs text-slate-500" colSpan={3}>
                        {d.ocrStatus && <OcrStatusBadge status={d.ocrStatus} />} <span className="ml-1">{d.pageCount ? `${d.pageCount} page(s)` : ''} · not yet structured</span>
                      </td>
                    )}
                    <td className="space-x-3 whitespace-nowrap px-3 text-right">
                      {d.kind === 'ocr' && (
                        <Link className="text-brand-700 hover:underline" to={`/digitisation/ocr/${d.id}`}>
                          OCR results
                        </Link>
                      )}
                      {d.protocolId && (
                        <>
                          <Link className="text-brand-700 hover:underline" to={`/builder/${d.protocolId}`}>
                            Review
                          </Link>
                          <Link className="text-brand-700 hover:underline" to={`/export/${d.protocolId}`}>
                            Export
                          </Link>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      )}
    </Page>
  );
}

function Report({ result }: { result: { protocolId: string; report: DigitisationReport } }) {
  const r = result.report;
  return (
    <Card className="p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <CheckCircle2 className="h-6 w-6 text-emerald-500" />
        <div className="flex-1">
          <div className="font-semibold text-slate-900">{r.filename} structured into the study database</div>
          <div className="text-sm text-slate-500">
            {r.blockCount} text blocks · {r.headingCount} headings · {r.mapped.length} template subsections populated · {r.unmapped.length} unmapped
          </div>
        </div>
        <Link to={`/builder/${result.protocolId}`}>
          <Button variant="primary">Review in editor</Button>
        </Link>
        <Link to={`/review/${result.protocolId}`}>
          <Button>Validate</Button>
        </Link>
        <Link to={`/export/${result.protocolId}`}>
          <Button>Export</Button>
        </Link>
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Object.entries(r.counts).map(([k, v]) => (
          <div key={k} className="rounded-md bg-slate-50 p-3">
            <div className="text-xl font-semibold text-slate-900">{v}</div>
            <div className="text-xs capitalize text-slate-500">{k === 'inclusion' || k === 'exclusion' ? `${k} criteria` : k}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Extracted metadata</h3>
          <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-sm">
            {Object.entries(r.metadata).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-slate-500">{k}</dt>
                <dd className="text-slate-800">{v}</dd>
              </div>
            ))}
            {Object.keys(r.metadata).length === 0 && <dd className="col-span-2 italic text-slate-400">No metadata detected</dd>}
          </dl>
          <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-700">Notes</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            {r.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Section mapping</h3>
          <div className="max-h-80 overflow-y-auto rounded border border-slate-200">
            <table className="w-full text-xs">
              <tbody>
                {r.mapped.map((m) => (
                  <tr key={m.templateKey} className="border-b border-slate-100">
                    <td className="px-2 py-1.5 text-slate-600">{m.sourceHeading}</td>
                    <td className="px-2 text-slate-400">→</td>
                    <td className="px-2 font-medium text-slate-800">
                      {m.subsectionNumber} {m.subsectionTitle}
                    </td>
                    <td className="px-2 text-right text-slate-400">{m.items}</td>
                  </tr>
                ))}
                {r.unmapped.map((u) => (
                  <tr key={u.heading} className="border-b border-slate-100 bg-amber-50/50">
                    <td className="px-2 py-1.5 text-slate-600">{u.heading}</td>
                    <td className="px-2 text-slate-400">→</td>
                    <td className="px-2 italic text-amber-700" colSpan={2}>
                      Unmapped, kept in Section 16 for review
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Card>
  );
}
