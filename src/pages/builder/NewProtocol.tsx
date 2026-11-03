import { CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PHASES, STUDY_DESIGNS, type ProtocolTemplate } from '../../../shared/types';
import { Page } from '../../components/Layout';
import { Button, Card, FieldLabel, inputCls, Notice, PageHeader } from '../../components/ui';
import { api } from '../../lib/api';

const FIELDS: { key: string; label: string; placeholder: string; type?: 'date' | 'select'; options?: string[]; required?: boolean; span?: string }[] = [
  { key: 'title', label: 'Protocol Title', placeholder: '[Enter protocol title]', required: true, span: 'md:col-span-2' },
  { key: 'protocolNumber', label: 'Protocol Number', placeholder: '[Enter protocol identifying number]' },
  { key: 'sponsorName', label: 'Sponsor Name', placeholder: '[Enter sponsor name]' },
  { key: 'therapeuticArea', label: 'Therapeutic Area', placeholder: '[Enter therapeutic area]' },
  { key: 'indication', label: 'Indication', placeholder: '[Enter indication]' },
  { key: 'phase', label: 'Clinical Trial Phase', placeholder: '[Select phase]', type: 'select', options: PHASES },
  { key: 'studyDesign', label: 'Study Design', placeholder: '[Select study design]', type: 'select', options: STUDY_DESIGNS },
  { key: 'version', label: 'Protocol Version', placeholder: '[e.g. 1.0]' },
  { key: 'protocolDate', label: 'Protocol Date', placeholder: '', type: 'date' },
  { key: 'amendmentNumber', label: 'Amendment Number', placeholder: '[If applicable]' },
];

export function NewProtocol() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<ProtocolTemplate[]>([]);
  const [form, setForm] = useState<Record<string, string>>({});
  const [template, setTemplate] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.templates().then((t) => {
      setTemplates(t);
      if (t[0]) setTemplate(`${t[0].id}@${t[0].version}`);
    });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title?.trim()) return setError('Protocol title is required to create a draft.');
    setBusy(true);
    setError(null);
    try {
      const [templateId, templateVersion] = template.split('@');
      const { id } = await api.createProtocol({ ...form, templateId, templateVersion });
      navigate(`/builder/${id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Page>
      <PageHeader title="Create New Protocol" subtitle="Enter the study set-up details. You can change any of them later. All sections are created with empty placeholders, and nothing is pre-filled." />
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Protocol set-up</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {FIELDS.map((f) => (
              <div key={f.key} className={f.span}>
                <FieldLabel htmlFor={f.key} required={f.required}>
                  {f.label}
                </FieldLabel>
                {f.type === 'select' ? (
                  <select id={f.key} className={inputCls} value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}>
                    <option value="">{f.placeholder}</option>
                    {f.options!.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                ) : (
                  <input id={f.key} type={f.type ?? 'text'} className={inputCls} value={form[f.key] ?? ''} placeholder={f.placeholder} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                )}
              </div>
            ))}
          </div>
        </Card>
        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Template</h2>
            {templates.map((t) => {
              const key = `${t.id}@${t.version}`;
              const subs = t.sections.reduce((n, s) => n + s.subsections.length, 0);
              return (
                <label key={key} className={`block cursor-pointer rounded-md border p-3 ${template === key ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-500' : 'border-slate-200'}`}>
                  <div className="flex items-start gap-2">
                    <input type="radio" name="template" checked={template === key} onChange={() => setTemplate(key)} className="mt-1" />
                    <div>
                      <div className="font-medium text-slate-900">{t.name}</div>
                      <div className="text-xs text-slate-500">
                        Template v{t.version} · {t.sections.length} sections · {subs} subsections
                      </div>
                      <div className="mt-2 space-y-0.5 text-xs text-slate-600">
                        {t.sections.slice(0, 16).map((s) => (
                          <div key={s.key} className="flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3 text-brand-500" /> {s.number}. {s.title}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </label>
              );
            })}
          </Card>
          {templates[0] && <Notice tone="warn">{templates[0].notice}</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            Create protocol
          </Button>
        </div>
      </form>
    </Page>
  );
}
