import { AlertCircle, AlertTriangle, ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { ProtocolStatus, ValidationIssue, ValidationReport } from '../../shared/types';
import { api } from '../lib/api';
import { useEditor } from '../store/editor';
import { Button, Card, Notice, StatusBadge } from './ui';

export function ValidationView({ report, onGo }: { report: ValidationReport; onGo: (issue: ValidationIssue) => void }) {
  const bundle = useEditor((s) => s.bundle!);
  const flush = useEditor((s) => s.flush);
  const load = useEditor((s) => s.load);
  const [busy, setBusy] = useState<ProtocolStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const changeStatus = async (status: ProtocolStatus) => {
    setBusy(status);
    setError(null);
    try {
      await flush();
      await api.setStatus(bundle.protocol.id, status);
      await load(bundle.protocol.id, true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-center gap-6 p-5">
        <div className="flex items-center gap-3">
          {report.errors.length ? <AlertCircle className="h-9 w-9 text-red-500" /> : <ShieldCheck className="h-9 w-9 text-emerald-500" />}
          <div>
            <div className="text-lg font-semibold text-slate-900">{report.errors.length ? 'Validation errors must be resolved' : 'No blocking validation errors'}</div>
            <div className="text-sm text-slate-500">
              {report.errors.length} error(s) · {report.warnings.length} warning(s) · rule-based checks only, no content is filled in automatically
            </div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-slate-500">Status:</span>
          <StatusBadge status={bundle.protocol.status} />
          {bundle.protocol.status !== 'Draft' && (
            <Button size="sm" onClick={() => changeStatus('Draft')} loading={busy === 'Draft'}>
              Return to Draft
            </Button>
          )}
          {bundle.protocol.status === 'Draft' && (
            <Button size="sm" onClick={() => changeStatus('In Review')} loading={busy === 'In Review'}>
              Submit for review
            </Button>
          )}
          {bundle.protocol.status !== 'Final' && (
            <Button size="sm" variant="primary" onClick={() => changeStatus('Final')} disabled={report.errors.length > 0} loading={busy === 'Final'} title={report.errors.length ? 'Resolve all errors first' : undefined}>
              Mark as Final
            </Button>
          )}
        </div>
      </Card>
      {error && <Notice tone="error">{error}</Notice>}

      <div className="grid gap-5 lg:grid-cols-2">
        <IssueList title="Errors" tone="error" issues={report.errors} onGo={onGo} />
        <IssueList title="Warnings" tone="warning" issues={report.warnings} onGo={onGo} />
      </div>
    </div>
  );
}

function IssueList({ title, tone, issues, onGo }: { title: string; tone: 'error' | 'warning'; issues: ValidationIssue[]; onGo: (i: ValidationIssue) => void }) {
  const Icon = tone === 'error' ? AlertCircle : AlertTriangle;
  return (
    <Card>
      <div className={`flex items-center gap-2 border-b px-4 py-3 ${tone === 'error' ? 'border-red-100 bg-red-50/60' : 'border-amber-100 bg-amber-50/60'}`}>
        <Icon className={`h-4 w-4 ${tone === 'error' ? 'text-red-500' : 'text-amber-500'}`} />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <span className={`ml-auto rounded-full px-2 text-xs font-semibold ${tone === 'error' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{issues.length}</span>
      </div>
      {issues.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-6 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" /> No {title.toLowerCase()}.
        </div>
      ) : (
        <ul className="max-h-[560px] divide-y divide-slate-100 overflow-y-auto">
          {issues.map((i) => (
            <li key={i.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
              <div className="flex-1">
                <div className="text-slate-800">{i.message}</div>
                <div className="text-xs text-slate-500">
                  {i.location ?? (i.target === 'soa' ? 'Schedule of Activities' : i.target)} · <span className="font-mono">{i.rule}</span>
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => onGo(i)}>
                Fix <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
