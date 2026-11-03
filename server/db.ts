import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { TEMPLATES } from '../shared/template/index.ts';

const DB_PATH = process.env.PROTOCOLIQ_DB ?? path.resolve(process.cwd(), 'data', 'protocoliq.db');
if (DB_PATH !== ':memory:') fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

/** Root for stored files (uploaded source documents, OCR output). */
export const DATA_DIR = path.resolve(process.env.PROTOCOLIQ_DATA ?? (DB_PATH === ':memory:' ? path.join(process.cwd(), 'data') : path.dirname(DB_PATH)));

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

// Common study database used by both Protocol Digitisation and Protocol Builder.
db.exec(`
CREATE TABLE IF NOT EXISTS studies (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  protocol_number TEXT NOT NULL DEFAULT '',
  sponsor_name TEXT NOT NULL DEFAULT '',
  therapeutic_area TEXT NOT NULL DEFAULT '',
  indication TEXT NOT NULL DEFAULT '',
  phase TEXT NOT NULL DEFAULT '',
  study_design TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('builder','digitisation')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS protocol_templates (
  id TEXT NOT NULL,
  version TEXT NOT NULL,
  name TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  registered_at TEXT NOT NULL,
  PRIMARY KEY (id, version)
);

CREATE TABLE IF NOT EXISTS protocols (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,
  template_version TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  protocol_date TEXT NOT NULL DEFAULT '',
  amendment_number TEXT NOT NULL DEFAULT '',
  amendment_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','In Review','Final')),
  source TEXT NOT NULL CHECK (source IN ('builder','digitisation')),
  revision INTEGER NOT NULL DEFAULT 1,
  completion INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_opened_at TEXT
);

CREATE TABLE IF NOT EXISTS protocol_sections (
  id TEXT PRIMARY KEY,
  protocol_id TEXT NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  section_number INTEGER NOT NULL,
  section_title TEXT NOT NULL,
  template_key TEXT NOT NULL,
  order_index INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS protocol_subsections (
  id TEXT PRIMARY KEY,
  protocol_id TEXT NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL REFERENCES protocol_sections(id) ON DELETE CASCADE,
  section_number INTEGER NOT NULL,
  section_title TEXT NOT NULL,
  subsection_number TEXT NOT NULL,
  subsection_title TEXT NOT NULL,
  template_key TEXT,
  guidance TEXT NOT NULL DEFAULT '',
  fields_json TEXT NOT NULL,
  content_json TEXT NOT NULL DEFAULT '{}',
  content_type TEXT NOT NULL,
  is_optional INTEGER NOT NULL DEFAULT 0,
  is_custom INTEGER NOT NULL DEFAULT 0,
  completion_status TEXT NOT NULL DEFAULT 'not_started' CHECK (completion_status IN ('not_started','in_progress','complete')),
  order_index INTEGER NOT NULL,
  last_modified TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS objectives (
  id TEXT PRIMARY KEY,
  protocol_id TEXT NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  objective_code TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('Primary','Secondary','Exploratory')),
  description TEXT NOT NULL DEFAULT '',
  order_index INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS endpoints (
  id TEXT PRIMARY KEY,
  protocol_id TEXT NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  endpoint_code TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  definition TEXT NOT NULL DEFAULT '',
  measurement_method TEXT NOT NULL DEFAULT '',
  timepoint TEXT NOT NULL DEFAULT '',
  order_index INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS objective_endpoint_links (
  objective_id TEXT NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  endpoint_id TEXT NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
  PRIMARY KEY (objective_id, endpoint_id)
);

CREATE TABLE IF NOT EXISTS study_arms (
  id TEXT PRIMARY KEY,
  protocol_id TEXT NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  arm_code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  arm_type TEXT NOT NULL DEFAULT '',
  intervention_name TEXT NOT NULL DEFAULT '',
  dosage TEXT NOT NULL DEFAULT '',
  route TEXT NOT NULL DEFAULT '',
  frequency TEXT NOT NULL DEFAULT '',
  duration TEXT NOT NULL DEFAULT '',
  comparator TEXT NOT NULL DEFAULT '',
  order_index INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS eligibility_criteria (
  id TEXT PRIMARY KEY,
  protocol_id TEXT NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  criterion_type TEXT NOT NULL CHECK (criterion_type IN ('inclusion','exclusion')),
  criterion_code TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  order_index INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS soa_schedules (
  protocol_id TEXT PRIMARY KEY REFERENCES protocols(id) ON DELETE CASCADE,
  schedule_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS protocol_versions (
  id TEXT PRIMARY KEY,
  protocol_id TEXT NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  version_label TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  protocol_id TEXT NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  subsection_id TEXT,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_documents (
  id TEXT PRIMARY KEY,
  study_id TEXT REFERENCES studies(id) ON DELETE CASCADE,
  protocol_id TEXT REFERENCES protocols(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  parse_report_json TEXT NOT NULL,
  uploaded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_protocols_study ON protocols(study_id);
CREATE INDEX IF NOT EXISTS idx_sections_protocol ON protocol_sections(protocol_id, order_index);
CREATE INDEX IF NOT EXISTS idx_subsections_protocol ON protocol_subsections(protocol_id, section_id, order_index);
CREATE INDEX IF NOT EXISTS idx_objectives_protocol ON objectives(protocol_id);
CREATE INDEX IF NOT EXISTS idx_endpoints_protocol ON endpoints(protocol_id);
CREATE INDEX IF NOT EXISTS idx_arms_protocol ON study_arms(protocol_id);
CREATE INDEX IF NOT EXISTS idx_criteria_protocol ON eligibility_criteria(protocol_id);
CREATE INDEX IF NOT EXISTS idx_versions_protocol ON protocol_versions(protocol_id);

CREATE TABLE IF NOT EXISTS ocr_corrections (
  document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  element_id TEXT NOT NULL,
  text TEXT,
  table_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (document_id, element_id)
);
`);

// Columns added for OCR documents. source_documents stays the single document registry for both workflows.
const sourceDocColumns = new Set((db.prepare(`PRAGMA table_info(source_documents)`).all() as { name: string }[]).map((c) => c.name));
for (const [name, ddl] of [
  ['kind', `kind TEXT NOT NULL DEFAULT 'parsed'`],
  ['storage_path', 'storage_path TEXT'],
  ['ocr_status', 'ocr_status TEXT'],
  ['ocr_error', 'ocr_error TEXT'],
  ['page_count', 'page_count INTEGER'],
  ['inspection_json', 'inspection_json TEXT'],
  ['linked_protocol_id', 'linked_protocol_id TEXT'],
] as const) {
  if (!sourceDocColumns.has(name)) db.exec(`ALTER TABLE source_documents ADD COLUMN ${ddl}`);
}

const registerTemplate = db.prepare(
  `INSERT INTO protocol_templates (id, version, name, definition_json, registered_at) VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(id, version) DO UPDATE SET name = excluded.name, definition_json = excluded.definition_json`,
);
for (const t of TEMPLATES) registerTemplate.run(t.id, t.version, t.name, JSON.stringify(t), new Date().toISOString());

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
