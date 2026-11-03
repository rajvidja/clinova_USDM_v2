import clsx from 'clsx';
import { AlertCircle, AlertTriangle, ArrowLeft, Check, ChevronDown, CloudOff, Copy, Download, Loader2, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { buildDocModel } from '../../../shared/docModel';
import type { ValidationIssue } from '../../../shared/types';
import { validateProtocol } from '../../../shared/validation';
import { ArmsBuilder } from '../../components/builders/ArmsCriteria';
import { EndpointsEditor, ObjectivesEditor, TraceabilityMatrix } from '../../components/builders/ObjectivesEndpoints';
import { SoaBuilder } from '../../components/builders/SoaBuilder';
import { DocumentPreview } from '../../components/DocumentPreview';
import { Button, Card, Modal, Notice, Progress, SourceBadge, Spinner, StatusBadge, Tabs } from '../../components/ui';
import { ValidationView } from '../../components/ValidationView';
import { api, exportUrl } from '../../lib/api';
import { download, timeAgo } from '../../lib/format';
import { useEditor } from '../../store/editor';
import { HistoryTab } from './HistoryTab';
import { SectionsTab } from './SectionsTab';

export type EditorTab = 'sections' | 'objectives' | 'arms' | 'soa' | 'validation' | 'preview' | 'history';

export function useProtocolLoader(id: string | undefined) {
  const load = useEditor((s) => s.load);
  const bundle = useEditor((s) => s.bundle);
  const loadError = useEditor((s) => s.loadError);
  useEffect(() => {
    if (id) void load(id);
  }, [id, load]);
  const ready = !!bundle && bundle.protocol.id === id;
  return { bundle: ready ? bundle : null, loadError };
}

export function SaveIndicator() {
  const saveState = useEditor((s) => s.saveState);
  const lastSavedAt = useEditor((s) => s.lastSavedAt);
  const saveError = useEditor((s) => s.saveError);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);
  if (saveState === 'saving')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
      </span>
    );
  if (saveState === 'dirty') return <span className="inline-flex items-center gap-1.5 text-xs text-amber-600">● Unsaved changes</span>;
  if (saveState === 'error')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-red-600" title={saveError ?? ''}>
        <CloudOff className="h-3.5 w-3.5" /> Save failed. Changes kept locally, retrying…
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500" title={lastSavedAt ?? ''}>
      <Check className="h-3.5 w-3.5 text-emerald-500" /> All changes saved {lastSavedAt ? `· ${timeAgo(lastSavedAt)}` : ''}
    </span>
  );
}

