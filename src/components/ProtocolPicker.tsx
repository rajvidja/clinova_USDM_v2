import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ProtocolSummary } from '../../shared/types';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { Page } from './Layout';
import { Card, EmptyState, PageHeader, Progress, SourceBadge, Spinner, StatusBadge } from './ui';

export function ProtocolPicker({ title, subtitle, base }: { title: string; subtitle: string; base: string }) {
  const [list, setList] = useState<ProtocolSummary[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => void api.protocols().then(setList), []);
  const filtered = (list ?? []).filter((p) => `${p.title} ${p.protocolNumber} ${p.sponsorName}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Page>
      <PageHeader title={title} subtitle={subtitle} />
      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm" placeholder="Search protocols…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!list ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState title="No protocols found">Create one in Protocol Builder or upload one in Protocol Digitisation.</EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((p) => (
            <Link key={p.id} to={`${base}/${p.id}`}>
              <Card className="h-full p-4 transition-shadow hover:shadow-md">
                <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
                  <span className="font-mono">{p.protocolNumber || '—'}</span>
                  <SourceBadge source={p.source} />
                  <StatusBadge status={p.status} />
                  <span className="ml-auto">{timeAgo(p.updatedAt)}</span>
                </div>
                <div className="line-clamp-2 font-medium text-slate-800">{p.title || <em className="text-slate-400">[Untitled protocol]</em>}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {p.sponsorName || 'No sponsor'} · v{p.version || '—'}
                </div>
                <Progress value={p.completion} className="mt-3" />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
}
