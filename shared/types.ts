// Common structured study data model shared by Protocol Digitisation and Protocol Builder.
// Entity names are chosen so they map cleanly onto USDM classes later
// (Study, StudyVersion, Objective, Endpoint, StudyArm, EligibilityCriterion, Encounter, Activity).

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'select'
  | 'list'
  | 'table'
  | 'richtext'
  | 'file'
  | 'references'
  // Structured widgets backed by normalized tables rather than subsection content
  | 'objectives'
  | 'endpoints'
  | 'arms'
  | 'criteria'
  | 'soa';

export type MetaBinding =
  | 'study.title'
  | 'study.protocolNumber'
  | 'study.sponsorName'
  | 'protocol.version'
  | 'protocol.protocolDate'
  | 'protocol.amendmentNumber'
  | 'protocol.amendmentDate';

export interface TableColumn {
  key: string;
  label: string;
}

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  placeholder: string;
  required?: boolean;
  help?: string;
  options?: string[];
  columns?: TableColumn[];
  editableColumns?: boolean;
  unit?: string;
  bind?: MetaBinding;
  objectiveCategory?: ObjectiveCategory;
  criterionType?: CriterionType;
}

export interface SubsectionTemplate {
  key: string;
  title: string;
  guidance: string;
  optional?: boolean;
  fields: FieldDef[];
}

export interface SectionTemplate {
  key: string;
  number: number;
  title: string;
  subsections: SubsectionTemplate[];
}

export interface ProtocolTemplate {
  id: string;
  version: string;
  name: string;
  basis: string;
  notice: string;
  sections: SectionTemplate[];
}

export type CompletionStatus = 'not_started' | 'in_progress' | 'complete';
export type ProtocolStatus = 'Draft' | 'In Review' | 'Final';
export type StudySource = 'builder' | 'digitisation';

export interface Study {
  id: string;
  title: string;
  protocolNumber: string;
  sponsorName: string;
  therapeuticArea: string;
  indication: string;
  phase: string;
  studyDesign: string;
  source: StudySource;
  createdAt: string;
  updatedAt: string;
}

export interface Protocol {
  id: string;
  studyId: string;
  templateId: string;
  templateVersion: string;
  version: string;
  protocolDate: string;
  amendmentNumber: string;
  amendmentDate: string;
  status: ProtocolStatus;
  source: StudySource;
  revision: number;
  completion: number;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

export interface Subsection {
  id: string;
  protocolId: string;
  sectionId: string;
  sectionNumber: number;
  sectionTitle: string;
  subsectionNumber: string;
  subsectionTitle: string;
  templateKey: string | null;
  guidance: string;
  fields: FieldDef[];
  content: Record<string, unknown>;
  contentType: string;
  isOptional: boolean;
  isCustom: boolean;
  completionStatus: CompletionStatus;
  orderIndex: number;
  lastModified: string;
}

export interface Section {
  id: string;
  protocolId: string;
  sectionNumber: number;
  sectionTitle: string;
  templateKey: string;
  subsections: Subsection[];
}

export type ObjectiveCategory = 'Primary' | 'Secondary' | 'Exploratory';
export const OBJECTIVE_CATEGORIES: ObjectiveCategory[] = ['Primary', 'Secondary', 'Exploratory'];
export const ENDPOINT_CATEGORIES = ['Primary', 'Secondary', 'Exploratory', 'Safety'] as const;
export type EndpointCategory = (typeof ENDPOINT_CATEGORIES)[number];

export interface Objective {
  id: string;
  code: string;
  category: ObjectiveCategory;
  description: string;
}

export interface Endpoint {
  id: string;
  code: string;
  category: EndpointCategory;
  name: string;
  definition: string;
  measurementMethod: string;
  timepoint: string;
  objectiveIds: string[];
}

export const ARM_TYPES = ['Experimental', 'Active comparator', 'Placebo comparator', 'No intervention', 'Other'] as const;

export interface StudyArm {
  id: string;
  code: string;
  name: string;
  armType: string;
  interventionName: string;
  dosage: string;
  route: string;
  frequency: string;
  duration: string;
  comparator: string;
}

export type CriterionType = 'inclusion' | 'exclusion';

export interface EligibilityCriterion {
  id: string;
  type: CriterionType;
  code: string;
  text: string;
}

export type SoaMark = '' | 'required' | 'optional';

export interface SoaVisit {
  id: string;
  name: string;
  timing: string;
  window: string;
  footnoteIds: string[];
}

export interface SoaActivity {
  id: string;
  name: string;
  category: string;
  cells: Record<string, SoaMark>;
  footnoteIds: string[];
}

export interface SoaFootnote {
  id: string;
  marker: string;
  text: string;
}

export interface SoaSchedule {
  schemaVersion: 1;
  visits: SoaVisit[];
  activities: SoaActivity[];
  footnotes: SoaFootnote[];
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface ReferenceItem {
  id: string;
  citation: string;
  link: string;
}

export interface TableValue {
  columns?: TableColumn[];
  rows: Record<string, string>[];
}

export interface ProtocolBundle {
  study: Study;
  protocol: Protocol;
  sections: Section[];
  objectives: Objective[];
  endpoints: Endpoint[];
  arms: StudyArm[];
  criteria: EligibilityCriterion[];
  soa: SoaSchedule;
}

export interface ProtocolSummary {
  id: string;
  studyId: string;
  title: string;
  protocolNumber: string;
  sponsorName: string;
  phase: string;
  therapeuticArea: string;
  version: string;
  status: ProtocolStatus;
  source: StudySource;
  completion: number;
  revision: number;
  updatedAt: string;
  createdAt: string;
  templateId: string;
  templateVersion: string;
}

export interface ValidationIssue {
  id: string;
  severity: 'error' | 'warning';
  rule: string;
  message: string;
  subsectionId?: string;
  location?: string;
  target?: 'subsection' | 'objectives' | 'endpoints' | 'arms' | 'criteria' | 'soa' | 'meta';
}

export interface ValidationReport {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  checkedAt: string;
}

export interface SaveRequest {
  baseRevision?: number;
  meta?: Partial<Pick<Study, 'title' | 'protocolNumber' | 'sponsorName' | 'therapeuticArea' | 'indication' | 'phase' | 'studyDesign'>> &
    Partial<Pick<Protocol, 'version' | 'protocolDate' | 'amendmentNumber' | 'amendmentDate'>>;
  subsections?: { id: string; content: Record<string, unknown> }[];
  objectives?: Objective[];
  endpoints?: Endpoint[];
  arms?: StudyArm[];
  criteria?: EligibilityCriterion[];
  soa?: SoaSchedule;
}

export interface SaveResponse {
  protocol: Protocol;
  study: Study;
  completion: Record<string, CompletionStatus>;
}

export interface ProtocolVersionEntry {
  id: string;
  protocolId: string;
  revision: number;
  versionLabel: string;
  status: ProtocolStatus;
  note: string;
  createdAt: string;
}

export const PHASES = ['Phase 1', 'Phase 1/2', 'Phase 2', 'Phase 2/3', 'Phase 3', 'Phase 4', 'Not applicable'];
export const STUDY_DESIGNS = [
  'Randomised, parallel group',
  'Randomised, crossover',
  'Factorial',
  'Single-arm',
  'Non-randomised, controlled',
  'Adaptive',
  'Other',
];
