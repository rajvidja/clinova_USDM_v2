import { randomUUID } from 'node:crypto';
import { db, tx } from './db.ts';
import { completionPercent, subsectionStatus } from '../shared/completion.ts';
import { sanitizeRichText } from '../shared/richtext.ts';
import { contentTypeOf, customFieldFor, getTemplate } from '../shared/template/index.ts';
import { validateProtocol } from '../shared/validation.ts';
import type {
  Attachment,
  CompletionStatus,
  EligibilityCriterion,
  Endpoint,
  FieldDef,
  FieldType,
  Objective,
  Protocol,
  ProtocolBundle,
  ProtocolStatus,
  ProtocolSummary,
  ProtocolVersionEntry,
  SaveRequest,
  SaveResponse,
  Section,
  SoaSchedule,
  Study,
  StudyArm,
  StudySource,
  Subsection,
  TableValue,
} from '../shared/types.ts';
import { ENDPOINT_CATEGORIES, OBJECTIVE_CATEGORIES } from '../shared/types.ts';

type Row = Record<string, any>;

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const uid = () => randomUUID();
const now = () => new Date().toISOString();
const s = (v: unknown, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));

export const DEFAULT_VISITS = ['Screening', 'Baseline', 'Week 4', 'Week 8', 'Week 12', 'End of Treatment', 'Follow-up'];

export function emptySoa(): SoaSchedule {
  return {
    schemaVersion: 1,
    visits: DEFAULT_VISITS.map((name) => ({ id: uid(), name, timing: '', window: '', footnoteIds: [] })),
    activities: [],
    footnotes: [],
  };
}

// ---------- Row mappers ----------

