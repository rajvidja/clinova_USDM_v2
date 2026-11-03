import { isValueFilled, metaValue } from './completion.ts';
import { parseRichText, type Run } from './richtext.ts';
import type { Attachment, FieldDef, ProtocolBundle, ReferenceItem, Subsection, TableValue } from './types.ts';
import { getTemplate } from './template/index.ts';

export interface DocRun extends Run {
  placeholder?: boolean;
}

export type ListStyle = 'bullet' | 'number' | 'none';

export type DocBlock =
  | { t: 'heading'; level: 1 | 2; number: string; text: string; anchor: string }
  | { t: 'label'; text: string }
  | { t: 'para'; runs: DocRun[] }
  | { t: 'list'; style: ListStyle; items: DocRun[][] }
  | { t: 'table'; headers: string[]; rows: DocRun[][][]; compact?: boolean; widths?: number[] }
  | { t: 'image'; attachmentId: string; filename: string; mimeType: string }
  | { t: 'attachment'; filename: string; size: number };

export interface SoaBlock {
  visits: { name: string; timing: string; window: string; markers: string }[];
  rows: { name: string; category: string; markers: string; cells: string[] }[];
  footnotes: { marker: string; text: string }[];
}

export interface DocModel {
  draft: boolean;
  cover: {
    title: string;
    protocolNumber: string;
    version: string;
    protocolDate: string;
    amendmentNumber: string;
    amendmentDate: string;
    sponsorName: string;
    phase: string;
    therapeuticArea: string;
    indication: string;
    studyDesign: string;
    status: string;
    templateName: string;
    templateVersion: string;
  };
  toc: { number: string; title: string; level: 1 | 2; anchor: string }[];
  soa: SoaBlock | null;
  body: DocBlock[];
  headerText: string;
  footerText: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return iso || '';
  return `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

const ph = (text: string): DocRun => ({ text, placeholder: true });

export function buildDocModel(bundle: ProtocolBundle, opts: { draft?: boolean } = {}): DocModel {
  const draft = opts.draft ?? bundle.protocol.status !== 'Final';
  const { study, protocol } = bundle;
  const missing = (f: FieldDef | string): DocRun =>
    ph(draft ? (typeof f === 'string' ? f : f.placeholder) : `[Not provided${typeof f === 'string' ? '' : ': ' + f.label}]`);
  const template = getTemplate(protocol.templateId, protocol.templateVersion);

  const toc: DocModel['toc'] = [];
  const body: DocBlock[] = [];

  for (const section of bundle.sections) {
    const anchor = `sec-${section.id}`;
    toc.push({ number: String(section.sectionNumber), title: section.sectionTitle.toUpperCase(), level: 1, anchor });
    body.push({ t: 'heading', level: 1, number: String(section.sectionNumber), text: section.sectionTitle.toUpperCase(), anchor });
    if (!section.subsections.length) body.push({ t: 'para', runs: [missing('[No subsections in this section]')] });
    for (const sub of section.subsections) {
      const subAnchor = `sub-${sub.id}`;
      toc.push({ number: sub.subsectionNumber, title: sub.subsectionTitle, level: 2, anchor: subAnchor });
      body.push({ t: 'heading', level: 2, number: sub.subsectionNumber, text: sub.subsectionTitle, anchor: subAnchor });
      body.push(...renderSubsection(sub, bundle, missing));
    }
  }

  const titleText = study.title || (draft ? '[Enter protocol title]' : '');
  return {
    draft,
    cover: {
      title: titleText,
      protocolNumber: study.protocolNumber,
      version: protocol.version,
      protocolDate: formatDate(protocol.protocolDate),
      amendmentNumber: protocol.amendmentNumber,
      amendmentDate: formatDate(protocol.amendmentDate),
      sponsorName: study.sponsorName,
      phase: study.phase,
      therapeuticArea: study.therapeuticArea,
      indication: study.indication,
      studyDesign: study.studyDesign,
      status: protocol.status,
      templateName: template?.name ?? protocol.templateId,
      templateVersion: protocol.templateVersion,
    },
    toc,
    soa: buildSoaBlock(bundle),
    body,
    headerText: [study.protocolNumber || '[Protocol number]', draft ? 'DRAFT' : ''].filter(Boolean).join('  |  '),
    footerText: [
      study.protocolNumber ? `Protocol ${study.protocolNumber}` : '[Protocol number]',
      `Version ${protocol.version || '[version]'}`,
      formatDate(protocol.protocolDate) || '[date]',
      'Confidential',
    ].join('  |  '),
  };
}

function buildSoaBlock(bundle: ProtocolBundle): SoaBlock | null {
  const soa = bundle.soa;
  if (!soa.visits.length && !soa.activities.length) return null;
  const markerOf = (ids: string[]) =>
    ids
      .map((id) => soa.footnotes.find((f) => f.id === id)?.marker)
      .filter(Boolean)
      .join(',');
  return {
    visits: soa.visits.map((v) => ({ name: v.name, timing: v.timing, window: v.window, markers: markerOf(v.footnoteIds) })),
    rows: soa.activities.map((a) => ({
      name: a.name,
      category: a.category,
      markers: markerOf(a.footnoteIds),
      cells: soa.visits.map((v) => (a.cells[v.id] === 'required' ? 'X' : a.cells[v.id] === 'optional' ? '(X)' : '')),
    })),
    footnotes: soa.footnotes.map((f) => ({ marker: f.marker, text: f.text })),
  };
}

function renderSubsection(sub: Subsection, bundle: ProtocolBundle, missing: (f: FieldDef | string) => DocRun): DocBlock[] {
  const out: DocBlock[] = [];
  const multi = sub.fields.length > 1;
  for (const f of sub.fields) {
    const value = f.bind ? metaValue(bundle, f.bind) : sub.content?.[f.key];
    const inline = ['text', 'number', 'date', 'select'].includes(f.type);
    if (inline) {
      let text = '';
      if (isValueFilled(f, value)) {
        text = f.type === 'date' ? formatDate(String(value)) : String(value);
        if (f.unit) text += ` ${f.unit}`;
      }
      const runs: DocRun[] = [];
      if (multi || f.label) runs.push({ text: `${f.label}: `, bold: true });
      runs.push(text ? { text } : missing(f));
      out.push({ t: 'para', runs });
      continue;
    }
    if (multi) out.push({ t: 'label', text: f.label });
    out.push(...renderBlockField(f, value, bundle, missing));
  }
  if (!sub.fields.length) out.push({ t: 'para', runs: [missing('[No content fields defined]')] });
  return out;
}

function renderBlockField(f: FieldDef, value: unknown, bundle: ProtocolBundle, missing: (f: FieldDef | string) => DocRun): DocBlock[] {
  const empty = (): DocBlock[] => [{ t: 'para', runs: [missing(f)] }];
  switch (f.type) {
    case 'textarea': {
      const text = typeof value === 'string' ? value.trim() : '';
      if (!text) return empty();
      return text.split(/\n{2,}/).map((p) => ({ t: 'para', runs: p.split('\n').flatMap((line, i) => (i ? [{ text: '\n' }, { text: line }] : [{ text: line }])) }));
    }
    case 'richtext': {
      const blocks = parseRichText(String(value ?? ''));
      if (!blocks.length) return empty();
      return blocks.map((b) => (b.kind === 'p' ? { t: 'para', runs: b.runs } : { t: 'list', style: b.ordered ? 'number' : 'bullet', items: b.items }));
    }
    case 'list': {
      const items = (Array.isArray(value) ? value : []).map((v) => String(v ?? '').trim()).filter(Boolean);
      if (!items.length) return empty();
      return [{ t: 'list', style: 'bullet', items: items.map((text) => [{ text }]) }];
    }
    case 'table': {
      const t = (value as TableValue) ?? { rows: [] };
      const cols = t.columns?.length ? t.columns : f.columns ?? [];
      const rows = (t.rows ?? []).filter((r) => Object.values(r).some((c) => String(c ?? '').trim()));
      if (!rows.length) return empty();
      return [{ t: 'table', headers: cols.map((c) => c.label), rows: rows.map((r) => cols.map((c) => [{ text: String(r[c.key] ?? '') }])) }];
    }
    case 'references': {
      const refs = (Array.isArray(value) ? (value as ReferenceItem[]) : []).filter((r) => r?.citation?.trim());
      if (!refs.length) return empty();
      return [{ t: 'list', style: 'number', items: refs.map((r) => [{ text: r.citation.trim() }, ...(r.link?.trim() ? [{ text: ` ${r.link.trim()}`, italic: true }] : [])]) }];
    }
    case 'file': {
      const files = Array.isArray(value) ? (value as Attachment[]) : [];
      if (!files.length) return empty();
      return files.map((a) =>
        /^image\/(png|jpe?g)$/.test(a.mimeType)
          ? { t: 'image', attachmentId: a.id, filename: a.filename, mimeType: a.mimeType }
          : { t: 'attachment', filename: a.filename, size: a.size },
      );
    }
    case 'objectives': {
      const list = bundle.objectives.filter((o) => o.category === f.objectiveCategory);
      if (!list.length) return empty();
      return [
        {
          t: 'table',
          headers: ['ID', 'Objective', 'Linked endpoint(s)'],
          widths: [12, 50, 38],
          rows: list.map((o) => {
            const eps = bundle.endpoints.filter((e) => e.objectiveIds.includes(o.id));
            return [
              [{ text: o.code }],
              [o.description.trim() ? { text: o.description } : missing('[Enter objective description]')],
              eps.length ? [{ text: eps.map((e) => `${e.code ? e.code + ': ' : ''}${e.name}`).join('\n') }] : [missing('[No endpoint linked]')],
            ];
          }),
        },
      ];
    }
    case 'endpoints': {
      if (!bundle.endpoints.length) return empty();
      const objCodes = (ids: string[]) =>
        ids
          .map((id) => bundle.objectives.find((o) => o.id === id)?.code)
          .filter(Boolean)
          .join(', ');
      const cell = (v: string, p: string): DocRun[] => [v.trim() ? { text: v } : missing(p)];
      return [
        {
          t: 'table',
          compact: true,
          headers: ['ID', 'Category', 'Endpoint', 'Definition', 'Measurement method', 'Timepoint', 'Objective(s)'],
          widths: [8, 11, 17, 22, 16, 14, 12],
          rows: bundle.endpoints.map((e) => [
            [{ text: e.code }],
            [{ text: e.category }],
            cell(e.name, '[Enter endpoint name]'),
            cell(e.definition, '[Enter definition]'),
            cell(e.measurementMethod, '[Enter method]'),
            cell(e.timepoint, '[Enter timepoint]'),
            [{ text: objCodes(e.objectiveIds) || '—' }],
          ]),
        },
      ];
    }
    case 'arms': {
      if (!bundle.arms.length) return empty();
      const cell = (v: string): DocRun[] => [v.trim() ? { text: v } : missing('[Enter]')];
      return [
        {
          t: 'table',
          compact: true,
          headers: ['Arm ID', 'Arm name', 'Type', 'Intervention', 'Dosage', 'Route', 'Frequency', 'Duration', 'Comparator'],
          widths: [7, 12, 14, 13, 10, 9, 10, 10, 11],
          rows: bundle.arms.map((a) => [
            [{ text: a.code }],
            cell(a.name),
            [{ text: a.armType || '—' }],
            cell(a.interventionName),
            cell(a.dosage),
            cell(a.route),
            cell(a.frequency),
            cell(a.duration),
            [{ text: a.comparator || '—' }],
          ]),
        },
      ];
    }
    case 'criteria': {
      const list = bundle.criteria.filter((c) => c.type === f.criterionType && c.text.trim());
      if (!list.length) return empty();
      return [{ t: 'list', style: 'none', items: list.map((c) => [{ text: `${c.code || '•'}  `, bold: true }, { text: c.text }]) }];
    }
    default:
      return empty();
  }
}
