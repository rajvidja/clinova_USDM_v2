import { richTextToPlain } from './richtext.ts';
import type {
  CompletionStatus,
  FieldDef,
  MetaBinding,
  ProtocolBundle,
  ReferenceItem,
  Section,
  Subsection,
  TableValue,
} from './types.ts';

type EntityState = Pick<ProtocolBundle, 'study' | 'protocol' | 'objectives' | 'endpoints' | 'arms' | 'criteria' | 'soa'>;

export function metaValue(state: Pick<ProtocolBundle, 'study' | 'protocol'>, bind: MetaBinding): string {
  const [scope, key] = bind.split('.') as ['study' | 'protocol', string];
  const obj = scope === 'study' ? state.study : state.protocol;
  return String((obj as unknown as Record<string, unknown>)[key] ?? '');
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Filled-ness for plain content fields. Structured widgets are handled in widgetStatus. */
export function isValueFilled(field: FieldDef, value: unknown): boolean {
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'date':
    case 'select':
      return str(value).length > 0;
    case 'number':
      return value !== null && value !== '' && value !== undefined && Number.isFinite(Number(value));
    case 'richtext':
      return richTextToPlain(String(value ?? '')).length > 0;
    case 'list':
      return Array.isArray(value) && value.some((v) => str(v).length > 0);
    case 'table': {
      const t = value as TableValue | undefined;
      return !!t && Array.isArray(t.rows) && t.rows.some((r) => Object.values(r).some((c) => str(c).length > 0));
    }
    case 'file':
      return Array.isArray(value) && value.length > 0;
    case 'references':
      return Array.isArray(value) && (value as ReferenceItem[]).some((r) => str(r?.citation).length > 0);
    default:
      return false;
  }
}

export function widgetStatus(field: FieldDef, state: EntityState): CompletionStatus {
  switch (field.type) {
    case 'objectives': {
      const list = state.objectives.filter((o) => o.category === field.objectiveCategory);
      if (!list.length) return 'not_started';
      return list.every((o) => str(o.description)) ? 'complete' : 'in_progress';
    }
    case 'endpoints': {
      if (!state.endpoints.length) return 'not_started';
      const allNamed = state.endpoints.every((e) => str(e.name));
      const hasPrimary = state.endpoints.some((e) => e.category === 'Primary' && str(e.name));
      return allNamed && hasPrimary ? 'complete' : 'in_progress';
    }
    case 'arms': {
      if (!state.arms.length) return 'not_started';
      const ok = state.arms.every((a) => str(a.name) && str(a.interventionName) && str(a.dosage) && str(a.route) && str(a.frequency));
      return ok ? 'complete' : 'in_progress';
    }
    case 'criteria': {
      const list = state.criteria.filter((c) => c.type === field.criterionType);
      if (!list.length) return 'not_started';
      return list.every((c) => str(c.text)) ? 'complete' : 'in_progress';
    }
    case 'soa': {
      if (!state.soa.activities.length) return 'not_started';
      return state.soa.activities.every((a) => Object.values(a.cells).some(Boolean)) ? 'complete' : 'in_progress';
    }
    default:
      return 'not_started';
  }
}

const WIDGETS = new Set(['objectives', 'endpoints', 'arms', 'criteria', 'soa']);

export function isWidget(field: FieldDef) {
  return WIDGETS.has(field.type);
}

export function fieldStatus(field: FieldDef, content: Record<string, unknown>, state: EntityState): CompletionStatus {
  if (isWidget(field)) return widgetStatus(field, state);
  const value = field.bind ? metaValue(state, field.bind) : content[field.key];
  return isValueFilled(field, value) ? 'complete' : 'not_started';
}

export function subsectionStatus(sub: Pick<Subsection, 'fields' | 'content'>, state: EntityState): CompletionStatus {
  const statuses = sub.fields.map((f) => ({ f, s: fieldStatus(f, sub.content ?? {}, state) }));
  if (!statuses.length) return 'not_started';
  const required = statuses.filter((x) => x.f.required);
  const anyProgress = statuses.some((x) => x.s !== 'not_started');
  if (!anyProgress) return 'not_started';
  if (required.length) return required.every((x) => x.s === 'complete') ? 'complete' : 'in_progress';
  return statuses.some((x) => x.s === 'complete') ? 'complete' : 'in_progress';
}

export function completionPercent(sections: Section[]): number {
  const subs = sections.flatMap((s) => s.subsections);
  if (!subs.length) return 0;
  const score = subs.reduce((acc, s) => acc + (s.completionStatus === 'complete' ? 1 : s.completionStatus === 'in_progress' ? 0.5 : 0), 0);
  return Math.round((score / subs.length) * 100);
}

export function sectionStatus(section: Section): CompletionStatus {
  const s = section.subsections.map((x) => x.completionStatus);
  if (!s.length || s.every((x) => x === 'not_started')) return 'not_started';
  return s.every((x) => x === 'complete') ? 'complete' : 'in_progress';
}

export function recomputeAll(bundle: ProtocolBundle): ProtocolBundle {
  const sections = bundle.sections.map((sec) => ({
    ...sec,
    subsections: sec.subsections.map((s) => ({ ...s, completionStatus: subsectionStatus(s, bundle) })),
  }));
  return { ...bundle, sections, protocol: { ...bundle.protocol, completion: completionPercent(sections) } };
}