const toStudy = (r: Row): Study => ({
  id: r.id,
  title: r.title,
  protocolNumber: r.protocol_number,
  sponsorName: r.sponsor_name,
  therapeuticArea: r.therapeutic_area,
  indication: r.indication,
  phase: r.phase,
  studyDesign: r.study_design,
  source: r.source,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toProtocol = (r: Row): Protocol => ({
  id: r.id,
  studyId: r.study_id,
  templateId: r.template_id,
  templateVersion: r.template_version,
  version: r.version,
  protocolDate: r.protocol_date,
  amendmentNumber: r.amendment_number,
  amendmentDate: r.amendment_date,
  status: r.status,
  source: r.source,
  revision: Number(r.revision),
  completion: Number(r.completion),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lastOpenedAt: r.last_opened_at ?? null,
});

const toSubsection = (r: Row): Subsection => ({
  id: r.id,
  protocolId: r.protocol_id,
  sectionId: r.section_id,
  sectionNumber: Number(r.section_number),
  sectionTitle: r.section_title,
  subsectionNumber: r.subsection_number,
  subsectionTitle: r.subsection_title,
  templateKey: r.template_key ?? null,
  guidance: r.guidance,
  fields: JSON.parse(r.fields_json),
  content: JSON.parse(r.content_json),
  contentType: r.content_type,
  isOptional: !!r.is_optional,
  isCustom: !!r.is_custom,
  completionStatus: r.completion_status,
  orderIndex: Number(r.order_index),
  lastModified: r.last_modified,
});

// ---------- Create ----------

export interface ProtocolSetup {
  title?: string;
  protocolNumber?: string;
  sponsorName?: string;
  therapeuticArea?: string;
  indication?: string;
  phase?: string;
  studyDesign?: string;
  version?: string;
  protocolDate?: string;
  amendmentNumber?: string;
  amendmentDate?: string;
  templateId?: string;
  templateVersion?: string;
}

export function createProtocol(setup: ProtocolSetup, source: StudySource = 'builder', studyId?: string): string {
  const template = getTemplate(setup.templateId ?? 'ich-gcp-protocol', setup.templateVersion);
  if (!template) throw new HttpError(400, 'Unknown protocol template');
  const t = now();
  const protocolId = uid();
  tx(() => {
    if (!studyId) {
      studyId = uid();
      db.prepare(
        `INSERT INTO studies (id, title, protocol_number, sponsor_name, therapeutic_area, indication, phase, study_design, source, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(studyId, s(setup.title, 1000), s(setup.protocolNumber, 200), s(setup.sponsorName, 500), s(setup.therapeuticArea, 200), s(setup.indication, 500), s(setup.phase, 100), s(setup.studyDesign, 200), source, t, t);
    }
    db.prepare(
      `INSERT INTO protocols (id, study_id, template_id, template_version, version, protocol_date, amendment_number, amendment_date, status, source, revision, completion, created_at, updated_at, last_opened_at)
       VALUES (?,?,?,?,?,?,?,?,'Draft',?,1,0,?,?,?)`,
    ).run(protocolId, studyId, template.id, template.version, s(setup.version, 50), s(setup.protocolDate, 20), s(setup.amendmentNumber, 50), s(setup.amendmentDate, 20), source, t, t, t);

    const insSec = db.prepare(`INSERT INTO protocol_sections (id, protocol_id, section_number, section_title, template_key, order_index) VALUES (?,?,?,?,?,?)`);
    const insSub = db.prepare(
      `INSERT INTO protocol_subsections (id, protocol_id, section_id, section_number, section_title, subsection_number, subsection_title, template_key, guidance, fields_json, content_json, content_type, is_optional, is_custom, completion_status, order_index, last_modified)
       VALUES (?,?,?,?,?,?,?,?,?,?,'{}',?,?,0,'not_started',?,?)`,
    );
    template.sections.forEach((sec, si) => {
      const secId = uid();
      insSec.run(secId, protocolId, sec.number, sec.title, sec.key, si);
      sec.subsections.forEach((sub, i) => {
        insSub.run(uid(), protocolId, secId, sec.number, sec.title, `${sec.number}.${i + 1}`, sub.title, sub.key, sub.guidance, JSON.stringify(sub.fields), contentTypeOf(sub.fields), sub.optional ? 1 : 0, i, t);
      });
    });
    db.prepare(`INSERT INTO soa_schedules (protocol_id, schedule_json, updated_at) VALUES (?,?,?)`).run(protocolId, JSON.stringify(emptySoa()), t);
  });
  recompute(protocolId, false);
  return protocolId;
}

// ---------- Read ----------

function requireProtocolRow(id: string): Row {
  const row = db.prepare(`SELECT * FROM protocols WHERE id = ?`).get(id) as Row | undefined;
  if (!row) throw new HttpError(404, 'Protocol not found');
  return row;
}

export function getBundle(protocolId: string): ProtocolBundle {
  const p = toProtocol(requireProtocolRow(protocolId));
  const study = toStudy(db.prepare(`SELECT * FROM studies WHERE id = ?`).get(p.studyId) as Row);
  const subRows = (db.prepare(`SELECT * FROM protocol_subsections WHERE protocol_id = ? ORDER BY section_number, order_index`).all(protocolId) as Row[]).map(toSubsection);
  const sections: Section[] = (db.prepare(`SELECT * FROM protocol_sections WHERE protocol_id = ? ORDER BY order_index`).all(protocolId) as Row[]).map((r) => ({
    id: r.id,
    protocolId,
    sectionNumber: Number(r.section_number),
    sectionTitle: r.section_title,
    templateKey: r.template_key,
    subsections: subRows.filter((x) => x.sectionId === r.id),
  }));
  const links = db
    .prepare(`SELECT l.objective_id, l.endpoint_id FROM objective_endpoint_links l JOIN endpoints e ON e.id = l.endpoint_id WHERE e.protocol_id = ?`)
    .all(protocolId) as Row[];
  const objectives: Objective[] = (db.prepare(`SELECT * FROM objectives WHERE protocol_id = ? ORDER BY order_index`).all(protocolId) as Row[]).map((r) => ({
    id: r.id,
    code: r.objective_code,
    category: r.category,
    description: r.description,
  }));
  const endpoints: Endpoint[] = (db.prepare(`SELECT * FROM endpoints WHERE protocol_id = ? ORDER BY order_index`).all(protocolId) as Row[]).map((r) => ({
    id: r.id,
    code: r.endpoint_code,
    category: r.category,
    name: r.name,
    definition: r.definition,
    measurementMethod: r.measurement_method,
    timepoint: r.timepoint,
    objectiveIds: links.filter((l) => l.endpoint_id === r.id).map((l) => l.objective_id),
  }));
  const arms: StudyArm[] = (db.prepare(`SELECT * FROM study_arms WHERE protocol_id = ? ORDER BY order_index`).all(protocolId) as Row[]).map((r) => ({
    id: r.id,
    code: r.arm_code,
    name: r.name,
    armType: r.arm_type,
    interventionName: r.intervention_name,
    dosage: r.dosage,
    route: r.route,
    frequency: r.frequency,
    duration: r.duration,
    comparator: r.comparator,
  }));
  const criteria: EligibilityCriterion[] = (db.prepare(`SELECT * FROM eligibility_criteria WHERE protocol_id = ? ORDER BY criterion_type, order_index`).all(protocolId) as Row[]).map((r) => ({
    id: r.id,
    type: r.criterion_type,
    code: r.criterion_code,
    text: r.text,
  }));
  const soaRow = db.prepare(`SELECT schedule_json FROM soa_schedules WHERE protocol_id = ?`).get(protocolId) as Row | undefined;
  const soa: SoaSchedule = soaRow ? JSON.parse(soaRow.schedule_json) : emptySoa();
  return { study, protocol: p, sections, objectives, endpoints, arms, criteria, soa };
}

export function listSummaries(): ProtocolSummary[] {
  const rows = db
    .prepare(
      `SELECT p.*, s.title, s.protocol_number, s.sponsor_name, s.phase, s.therapeutic_area
       FROM protocols p JOIN studies s ON s.id = p.study_id ORDER BY p.updated_at DESC`,
    )
    .all() as Row[];
  return rows.map((r) => ({
    id: r.id,
    studyId: r.study_id,
    title: r.title,
    protocolNumber: r.protocol_number,
    sponsorName: r.sponsor_name,
    phase: r.phase,
    therapeuticArea: r.therapeutic_area,
    version: r.version,
    status: r.status,
    source: r.source,
    completion: Number(r.completion),
    revision: Number(r.revision),
    updatedAt: r.updated_at,
    createdAt: r.created_at,
    templateId: r.template_id,
    templateVersion: r.template_version,
  }));
}

export function listStudies() {
  const studies = (db.prepare(`SELECT * FROM studies ORDER BY updated_at DESC`).all() as Row[]).map(toStudy);
  const summaries = listSummaries();
  return studies.map((st) => ({ ...st, protocols: summaries.filter((p) => p.studyId === st.id) }));
}

export function touchOpened(protocolId: string) {
  db.prepare(`UPDATE protocols SET last_opened_at = ? WHERE id = ?`).run(now(), protocolId);
}

// ---------- Content sanitation ----------

function cleanValue(field: FieldDef, value: unknown): unknown {
  switch (field.type) {
    case 'text':
    case 'date':
    case 'select':
      return s(value, 2000);
    case 'textarea':
      return s(value, 50000);
    case 'richtext':
      return sanitizeRichText(s(value, 200000));
    case 'number': {
      if (value === '' || value === null || value === undefined) return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case 'list':
      return Array.isArray(value) ? value.map((v) => s(v, 5000)) : [];
    case 'table': {
      const t = (value ?? {}) as TableValue;
      const columns = Array.isArray(t.columns) ? t.columns.map((c) => ({ key: s(c.key, 50), label: s(c.label, 200) })) : undefined;
      const keys = (columns ?? field.columns ?? []).map((c) => c.key);
      const rows = Array.isArray(t.rows) ? t.rows.map((r) => Object.fromEntries(keys.map((k) => [k, s(r?.[k], 5000)]))) : [];
      return columns && field.editableColumns ? { columns, rows } : { rows };
    }
    case 'references':
      return Array.isArray(value) ? value.map((r: any) => ({ id: s(r?.id, 64) || uid(), citation: s(r?.citation, 5000), link: s(r?.link, 2000) })) : [];
    case 'file':
      return Array.isArray(value) ? value.map((a: any) => ({ id: s(a?.id, 64), filename: s(a?.filename, 500), mimeType: s(a?.mimeType, 200), size: Number(a?.size) || 0 })) : [];
    default:
      return undefined;
  }
}

function cleanContent(fields: FieldDef[], content: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.bind || ['objectives', 'endpoints', 'arms', 'criteria', 'soa'].includes(f.type)) continue;
    if (content && f.key in content) out[f.key] = cleanValue(f, content[f.key]);
  }
  return out;
}

function cleanSoa(soa: SoaSchedule): SoaSchedule {
  const visits = (soa.visits ?? []).map((v) => ({ id: s(v.id, 64) || uid(), name: s(v.name, 200), timing: s(v.timing, 200), window: s(v.window, 200), footnoteIds: (v.footnoteIds ?? []).map((x) => s(x, 64)) }));
  const visitIds = new Set(visits.map((v) => v.id));
  return {
    schemaVersion: 1,
    visits,
    activities: (soa.activities ?? []).map((a) => ({
      id: s(a.id, 64) || uid(),
      name: s(a.name, 500),
      category: s(a.category, 200),
      cells: Object.fromEntries(Object.entries(a.cells ?? {}).filter(([k, v]) => visitIds.has(k) && (v === 'required' || v === 'optional'))) as SoaSchedule['activities'][number]['cells'],
      footnoteIds: (a.footnoteIds ?? []).map((x) => s(x, 64)),
    })),
    footnotes: (soa.footnotes ?? []).map((f) => ({ id: s(f.id, 64) || uid(), marker: s(f.marker, 10), text: s(f.text, 2000) })),
  };
}

// ---------- Save ----------

function writeObjectives(protocolId: string, list: Objective[]) {
  db.prepare(`DELETE FROM objectives WHERE protocol_id = ?`).run(protocolId);
  const ins = db.prepare(`INSERT INTO objectives (id, protocol_id, objective_code, category, description, order_index) VALUES (?,?,?,?,?,?)`);
  list.forEach((o, i) => {
    const category = OBJECTIVE_CATEGORIES.includes(o.category) ? o.category : 'Secondary';
    ins.run(s(o.id, 64) || uid(), protocolId, s(o.code, 50), category, s(o.description, 5000), i);
  });
}

function writeEndpoints(protocolId: string, list: Endpoint[]) {
  db.prepare(`DELETE FROM endpoints WHERE protocol_id = ?`).run(protocolId);
  const ins = db.prepare(
    `INSERT INTO endpoints (id, protocol_id, endpoint_code, category, name, definition, measurement_method, timepoint, order_index) VALUES (?,?,?,?,?,?,?,?,?)`,
  );
  const link = db.prepare(`INSERT OR IGNORE INTO objective_endpoint_links (objective_id, endpoint_id) VALUES (?,?)`);
  const objIds = new Set((db.prepare(`SELECT id FROM objectives WHERE protocol_id = ?`).all(protocolId) as Row[]).map((r) => r.id));
  list.forEach((e, i) => {
    const id = s(e.id, 64) || uid();
    const category = (ENDPOINT_CATEGORIES as readonly string[]).includes(e.category) ? e.category : 'Secondary';
    ins.run(id, protocolId, s(e.code, 50), category, s(e.name, 2000), s(e.definition, 5000), s(e.measurementMethod, 2000), s(e.timepoint, 1000), i);
    (e.objectiveIds ?? []).filter((o) => objIds.has(o)).forEach((o) => link.run(o, id));
  });
}

function writeArms(protocolId: string, list: StudyArm[]) {
  db.prepare(`DELETE FROM study_arms WHERE protocol_id = ?`).run(protocolId);
  const ins = db.prepare(
    `INSERT INTO study_arms (id, protocol_id, arm_code, name, arm_type, intervention_name, dosage, route, frequency, duration, comparator, order_index) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  list.forEach((a, i) =>
    ins.run(s(a.id, 64) || uid(), protocolId, s(a.code, 50), s(a.name, 500), s(a.armType, 100), s(a.interventionName, 500), s(a.dosage, 500), s(a.route, 200), s(a.frequency, 200), s(a.duration, 200), s(a.comparator, 500), i),
  );
}

function writeCriteria(protocolId: string, list: EligibilityCriterion[]) {
  db.prepare(`DELETE FROM eligibility_criteria WHERE protocol_id = ?`).run(protocolId);
  const ins = db.prepare(`INSERT INTO eligibility_criteria (id, protocol_id, criterion_type, criterion_code, text, order_index) VALUES (?,?,?,?,?,?)`);
  list.forEach((c, i) => ins.run(s(c.id, 64) || uid(), protocolId, c.type === 'exclusion' ? 'exclusion' : 'inclusion', s(c.code, 50), s(c.text, 5000), i));
}

const META_COLUMNS: Record<string, [table: 'studies' | 'protocols', column: string, max: number]> = {
  title: ['studies', 'title', 1000],
  protocolNumber: ['studies', 'protocol_number', 200],
  sponsorName: ['studies', 'sponsor_name', 500],
  therapeuticArea: ['studies', 'therapeutic_area', 200],
  indication: ['studies', 'indication', 500],
  phase: ['studies', 'phase', 100],
  studyDesign: ['studies', 'study_design', 200],
  version: ['protocols', 'version', 50],
  protocolDate: ['protocols', 'protocol_date', 20],
  amendmentNumber: ['protocols', 'amendment_number', 50],
  amendmentDate: ['protocols', 'amendment_date', 20],
};

/** Recompute subsection completion statuses and protocol completion. */
function recompute(protocolId: string, bumpRevision: boolean): Record<string, CompletionStatus> {
  const bundle = getBundle(protocolId);
  const upd = db.prepare(`UPDATE protocol_subsections SET completion_status = ? WHERE id = ?`);
  const statuses: Record<string, CompletionStatus> = {};
  for (const sec of bundle.sections) {
    for (const sub of sec.subsections) {
      const st = subsectionStatus(sub, bundle);
      statuses[sub.id] = st;
      if (st !== sub.completionStatus) upd.run(st, sub.id);
      sub.completionStatus = st;
    }
  }
  const pct = completionPercent(bundle.sections);
  if (bumpRevision) {
    db.prepare(`UPDATE protocols SET completion = ?, revision = revision + 1, updated_at = ? WHERE id = ?`).run(pct, now(), protocolId);
    db.prepare(`UPDATE studies SET updated_at = ? WHERE id = ?`).run(now(), bundle.study.id);
  } else {
    db.prepare(`UPDATE protocols SET completion = ? WHERE id = ?`).run(pct, protocolId);
  }
  return statuses;
}

export function saveProtocol(protocolId: string, req: SaveRequest): SaveResponse {
  const pRow = requireProtocolRow(protocolId);
  const completion = tx(() => {
    const t = now();
    if (req.meta) {
      for (const [key, value] of Object.entries(req.meta)) {
        const target = META_COLUMNS[key];
        if (!target) continue;
        const [table, column, max] = target;
        const idCol = table === 'studies' ? pRow.study_id : protocolId;
        db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).run(s(value, max), idCol);
      }
    }
    if (req.subsections?.length) {
      const get = db.prepare(`SELECT fields_json, content_json FROM protocol_subsections WHERE id = ? AND protocol_id = ?`);
      const upd = db.prepare(`UPDATE protocol_subsections SET content_json = ?, last_modified = ? WHERE id = ?`);
      for (const item of req.subsections) {
        const row = get.get(item.id, protocolId) as Row | undefined;
        if (!row) continue;
        const json = JSON.stringify(cleanContent(JSON.parse(row.fields_json), item.content ?? {}));
        if (json !== row.content_json) upd.run(json, t, item.id);
      }
    }
    // Rewriting objectives cascades away link rows, so endpoints (and their links) are always rewritten after.
    const endpoints = req.endpoints ?? (req.objectives ? getBundle(protocolId).endpoints : undefined);
    if (req.objectives) writeObjectives(protocolId, req.objectives);
    if (endpoints) writeEndpoints(protocolId, endpoints);
    if (req.arms) writeArms(protocolId, req.arms);
    if (req.criteria) writeCriteria(protocolId, req.criteria);
    if (req.soa) db.prepare(`UPDATE soa_schedules SET schedule_json = ?, updated_at = ? WHERE protocol_id = ?`).run(JSON.stringify(cleanSoa(req.soa)), t, protocolId);
    if (pRow.status === 'Final') db.prepare(`UPDATE protocols SET status = 'Draft' WHERE id = ?`).run(protocolId);
    return recompute(protocolId, true);
  });
  const fresh = getBundle(protocolId);
  return { protocol: fresh.protocol, study: fresh.study, completion };
}

export function setStatus(protocolId: string, status: ProtocolStatus): Protocol {
  requireProtocolRow(protocolId);
  if (!['Draft', 'In Review', 'Final'].includes(status)) throw new HttpError(400, 'Invalid status');
  if (status === 'Final') {
    const report = validateProtocol(getBundle(protocolId));
    if (report.errors.length) throw new HttpError(422, `Cannot mark as Final: ${report.errors.length} validation error(s) must be resolved first.`);
  }
  db.prepare(`UPDATE protocols SET status = ?, updated_at = ? WHERE id = ?`).run(status, now(), protocolId);
  if (status === 'Final') createSnapshot(protocolId, 'Marked as Final');
  return getBundle(protocolId).protocol;
}

export function deleteProtocol(protocolId: string) {
  const row = requireProtocolRow(protocolId);
  tx(() => {
    db.prepare(`DELETE FROM protocols WHERE id = ?`).run(protocolId);
    const remaining = db.prepare(`SELECT COUNT(*) AS n FROM protocols WHERE study_id = ?`).get(row.study_id) as Row;
    if (!Number(remaining.n)) db.prepare(`DELETE FROM studies WHERE id = ?`).run(row.study_id);
  });
}

// ---------- Subsection structure ----------

function requireSubsection(id: string): Subsection {
  const row = db.prepare(`SELECT * FROM protocol_subsections WHERE id = ?`).get(id) as Row | undefined;
  if (!row) throw new HttpError(404, 'Subsection not found');
  return toSubsection(row);
}

function renumber(sectionId: string) {
  const sec = db.prepare(`SELECT section_number FROM protocol_sections WHERE id = ?`).get(sectionId) as Row;
  const subs = db.prepare(`SELECT id FROM protocol_subsections WHERE section_id = ? ORDER BY order_index`).all(sectionId) as Row[];
  const upd = db.prepare(`UPDATE protocol_subsections SET order_index = ?, subsection_number = ? WHERE id = ?`);
  subs.forEach((r, i) => upd.run(i, `${sec.section_number}.${i + 1}`, r.id));
}

function bump(protocolId: string) {
  recompute(protocolId, true);
}

export function addSubsection(protocolId: string, sectionId: string, title: string, contentType: FieldType, afterId?: string): string {
  const sec = db.prepare(`SELECT * FROM protocol_sections WHERE id = ? AND protocol_id = ?`).get(sectionId, protocolId) as Row | undefined;
  if (!sec) throw new HttpError(404, 'Section not found');
  const cleanTitle = s(title, 300).trim();
  if (!cleanTitle) throw new HttpError(400, 'Subsection title is required');
  const allowed: FieldType[] = ['richtext', 'textarea', 'text', 'list', 'table', 'references', 'file', 'number', 'date'];
  const type = allowed.includes(contentType) ? contentType : 'richtext';
  const fields = customFieldFor(type, cleanTitle);
  const id = uid();
  tx(() => {
    let order = (db.prepare(`SELECT COALESCE(MAX(order_index), -1) + 1 AS n FROM protocol_subsections WHERE section_id = ?`).get(sectionId) as Row).n;
    if (afterId) {
      const after = db.prepare(`SELECT order_index FROM protocol_subsections WHERE id = ? AND section_id = ?`).get(afterId, sectionId) as Row | undefined;
      if (after) {
        order = Number(after.order_index) + 1;
        db.prepare(`UPDATE protocol_subsections SET order_index = order_index + 1 WHERE section_id = ? AND order_index >= ?`).run(sectionId, order);
      }
    }
    db.prepare(
      `INSERT INTO protocol_subsections (id, protocol_id, section_id, section_number, section_title, subsection_number, subsection_title, template_key, guidance, fields_json, content_json, content_type, is_optional, is_custom, completion_status, order_index, last_modified)
       VALUES (?,?,?,?,?,'',?,NULL,?,?,'{}',?,1,1,'not_started',?,?)`,
    ).run(id, protocolId, sectionId, sec.section_number, sec.section_title, cleanTitle, 'User-defined optional subsection.', JSON.stringify(fields), contentTypeOf(fields), order, now());
    renumber(sectionId);
    bump(protocolId);
  });
  return id;
}

export function updateSubsectionMeta(id: string, patch: { title?: string; fields?: FieldDef[] }) {
  const sub = requireSubsection(id);
  tx(() => {
    if (patch.title !== undefined) {
      if (!sub.isOptional) throw new HttpError(400, 'Only optional subsections can be renamed');
      const title = s(patch.title, 300).trim();
      if (!title) throw new HttpError(400, 'Title is required');
      db.prepare(`UPDATE protocol_subsections SET subsection_title = ?, last_modified = ? WHERE id = ?`).run(title, now(), id);
    }
    if (patch.fields && sub.isCustom) {
      // Custom tables may rename columns; only labels/columns are editable, not types.
      const fields = sub.fields.map((f, i) => ({ ...f, label: s(patch.fields![i]?.label ?? f.label, 300), columns: f.editableColumns ? patch.fields![i]?.columns ?? f.columns : f.columns }));
      db.prepare(`UPDATE protocol_subsections SET fields_json = ? WHERE id = ?`).run(JSON.stringify(fields), id);
    }
    bump(sub.protocolId);
  });
}

export function deleteSubsection(id: string) {
  const sub = requireSubsection(id);
  if (!sub.isOptional) throw new HttpError(400, 'Mandatory template subsections cannot be removed');
  tx(() => {
    db.prepare(`DELETE FROM protocol_subsections WHERE id = ?`).run(id);
    renumber(sub.sectionId);
    bump(sub.protocolId);
  });
}

export function duplicateSubsection(id: string): string {
  const sub = requireSubsection(id);
  if (sub.fields.some((f) => ['objectives', 'endpoints', 'arms', 'criteria', 'soa'].includes(f.type)) || sub.fields.some((f) => f.bind))
    throw new HttpError(400, 'Subsections bound to structured study data cannot be duplicated');
  const newId = uid();
  tx(() => {
    db.prepare(`UPDATE protocol_subsections SET order_index = order_index + 1 WHERE section_id = ? AND order_index > ?`).run(sub.sectionId, sub.orderIndex);
    db.prepare(
      `INSERT INTO protocol_subsections (id, protocol_id, section_id, section_number, section_title, subsection_number, subsection_title, template_key, guidance, fields_json, content_json, content_type, is_optional, is_custom, completion_status, order_index, last_modified)
       VALUES (?,?,?,?,?,'',?,?,?,?,?,?,1,1,?,?,?)`,
    ).run(newId, sub.protocolId, sub.sectionId, sub.sectionNumber, sub.sectionTitle, `${sub.subsectionTitle} (copy)`, sub.templateKey, sub.guidance, JSON.stringify(sub.fields.map((f) => ({ ...f, required: false }))), JSON.stringify(sub.content), sub.contentType, sub.completionStatus, sub.orderIndex + 1, now());
    renumber(sub.sectionId);
    bump(sub.protocolId);
  });
  return newId;
}

/** Move an optional subsection up or down. Mandatory subsections keep their relative template order. */
export function moveSubsection(id: string, direction: 'up' | 'down') {
  const sub = requireSubsection(id);
  if (!sub.isOptional) throw new HttpError(400, 'Only optional subsections can be rearranged');
  const siblings = db.prepare(`SELECT id, order_index FROM protocol_subsections WHERE section_id = ? ORDER BY order_index`).all(sub.sectionId) as Row[];
  const idx = siblings.findIndex((r) => r.id === id);
  const swapWith = direction === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= siblings.length) return;
  tx(() => {
    const upd = db.prepare(`UPDATE protocol_subsections SET order_index = ? WHERE id = ?`);
    upd.run(swapWith, siblings[idx].id);
    upd.run(idx, siblings[swapWith].id);
    renumber(sub.sectionId);
    bump(sub.protocolId);
  });
}

// ---------- Bundle import (duplicate / restore / digitisation) ----------

export function writeBundleContent(protocolId: string, bundle: ProtocolBundle, remapIds: boolean) {
  const idMap = new Map<string, string>();
  const nid = (old: string) => {
    if (!remapIds) return old;
    if (!idMap.has(old)) idMap.set(old, uid());
    return idMap.get(old)!;
  };
  const t = now();
  db.prepare(`DELETE FROM protocol_sections WHERE protocol_id = ?`).run(protocolId);
  const insSec = db.prepare(`INSERT INTO protocol_sections (id, protocol_id, section_number, section_title, template_key, order_index) VALUES (?,?,?,?,?,?)`);
  const insSub = db.prepare(
    `INSERT INTO protocol_subsections (id, protocol_id, section_id, section_number, section_title, subsection_number, subsection_title, template_key, guidance, fields_json, content_json, content_type, is_optional, is_custom, completion_status, order_index, last_modified)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  bundle.sections.forEach((sec, si) => {
    const secId = nid(sec.id);
    insSec.run(secId, protocolId, sec.sectionNumber, sec.sectionTitle, sec.templateKey, si);
    sec.subsections.forEach((sub, i) => {
      insSub.run(nid(sub.id), protocolId, secId, sec.sectionNumber, sec.sectionTitle, sub.subsectionNumber, sub.subsectionTitle, sub.templateKey, sub.guidance, JSON.stringify(sub.fields), JSON.stringify(sub.content ?? {}), sub.contentType, sub.isOptional ? 1 : 0, sub.isCustom ? 1 : 0, sub.completionStatus, i, remapIds ? t : sub.lastModified);
    });
  });
  writeObjectives(protocolId, bundle.objectives.map((o) => ({ ...o, id: nid(o.id) })));
  writeEndpoints(protocolId, bundle.endpoints.map((e) => ({ ...e, id: nid(e.id), objectiveIds: e.objectiveIds.map(nid) })));
  writeArms(protocolId, bundle.arms.map((a) => ({ ...a, id: nid(a.id) })));
  writeCriteria(protocolId, bundle.criteria.map((c) => ({ ...c, id: nid(c.id) })));
  db.prepare(`INSERT INTO soa_schedules (protocol_id, schedule_json, updated_at) VALUES (?,?,?) ON CONFLICT(protocol_id) DO UPDATE SET schedule_json = excluded.schedule_json, updated_at = excluded.updated_at`).run(
    protocolId,
    JSON.stringify(cleanSoa(bundle.soa)),
    t,
  );
}

export function duplicateProtocol(protocolId: string, mode: 'new-study' | 'new-version'): string {
  const src = getBundle(protocolId);
  const newId = uid();
  const t = now();
  tx(() => {
    let studyId = src.study.id;
    if (mode === 'new-study') {
      studyId = uid();
      db.prepare(
        `INSERT INTO studies (id, title, protocol_number, sponsor_name, therapeutic_area, indication, phase, study_design, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,'builder',?,?)`,
      ).run(studyId, `Copy of ${src.study.title}`.trim(), src.study.protocolNumber ? `${src.study.protocolNumber}-COPY` : '', src.study.sponsorName, src.study.therapeuticArea, src.study.indication, src.study.phase, src.study.studyDesign, t, t);
    }
    db.prepare(
      `INSERT INTO protocols (id, study_id, template_id, template_version, version, protocol_date, amendment_number, amendment_date, status, source, revision, completion, created_at, updated_at, last_opened_at)
       VALUES (?,?,?,?,?,?,?,?,'Draft','builder',1,?,?,?,?)`,
    ).run(newId, studyId, src.protocol.templateId, src.protocol.templateVersion, mode === 'new-version' ? '' : src.protocol.version, src.protocol.protocolDate, mode === 'new-version' ? '' : src.protocol.amendmentNumber, mode === 'new-version' ? '' : src.protocol.amendmentDate, src.protocol.completion, t, t, t);

    // Copy attachments so the duplicate is independent of the source protocol.
    const attMap = new Map<string, string>();
    const atts = db.prepare(`SELECT * FROM attachments WHERE protocol_id = ?`).all(protocolId) as Row[];
    const insAtt = db.prepare(`INSERT INTO attachments (id, protocol_id, subsection_id, filename, mime_type, size, data, created_at) VALUES (?,?,?,?,?,?,?,?)`);
    for (const a of atts) {
      const aid = uid();
      attMap.set(a.id, aid);
      insAtt.run(aid, newId, null, a.filename, a.mime_type, a.size, a.data, t);
    }
    const remapped: ProtocolBundle = {
      ...src,
      sections: src.sections.map((sec) => ({
        ...sec,
        subsections: sec.subsections.map((sub) => {
          const content = { ...sub.content };
          for (const f of sub.fields) {
            if (f.type === 'file' && Array.isArray(content[f.key])) {
              content[f.key] = (content[f.key] as Attachment[]).map((a) => ({ ...a, id: attMap.get(a.id) ?? a.id }));
            }
          }
          return { ...sub, content };
        }),
      })),
    };
    writeBundleContent(newId, remapped, true);
  });
  recompute(newId, false);
  return newId;
}

// ---------- Versions ----------

export function createSnapshot(protocolId: string, note: string): ProtocolVersionEntry {
  const bundle = getBundle(protocolId);
  const id = uid();
  const t = now();
  db.prepare(`INSERT INTO protocol_versions (id, protocol_id, revision, version_label, status, note, snapshot_json, created_at) VALUES (?,?,?,?,?,?,?,?)`).run(
    id,
    protocolId,
    bundle.protocol.revision,
    bundle.protocol.version,
    bundle.protocol.status,
    s(note, 1000),
    JSON.stringify(bundle),
    t,
  );
  return { id, protocolId, revision: bundle.protocol.revision, versionLabel: bundle.protocol.version, status: bundle.protocol.status, note, createdAt: t };
}

export function listSnapshots(protocolId: string): ProtocolVersionEntry[] {
  return (db.prepare(`SELECT id, protocol_id, revision, version_label, status, note, created_at FROM protocol_versions WHERE protocol_id = ? ORDER BY created_at DESC`).all(protocolId) as Row[]).map((r) => ({
    id: r.id,
    protocolId: r.protocol_id,
    revision: Number(r.revision),
    versionLabel: r.version_label,
    status: r.status,
    note: r.note,
    createdAt: r.created_at,
  }));
}

export function getSnapshot(protocolId: string, versionId: string): ProtocolBundle {
  const row = db.prepare(`SELECT snapshot_json FROM protocol_versions WHERE id = ? AND protocol_id = ?`).get(versionId, protocolId) as Row | undefined;
  if (!row) throw new HttpError(404, 'Version not found');
  return JSON.parse(row.snapshot_json);
}

export function restoreSnapshot(protocolId: string, versionId: string) {
  const snap = getSnapshot(protocolId, versionId);
  createSnapshot(protocolId, `Automatic backup before restoring revision ${snap.protocol.revision}`);
  const p = requireProtocolRow(protocolId);
  tx(() => {
    const st = snap.study;
    db.prepare(`UPDATE studies SET title=?, protocol_number=?, sponsor_name=?, therapeutic_area=?, indication=?, phase=?, study_design=? WHERE id = ?`).run(
      st.title, st.protocolNumber, st.sponsorName, st.therapeuticArea, st.indication, st.phase, st.studyDesign, p.study_id,
    );
    const sp = snap.protocol;
    db.prepare(`UPDATE protocols SET version=?, protocol_date=?, amendment_number=?, amendment_date=?, status='Draft' WHERE id = ?`).run(sp.version, sp.protocolDate, sp.amendmentNumber, sp.amendmentDate, protocolId);
    writeBundleContent(protocolId, snap, false);
    recompute(protocolId, true);
  });
}

// ---------- Attachments ----------

export function addAttachment(protocolId: string, subsectionId: string | null, filename: string, mimeType: string, data: Buffer): Attachment {
  requireProtocolRow(protocolId);
  const id = uid();
  db.prepare(`INSERT INTO attachments (id, protocol_id, subsection_id, filename, mime_type, size, data, created_at) VALUES (?,?,?,?,?,?,?,?)`).run(
    id,
    protocolId,
    subsectionId,
    s(filename, 500),
    s(mimeType, 200) || 'application/octet-stream',
    data.length,
    data,
    now(),
  );
  return { id, filename, mimeType, size: data.length };
}

export function getAttachment(id: string): { filename: string; mimeType: string; data: Uint8Array } | undefined {
  const row = db.prepare(`SELECT filename, mime_type, data FROM attachments WHERE id = ?`).get(id) as Row | undefined;
  return row ? { filename: row.filename, mimeType: row.mime_type, data: row.data } : undefined;
}

// ---------- Dashboard ----------

export function dashboardStats() {
  const summaries = listSummaries();
  const docs = db.prepare(`SELECT id, filename, protocol_id, uploaded_at FROM source_documents ORDER BY uploaded_at DESC LIMIT 5`).all() as Row[];
  return {
    studies: (db.prepare(`SELECT COUNT(*) AS n FROM studies`).get() as Row).n,
    protocols: summaries.length,
    builder: summaries.filter((p) => p.source === 'builder').length,
    digitised: summaries.filter((p) => p.source === 'digitisation').length,
    drafts: summaries.filter((p) => p.status !== 'Final').length,
    final: summaries.filter((p) => p.status === 'Final').length,
    recent: summaries.slice(0, 6),
    recentDocuments: docs.map((d) => ({ id: d.id, filename: d.filename, protocolId: d.protocol_id, uploadedAt: d.uploaded_at })),
  };
}
