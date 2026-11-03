import clsx from 'clsx';
import { Braces, FileText, FileType2, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { buildDocModel, type DocBlock } from '../../shared/docModel';
import { richTextToPlain } from '../../shared/richtext';
import type { ProtocolBundle, ValidationIssue } from '../../shared/types';
import { validateProtocol } from '../../shared/validation';
import { SoaBuilder } from '../components/builders/SoaBuilder';
import { DocBlocks } from '../components/DocumentPreview';
import { Page } from '../components/Layout';
import { ProtocolPicker } from '../components/ProtocolPicker';
import { Button, Card, CompletionIcon, Notice, PageHeader, Progress, SourceBadge, Spinner, StatusBadge } from '../components/ui';
import { ValidationView } from '../components/ValidationView';
import { exportUrl } from '../lib/api';
import { download, formatDateTime } from '../lib/format';
import { useEditor } from '../store/editor';
import { SaveIndicator, useProtocolLoader } from './builder/Editor';

function ModuleHeader({ bundle, title, children }: { bundle: ProtocolBundle; title: string; children?: React.ReactNode }) {
  return (
    <PageHeader
      title={title}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-700">{bundle.study.title || '[Untitled protocol]'}</span>
          <span className="font-mono text-xs">{bundle.study.protocolNumber}</span>
          <SourceBadge source={bundle.protocol.source} />
          <StatusBadge status={bundle.protocol.status} />
        </span>
      }
      actions={
        <>
          {children}
          <Link to={`/builder/${bundle.protocol.id}`}>
            <Button>Open in editor</Button>
          </Link>
        </>
      }
    />
  );
}

function useModule(base: string) {
  const { id } = useParams<{ id: string }>();
  const { bundle, loadError } = useProtocolLoader(id);
  return { id, bundle, loadError, base };
}

// ---------- Protocol Explorer ----------

