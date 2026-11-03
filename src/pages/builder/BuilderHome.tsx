import { Copy, FilePlus2, LayoutTemplate, MoreHorizontal, Play, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ProtocolSummary, ProtocolTemplate } from '../../../shared/types';
import { Page } from '../../components/Layout';
import { Button, Card, EmptyState, Modal, PageHeader, Progress, SourceBadge, Spinner, StatusBadge } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDateTime, timeAgo } from '../../lib/format';

export function BuilderHome() {
  const [protocols, setProtocols] = useState<ProtocolSummary[] | null>(null);
  const [templates, setTemplates] = useState<ProtocolTemplate[]>([]);
  const [includeDigitised, setIncludeDigitised] = useState(true);
  const refresh = () => api.protocols().then(setProtocols);
  useEffect(() => {
    void refresh();
    void api.templates().then(setTemplates);
  }, []);

  const list = useMemo(() => (protocols ?? []).filter((p) => includeDigitised || p.source === 'builder'), [protocols, includeDigitised]);
  const drafts = list.filter((p) => p.status !== 'Final');
  const completed = list.filter((p) => p.status === 'Final');
  const recent = [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);

  return (
    <Page wide>
      <PageHeader
        title="Protocol Builder"
        subtitle="Author a complete clinical trial protocol from a structured ICH-GCP template. Content is entered by you; ProtocolIQ applies rules, structure and formatting only."
        actions={
          <Link to="/builder/new">
            <Button variant="primary">
              <FilePlus2 className="h-4 w-4" /> Create New Protocol
            </Button>
          </Link>
        }
      />

      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <Link to="/builder/new" className="group">
          <Card className="h-full p-5 transition-shadow group-hover:shadow-md">
            <FilePlus2 className="mb-3 h-6 w-6 text-brand-600" />
            <div className="font-semibold text-slate-900">Create New Protocol</div>
            <p className="mt-1 text-sm text-slate-500">Set up study details and generate all 16 ICH sections with editable placeholders.</p>
          </Card>
        </Link>
        <Link to="/builder/templates" className="group">
          <Card className="h-full p-5 transition-shadow group-hover:shadow-md">
            <LayoutTemplate className="mb-3 h-6 w-6 text-violet-600" />
            <div className="font-semibold text-slate-900">Protocol Templates</div>
            <p className="mt-1 text-sm text-slate-500">
              {templates.map((t) => `${t.name} v${t.version}`).join(', ') || 'Loading…'}
            </p>
          </Card>
        </Link>
        <Card className="grid grid-cols-3 p-5 text-center">
          <Stat label="Drafts" value={drafts.length} />
          <Stat label="Completed" value={completed.length} />
          <Stat label="Total" value={list.length} />
        </Card>
      </div>

      <label className="mb-3 flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={includeDigitised} onChange={(e) => setIncludeDigitised(e.target.checked)} />
        Include protocols created by Protocol Digitisation (shared study database)
      </label>

      {!protocols ? (
        <Spinner />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<FilePlus2 className="h-8 w-8" />}
          title="No protocols yet"
          action={
            <Link to="/builder/new">
              <Button variant="primary">Create New Protocol</Button>
            </Link>
          }
        >
          Create a protocol from the ICH-GCP template to get started.
        </EmptyState>
      ) : (
        <div className="space-y-8">
          <ProtocolTable title="Recently Edited Protocols" rows={recent} onChange={refresh} />
          <ProtocolTable title="Existing Drafts" rows={drafts} onChange={refresh} empty="No drafts." />
          <ProtocolTable title="Completed Protocols" rows={completed} onChange={refresh} empty="No protocols have been marked Final yet." />
        </div>
      )}
    </Page>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-2xl font-semibold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

export function ProtocolTable({ title, rows, onChange, empty, linkBase = '/builder' }: { title: string; rows: ProtocolSummary[]; onChange?: () => void; empty?: string; linkBase?: string }) {
  const navigate = useNavigate();
  const [menu, setMenu] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProtocolSummary | null>(null);
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title} <span className="font-normal">({rows.length})</span>
      </h2>
      <Card className="overflow-visible">
        {rows.length === 0 ? (
          <p className="px-5 py-5 text-sm text-slate-500">{empty}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Protocol title</th>
                <th className="px-2 py-2.5">Protocol number</th>
                <th className="px-2 py-2.5">Sponsor</th>
                <th className="px-2 py-2.5">Version</th>
                <th className="px-2 py-2.5">Last modified</th>
                <th className="w-40 px-2 py-2.5">Completion</th>
                <th className="px-2 py-2.5">Status</th>
                <th className="w-32 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                  <td className="max-w-[380px] px-4 py-2.5">
                    <Link to={`${linkBase}/${p.id}`} className="line-clamp-2 font-medium text-slate-800 hover:text-brand-700">
                      {p.title || <span className="italic text-slate-400">[Untitled protocol]</span>}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
                      <SourceBadge source={p.source} /> {p.phase}
                    </div>
                  </td>
                  <td className="px-2 font-mono text-xs">{p.protocolNumber || '—'}</td>
                  <td className="px-2 text-slate-600">{p.sponsorName || '—'}</td>
                  <td className="px-2">{p.version || '—'}</td>
                  <td className="px-2 text-slate-600" title={formatDateTime(p.updatedAt)}>
                    {timeAgo(p.updatedAt)}
                  </td>
                  <td className="px-2">
                    <Progress value={p.completion} />
                  </td>
                  <td className="px-2">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="relative px-2 text-right">
                    <Button size="sm" onClick={() => navigate(`/builder/${p.id}`)}>
                      <Play className="h-3 w-3" /> Resume
                    </Button>
                    {onChange && (
                      <button className="ml-1 rounded p-1.5 text-slate-400 hover:bg-slate-100" onClick={() => setMenu(menu === p.id ? null : p.id)} aria-label="More actions">
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    )}
                    {menu === p.id && (
                      <div className="absolute right-2 top-full z-20 w-48 rounded-md border border-slate-200 bg-white py-1 text-left shadow-lg" onMouseLeave={() => setMenu(null)}>
                        <button
                          className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50"
                          onClick={async () => {
                            setMenu(null);
                            const { id } = await api.duplicate(p.id, 'new-study');
                            navigate(`/builder/${id}`);
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" /> Duplicate
                        </button>
                        <button className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50" onClick={() => (setMenu(null), setConfirmDelete(p))}>
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete protocol"
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                await api.deleteProtocol(confirmDelete!.id);
                setConfirmDelete(null);
                onChange?.();
              }}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Permanently delete <strong>{confirmDelete?.title || 'this protocol'}</strong> with its snapshots and attachments?
        </p>
      </Modal>
    </section>
  );
}
