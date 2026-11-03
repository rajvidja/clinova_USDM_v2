import { Copy, Plus } from 'lucide-react';
import { ARM_TYPES, type CriterionType, type StudyArm } from '../../../shared/types';
import { newId, nextCode } from '../../lib/format';
import { useEditor } from '../../store/editor';
import { move, RowActions } from '../fields/StructuredFields';
import { Button, inputCls } from '../ui';

const ARM_FIELDS: { key: keyof StudyArm; label: string; placeholder: string; span: string }[] = [
  { key: 'interventionName', label: 'Intervention name', placeholder: '[Enter intervention name]', span: 'col-span-6' },
  { key: 'dosage', label: 'Dosage', placeholder: '[Enter dose]', span: 'col-span-3' },
  { key: 'route', label: 'Route', placeholder: '[Enter route]', span: 'col-span-3' },
  { key: 'frequency', label: 'Frequency', placeholder: '[Enter frequency]', span: 'col-span-4' },
  { key: 'duration', label: 'Duration', placeholder: '[Enter treatment duration]', span: 'col-span-4' },
  { key: 'comparator', label: 'Comparator', placeholder: '[Enter comparator, if any]', span: 'col-span-4' },
];

export function ArmsBuilder() {
  const arms = useEditor((s) => s.bundle!.arms);
  const setArms = useEditor((s) => s.setArms);
  const update = (id: string, patch: Partial<StudyArm>) => setArms(arms.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const blank = (): StudyArm => ({ id: newId(), code: nextCode('A', arms.map((a) => a.code)), name: '', armType: '', interventionName: '', dosage: '', route: '', frequency: '', duration: '', comparator: '' });

  return (
    <div className="space-y-3">
      {arms.length === 0 && <p className="text-sm italic text-slate-400">[Enter treatment name, dosage, route and frequency for each study arm]</p>}
      {arms.map((a, i) => (
        <div key={a.id} className="group rounded-lg border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center gap-2">
            <input className={inputCls + ' !w-20 shrink-0 font-mono text-xs'} value={a.code} placeholder="Arm ID" aria-label="Arm ID" onChange={(e) => update(a.id, { code: e.target.value })} />
            <input className={inputCls + ' flex-1 font-medium'} value={a.name} placeholder="[Enter arm name]" aria-label="Arm name" onChange={(e) => update(a.id, { name: e.target.value })} />
            <select className={inputCls + ' !w-48 shrink-0'} value={a.armType} aria-label="Arm type" onChange={(e) => update(a.id, { armType: e.target.value })}>
              <option value="">[Arm type]</option>
              {ARM_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <button className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Duplicate arm" aria-label="Duplicate arm" onClick={() => setArms([...arms.slice(0, i + 1), { ...a, id: newId(), code: nextCode('A', arms.map((x) => x.code)), name: a.name ? `${a.name} (copy)` : '' }, ...arms.slice(i + 1)])}>
              <Copy className="h-3.5 w-3.5" />
            </button>
            <RowActions
              label="arm"
              onUp={i > 0 ? () => setArms(move(arms, i, -1)) : undefined}
              onDown={i < arms.length - 1 ? () => setArms(move(arms, i, 1)) : undefined}
              onRemove={() => setArms(arms.filter((x) => x.id !== a.id))}
            />
          </div>
          <div className="grid grid-cols-12 gap-2">
            {ARM_FIELDS.map((f) => (
              <label key={f.key} className={f.span}>
                <span className="mb-0.5 block text-xs font-medium text-slate-500">{f.label}</span>
                <input className={inputCls} value={String(a[f.key] ?? '')} placeholder={f.placeholder} onChange={(e) => update(a.id, { [f.key]: e.target.value })} />
              </label>
            ))}
          </div>
        </div>
      ))}
      <Button size="sm" variant="secondary" onClick={() => setArms([...arms, blank()])}>
        <Plus className="h-3.5 w-3.5" /> Add treatment arm
      </Button>
    </div>
  );
}

export function CriteriaBuilder({ type }: { type: CriterionType }) {
  const criteria = useEditor((s) => s.bundle!.criteria);
  const setCriteria = useEditor((s) => s.setCriteria);
  const list = criteria.filter((c) => c.type === type);
  const others = criteria.filter((c) => c.type !== type);
  const prefix = type === 'inclusion' ? 'I' : 'E';
  const write = (next: typeof list) => setCriteria(type === 'inclusion' ? [...next, ...others] : [...others, ...next]);
  const add = (at = list.length) => {
    const next = [...list];
    next.splice(at, 0, { id: newId(), type, code: nextCode(prefix, list.map((c) => c.code)), text: '' });
    write(next);
  };
  return (
    <div className="space-y-1.5">
      {list.length === 0 && <p className="text-sm italic text-slate-400">[Add {type} criteria]</p>}
      {list.map((c, i) => (
        <div key={c.id} className="group flex items-start gap-2">
          <input className={inputCls + ' !w-16 shrink-0 font-mono text-xs'} value={c.code} aria-label="Criterion ID" onChange={(e) => write(list.map((x) => (x.id === c.id ? { ...x, code: e.target.value } : x)))} />
          <textarea
            className={inputCls + ' min-h-[40px] flex-1'}
            rows={1}
            value={c.text}
            placeholder={`[Enter ${type} criterion]`}
            aria-label={`${type} criterion text`}
            onChange={(e) => write(list.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                add(i + 1);
              }
            }}
          />
          <RowActions
            label="criterion"
            onUp={i > 0 ? () => write(move(list, i, -1)) : undefined}
            onDown={i < list.length - 1 ? () => write(move(list, i, 1)) : undefined}
            onRemove={() => write(list.filter((x) => x.id !== c.id))}
          />
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Button size="sm" variant="ghost" onClick={() => add()}>
          <Plus className="h-3.5 w-3.5" /> Add {type} criterion
        </Button>
        <span className="text-xs text-slate-400">Enter adds a new criterion · Shift+Enter for a line break</span>
      </div>
    </div>
  );
}