export function Explorer() {
  const { id, bundle, loadError } = useModule('/explorer');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const model = useMemo(() => (bundle ? buildDocModel(bundle) : null), [bundle]);
  if (!id) return <ProtocolPicker title="Protocol Explorer" subtitle="Browse the structured content of any protocol in the study database." base="/explorer" />;
  if (loadError) return <Page><Notice tone="error">{loadError}</Notice></Page>;
  if (!bundle || !model) return <Spinner />;

  const subs = bundle.sections.flatMap((s) => s.subsections);
  const text = (subId: string) => {
    const sub = subs.find((s) => s.id === subId)!;
    return `${sub.subsectionNumber} ${sub.subsectionTitle} ${Object.values(sub.content)
      .map((v) => (typeof v === 'string' ? richTextToPlain(v) : JSON.stringify(v)))
      .join(' ')}`.toLowerCase();
  };
  const matches = subs.filter((s) => !q || text(s.id).includes(q.toLowerCase()));
  const current = subs.find((s) => s.id === selected) ?? matches[0];
  const blocks: DocBlock[] = [];
  if (current) {
    const start = model.body.findIndex((b) => b.t === 'heading' && b.anchor === `sub-${current.id}`);
    for (let i = start; i < model.body.length; i++) {
      const b = model.body[i];
      if (i > start && b.t === 'heading') break;
      blocks.push(b);
    }
  }

  return (
    <Page wide>
      <ModuleHeader bundle={bundle} title="Protocol Explorer" />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-6">
        {[
          ['Completion', `${bundle.protocol.completion}%`],
          ['Objectives', bundle.objectives.length],
          ['Endpoints', bundle.endpoints.length],
          ['Study arms', bundle.arms.length],
          ['Criteria', bundle.criteria.length],
          ['SoA visits × assessments', `${bundle.soa.visits.length} × ${bundle.soa.activities.length}`],
        ].map(([k, v]) => (
          <Card key={k} className="p-3">
            <div className="text-lg font-semibold text-slate-900">{v}</div>
            <div className="text-xs text-slate-500">{k}</div>
          </Card>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <Card className="max-h-[70vh] overflow-y-auto">
          <div className="sticky top-0 border-b border-slate-100 bg-white p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <input className="w-full rounded-md border border-slate-300 py-2 pl-8 pr-2 text-sm" placeholder="Search protocol content…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          {bundle.sections.map((sec) => {
            const visible = sec.subsections.filter((s) => matches.includes(s));
            if (!visible.length) return null;
            return (
              <div key={sec.id} className="py-1">
                <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {sec.sectionNumber}. {sec.sectionTitle}
                </div>
                {visible.map((s) => (
                  <button key={s.id} onClick={() => setSelected(s.id)} className={clsx('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm', current?.id === s.id ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-50')}>
                    <CompletionIcon status={s.completionStatus} className="h-3.5 w-3.5" />
                    <span className="w-8 tabular-nums text-slate-400">{s.subsectionNumber}</span>
                    <span className="flex-1 truncate">{s.subsectionTitle}</span>
                  </button>
                ))}
              </div>
            );
          })}
          {matches.length === 0 && <p className="p-4 text-sm text-slate-500">No matches.</p>}
        </Card>
        <Card className="p-6">
          {current ? (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">id {current.id.slice(0, 8)}</span>
                <span>content type: {current.contentType}</span>
                <span>· modified {formatDateTime(current.lastModified)}</span>
                <Link className="ml-auto text-brand-700 hover:underline" to={`/builder/${bundle.protocol.id}?s=${current.id}`}>
                  Edit this subsection
                </Link>
              </div>
              <div className="font-[Arial,Helvetica,sans-serif] text-[13px] leading-relaxed">
                <DocBlocks blocks={blocks} />
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">Select a subsection.</p>
          )}
        </Card>
      </div>
    </Page>
  );
}

// ---------- Schedule of Activities module ----------

export function SoaModule() {
  const { id, bundle, loadError } = useModule('/soa');
  if (!id) return <ProtocolPicker title="Schedule of Activities" subtitle="Select a protocol to build or edit its visit schedule." base="/soa" />;
  if (loadError) return <Page><Notice tone="error">{loadError}</Notice></Page>;
  if (!bundle) return <Spinner />;
  return (
    <Page wide>
      <ModuleHeader bundle={bundle} title="Schedule of Activities">
        <SaveIndicator />
      </ModuleHeader>
      <Notice tone="info" className="mb-4">
        Visits and assessments are entered manually and auto-saved as structured JSON. ProtocolIQ never generates clinical assessment schedules.
      </Notice>
      <Card className="p-5">
        <SoaBuilder />
      </Card>
    </Page>
  );
}

// ---------- Relationship Map ----------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function RelationshipMap() {
  const { id, bundle, loadError } = useModule('/relationships');
  if (!id) return <ProtocolPicker title="Relationship Map" subtitle="Visualise objective → endpoint → visit traceability for a protocol." base="/relationships" />;
  if (loadError) return <Page><Notice tone="error">{loadError}</Notice></Page>;
  if (!bundle) return <Spinner />;

  const { objectives, endpoints, soa, arms } = bundle;
  const NODE_H = 64;
  const GAP = 14;
  const COL_W = 280;
  const X = [0, 400, 800];
  const y = (i: number) => i * (NODE_H + GAP);
  const visitMatches = (timepoint: string) => soa.visits.filter((v) => {
    const t = ` ${norm(timepoint)} `;
    return (norm(v.name) && t.includes(` ${norm(v.name)} `)) || (norm(v.timing) && t.includes(` ${norm(v.timing)} `));
  });
  const links: { from: [number, number]; to: [number, number]; kind: 'manual' | 'rule' }[] = [];
  endpoints.forEach((e, ei) => {
    e.objectiveIds.forEach((oid) => {
      const oi = objectives.findIndex((o) => o.id === oid);
      if (oi >= 0) links.push({ from: [0, oi], to: [1, ei], kind: 'manual' });
    });
    visitMatches(e.timepoint).forEach((v) => links.push({ from: [1, ei], to: [2, soa.visits.indexOf(v)], kind: 'rule' }));
  });
  const height = Math.max(objectives.length, endpoints.length, soa.visits.length, 1) * (NODE_H + GAP);
  const activitiesAt = (vid: string) => soa.activities.filter((a) => a.cells[vid]).length;

  const Node = ({ col, i, title, sub, tone }: { col: number; i: number; title: string; sub: string; tone: string }) => (
    <div className={clsx('absolute overflow-hidden rounded-md border bg-white px-3 py-2 shadow-sm', tone)} style={{ left: X[col], top: y(i), width: COL_W, height: NODE_H }}>
      <div className="truncate text-xs font-semibold text-slate-800" title={title}>
        {title}
      </div>
      <div className="line-clamp-2 text-[11px] text-slate-500" title={sub}>
        {sub}
      </div>
    </div>
  );

  return (
    <Page wide>
      <ModuleHeader bundle={bundle} title="Relationship Map" />
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <svg width="28" height="6"><line x1="0" y1="3" x2="28" y2="3" stroke="#0f8a75" strokeWidth="2" /></svg> Manual objective–endpoint link
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="28" height="6"><line x1="0" y1="3" x2="28" y2="3" stroke="#7c3aed" strokeWidth="2" strokeDasharray="4 3" /></svg> Endpoint timepoint text matches visit name or timing (rule-based)
        </span>
      </div>
      <Card className="overflow-x-auto p-6">
        <div className="mb-3 grid text-xs font-semibold uppercase tracking-wide text-slate-500" style={{ gridTemplateColumns: `${X[1]}px ${X[2] - X[1]}px ${COL_W}px` }}>
          <span>Objectives ({objectives.length})</span>
          <span>Endpoints ({endpoints.length})</span>
          <span>SoA visits ({soa.visits.length})</span>
        </div>
        <div className="relative" style={{ height, width: X[2] + COL_W }}>
          <svg className="absolute inset-0" width={X[2] + COL_W} height={height}>
            {links.map((l, i) => {
              const x1 = X[l.from[0]] + COL_W;
              const y1 = y(l.from[1]) + NODE_H / 2;
              const x2 = X[l.to[0]];
              const y2 = y(l.to[1]) + NODE_H / 2;
              const mx = (x1 + x2) / 2;
              return <path key={i} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={l.kind === 'manual' ? '#0f8a75' : '#7c3aed'} strokeWidth={1.8} strokeDasharray={l.kind === 'rule' ? '5 4' : undefined} opacity={0.75} />;
            })}
          </svg>
          {objectives.map((o, i) => (
            <Node key={o.id} col={0} i={i} title={`${o.code} · ${o.category}`} sub={o.description || '[no description]'} tone={o.category === 'Primary' ? 'border-brand-500' : 'border-slate-200'} />
          ))}
          {endpoints.map((e, i) => (
            <Node key={e.id} col={1} i={i} title={`${e.code} · ${e.category} · ${e.timepoint || 'no timepoint'}`} sub={e.name || '[unnamed endpoint]'} tone={e.category === 'Primary' ? 'border-brand-500' : 'border-slate-200'} />
          ))}
          {soa.visits.map((v, i) => (
            <Node key={v.id} col={2} i={i} title={v.name || '[unnamed visit]'} sub={`${v.timing || 'no timepoint'} · ${activitiesAt(v.id)} assessment(s)`} tone="border-violet-200" />
          ))}
        </div>
        {!objectives.length && !endpoints.length && <p className="text-sm text-slate-500">No objectives or endpoints defined yet.</p>}
      </Card>
      <Card className="mt-5 p-5">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Study arms → interventions</h3>
        {arms.length === 0 ? (
          <p className="text-sm italic text-slate-400">No study arms defined.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {arms.map((a) => (
              <div key={a.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                <div className="font-semibold text-slate-800">
                  {a.code} · {a.name || '[unnamed arm]'}
                </div>
                <div className="text-xs text-slate-500">
                  {[a.interventionName, a.dosage, a.route, a.frequency, a.duration].filter(Boolean).join(' · ') || 'No intervention details'}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </Page>
  );
}

// ---------- Review & Validation ----------

export function Review() {
  const { id, bundle, loadError } = useModule('/review');
  const navigate = useNavigate();
  const report = useMemo(() => (bundle ? validateProtocol(bundle) : null), [bundle]);
  if (!id) return <ProtocolPicker title="Review & Validation" subtitle="Run rule-based validation checks and manage protocol status." base="/review" />;
  if (loadError) return <Page><Notice tone="error">{loadError}</Notice></Page>;
  if (!bundle || !report) return <Spinner />;
  const go = (i: ValidationIssue) => {
    if (i.target === 'soa') return navigate(`/builder/${id}/soa`);
    if (i.subsectionId) return navigate(`/builder/${id}?s=${i.subsectionId}`);
    if (i.target === 'arms') return navigate(`/builder/${id}/arms`);
    navigate(`/builder/${id}/objectives`);
  };
  return (
    <Page wide>
      <ModuleHeader bundle={bundle} title="Review & Validation" />
      <ValidationView report={report} onGo={go} />
    </Page>
  );
}

// ---------- Export Center ----------

export function ExportCenter() {
  const { id, bundle, loadError } = useModule('/export');
  const flush = useEditor((s) => s.flush);
  const report = useMemo(() => (bundle ? validateProtocol(bundle) : null), [bundle]);
  if (!id) return <ProtocolPicker title="Export Center" subtitle="Export any protocol as DOCX, PDF or structured JSON." base="/export" />;
  if (loadError) return <Page><Notice tone="error">{loadError}</Notice></Page>;
  if (!bundle || !report) return <Spinner />;
  const go = async (format: 'docx' | 'pdf' | 'json') => {
    await flush();
    download(exportUrl(bundle.protocol.id, format));
  };
  const formats = [
    { f: 'docx' as const, icon: FileType2, title: 'Word document (.docx)', text: 'Editable clinical protocol layout with cover page, TOC field, Word heading styles, numbered sections, tables, a landscape Schedule of Activities and "Page X of Y" footers.' },
    { f: 'pdf' as const, icon: FileText, title: 'PDF document (.pdf)', text: 'Paginated, print-ready protocol with cover page, table of contents with page numbers, headers, footers and a DRAFT watermark for non-final versions.' },
    { f: 'json' as const, icon: Braces, title: 'Structured JSON (.json)', text: 'Normalised study, protocol, sections/subsections, objectives, endpoints, links, arms, criteria and SoA, with validation results and USDM mapping hints.' },
  ];
  return (
    <Page>
      <ModuleHeader bundle={bundle} title="Export Center" />
      <Card className="mb-5 flex flex-wrap items-center gap-6 p-4 text-sm">
        <div className="w-60">
          <div className="mb-1 text-xs text-slate-500">Completion</div>
          <Progress value={bundle.protocol.completion} />
        </div>
        <div>
          <span className="font-semibold text-red-600">{report.errors.length}</span> errors · <span className="font-semibold text-amber-600">{report.warnings.length}</span> warnings
        </div>
        <Link to={`/review/${bundle.protocol.id}`} className="text-brand-700 hover:underline">
          View validation
        </Link>
        <span className="text-slate-500">Last modified {formatDateTime(bundle.protocol.updatedAt)}</span>
      </Card>
      {bundle.protocol.status !== 'Final' && (
        <Notice tone="warn" className="mb-5">
          This protocol is not Final. DOCX and PDF exports are marked DRAFT, and missing content appears as highlighted placeholders rather than being left out.
        </Notice>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {formats.map(({ f, icon: Icon, title, text }) => (
          <Card key={f} className="flex flex-col p-5">
            <Icon className="mb-3 h-7 w-7 text-brand-600" />
            <div className="font-semibold text-slate-900">{title}</div>
            <p className="mb-4 mt-1 flex-1 text-sm text-slate-500">{text}</p>
            <Button variant="primary" onClick={() => go(f)}>
              Download {f.toUpperCase()}
            </Button>
          </Card>
        ))}
      </div>
    </Page>
  );
}