export function Editor() {
  const { id, tab = 'sections' } = useParams<{ id: string; tab?: EditorTab }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { bundle, loadError } = useProtocolLoader(id);
  const flush = useEditor((s) => s.flush);
  const recovered = useEditor((s) => s.recovered);
  const report = useMemo(() => (bundle ? validateProtocol(bundle) : null), [bundle]);
  const [menu, setMenu] = useState<'export' | 'more' | null>(null);
  const [dupOpen, setDupOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);

  const selectSub = useCallback(
    (subId: string) => {
      void flush();
      setParams((p) => {
        const n = new URLSearchParams(p);
        n.set('s', subId);
        return n;
      }, { replace: true });
    },
    [setParams, flush],
  );
  const setTab = (t: EditorTab) => {
    void flush();
    navigate(`/builder/${id}/${t === 'sections' ? '' : t}${t === 'sections' && params.get('s') ? `?s=${params.get('s')}` : ''}`);
  };

  const goToIssue = (issue: ValidationIssue) => {
    if (issue.target === 'soa') return setTab('soa');
    if (issue.target === 'arms' && !issue.subsectionId) return setTab('arms');
    if (issue.subsectionId) {
      navigate(`/builder/${id}?s=${issue.subsectionId}`);
      return;
    }
    if (issue.target === 'objectives' || issue.target === 'endpoints') setTab('objectives');
  };

  if (loadError) return <div className="p-8"><Notice tone="error">Could not load protocol: {loadError}</Notice></div>;
  if (!bundle || !report) return <Spinner label="Loading protocol…" />;

  const exportFile = async (format: 'pdf' | 'docx' | 'json') => {
    setMenu(null);
    await flush();
    download(exportUrl(bundle.protocol.id, format));
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="flex h-16 items-center gap-4 px-6">
          <Link to="/builder" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Back to Protocol Builder">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold text-slate-900" title={bundle.study.title}>
              {bundle.study.title || <span className="italic text-slate-400">[Untitled protocol]</span>}
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="font-mono">{bundle.study.protocolNumber || '[no protocol number]'}</span>
              <span>· v{bundle.protocol.version || '—'}</span>
              <span>· rev {bundle.protocol.revision}</span>
              <SourceBadge source={bundle.protocol.source} />
              <StatusBadge status={bundle.protocol.status} />
              <Progress value={bundle.protocol.completion} className="w-32" />
            </div>
          </div>
          <SaveIndicator />
          <button onClick={() => setTab('validation')} className="flex items-center gap-2 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs hover:bg-slate-50" title="Open validation">
            <span className="inline-flex items-center gap-1 text-red-600">
              <AlertCircle className="h-3.5 w-3.5" /> {report.errors.length}
            </span>
            <span className="inline-flex items-center gap-1 text-amber-600">
              <AlertTriangle className="h-3.5 w-3.5" /> {report.warnings.length}
            </span>
          </button>
          <Button variant="secondary" onClick={() => void flush()}>
            <Save className="h-4 w-4" /> Save
          </Button>
          <div className="relative">
            <Button variant="primary" onClick={() => setMenu(menu === 'export' ? null : 'export')}>
              <Download className="h-4 w-4" /> Export <ChevronDown className="h-3.5 w-3.5" />
            </Button>
            {menu === 'export' && (
              <Menu onClose={() => setMenu(null)}>
                <MenuItem onClick={() => exportFile('docx')}>Word document (.docx)</MenuItem>
                <MenuItem onClick={() => exportFile('pdf')}>PDF document (.pdf)</MenuItem>
                <MenuItem onClick={() => exportFile('json')}>Structured JSON (.json)</MenuItem>
              </Menu>
            )}
          </div>
          <div className="relative">
            <Button variant="ghost" onClick={() => setMenu(menu === 'more' ? null : 'more')} aria-label="More actions">
              ⋯
            </Button>
            {menu === 'more' && (
              <Menu onClose={() => setMenu(null)}>
                <MenuItem onClick={() => (setMenu(null), setDupOpen(true))}>
                  <Copy className="h-3.5 w-3.5" /> Duplicate protocol…
                </MenuItem>
                <MenuItem onClick={() => (setMenu(null), setDelOpen(true))} danger>
                  <Trash2 className="h-3.5 w-3.5" /> Delete protocol…
                </MenuItem>
              </Menu>
            )}
          </div>
        </div>
        <div className="px-6">
          <Tabs<EditorTab>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'sections', label: 'Sections' },
              { id: 'objectives', label: 'Objectives & Endpoints' },
              { id: 'arms', label: 'Study Arms' },
              { id: 'soa', label: 'Schedule of Activities' },
              { id: 'validation', label: `Validation (${report.errors.length}/${report.warnings.length})` },
              { id: 'preview', label: 'Preview' },
              { id: 'history', label: 'History' },
            ]}
          />
        </div>
      </header>

      {(recovered || bundle.protocol.status === 'Final') && (
        <div className="space-y-2 px-6 pt-3">
          {recovered && <Notice tone="info">Unsaved changes from your previous session were recovered and are being saved.</Notice>}
          {bundle.protocol.status === 'Final' && <Notice tone="warn">This protocol is marked Final. Any edit returns it to Draft. A snapshot of the Final version is kept in History.</Notice>}
        </div>
      )}

      {tab === 'sections' && <SectionsTab selectedId={params.get('s')} onSelect={selectSub} />}
      {tab === 'objectives' && (
        <div className="mx-auto max-w-6xl space-y-6 px-8 py-6">
          <Card className="p-5">
            <h3 className="mb-1 text-base font-semibold text-slate-900">Objectives</h3>
            <p className="mb-4 text-sm text-slate-500">Objectives appear in Sections 3.1–3.3 according to their category.</p>
            <ObjectivesEditor />
          </Card>
          <Card className="p-5">
            <h3 className="mb-1 text-base font-semibold text-slate-900">Endpoints</h3>
            <p className="mb-4 text-sm text-slate-500">Endpoints appear in Section 4.1. Link each endpoint to the objective(s) it measures.</p>
            <EndpointsEditor />
          </Card>
          <Card className="p-5">
            <h3 className="mb-1 text-base font-semibold text-slate-900">Objective–endpoint links</h3>
            <p className="mb-4 text-sm text-slate-500">Links are set manually. Click a cell to link or unlink.</p>
            <TraceabilityMatrix />
          </Card>
        </div>
      )}
      {tab === 'arms' && (
        <div className="mx-auto max-w-5xl px-8 py-6">
          <Card className="p-5">
            <h3 className="mb-1 text-base font-semibold text-slate-900">Study arms</h3>
            <p className="mb-4 text-sm text-slate-500">Treatment arms appear in Section 6.1 and are stored as structured study arm records.</p>
            <ArmsBuilder />
          </Card>
        </div>
      )}
      {tab === 'soa' && (
        <div className="px-6 py-6">
          <Card className="p-5">
            <h3 className="mb-1 text-base font-semibold text-slate-900">Schedule of Activities</h3>
            <p className="mb-4 text-sm text-slate-500">Build the visit schedule manually. It is stored as structured JSON and rendered as a landscape table in previews and exports.</p>
            <SoaBuilder />
          </Card>
        </div>
      )}
      {tab === 'validation' && (
        <div className="mx-auto max-w-6xl px-8 py-6">
          <ValidationView report={report} onGo={goToIssue} />
        </div>
      )}
      {tab === 'preview' && <PreviewTab onNavigate={(anchor) => anchor.startsWith('sub-') && navigate(`/builder/${id}?s=${anchor.slice(4)}`)} />}
      {tab === 'history' && <HistoryTab />}

      <DuplicateModal open={dupOpen} onClose={() => setDupOpen(false)} protocolId={bundle.protocol.id} />
      <Modal
        open={delOpen}
        onClose={() => setDelOpen(false)}
        title="Delete protocol"
        footer={
          <>
            <Button onClick={() => setDelOpen(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                await api.deleteProtocol(bundle.protocol.id);
                useEditor.setState({ bundle: null });
                navigate('/builder');
              }}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">This permanently deletes the protocol, its snapshots and attachments from the study database.</p>
      </Modal>
    </div>
  );
}

