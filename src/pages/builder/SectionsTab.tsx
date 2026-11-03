import clsx from 'clsx';
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, Copy, Info, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { sectionStatus } from '../../../shared/completion';
import { CUSTOM_CONTENT_TYPES } from '../../../shared/template/index';
import type { FieldType, Section, Subsection } from '../../../shared/types';
import { FieldRenderer } from '../../components/fields/FieldRenderer';
import { Button, CompletionIcon, completionLabel, inputCls, Modal, Notice } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useEditor } from '../../store/editor';

export function SectionsTab({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string) => void }) {
  const bundle = useEditor((s) => s.bundle!);
  const subs = useMemo(() => bundle.sections.flatMap((s) => s.subsections), [bundle.sections]);
  const current = subs.find((s) => s.id === selectedId) ?? subs[0];

  useEffect(() => {
    if (current && current.id !== selectedId) onSelect(current.id);
  }, [current, selectedId, onSelect]);

  if (!current) return null;
  const idx = subs.findIndex((s) => s.id === current.id);
  return (
    <div className="flex min-h-[calc(100vh-103px)]">
      <SectionNav sections={bundle.sections} selectedId={current.id} onSelect={onSelect} />
      <div className="min-w-0 flex-1 bg-slate-50">
        <SubsectionPanel
          key={current.id}
          sub={current}
          protocolId={bundle.protocol.id}
          prev={idx > 0 ? subs[idx - 1] : undefined}
          next={idx < subs.length - 1 ? subs[idx + 1] : undefined}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}

function SectionNav({ sections, selectedId, onSelect }: { sections: Section[]; selectedId: string; onSelect: (id: string) => void }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<'all' | 'incomplete'>('all');
  return (
    <aside className="sticky top-[103px] h-[calc(100vh-103px)] w-80 shrink-0 overflow-y-auto border-r border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Protocol sections</span>
        <select className="rounded border-slate-200 text-xs text-slate-600" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter subsections">
          <option value="all">All</option>
          <option value="incomplete">Incomplete only</option>
        </select>
      </div>
      <nav className="py-1">
        {sections.map((sec) => {
          const st = sectionStatus(sec);
          const done = sec.subsections.filter((s) => s.completionStatus === 'complete').length;
          const containsSelected = sec.subsections.some((s) => s.id === selectedId);
          const isCollapsed = collapsed[sec.id] ?? !containsSelected;
          const visible = sec.subsections.filter((s) => filter === 'all' || s.completionStatus !== 'complete');
          return (
            <div key={sec.id}>
              <button
                onClick={() => setCollapsed({ ...collapsed, [sec.id]: !isCollapsed })}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                aria-expanded={!isCollapsed}
              >
                {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
                <CompletionIcon status={st} />
                <span className="flex-1 text-[13px] font-semibold text-slate-700">
                  {sec.sectionNumber}. {sec.sectionTitle}
                </span>
                <span className={clsx('rounded px-1.5 text-[11px] tabular-nums', done === sec.subsections.length ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                  {done}/{sec.subsections.length}
                </span>
              </button>
              {!isCollapsed && (
                <ul className="pb-1">
                  {visible.map((s) => (
                    <li key={s.id}>
                      <button
                        onClick={() => onSelect(s.id)}
                        className={clsx(
                          'flex w-full items-start gap-2 py-1.5 pl-10 pr-3 text-left text-[13px]',
                          s.id === selectedId ? 'bg-brand-50 font-medium text-brand-800 shadow-[inset_3px_0_0_theme(colors.brand.600)]' : 'text-slate-600 hover:bg-slate-50',
                        )}
                        title={completionLabel(s.completionStatus)}
                      >
                        <CompletionIcon status={s.completionStatus} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="w-8 shrink-0 tabular-nums text-slate-400">{s.subsectionNumber}</span>
                        <span className="flex-1">
                          {s.subsectionTitle}
                          {s.isOptional && <span className="ml-1 text-[10px] uppercase text-slate-400">opt</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                  {visible.length === 0 && <li className="py-1 pl-10 text-xs italic text-slate-400">All subsections complete</li>}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function SubsectionPanel({ sub, protocolId, prev, next, onSelect }: { sub: Subsection; protocolId: string; prev?: Subsection; next?: Subsection; onSelect: (id: string) => void }) {
  const flush = useEditor((s) => s.flush);
  const reload = useEditor((s) => s.reload);
  const saveState = useEditor((s) => s.saveState);
  const dirty = useEditor((s) => s.dirtySubs.has(sub.id));
  const [modal, setModal] = useState<'rename' | 'add' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bound = sub.fields.some((f) => f.bind || ['objectives', 'endpoints', 'arms', 'criteria', 'soa'].includes(f.type));

  const structural = async (fn: () => Promise<unknown>, select?: (r: unknown) => string | undefined) => {
    setBusy(true);
    setError(null);
    try {
      await flush();
      const r = await fn();
      await reload();
      const target = select?.(r);
      if (target) onSelect(target);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-8 py-6">
      <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
        <span>
          Section {sub.sectionNumber}: {sub.sectionTitle}
        </span>
        <span>·</span>
        <span className={clsx('rounded px-1.5 py-0.5 font-medium', sub.isOptional ? 'bg-slate-100 text-slate-600' : 'bg-red-50 text-red-700')}>{sub.isCustom ? 'Custom · optional' : sub.isOptional ? 'Optional' : 'Mandatory'}</span>
        <span className="inline-flex items-center gap-1">
          <CompletionIcon status={sub.completionStatus} className="h-3.5 w-3.5" /> {completionLabel(sub.completionStatus)}
        </span>
      </div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <h2 className="text-2xl font-semibold text-slate-900">
          <span className="mr-2 tabular-nums text-slate-400">{sub.subsectionNumber}</span>
          {sub.subsectionTitle}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          {sub.isOptional && (
            <>
              <IconAction label="Rename subsection" onClick={() => setModal('rename')}>
                <Pencil className="h-4 w-4" />
              </IconAction>
              <IconAction label="Move up" onClick={() => structural(() => api.moveSubsection(sub.id, 'up'))} disabled={busy}>
                <ArrowUp className="h-4 w-4" />
              </IconAction>
              <IconAction label="Move down" onClick={() => structural(() => api.moveSubsection(sub.id, 'down'))} disabled={busy}>
                <ArrowDown className="h-4 w-4" />
              </IconAction>
            </>
          )}
          {!bound && (
            <IconAction label="Duplicate subsection" onClick={() => structural(() => api.duplicateSubsection(sub.id), (r) => (r as { id: string }).id)} disabled={busy}>
              <Copy className="h-4 w-4" />
            </IconAction>
          )}
          <IconAction label="Add subsection after this one" onClick={() => setModal('add')}>
            <Plus className="h-4 w-4" />
          </IconAction>
          {sub.isOptional && (
            <IconAction label="Remove subsection" danger onClick={() => setModal('delete')}>
              <Trash2 className="h-4 w-4" />
            </IconAction>
          )}
        </div>
      </div>

      <div className="mb-5 flex gap-2 rounded-md border border-blue-100 bg-blue-50/60 px-3 py-2.5 text-sm text-slate-700">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
        <div>
          <div className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-blue-700">Guidance</div>
          {sub.guidance}
        </div>
      </div>

      {error && <Notice tone="error" className="mb-4">{error}</Notice>}

      <div className="space-y-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        {sub.fields.map((f) => (
          <FieldRenderer key={f.key} field={f} sub={sub} protocolId={protocolId} />
        ))}
        {sub.fields.length === 0 && <p className="text-sm italic text-slate-400">This subsection has no content fields.</p>}
      </div>

      <div className="mt-2 text-right text-xs text-slate-400">Last modified {formatDateTime(sub.lastModified)}</div>

      <div className="mt-6 flex items-center justify-between border-t border-slate-200 pt-4">
        <Button onClick={() => prev && onSelect(prev.id)} disabled={!prev}>
          <ChevronLeft className="h-4 w-4" /> {prev ? `${prev.subsectionNumber} ${truncate(prev.subsectionTitle)}` : 'Previous'}
        </Button>
        <Button variant="primary" onClick={() => void flush()} loading={saveState === 'saving'}>
          <Save className="h-4 w-4" /> {dirty ? 'Save section' : 'Saved'}
        </Button>
        <Button
          onClick={() => {
            void flush();
            if (next) onSelect(next.id);
          }}
          disabled={!next}
        >
          {next ? `${next.subsectionNumber} ${truncate(next.subsectionTitle)}` : 'Next'} <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <RenameModal open={modal === 'rename'} sub={sub} onClose={() => setModal(null)} onSave={(title) => structural(() => api.updateSubsection(sub.id, { title }))} />
      <AddModal
        open={modal === 'add'}
        onClose={() => setModal(null)}
        onSave={(title, type) => structural(() => api.addSubsection(protocolId, sub.sectionId, title, type, sub.id), (r) => (r as { id: string }).id)}
      />
      <Modal
        open={modal === 'delete'}
        onClose={() => setModal(null)}
        title="Remove subsection"
        footer={
          <>
            <Button onClick={() => setModal(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                setModal(null);
                void structural(() => api.deleteSubsection(sub.id), () => prev?.id ?? next?.id);
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Remove <strong>{sub.subsectionNumber} {sub.subsectionTitle}</strong> and its content from this protocol? Following subsections will be renumbered. A version snapshot can be restored from History if needed.
        </p>
      </Modal>
    </div>
  );
}

const truncate = (s: string) => (s.length > 26 ? s.slice(0, 24) + '…' : s);

function IconAction({ children, label, onClick, disabled, danger }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button title={label} aria-label={label} onClick={onClick} disabled={disabled} className={clsx('rounded-md p-2 text-slate-400 disabled:opacity-40', danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-white hover:text-slate-700 hover:shadow-sm')}>
      {children}
    </button>
  );
}

function RenameModal({ open, sub, onClose, onSave }: { open: boolean; sub: Subsection; onClose: () => void; onSave: (title: string) => void }) {
  const [title, setTitle] = useState(sub.subsectionTitle);
  useEffect(() => setTitle(sub.subsectionTitle), [sub.subsectionTitle, open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Rename subsection"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!title.trim()}
            onClick={() => {
              onSave(title.trim());
              onClose();
            }}
          >
            Rename
          </Button>
        </>
      }
    >
      <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus aria-label="Subsection title" />
    </Modal>
  );
}

function AddModal({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (title: string, type: FieldType) => void }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<FieldType>('richtext');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add optional subsection"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!title.trim()}
            onClick={() => {
              onSave(title.trim(), type);
              setTitle('');
              onClose();
            }}
          >
            Add subsection
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Subsection title</span>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="[Enter subsection title]" autoFocus />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Content type</span>
          <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as FieldType)}>
            {CUSTOM_CONTENT_TYPES.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-slate-500">The new subsection is inserted after the current one and the section is renumbered.</p>
      </div>
    </Modal>
  );
}
