import clsx from 'clsx';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Plus, Superscript, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { SoaActivity, SoaMark, SoaSchedule, SoaVisit } from '../../../shared/types';
import { newId } from '../../lib/format';
import { useEditor } from '../../store/editor';
import { Button, cellInputCls, inputCls } from '../ui';

const NEXT: Record<SoaMark, SoaMark> = { '': 'required', required: 'optional', optional: '' };
const markerFor = (i: number) => (i < 26 ? String.fromCharCode(97 + i) : `n${i + 1}`);

function swap<T>(arr: T[], i: number, j: number) {
  if (j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function SoaBuilder() {
  const soa = useEditor((s) => s.bundle!.soa);
  const setSoa = useEditor((s) => s.setSoa);
  const [fnTarget, setFnTarget] = useState<{ kind: 'visit' | 'activity'; id: string } | null>(null);
  const write = (patch: Partial<SoaSchedule>) => setSoa({ ...soa, ...patch });
  const updVisit = (id: string, patch: Partial<SoaVisit>) => write({ visits: soa.visits.map((v) => (v.id === id ? { ...v, ...patch } : v)) });
  const updAct = (id: string, patch: Partial<SoaActivity>) => write({ activities: soa.activities.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  const marker = (ids: string[]) => ids.map((id) => soa.footnotes.find((f) => f.id === id)?.marker).filter(Boolean).join(',');

  const addVisit = () => write({ visits: [...soa.visits, { id: newId(), name: `Visit ${soa.visits.length + 1}`, timing: '', window: '', footnoteIds: [] }] });
  const removeVisit = (id: string) =>
    write({
      visits: soa.visits.filter((v) => v.id !== id),
      activities: soa.activities.map((a) => {
        const cells = { ...a.cells };
        delete cells[id];
        return { ...a, cells };
      }),
    });
  const addActivity = () => write({ activities: [...soa.activities, { id: newId(), name: '', category: '', cells: {}, footnoteIds: [] }] });
  const addFootnote = () => write({ footnotes: [...soa.footnotes, { id: newId(), marker: markerFor(soa.footnotes.length), text: '' }] });
  const removeFootnote = (id: string) =>
    write({
      footnotes: soa.footnotes.filter((f) => f.id !== id),
      visits: soa.visits.map((v) => ({ ...v, footnoteIds: v.footnoteIds.filter((x) => x !== id) })),
      activities: soa.activities.map((a) => ({ ...a, footnoteIds: a.footnoteIds.filter((x) => x !== id) })),
    });

  const toggleFn = (fid: string) => {
    if (!fnTarget) return;
    const flip = (ids: string[]) => (ids.includes(fid) ? ids.filter((x) => x !== fid) : [...ids, fid]);
    if (fnTarget.kind === 'visit') updVisit(fnTarget.id, { footnoteIds: flip(soa.visits.find((v) => v.id === fnTarget.id)!.footnoteIds) });
    else updAct(fnTarget.id, { footnoteIds: flip(soa.activities.find((a) => a.id === fnTarget.id)!.footnoteIds) });
  };
  const fnIds = fnTarget ? (fnTarget.kind === 'visit' ? soa.visits.find((v) => v.id === fnTarget.id)?.footnoteIds : soa.activities.find((a) => a.id === fnTarget.id)?.footnoteIds) ?? [] : [];

  const FnButton = ({ kind, id, ids }: { kind: 'visit' | 'activity'; id: string; ids: string[] }) => (
    <button
      onClick={() => setFnTarget(fnTarget?.id === id ? null : { kind, id })}
      className={clsx('inline-flex items-center gap-0.5 rounded px-1 text-[11px]', ids.length ? 'bg-violet-50 font-semibold text-violet-700' : 'text-slate-400 hover:bg-slate-100', fnTarget?.id === id && 'ring-1 ring-violet-400')}
      title="Assign footnotes"
      aria-label="Assign footnotes"
    >
      <Superscript className="h-3 w-3" />
      {marker(ids)}
    </button>
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={addVisit}>
          <Plus className="h-3.5 w-3.5" /> Add visit
        </Button>
        <Button size="sm" onClick={addActivity}>
          <Plus className="h-3.5 w-3.5" /> Add assessment
        </Button>
        <Button size="sm" onClick={addFootnote}>
          <Plus className="h-3.5 w-3.5" /> Add footnote
        </Button>
        <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
          <span>Click a cell to cycle:</span>
          <span className="inline-flex items-center gap-1"><Cell mark="required" /> Required</span>
          <span className="inline-flex items-center gap-1"><Cell mark="optional" /> Optional</span>
          <span className="inline-flex items-center gap-1"><Cell mark="" /> Not performed</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 align-top">
              <th className="sticky left-0 z-10 min-w-[260px] border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                Assessment / Procedure
              </th>
              {soa.visits.map((v, i) => (
                <th key={v.id} className="group min-w-[132px] border-b border-r border-slate-200 px-1.5 py-1.5 text-left font-normal">
                  <input className={cellInputCls + ' font-semibold text-slate-800'} value={v.name} placeholder="[Visit name]" aria-label="Visit name" onChange={(e) => updVisit(v.id, { name: e.target.value })} />
                  <input className={cellInputCls + ' text-xs'} value={v.timing} placeholder="[Timepoint, e.g. Day 1]" aria-label="Visit timepoint" onChange={(e) => updVisit(v.id, { timing: e.target.value })} />
                  <input className={cellInputCls + ' text-xs'} value={v.window} placeholder="[Window, e.g. ±3 days]" aria-label="Visit window" onChange={(e) => updVisit(v.id, { window: e.target.value })} />
                  <div className="mt-0.5 flex items-center justify-between px-1">
                    <FnButton kind="visit" id={v.id} ids={v.footnoteIds} />
                    <span className="flex opacity-50 group-hover:opacity-100">
                      <IconBtn label="Move visit left" onClick={() => write({ visits: swap(soa.visits, i, i - 1) })} disabled={i === 0}>
                        <ArrowLeft className="h-3 w-3" />
                      </IconBtn>
                      <IconBtn label="Move visit right" onClick={() => write({ visits: swap(soa.visits, i, i + 1) })} disabled={i === soa.visits.length - 1}>
                        <ArrowRight className="h-3 w-3" />
                      </IconBtn>
                      <IconBtn label="Remove visit" danger onClick={() => removeVisit(v.id)}>
                        <Trash2 className="h-3 w-3" />
                      </IconBtn>
                    </span>
                  </div>
                </th>
              ))}
              <th className="border-b border-slate-200 px-2" />
            </tr>
          </thead>
          <tbody>
            {soa.activities.length === 0 && (
              <tr>
                <td colSpan={soa.visits.length + 2} className="px-4 py-8 text-center text-sm text-slate-400">
                  No assessments yet. Use <strong>Add assessment</strong> to enter procedures manually. ProtocolIQ does not generate assessment schedules.
                </td>
              </tr>
            )}
            {soa.activities.map((a, i) => (
              <tr key={a.id} className="group border-b border-slate-100 hover:bg-slate-50/60">
                <td className="sticky left-0 z-10 border-r border-slate-200 bg-white px-1.5 py-1 group-hover:bg-slate-50">
                  <div className="flex items-center gap-1">
                    <div className="flex-1">
                      <input className={cellInputCls + ' font-medium'} value={a.name} placeholder="[Assessment / procedure]" aria-label="Assessment name" onChange={(e) => updAct(a.id, { name: e.target.value })} />
                      <input className={cellInputCls + ' py-0.5 text-xs text-slate-500'} value={a.category} placeholder="[Category, optional]" aria-label="Assessment category" onChange={(e) => updAct(a.id, { category: e.target.value })} />
                    </div>
                    <FnButton kind="activity" id={a.id} ids={a.footnoteIds} />
                  </div>
                </td>
                {soa.visits.map((v) => {
                  const mark = a.cells[v.id] ?? '';
                  return (
                    <td key={v.id} className="border-r border-slate-100 p-0 text-center">
                      <button
                        className="flex h-11 w-full items-center justify-center hover:bg-brand-50"
                        onClick={() => updAct(a.id, { cells: { ...a.cells, [v.id]: NEXT[mark] } })}
                        aria-label={`${a.name || 'Assessment'} at ${v.name}: ${mark || 'not performed'}`}
                      >
                        <Cell mark={mark} />
                      </button>
                    </td>
                  );
                })}
                <td className="px-1">
                  <span className="flex opacity-50 group-hover:opacity-100">
                    <IconBtn label="Move up" onClick={() => write({ activities: swap(soa.activities, i, i - 1) })} disabled={i === 0}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </IconBtn>
                    <IconBtn label="Move down" onClick={() => write({ activities: swap(soa.activities, i, i + 1) })} disabled={i === soa.activities.length - 1}>
                      <ArrowDown className="h-3.5 w-3.5" />
                    </IconBtn>
                    <IconBtn label="Remove assessment" danger onClick={() => write({ activities: soa.activities.filter((x) => x.id !== a.id) })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconBtn>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {fnTarget && (
        <div className="mt-3 rounded-md border border-violet-200 bg-violet-50/50 p-3 text-sm">
          <div className="mb-1.5 font-medium text-violet-800">
            Footnotes for {fnTarget.kind === 'visit' ? `visit "${soa.visits.find((v) => v.id === fnTarget.id)?.name}"` : `assessment "${soa.activities.find((a) => a.id === fnTarget.id)?.name || 'unnamed'}"`}
          </div>
          {soa.footnotes.length === 0 && <p className="text-xs text-slate-500">Add a footnote first.</p>}
          {soa.footnotes.map((f) => (
            <label key={f.id} className="flex items-center gap-2 py-0.5">
              <input type="checkbox" checked={fnIds.includes(f.id)} onChange={() => toggleFn(f.id)} />
              <span className="font-semibold">{f.marker}</span> {f.text || <em className="text-slate-400">empty footnote</em>}
            </label>
          ))}
          <Button size="sm" variant="ghost" className="mt-1" onClick={() => setFnTarget(null)}>
            Done
          </Button>
        </div>
      )}

      <div className="mt-5">
        <h4 className="mb-2 text-sm font-semibold text-slate-700">Footnotes</h4>
        {soa.footnotes.length === 0 && <p className="text-sm italic text-slate-400">[Add footnotes]</p>}
        <div className="space-y-1.5">
          {soa.footnotes.map((f) => (
            <div key={f.id} className="flex items-center gap-2">
              <input className={inputCls + ' !w-14 shrink-0 text-center font-semibold'} value={f.marker} aria-label="Footnote marker" onChange={(e) => write({ footnotes: soa.footnotes.map((x) => (x.id === f.id ? { ...x, marker: e.target.value } : x)) })} />
              <input className={inputCls} value={f.text} placeholder="[Enter footnote text]" aria-label="Footnote text" onChange={(e) => write({ footnotes: soa.footnotes.map((x) => (x.id === f.id ? { ...x, text: e.target.value } : x)) })} />
              <IconBtn label="Remove footnote" danger onClick={() => removeFootnote(f.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </IconBtn>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Cell({ mark }: { mark: SoaMark }) {
  if (mark === 'required') return <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-brand-600 text-xs font-bold text-white">X</span>;
  if (mark === 'optional') return <span className="inline-flex h-6 w-8 items-center justify-center rounded border border-brand-500 text-xs font-semibold text-brand-700">(X)</span>;
  return <span className="inline-flex h-6 w-6 items-center justify-center rounded border border-dashed border-slate-200 text-slate-300">·</span>;
}

function IconBtn({ children, label, onClick, disabled, danger }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick} className={clsx('rounded p-1 text-slate-400 disabled:opacity-30', danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-slate-100 hover:text-slate-700')}>
      {children}
    </button>
  );
}
