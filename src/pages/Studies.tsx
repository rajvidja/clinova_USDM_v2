import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ProtocolSummary, Study } from '../../shared/types';
import { Page } from '../components/Layout';
import { Card, EmptyState, PageHeader, Progress, SourceBadge, Spinner, StatusBadge } from '../components/ui';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';

export function Studies() {
  const [studies, setStudies] = useState<(Study & { protocols: ProtocolSummary[] })[] | null>(null);
  useEffect(() => void api.studies().then(setStudies), []);
  if (!studies) return <Spinner />;
  return (
    <Page wide>
      <PageHeader title="Studies" subtitle="All studies in the common structured study database, whether authored in Protocol Builder or created by Protocol Digitisation. Each study can hold several protocol versions." />
      {studies.length === 0 ? (
        <EmptyState title="No studies yet" />
      ) : (
        <div className="space-y-3">
          {studies.map((s) => (
            <Card key={s.id} className="p-4">
              <div className="flex flex-wrap items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono">{s.protocolNumber || '—'}</span>
                    <SourceBadge source={s.source} />
                    <span>{s.phase}</span>
                  </div>
                  <div className="font-medium text-slate-900">{s.title || <em className="text-slate-400">[Untitled]</em>}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {[s.sponsorName, s.therapeuticArea, s.indication, s.studyDesign].filter(Boolean).join(' · ') || 'No study details entered'}
                  </div>
                </div>
                <div className="text-right text-xs text-slate-400">Updated {formatDateTime(s.updatedAt)}</div>
              </div>
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {s.protocols.map((p) => (
                    <tr key={p.id} className="border-t border-slate-100">
                      <td className="py-2 pr-2">Version {p.version || '—'}</td>
                      <td className="px-2">
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="w-48 px-2">
                        <Progress value={p.completion} />
                      </td>
                      <td className="px-2 text-xs text-slate-500">rev {p.revision}</td>
                      <td className="space-x-3 px-2 text-right text-sm">
                        <Link className="text-brand-700 hover:underline" to={`/builder/${p.id}`}>
                          Edit
                        </Link>
                        <Link className="text-brand-700 hover:underline" to={`/explorer/${p.id}`}>
                          Explore
                        </Link>
                        <Link className="text-brand-700 hover:underline" to={`/export/${p.id}`}>
                          Export
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}
