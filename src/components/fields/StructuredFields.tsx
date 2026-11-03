import { ArrowDown, ArrowUp, ExternalLink, FileText, Paperclip, Plus, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import type { Attachment, FieldDef, ReferenceItem, TableColumn, TableValue } from '../../../shared/types';
import { api, attachmentUrl } from '../../lib/api';
import { newId } from '../../lib/format';
import { Button, cellInputCls, inputCls, Notice } from '../ui';

const move = <T,>(arr: T[], i: number, d: -1 | 1) => {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

export function RowActions({ onUp, onDown, onRemove, label }: { onUp?: () => void; onDown?: () => void; onRemove: () => void; label: string }) {
  return (
    <div className="flex shrink-0 items-center opacity-60 group-hover:opacity-100">
      {onUp && (
        <button type="button" onClick={onUp} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Move up" aria-label={`Move ${label} up`}>
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
      )}
      {onDown && (
        <button type="button" onClick={onDown} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Move down" aria-label={`Move ${label} down`}>
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
      )}
      <button type="button" onClick={onRemove} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Remove" aria-label={`Remove ${label}`}>
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function ListField({ field, value, onChange }: { field: FieldDef; value: unknown; onChange: (v: string[]) => void }) {
  const items = Array.isArray(value) ? (value as string[]) : [];
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const add = (at = items.length) => {
    const next = [...items];
    next.splice(at, 0, '');
    onChange(next);
    setTimeout(() => refs.current[at]?.focus());
  };
  return (
    <div className="space-y-1.5">
      {items.length === 0 && <p className="text-sm italic text-slate-400">{field.placeholder}</p>}
      {items.map((item, i) => (
        <div key={i} className="group flex items-center gap-2">
          <span className="w-6 text-right text-xs tabular-nums text-slate-400">{i + 1}.</span>
          <input
            ref={(el) => {
              refs.current[i] = el;
            }}
            className={inputCls}
            value={item}
            placeholder={field.placeholder}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add(i + 1);
              }
            }}
          />
          <RowActions
            label="item"
            onUp={i > 0 ? () => onChange(move(items, i, -1)) : undefined}
            onDown={i < items.length - 1 ? () => onChange(move(items, i, 1)) : undefined}
            onRemove={() => onChange(items.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={() => add()}>
        <Plus className="h-3.5 w-3.5" /> Add item
      </Button>
    </div>
  );
}

export function TableField({
  field,
  value,
  onChange,
  onColumnsChange,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: TableValue) => void;
  onColumnsChange?: (cols: TableColumn[]) => void;
}) {
  const t = (value as TableValue) ?? { rows: [] };
  const columns = t.columns?.length ? t.columns : field.columns ?? [];
  const rows = t.rows ?? [];
  const emit = (patch: Partial<TableValue>) => onChange({ ...(field.editableColumns ? { columns } : {}), rows, ...patch });
  const setColumns = (cols: TableColumn[]) => {
    emit({ columns: cols });
    onColumnsChange?.(cols);
  };
  return (
    <div>
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="w-full min-w-[480px] text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              {columns.map((c, ci) => (
                <th key={c.key} className="border-b border-slate-200 px-2 py-1.5 font-semibold">
                  {field.editableColumns ? (
                    <div className="flex items-center gap-1">
                      <input
                        className={cellInputCls + ' font-semibold uppercase'}
                        value={c.label}
                        aria-label="Column name"
                        onChange={(e) => setColumns(columns.map((x, j) => (j === ci ? { ...x, label: e.target.value } : x)))}
                      />
                      {columns.length > 1 && (
                        <button className="text-slate-400 hover:text-red-600" title="Remove column" aria-label="Remove column" onClick={() => setColumns(columns.filter((_, j) => j !== ci))}>
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ) : (
                    <span className="px-2">{c.label}</span>
                  )}
                </th>
              ))}
              <th className="w-20 border-b border-slate-200" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-3 text-sm italic text-slate-400">
                  {field.placeholder}
                </td>
              </tr>
            )}
            {rows.map((r, ri) => (
              <tr key={ri} className="group border-b border-slate-100 last:border-0">
                {columns.map((c) => (
                  <td key={c.key} className="px-1 py-0.5 align-top">
                    <input
                      className={cellInputCls}
                      value={r[c.key] ?? ''}
                      placeholder={`[${c.label}]`}
                      aria-label={c.label}
                      onChange={(e) => emit({ rows: rows.map((x, j) => (j === ri ? { ...x, [c.key]: e.target.value } : x)) })}
                    />
                  </td>
                ))}
                <td className="px-1 align-middle">
                  <RowActions
                    label="row"
                    onUp={ri > 0 ? () => emit({ rows: move(rows, ri, -1) }) : undefined}
                    onDown={ri < rows.length - 1 ? () => emit({ rows: move(rows, ri, 1) }) : undefined}
                    onRemove={() => emit({ rows: rows.filter((_, j) => j !== ri) })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-1.5 flex gap-2">
        <Button size="sm" variant="ghost" onClick={() => emit({ rows: [...rows, Object.fromEntries(columns.map((c) => [c.key, '']))] })}>
          <Plus className="h-3.5 w-3.5" /> Add row
        </Button>
        {field.editableColumns && (
          <Button size="sm" variant="ghost" onClick={() => setColumns([...columns, { key: `c${Date.now().toString(36)}`, label: `Column ${columns.length + 1}` }])}>
            <Plus className="h-3.5 w-3.5" /> Add column
          </Button>
        )}
      </div>
    </div>
  );
}

export function FileField({ field, value, onChange, protocolId, subsectionId }: { field: FieldDef; value: unknown; onChange: (v: Attachment[]) => void; protocolId: string; subsectionId: string }) {
  const files = Array.isArray(value) ? (value as Attachment[]) : [];
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    setError(null);
    try {
      const added: Attachment[] = [];
      for (const f of Array.from(list)) {
        if (f.size > 20 * 1024 * 1024) throw new Error(`${f.name} exceeds the 20 MB limit.`);
        added.push(await api.uploadAttachment(protocolId, subsectionId, f));
      }
      onChange([...files, ...added]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div
      className="rounded-md border border-dashed border-slate-300 bg-slate-50/50 p-3"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void upload(e.dataTransfer.files);
      }}
    >
      {files.length === 0 && <p className="mb-2 text-sm italic text-slate-400">{field.placeholder}</p>}
      <ul className="mb-2 space-y-1">
        {files.map((f) => (
          <li key={f.id} className="group flex items-center gap-2 rounded bg-white px-2 py-1.5 text-sm ring-1 ring-slate-200">
            {f.mimeType.startsWith('image/') ? (
              <img src={attachmentUrl(f.id)} alt="" className="h-8 w-8 rounded object-cover" />
            ) : (
              <FileText className="h-4 w-4 text-slate-400" />
            )}
            <a href={attachmentUrl(f.id)} target="_blank" rel="noreferrer" className="flex-1 truncate text-brand-700 hover:underline">
              {f.filename}
            </a>
            <span className="text-xs text-slate-400">{Math.max(1, Math.round(f.size / 1024))} KB</span>
            <RowActions label="file" onRemove={() => onChange(files.filter((x) => x.id !== f.id))} />
          </li>
        ))}
      </ul>
      <input ref={input} type="file" multiple className="hidden" onChange={(e) => void upload(e.target.files)} />
      <Button size="sm" onClick={() => input.current?.click()} loading={busy}>
        {busy ? null : <Upload className="h-3.5 w-3.5" />} Attach files
      </Button>
      <span className="ml-2 text-xs text-slate-400">or drop files here. PNG/JPEG images are embedded in DOCX/PDF exports.</span>
      {error && <Notice tone="error" className="mt-2">{error}</Notice>}
    </div>
  );
}

export function ReferencesField({ field, value, onChange }: { field: FieldDef; value: unknown; onChange: (v: ReferenceItem[]) => void }) {
  const refs = Array.isArray(value) ? (value as ReferenceItem[]) : [];
  const update = (i: number, patch: Partial<ReferenceItem>) => onChange(refs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      {refs.length === 0 && <p className="text-sm italic text-slate-400">{field.placeholder}</p>}
      {refs.map((r, i) => (
        <div key={r.id} className="group flex gap-2 rounded-md border border-slate-200 bg-white p-2">
          <span className="w-6 pt-2 text-right text-xs tabular-nums text-slate-400">[{i + 1}]</span>
          <div className="flex-1 space-y-1.5">
            <textarea className={inputCls + ' min-h-[56px]'} value={r.citation} placeholder="[Enter full citation: authors, title, journal, year, volume, pages]" onChange={(e) => update(i, { citation: e.target.value })} />
            <div className="flex items-center gap-2">
              <input className={inputCls} value={r.link} placeholder="[DOI or URL, optional]" onChange={(e) => update(i, { link: e.target.value })} />
              {/^https?:\/\//.test(r.link) && (
                <a href={r.link} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-brand-700" title="Open link">
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>
          </div>
          <RowActions
            label="reference"
            onUp={i > 0 ? () => onChange(move(refs, i, -1)) : undefined}
            onDown={i < refs.length - 1 ? () => onChange(move(refs, i, 1)) : undefined}
            onRemove={() => onChange(refs.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={() => onChange([...refs, { id: newId(), citation: '', link: '' }])}>
        <Paperclip className="h-3.5 w-3.5" /> Add reference
      </Button>
    </div>
  );
}

export { move };
