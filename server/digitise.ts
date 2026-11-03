import mammoth from 'mammoth';
import { parse as parseHtml, type HTMLElement } from 'node-html-parser';
import { escapeHtml } from '../shared/richtext.ts';
import { ICH_GCP_TEMPLATE } from '../shared/template/ichGcp.ts';
import type { EligibilityCriterion, Endpoint, FieldDef, Objective, ObjectiveCategory, SaveRequest, SubsectionTemplate } from '../shared/types.ts';
import { db } from './db.ts';
import { addSubsection, createProtocol, getBundle, HttpError, saveProtocol, uid, type ProtocolSetup } from './repo.ts';

// Deterministic, rule-based parser: heading detection + keyword/title matching against the template.
// No AI or statistical models are used.

export type Block = { kind: 'heading' | 'para' | 'item'; text: string; level?: number; tableHeader?: boolean };

export interface DigitisationReport {
  filename: string;
  blockCount: number;
  headingCount: number;
  metadata: Record<string, string>;
  mapped: { sourceHeading: string; templateKey: string; subsectionNumber: string; subsectionTitle: string; items: number }[];
  unmapped: { heading: string; preview: string; blocks: number }[];
  counts: { objectives: number; endpoints: number; inclusion: number; exclusion: number };
  notes: string[];
}

// ---------- Extraction ----------

async function extractBlocks(filename: string, data: Buffer): Promise<Block[]> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.docx')) {
    const { value } = await mammoth.convertToHtml({ buffer: data });
    return htmlToBlocks(value);
  }
  if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.text')) {
    return textToBlocks(data.toString('utf8'));
  }
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return htmlToBlocks(data.toString('utf8'));
  throw new HttpError(415, 'Unsupported file type for direct parsing. Upload a .docx, .txt, .md or .html protocol document, or use OCR for PDF and image files.');
}

