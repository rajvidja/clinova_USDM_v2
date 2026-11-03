import clsx from 'clsx';
import { Link2, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ENDPOINT_CATEGORIES, OBJECTIVE_CATEGORIES, type Endpoint, type Objective, type ObjectiveCategory } from '../../../shared/types';
import { newId, nextCode } from '../../lib/format';
import { useEditor } from '../../store/editor';
import { move, RowActions } from '../fields/StructuredFields';
import { Button, cellInputCls, inputCls } from '../ui';

const prefix: Record<ObjectiveCategory, string> = { Primary: 'PO', Secondary: 'SO', Exploratory: 'EO' };

export function ObjectivesEditor({ category, compact }: { category?: ObjectiveCategory; compact?: boolean }) {
  const objectives = useEditor((s) => s.bundle!.objectives);
  const endpoints = useEditor((s) => s.bundle!.endpoints);
  const setObjectives = useEditor((s) => s.setObjectives);
  const shown = objectives.filter((o) => !category || o.category === category);

  const update = (id: string, patch: Partial<Objective>) => setObjectives(objectives.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const add = () => {
    const cat = category ?? 'Primary';
    setObjectives([...objectives, { id: newId(), code: nextCode(prefix[cat], objectives.map((o) => o.code)), category: cat, description: '' }]);
  };
  const reorder = (id: string, d: -1 | 1) => {
    const i = objectives.findIndex((o) => o.id === id);
    let j = i + d;
    while (j >= 0 && j < objectives.length && category && objectives[j].category !== category) j += d;
    if (j < 0 || j >= objectives.length) return;
    setObjectives(swap(objectives, i, j));
  };

  return (
    <div className="space-y-3">
      {shown.length === 0 && <p className="text-sm italic text-slate-400">[Enter {category ? category.toLowerCase() : ''} objective]</p>}
      {shown.map((o, idx) => {
        const linked = endpoints.filter((e) => e.objectiveIds.includes(o.id));
        return (
          <div key={o.id} className="group rounded-md border border-slate-200 bg-white p-4">
            <div className="flex items-end gap-3">
              <Field label="ID" className="w-28 shrink-0">
                <input className={inputCls + ' font-mono text-xs'} value={o.code} aria-label="Objective ID" placeholder="ID" onChange={(e) => update(o.id, { code: e.target.value })} />
              </Field>
              {!category && (
                <Field label="Category" className="w-44 shrink-0">
                  <select className={inputCls} value={o.category} aria-label="Objective category" onChange={(e) => update(o.id, { category: e.target.value as ObjectiveCategory })}>
                    {OBJECTIVE_CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
              )}
              <div className="ml-auto self-start">
                <RowActions
                  label="objective"
                  onUp={idx > 0 ? () => reorder(o.id, -1) : undefined}
                  onDown={idx < shown.length - 1 ? () => reorder(o.id, 1) : undefined}
                  onRemove={() => setObjectives(objectives.filter((x) => x.id !== o.id))}
                />
              </div>
            </div>
            <Field label="Description" className="mt-3">
              <textarea
                className={inputCls + ' min-h-[64px] resize-y'}
                value={o.description}
                aria-label="Objective description"
                placeholder={`[Enter ${o.category.toLowerCase()} objective]`}
                onChange={(e) => update(o.id, { description: e.target.value })}
              />
            </Field>
            {!compact && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3 text-xs">
                <Link2 className="h-3.5 w-3.5 text-slate-400" />
                <span className="font-medium text-slate-500">Linked endpoints:</span>
                {linked.length ? (
                  linked.map((e) => (
                    <span key={e.id} className="rounded bg-brand-50 px-1.5 py-0.5 font-mono text-brand-700" title={e.name}>
                      {e.code || e.name || 'unnamed'}
                    </span>
                  ))
                ) : (
                  <span className="italic text-amber-600">none</span>
                )}
              </div>
            )}
          </div>
        );
      })}
      <Button size="sm" variant="ghost" onClick={add}>
        <Plus className="h-3.5 w-3.5" /> Add {category ? category.toLowerCase() + ' ' : ''}objective
      </Button>
    </div>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function swap<T>(arr: T[], i: number, j: number) {
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function EndpointsEditor() {
  const objectives = useEditor((s) => s.bundle!.objectives);
  const endpoints = useEditor((s) => s.bundle!.endpoints);
  const setEndpoints = useEditor((s) => s.setEndpoints);
  const [openLinks, setOpenLinks] = useState<string | null>(null);
  const update = (id: string, patch: Partial<Endpoint>) => setEndpoints(endpoints.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const add = () =>
    setEndpoints([...endpoints, { id: newId(), code: nextCode('EP', endpoints.map((e) => e.code)), category: endpoints.some((e) => e.category === 'Primary') ? 'Secondary' : 'Primary', name: '', definition: '', measurementMethod: '', timepoint: '', objectiveIds: [] }]);

  return (
    <div className="space-y-3">
      {endpoints.length === 0 && <p className="text-sm italic text-slate-400">[Enter primary endpoint and its definition]</p>}
      {endpoints.map((e, i) => (
        <div key={e.id} className="group rounded-md border border-slate-200 bg-white p-4">
          <div className="flex items-start gap-3">
            <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 md:grid-cols-12">
              <Field label="ID" className="md:col-span-2">
                <input className={inputCls + ' font-mono text-xs'} value={e.code} placeholder="ID" aria-label="Endpoint ID" onChange={(ev) => update(e.id, { code: ev.target.value })} />
              </Field>
              <Field label="Category" className="md:col-span-3">
                <select className={inputCls} value={e.category} aria-label="Endpoint category" onChange={(ev) => update(e.id, { category: ev.target.value as Endpoint['category'] })}>
                  {ENDPOINT_CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="Endpoint name" className="md:col-span-7">
                <input className={inputCls} value={e.name} placeholder="[Enter endpoint name]" aria-label="Endpoint name" onChange={(ev) => update(e.id, { name: ev.target.value })} />
              </Field>
              <Field label="Definition" className="md:col-span-12">
                <textarea className={inputCls + ' min-h-[64px] resize-y'} value={e.definition} placeholder="[Enter endpoint definition]" aria-label="Endpoint definition" onChange={(ev) => update(e.id, { definition: ev.target.value })} />
              </Field>
              <Field label="Measurement method" className="md:col-span-7">
                <input className={inputCls} value={e.measurementMethod} placeholder="[Enter measurement method]" aria-label="Measurement method" onChange={(ev) => update(e.id, { measurementMethod: ev.target.value })} />
              </Field>
              <Field label="Assessment timepoint" className="md:col-span-5">
                <input className={inputCls} value={e.timepoint} placeholder="[Enter assessment timepoint]" aria-label="Assessment timepoint" onChange={(ev) => update(e.id, { timepoint: ev.target.value })} />
              </Field>
            </div>
            <RowActions
              label="endpoint"
              onUp={i > 0 ? () => setEndpoints(move(endpoints, i, -1)) : undefined}
              onDown={i < endpoints.length - 1 ? () => setEndpoints(move(endpoints, i, 1)) : undefined}
              onRemove={() => setEndpoints(endpoints.filter((x) => x.id !== e.id))}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3 text-xs">
            <span className="font-medium text-slate-500">Linked objectives:</span>
            {e.objectiveIds.length === 0 && <span className="italic text-amber-600">none</span>}
            {e.objectiveIds.map((oid) => {
              const o = objectives.find((x) => x.id === oid);
              return o ? (
                <span key={oid} className="rounded bg-brand-50 px-1.5 py-0.5 font-mono text-brand-700" title={o.description}>
                  {o.code || o.category}
                </span>
              ) : null;
            })}
            <button className="ml-1 text-brand-700 hover:underline" onClick={() => setOpenLinks(openLinks === e.id ? null : e.id)}>
              {openLinks === e.id ? 'Done' : 'Edit links'}
            </button>
          </div>
          {openLinks === e.id && (
            <div className="mt-2 grid gap-1 rounded border border-slate-200 bg-slate-50 p-2 text-sm">
              {objectives.length === 0 && <span className="text-xs italic text-slate-500">Define objectives first (Section 3).</span>}
              {objectives.map((o) => (
                <label key={o.id} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={e.objectiveIds.includes(o.id)}
                    onChange={(ev) => update(e.id, { objectiveIds: ev.target.checked ? [...e.objectiveIds, o.id] : e.objectiveIds.filter((x) => x !== o.id) })}
                  />
                  <span>
                    <span className="font-mono text-xs text-slate-500">{o.code}</span> <span className="text-xs text-slate-400">({o.category})</span> {o.description || <em className="text-slate-400">no description</em>}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={add}>
        <Plus className="h-3.5 w-3.5" /> Add endpoint
      </Button>
    </div>
  );
}

/** Manual objective–endpoint traceability matrix. */
export function TraceabilityMatrix() {
  const objectives = useEditor((s) => s.bundle!.objectives);
  const endpoints = useEditor((s) => s.bundle!.endpoints);
  const setEndpoints = useEditor((s) => s.setEndpoints);
  if (!objectives.length || !endpoints.length) return <p className="text-sm italic text-slate-400">Add objectives and endpoints to link them.</p>;
  const toggle = (e: Endpoint, oid: string) =>
    setEndpoints(endpoints.map((x) => (x.id === e.id ? { ...x, objectiveIds: x.objectiveIds.includes(oid) ? x.objectiveIds.filter((y) => y !== oid) : [...x.objectiveIds, oid] } : x)));
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className="sticky left-0 bg-slate-50 px-3 py-2 text-left text-xs font-semibold text-slate-500">Objective \ Endpoint</th>
            {endpoints.map((e) => (
              <th key={e.id} className="px-2 py-2 text-center text-xs font-semibold text-slate-600" title={e.name}>
                <div className="font-mono">{e.code || '—'}</div>
                <div className="max-w-[110px] truncate font-normal text-slate-400">{e.name}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {objectives.map((o) => (
            <tr key={o.id} className="border-t border-slate-100">
              <td className="sticky left-0 max-w-[320px] bg-white px-3 py-1.5">
                <span className="font-mono text-xs text-slate-500">{o.code}</span> <span className="text-xs text-slate-400">{o.category}</span>
                <div className="truncate text-slate-700" title={o.description}>{o.description || <em className="text-slate-400">no description</em>}</div>
              </td>
              {endpoints.map((e) => {
                const on = e.objectiveIds.includes(o.id);
                return (
                  <td key={e.id} className="px-2 text-center">
                    <button
                      onClick={() => toggle(e, o.id)}
                      aria-pressed={on}
                      aria-label={`Link ${o.code} to ${e.code}`}
                      className={clsx('h-6 w-6 rounded border text-xs font-bold', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-transparent hover:border-brand-500')}
                    >
                      ✓
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { cellInputCls };
