import { ArrowRight, FilePlus2, FileScan } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Page } from '../components/Layout';
import { Button, Card, PageHeader, Spinner } from '../components/ui';
import { api, type DashboardStats } from '../lib/api';
import { timeAgo } from '../lib/format';
import { ProtocolTable } from './builder/BuilderHome';

const FLOW_A = ['Upload existing protocol', 'Parse document', 'Extract elements', 'Structure data', 'Review', 'Export'];
const FLOW_B = ['Create new protocol', 'Select ICH template', 'Fill placeholders', 'Create SoA', 'Validate', 'Preview', 'Export'];

export function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  useEffect(() => void api.dashboard().then(setStats), []);
  if (!stats) return <Spinner />;
  return (
    <Page wide>
      <PageHeader title="Dashboard" subtitle="Two connected workflows writing to one structured study database, designed for downstream USDM mapping." />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
        {[
          ['Studies', stats.studies],
          ['Protocols', stats.protocols],
          ['Built in Builder', stats.builder],
          ['Digitised', stats.digitised],
          ['Final', stats.final],
        ].map(([label, value]) => (
          <Card key={label} className="p-4">
            <div className="text-2xl font-semibold text-slate-900">{value}</div>
            <div className="text-xs text-slate-500">{label}</div>
          </Card>
        ))}
      </div>

      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        <Flow title="A. Protocol Digitisation" icon={<FileScan className="h-5 w-5 text-violet-600" />} steps={FLOW_A} to="/digitisation" cta="Upload a protocol" />
        <Flow title="B. Protocol Builder" icon={<FilePlus2 className="h-5 w-5 text-brand-600" />} steps={FLOW_B} to="/builder/new" cta="Create a protocol" />
      </div>

      <ProtocolTable title="Recently edited" rows={stats.recent} empty="No protocols yet." />

      {stats.recentDocuments.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Recently digitised documents</h2>
          <Card>
            <ul className="divide-y divide-slate-100 text-sm">
              {stats.recentDocuments.map((d) => (
                <li key={d.id} className="flex items-center justify-between px-4 py-2.5">
                  <span className="font-medium text-slate-700">{d.filename}</span>
                  <span className="flex items-center gap-4 text-slate-500">
                    {timeAgo(d.uploadedAt)}
                    <Link className="text-brand-700 hover:underline" to={`/builder/${d.protocolId}`}>
                      Review
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </Page>
  );
}

function Flow({ title, icon, steps, to, cta }: { title: string; icon: React.ReactNode; steps: string[]; to: string; cta: string }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <h2 className="font-semibold text-slate-900">{title}</h2>
        <Link to={to} className="ml-auto">
          <Button size="sm" variant="primary">
            {cta}
          </Button>
        </Link>
      </div>
      <ol className="flex flex-wrap items-center gap-1.5 text-xs">
        {steps.map((s, i) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-700">
              <span className="mr-1 font-semibold text-slate-400">{i + 1}</span>
              {s}
            </span>
            {i < steps.length - 1 && <ArrowRight className="h-3 w-3 text-slate-300" />}
          </li>
        ))}
      </ol>
    </Card>
  );
}
