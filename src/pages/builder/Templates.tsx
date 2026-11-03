import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ProtocolTemplate } from '../../../shared/types';
import { Page } from '../../components/Layout';
import { Button, Card, Notice, PageHeader, Spinner } from '../../components/ui';
import { api } from '../../lib/api';

export function Templates() {
  const [templates, setTemplates] = useState<ProtocolTemplate[] | null>(null);
  useEffect(() => void api.templates().then(setTemplates), []);
  if (!templates) return <Spinner />;
  return (
    <Page>
      <PageHeader
        title="Protocol Templates"
        subtitle="Templates define the section structure, placeholders, field types and mandatory/optional status. Each protocol records the template id and version it was created from."
        actions={
          <Link to="/builder/new">
            <Button variant="primary">Use template</Button>
          </Link>
        }
      />
      {templates.map((t) => (
        <Card key={`${t.id}@${t.version}`} className="mb-6 p-6">
          <div className="mb-1 flex items-baseline gap-3">
            <h2 className="text-lg font-semibold text-slate-900">{t.name}</h2>
            <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
              {t.id} · v{t.version}
            </span>
          </div>
          <p className="mb-3 text-sm text-slate-600">{t.basis}</p>
          <Notice tone="warn" className="mb-5">
            {t.notice}
          </Notice>
          <div className="grid gap-4 md:grid-cols-2">
            {t.sections.map((s) => (
              <div key={s.key} className="rounded-md border border-slate-200 p-3">
                <div className="mb-1.5 text-sm font-semibold text-slate-800">
                  Section {s.number}: {s.title}
                </div>
                <ul className="space-y-1 text-xs">
                  {s.subsections.map((sub, i) => (
                    <li key={sub.key} className="flex gap-2">
                      <span className="w-8 shrink-0 tabular-nums text-slate-400">
                        {s.number}.{i + 1}
                      </span>
                      <span className="flex-1 text-slate-700">{sub.title}</span>
                      <span className="text-slate-400">{[...new Set(sub.fields.map((f) => f.type))].join(', ')}</span>
                      <span className={sub.optional ? 'text-slate-400' : 'font-medium text-red-600'}>{sub.optional ? 'optional' : 'mandatory'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Optional subsections can be renamed, rearranged or removed in each protocol, and users can add further optional subsections of any supported content type. To publish a new template
            version, update <code>shared/template/ichGcp.ts</code> (version constant) or register an additional template in <code>shared/template/index.ts</code>.
          </p>
        </Card>
      ))}
    </Page>
  );
}