function clean(t: string) {
  return t.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function htmlToBlocks(html: string): Block[] {
  const root = parseHtml(html);
  const out: Block[] = [];
  const walk = (el: HTMLElement) => {
    for (const child of el.childNodes as HTMLElement[]) {
      const tag = child.rawTagName?.toLowerCase();
      if (!tag) {
        const t = clean(child.text ?? '');
        if (t) out.push({ kind: 'para', text: t });
        continue;
      }
      if (/^h[1-6]$/.test(tag)) {
        const t = clean(child.text);
        if (t) out.push({ kind: 'heading', text: t, level: Number(tag[1]) });
      } else if (tag === 'p') {
        const t = clean(child.text);
        if (t) out.push({ kind: 'para', text: t });
      } else if (tag === 'ul' || tag === 'ol') {
        for (const li of child.querySelectorAll('li')) {
          const t = clean(li.childNodes.filter((n: any) => !['ul', 'ol'].includes(n.rawTagName?.toLowerCase())).map((n: any) => n.text).join(' '));
          if (t) out.push({ kind: 'item', text: t });
        }
      } else if (tag === 'table') {
        const rows = child.querySelectorAll('tr');
        rows.forEach((tr, i) => {
          const t = clean(tr.querySelectorAll('td,th').map((c) => clean(c.text)).filter(Boolean).join(' | '));
          const header = tr.querySelectorAll('th').length > 0 || (i === 0 && rows.length > 1 && /^(id|#|no\.?|arm id|assessment)\b/i.test(t));
          if (t) out.push({ kind: 'para', text: t, tableHeader: header || undefined });
        });
      } else {
        walk(child);
      }
    }
  };
  walk(root);
  return out;
}

function textToBlocks(text: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: 'para', text: clean(para.join(' ')) });
    para = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const md = /^(#{1,6})\s+(.*)$/.exec(line);
    if (md) {
      flush();
      out.push({ kind: 'heading', text: clean(md[2]), level: md[1].length });
    } else if (/^([-*•●▪]|\(?[a-z0-9]{1,3}[.)])\s+/i.test(line) && !looksLikeNumberedHeading(line)) {
      flush();
      out.push({ kind: 'item', text: clean(line.replace(/^([-*•●▪]|\(?[a-z0-9]{1,3}[.)])\s+/i, '')) });
    } else if (looksLikeNumberedHeading(line) || isAllCapsHeading(line)) {
      flush();
      out.push({ kind: 'heading', text: clean(line) });
    } else if (/^[A-Z][A-Za-z ]{1,30}:\s*\S/.test(line) && line.length < 200) {
      flush();
      out.push({ kind: 'para', text: clean(line) });
    } else {
      para.push(line);
    }
  }
  flush();
  return out;
}

const NUMBERED_HEADING = /^(?:section\s+)?(\d{1,2})((?:\.\d{1,2}){0,3})\.?[:\s]\s*(\S.{1,150})$/i;

function looksLikeNumberedHeading(line: string): boolean {
  const m = NUMBERED_HEADING.exec(line.trim());
  if (!m) return false;
  const title = m[3];
  if (line.length > 140 || /[.;,]\s*$/.test(title)) return false;
  return /^[A-Z(]/.test(title) && title.split(' ').length <= 16;
}

function isAllCapsHeading(line: string): boolean {
  const letters = line.replace(/[^A-Za-z]/g, '');
  return letters.length >= 6 && line.length <= 90 && letters === letters.toUpperCase() && line.split(' ').length <= 10;
}

function normaliseHeadings(blocks: Block[]): Block[] {
  if (blocks.filter((b) => b.kind === 'heading').length >= 5) return blocks;
  return blocks.map((b) => (b.kind === 'para' && (looksLikeNumberedHeading(b.text) || isAllCapsHeading(b.text)) ? { ...b, kind: 'heading' } : b));
}

// ---------- Template matching ----------

const SYNONYMS: Record<string, string[]> = {
  'general.title': ['protocol title', 'title page'],
  'general.sponsor': ['sponsor information', 'sponsor and monitor', 'sponsor'],
  'general.signatories': ['signatories', 'signature page', 'protocol approval', 'sponsor signature'],
  'general.medicalExpert': ['medical expert', 'medical monitor'],
  'general.investigators': ['investigators', 'investigator', 'trial sites', 'study sites'],
  'general.qualifiedPhysician': ['qualified physician'],
  'general.laboratories': ['laboratories', 'laboratory', 'central lab', 'technical departments'],
  'background.ip': ['investigational product', 'investigational medicinal product', 'study drug', 'description of the investigational'],
  'background.studies': ['nonclinical', 'non clinical', 'preclinical', 'clinical experience', 'previous clinical'],
  'background.riskBenefit': ['risks and benefits', 'risk benefit', 'benefit risk', 'potential risks'],
  'background.dosing': ['route of administration', 'dose rationale', 'dose selection', 'justification for dose', 'dosage regimen'],
  'background.compliance': ['compliance statement', 'conducted in compliance', 'good clinical practice'],
  'background.population': ['study population', 'population to be studied', 'population'],
  'background.literature': ['literature', 'references', 'bibliography'],
  'objectives.primary': ['primary objective', 'primary objectives', 'objectives'],
  'objectives.secondary': ['secondary objective', 'secondary objectives'],
  'objectives.exploratory': ['exploratory objective', 'exploratory objectives'],
  'objectives.purpose': ['purpose of the trial', 'purpose', 'study rationale', 'rationale'],
  'design.endpoints': ['endpoints', 'endpoint', 'outcome measures', 'study endpoints'],
  'design.type': ['study design', 'trial design', 'overall design', 'schematic'],
  'design.bias': ['randomisation', 'randomization', 'blinding', 'minimize bias', 'minimise bias'],
  'design.treatments': ['trial treatments', 'investigational product details', 'packaging', 'labelling', 'labeling'],
  'design.duration': ['duration of subject participation', 'study duration', 'trial periods', 'duration'],
  'design.stopping': ['stopping rules', 'discontinuation criteria', 'stopping'],
  'design.accountability': ['accountability', 'drug accountability'],
  'design.codes': ['unblinding', 'breaking the blind', 'code break', 'randomization codes', 'randomisation codes'],
  'design.sourceData': ['source data', 'recorded directly on'],
  'selection.inclusion': ['inclusion criteria', 'inclusion'],
  'selection.exclusion': ['exclusion criteria', 'exclusion'],
  'selection.withdrawal': ['withdrawal', 'subject replacement', 'discontinuation of subjects', 'discontinuation of participants'],
  'treatment.arms': ['treatments administered', 'treatment arms', 'study arms', 'dosage and administration', 'treatment of subjects'],
  'treatment.medications': ['concomitant', 'prohibited medication', 'permitted medication', 'rescue medication', 'prior and concomitant'],
  'treatment.compliance': ['treatment compliance', 'monitoring subject compliance', 'compliance'],
  'efficacy.parameters': ['efficacy parameters', 'efficacy variables', 'efficacy assessments', 'efficacy'],
  'efficacy.methods': ['timing of efficacy', 'methods of efficacy', 'efficacy methods'],
  'safety.parameters': ['safety parameters', 'safety variables', 'safety assessments', 'assessment of safety'],
  'safety.methods': ['safety methods', 'timing for assessing'],
  'safety.reporting': ['adverse event', 'adverse events', 'serious adverse', 'intercurrent'],
  'safety.followUp': ['follow up of adverse', 'follow-up of adverse', 'after adverse events'],
  'statistics.methods': ['statistical methods', 'statistical analysis', 'interim analysis', 'statistics'],
  'statistics.sampleSize': ['sample size', 'number of subjects'],
  'statistics.significance': ['level of significance', 'significance level', 'significance'],
  'statistics.termination': ['termination of the trial', 'criteria for termination', 'termination'],
  'statistics.missingData': ['missing data', 'spurious data', 'unused'],
  'statistics.deviations': ['deviations from the statistical', 'statistical plan', 'deviation'],
  'statistics.populations': ['analysis population', 'analysis populations', 'analysis sets', 'populations for analysis'],
  'access.monitoring': ['direct access', 'source data documents', 'monitoring access'],
  'access.audit': ['audit access'],
  'access.irb': ['irb review', 'iec review'],
  'access.inspection': ['regulatory inspection', 'inspection'],
  'quality.qc': ['quality control'],
  'quality.qa': ['quality assurance'],
  'quality.monitoring': ['monitoring and audit', 'monitoring', 'audits'],
  'ethics.considerations': ['ethical considerations', 'ethics', 'ethical'],
  'ethics.consent': ['informed consent', 'consent'],
  'ethics.irb': ['institutional review board', 'independent ethics committee', 'ethics committee', 'irb', 'iec'],
  'data.collection': ['data collection'],
  'data.crf': ['case report form', 'case report forms', 'crf'],
  'data.management': ['data management'],
  'data.confidentiality': ['confidentiality', 'data protection'],
  'data.retention': ['record retention', 'retention of records', 'archiving', 'recordkeeping', 'record keeping'],
  'financing.financing': ['financing', 'funding'],
  'financing.insurance': ['insurance', 'indemnity', 'indemnification'],
  'publication.principles': ['publication policy', 'publication'],
  'publication.authorship': ['authorship'],
  'supplements.appendices': ['appendices', 'appendix'],
  'supplements.documents': ['supplementary documents', 'supplements'],
  'supplements.references': ['reference documents'],
};

const STOP = new Set(['and', 'or', 'of', 'the', 'a', 'an', 'to', 'for', 'in', 'on', 'with', 'by', 'if', 'any', 'trial', 'study', 's']);
const tokens = (t: string) =>
  new Set(
    t
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !STOP.has(w))
      .map((w) => w.replace(/(ies)$/, 'y').replace(/s$/, '')),
  );

const ALL_SUBS: { sub: SubsectionTemplate; number: string; sectionNumber: number }[] = ICH_GCP_TEMPLATE.sections.flatMap((sec) =>
  sec.subsections.map((sub, i) => ({ sub, number: `${sec.number}.${i + 1}`, sectionNumber: sec.number })),
);

function stripNumber(heading: string): { number: string; title: string } {
  const m = /^(?:section\s+)?(\d{1,2}(?:\.\d{1,2}){0,3})\.?[:\s]\s*(.*)$/i.exec(heading);
  return m ? { number: m[1], title: m[2] } : { number: '', title: heading };
}

function matchHeading(heading: string): { key: string; score: number } | null {
  const { number, title } = stripNumber(heading);
  const norm = ' ' + title.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const ht = tokens(title);
  let best: { key: string; score: number } | null = null;
  for (const { sub, number: tnum } of ALL_SUBS) {
    let score = 0;
    for (const phrase of SYNONYMS[sub.key] ?? []) {
      const p = ' ' + phrase.toLowerCase().replace(/[^a-z0-9 ]/g, ' ') + ' ';
      if (norm.includes(p)) score = Math.max(score, 0.55 + 0.08 * phrase.split(' ').length);
    }
    const tt = tokens(sub.title);
    const inter = [...ht].filter((w) => tt.has(w)).length;
    const jaccard = inter / (new Set([...ht, ...tt]).size || 1);
    score = Math.max(score, jaccard);
    if (number && number === tnum && score >= 0.2) score += 0.15;
    if (!best || score > best.score) best = { key: sub.key, score };
  }
  return best && best.score >= 0.4 ? best : null;
}

// ---------- Metadata ----------

const ROMAN: Record<string, string> = { I: '1', II: '2', III: '3', IV: '4' };

function toIsoDate(text: string): string {
  const t = Date.parse(text.replace(/(\d+)(st|nd|rd|th)/, '$1'));
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function extractMetadata(blocks: Block[]): Record<string, string> {
  const meta: Record<string, string> = {};
  const head = blocks.slice(0, 60);
  const grab = (re: RegExp) => {
    for (const b of head) {
      const m = re.exec(b.text);
      if (m?.[1]?.trim()) return clean(m[1]).replace(/[|]+.*$/, '').trim();
    }
    return '';
  };
  meta.title = grab(/^(?:protocol|study|full)?\s*title\s*[:|]\s*(.{10,})$/i);
  meta.protocolNumber = grab(/protocol\s*(?:number|no\.?|id|code|identifier)\s*[:#|]?\s*([A-Z0-9][A-Z0-9\-_/.]{2,40})/i);
  meta.sponsorName = grab(/^sponsor(?:\s*name)?\s*[:|]\s*(.{2,200})$/i);
  meta.version = grab(/(?:protocol\s*)?version\s*(?:no\.?|number)?\s*[:|]?\s*(\d+(?:\.\d+)*)/i);
  const dateText = grab(/(?:protocol|version)?\s*date\s*[:|]\s*(.{6,40})$/i);
  meta.protocolDate = dateText ? toIsoDate(dateText) : '';
  meta.amendmentNumber = grab(/amendment\s*(?:no\.?|number)?\s*[:|]\s*([A-Z0-9.\-]{1,20})/i);
  meta.indication = grab(/^indication\s*[:|]\s*(.{2,200})$/i);
  meta.therapeuticArea = grab(/^therapeutic\s*area\s*[:|]\s*(.{2,200})$/i);
  const phase = grab(/\bphase\s*[:|]?\s*((?:I{1,3}V?|IV|[1-4])(?:\s*\/\s*(?:I{1,3}V?|IV|[1-4]))?[ab]?)\b/i);
  if (phase) {
    const parts = phase.toUpperCase().split('/').map((p) => ROMAN[p.trim().replace(/[AB]$/, '')] ?? p.trim().replace(/[AB]$/, ''));
    meta.phase = `Phase ${parts.join('/')}`;
  }
  if (!meta.title) {
    const candidate = head.find(
      (b) => b.text.length > 25 && b.text.length < 300 && !/[:|]/.test(b.text.slice(0, 30)) && !/^(table of contents|confidential)/i.test(b.text),
    );
    if (candidate) meta.title = candidate.text;
  }
  return Object.fromEntries(Object.entries(meta).filter(([, v]) => v));
}

// ---------- Assembly ----------

function blocksToHtml(blocks: Block[]): string {
  let html = '';
  let inList = false;
  for (const b of blocks) {
    if (b.kind === 'item') {
      if (!inList) html += '<ul>';
      inList = true;
      html += `<li>${escapeHtml(b.text)}</li>`;
    } else {
      if (inList) html += '</ul>';
      inList = false;
      html += b.kind === 'heading' ? `<p><strong>${escapeHtml(b.text)}</strong></p>` : `<p>${escapeHtml(b.text)}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html;
}

const stripEnumerator = (t: string) => t.replace(/^\(?([0-9]{1,3}|[a-z]|[ivx]{1,4})[.)]\s+/i, '').trim();
const cells = (t: string) => t.split(' | ').map((c) => c.trim());
/** For table rows ("ID | text | ..."), keep the longest cell as the entry text. */
const entryText = (t: string) => {
  const c = cells(t);
  return c.length > 1 ? c.reduce((a, b) => (b.length > a.length ? b : a), '') : stripEnumerator(t);
};

function entryLines(blocks: Block[]): Block[] {
  const items = blocks.filter((b) => b.kind === 'item');
  return items.length ? blocks.filter((b) => b.kind !== 'para' || !/:\s*$/.test(b.text)) : blocks;
}

export async function digitiseDocument(filename: string, mimeType: string, data: Buffer) {
  return digitiseBlocks(await extractBlocks(filename, data), { filename, mimeType, size: data.length });
}

/**
 * Structure already-extracted blocks into a new protocol. When `sourceDocumentId` is given (OCR documents),
 * the existing source_documents row is linked instead of inserting a new one.
 */
export function digitiseBlocks(extracted: Block[], source: { filename: string; mimeType: string; size: number; sourceDocumentId?: string }) {
  const { filename, mimeType } = source;
  const blocks = normaliseHeadings(extracted).filter((b) => !/^\[[^\]]*\]$/.test(b.text));
  if (!blocks.length) throw new HttpError(422, 'No readable text was found in the document.');
  const metadata = extractMetadata(blocks);

  // Group blocks under headings.
  const groups: { heading: string; match: { key: string; score: number } | null; blocks: Block[] }[] = [];
  let current: (typeof groups)[number] = { heading: '(Title page / front matter)', match: null, blocks: [] };
  for (const b of blocks) {
    if (b.kind === 'heading') {
      groups.push(current);
      current = { heading: b.text, match: matchHeading(b.text), blocks: [] };
    } else if (!b.tableHeader) current.blocks.push(b);
  }
  groups.push(current);

  // A section-level heading (e.g. "5. Selection of subjects") followed by a matched child should not swallow content.
  const contentByKey = new Map<string, { headings: string[]; blocks: Block[] }>();
  const unmapped: DigitisationReport['unmapped'] = [];
  for (const g of groups) {
    if (!g.blocks.length) continue;
    if (g.match) {
      const entry = contentByKey.get(g.match.key) ?? { headings: [], blocks: [] };
      entry.headings.push(g.heading);
      entry.blocks.push(...g.blocks);
      contentByKey.set(g.match.key, entry);
    } else if (g.heading !== '(Title page / front matter)') {
      unmapped.push({ heading: g.heading, preview: g.blocks.map((b) => b.text).join(' ').slice(0, 220), blocks: g.blocks.length });
    }
  }

  const setup: ProtocolSetup = {
    title: metadata.title,
    protocolNumber: metadata.protocolNumber,
    sponsorName: metadata.sponsorName,
    version: metadata.version,
    protocolDate: metadata.protocolDate,
    amendmentNumber: metadata.amendmentNumber,
    phase: metadata.phase,
    indication: metadata.indication,
    therapeuticArea: metadata.therapeuticArea,
  };
  const protocolId = createProtocol(setup, 'digitisation');
  const bundle = getBundle(protocolId);
  const subByKey = new Map(bundle.sections.flatMap((s) => s.subsections).map((s) => [s.templateKey!, s]));

  const save: SaveRequest = { subsections: [], objectives: [], endpoints: [], criteria: [] };
  const report: DigitisationReport = {
    filename,
    blockCount: blocks.length,
    headingCount: blocks.filter((b) => b.kind === 'heading').length,
    metadata,
    mapped: [],
    unmapped,
    counts: { objectives: 0, endpoints: 0, inclusion: 0, exclusion: 0 },
    notes: [],
  };
  const objCodes: Record<ObjectiveCategory, number> = { Primary: 0, Secondary: 0, Exploratory: 0 };
  const extraTreatmentHtml: string[] = [];

  for (const [key, entry] of contentByKey) {
    const sub = subByKey.get(key);
    if (!sub) continue;
    let items = 0;
    const widget = sub.fields.find((f) => ['objectives', 'endpoints', 'criteria', 'arms'].includes(f.type));
    if (widget?.type === 'criteria') {
      for (const b of entryLines(entry.blocks)) {
        const text = entryText(b.text).replace(/^(?:inc|exc|in|ex|i|e)\s*\d{1,3}[.:)]?\s+/i, '');
        if (!text) continue;
        const type = widget.criterionType!;
        const n = save.criteria!.filter((c) => c.type === type).length + 1;
        save.criteria!.push({ id: uid(), type, code: `${type === 'inclusion' ? 'I' : 'E'}${n}`, text } satisfies EligibilityCriterion);
        report.counts[type]++;
        items++;
      }
    } else if (widget?.type === 'objectives') {
      let category: ObjectiveCategory = widget.objectiveCategory ?? 'Primary';
      for (const b of entry.blocks) {
        const label = /^(primary|secondary|exploratory|tertiary)\b[^:]*objectives?\s*:?\s*(.*)$/i.exec(b.text);
        if (label) {
          category = label[1].toLowerCase() === 'primary' ? 'Primary' : label[1].toLowerCase() === 'secondary' ? 'Secondary' : 'Exploratory';
          if (!label[2]) continue;
        }
        const text = label?.[2] ? stripEnumerator(label[2]) : entryText(b.text);
        if (!text) continue;
        objCodes[category]++;
        save.objectives!.push({ id: uid(), code: `${category[0]}O${objCodes[category]}`, category, description: text } satisfies Objective);
        report.counts.objectives++;
        items++;
      }
    } else if (widget?.type === 'endpoints') {
      let category: Endpoint['category'] = 'Primary';
      for (const b of entry.blocks) {
        const label = /^(primary|secondary|exploratory|tertiary|safety)\b[^:]*endpoints?\s*:?\s*(.*)$/i.exec(b.text);
        if (label) {
          const l = label[1].toLowerCase();
          category = l === 'primary' ? 'Primary' : l === 'secondary' ? 'Secondary' : l === 'safety' ? 'Safety' : 'Exploratory';
          if (!label[2]) continue;
        }
        const row = cells(b.text);
        if (row.length === 7) {
          // Row exported by ProtocolIQ: ID | Category | Endpoint | Definition | Method | Timepoint | Objectives
          const cat = (['Primary', 'Secondary', 'Exploratory', 'Safety'] as const).find((c) => c === row[1]) ?? category;
          save.endpoints!.push({ id: uid(), code: row[0], category: cat, name: row[2], definition: row[3], measurementMethod: row[4], timepoint: row[5], objectiveIds: [] });
          report.counts.endpoints++;
          items++;
          continue;
        }
        const text = label?.[2] ? stripEnumerator(label[2]) : entryText(b.text);
        if (!text) continue;
        const n = save.endpoints!.length + 1;
        save.endpoints!.push({ id: uid(), code: `EP${n}`, category, name: text.length > 160 ? text.slice(0, 157) + '…' : text, definition: text.length > 160 ? text : '', measurementMethod: '', timepoint: '', objectiveIds: [] });
        report.counts.endpoints++;
        items++;
      }
    } else if (widget?.type === 'arms') {
      extraTreatmentHtml.push(blocksToHtml(entry.blocks));
      report.notes.push(`Treatment text under "${entry.headings.join('", "')}" was placed in 4.4 for manual structuring into study arms (6.1).`);
      items = entry.blocks.length;
    } else {
      const target = pickTextField(sub.fields);
      if (target) {
        save.subsections!.push({ id: sub.id, content: { ...sub.content, [target.key]: valueFor(target, entry.blocks) } });
        items = entry.blocks.length;
      }
    }
    report.mapped.push({ sourceHeading: entry.headings.join(' / '), templateKey: key, subsectionNumber: sub.subsectionNumber, subsectionTitle: sub.subsectionTitle, items });
  }

  if (extraTreatmentHtml.length) {
    const t = subByKey.get('design.treatments')!;
    const existing = save.subsections!.find((x) => x.id === t.id);
    const html = extraTreatmentHtml.join('');
    if (existing) existing.content.description = String(existing.content.description ?? '') + html;
    else save.subsections!.push({ id: t.id, content: { description: html } });
  }

  saveProtocol(protocolId, save);

  if (unmapped.length) {
    const supplements = bundle.sections.find((s) => s.sectionNumber === 16)!;
    const subId = addSubsection(protocolId, supplements.id, 'Unmapped Content from Source Document', 'richtext');
    const html = groups
      .filter((g) => !g.match && g.blocks.length && g.heading !== '(Title page / front matter)')
      .map((g) => `<p><strong>${escapeHtml(g.heading)}</strong></p>${blocksToHtml(g.blocks)}`)
      .join('');
    saveProtocol(protocolId, { subsections: [{ id: subId, content: { content: html } }] });
    report.notes.push(`${unmapped.length} source section(s) could not be matched to the template and were kept in Section 16 for review.`);
  }
  if (!report.counts.objectives) report.notes.push('No objectives were extracted. Enter them manually in 3.1–3.3.');
  if (!report.counts.endpoints) report.notes.push('No endpoints were extracted. Enter them manually in 4.1.');
  report.notes.push('Objective–endpoint links, study arms and the Schedule of Activities are not inferred and must be entered during review.');

  const final = getBundle(protocolId);
  if (source.sourceDocumentId) {
    db.prepare(`UPDATE source_documents SET linked_protocol_id = ?, parse_report_json = ? WHERE id = ?`).run(protocolId, JSON.stringify(report), source.sourceDocumentId);
  } else {
    db.prepare(`INSERT INTO source_documents (id, study_id, protocol_id, filename, mime_type, size, parse_report_json, uploaded_at) VALUES (?,?,?,?,?,?,?,?)`).run(
      uid(),
      final.study.id,
      protocolId,
      filename,
      mimeType || 'application/octet-stream',
      source.size,
      JSON.stringify(report),
      new Date().toISOString(),
    );
  }
  return { protocolId, report };
}

function pickTextField(fields: FieldDef[]): FieldDef | undefined {
  const plain = fields.filter((f) => !f.bind);
  return plain.find((f) => f.type === 'richtext') ?? plain.find((f) => f.type === 'textarea') ?? plain.find((f) => f.type === 'list') ?? plain.find((f) => f.type === 'table') ?? plain.find((f) => f.type === 'references');
}

function valueFor(field: FieldDef, blocks: Block[]): unknown {
  switch (field.type) {
    case 'richtext':
      return blocksToHtml(blocks);
    case 'textarea':
      return blocks.map((b) => (b.kind === 'item' ? `• ${b.text}` : b.text)).join('\n\n');
    case 'list':
      return blocks.map((b) => stripEnumerator(b.text)).filter(Boolean);
    case 'table': {
      const first = field.columns?.[0]?.key ?? 'c1';
      return { rows: blocks.map((b) => ({ [first]: b.text })) };
    }
    case 'references':
      return blocks.map((b) => ({ id: uid(), citation: stripEnumerator(b.text), link: '' }));
    default:
      return '';
  }
}

export function listSourceDocuments() {
  const rows = db
    .prepare(
      `SELECT d.id, d.kind, d.ocr_status, d.page_count, d.filename, d.size, d.parse_report_json, d.uploaded_at,
              COALESCE(d.protocol_id, (SELECT p.id FROM protocols p WHERE p.id = d.linked_protocol_id)) AS protocol_id
       FROM source_documents d ORDER BY d.uploaded_at DESC`,
    )
    .all() as any[];
  return rows.map((r) => ({
    id: r.id,
    kind: (r.kind ?? 'parsed') as 'parsed' | 'ocr',
    ocrStatus: r.ocr_status as string | null,
    pageCount: r.page_count as number | null,
    protocolId: r.protocol_id as string | null,
    filename: r.filename,
    size: r.size,
    uploadedAt: r.uploaded_at,
    report: JSON.parse(r.parse_report_json) as DigitisationReport | null,
  }));
}