function PreviewTab({ onNavigate }: { onNavigate: (anchor: string) => void }) {
  const bundle = useEditor((s) => s.bundle!);
  const flush = useEditor((s) => s.flush);
  const [mode, setMode] = useState<'document' | 'pdf'>('document');
  const [pdfKey, setPdfKey] = useState(0);
  const model = useMemo(() => buildDocModel(bundle), [bundle]);
  useEffect(() => {
    if (mode === 'pdf') void flush().then(() => setPdfKey(Date.now()));
  }, [mode, flush]);
  return (
    <div className="px-6 py-6">
      <div className="mx-auto mb-4 flex max-w-[1123px] items-center gap-3">
        <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-sm">
          {(['document', 'pdf'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={clsx('rounded px-3 py-1', mode === m ? 'bg-navy-800 text-white' : 'text-slate-600 hover:bg-slate-100')}>
              {m === 'document' ? 'Document view' : 'Paginated PDF (page numbers)'}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-500">Highlighted text marks placeholders for content that has not been entered. Nothing is omitted.</span>
      </div>
      {mode === 'document' ? (
        <DocumentPreview model={model} onNavigate={onNavigate} />
      ) : pdfKey ? (
        <iframe key={pdfKey} title="PDF preview" src={`${exportUrl(bundle.protocol.id, 'pdf', true)}&t=${pdfKey}`} className="mx-auto block h-[calc(100vh-220px)] w-full max-w-[1123px] rounded border border-slate-300 bg-white" />
      ) : (
        <Spinner label="Rendering PDF…" />
      )}
    </div>
  );
}

function DuplicateModal({ open, onClose, protocolId }: { open: boolean; onClose: () => void; protocolId: string }) {
  const navigate = useNavigate();
  const flush = useEditor((s) => s.flush);
  const [mode, setMode] = useState<'new-study' | 'new-version'>('new-study');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Duplicate protocol"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await flush();
              const { id } = await api.duplicate(protocolId, mode);
              setBusy(false);
              onClose();
              navigate(`/builder/${id}`);
            }}
          >
            Duplicate
          </Button>
        </>
      }
    >
      <div className="space-y-2 text-sm">
        <label className="flex items-start gap-2 rounded-md border border-slate-200 p-3">
          <input type="radio" checked={mode === 'new-study'} onChange={() => setMode('new-study')} className="mt-1" />
          <span>
            <span className="font-medium text-slate-800">Copy as a new protocol</span>
            <span className="block text-slate-500">Creates a separate study record ("Copy of …") with all content, structured data, SoA and attachments.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 rounded-md border border-slate-200 p-3">
          <input type="radio" checked={mode === 'new-version'} onChange={() => setMode('new-version')} className="mt-1" />
          <span>
            <span className="font-medium text-slate-800">Copy as a new version of this study</span>
            <span className="block text-slate-500">Keeps the same study record, for example to start an amendment. Version and amendment fields are cleared for you to complete.</span>
          </span>
        </label>
      </div>
    </Modal>
  );
}

function Menu({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    setTimeout(() => document.addEventListener('mousedown', h));
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);
  return (
    <div ref={ref} className="absolute right-0 top-full z-40 mt-1 w-60 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
      {children}
    </div>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={clsx('flex w-full items-center gap-2 px-3 py-2 text-left text-sm', danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50')}>
      {children}
    </button>
  );
}
