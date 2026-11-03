import { metaValue } from '../../shared/completion.ts';
import { getTemplate } from '../../shared/template/index.ts';
import type { ProtocolBundle } from '../../shared/types.ts';
import { validateProtocol } from '../../shared/validation.ts';

// Candidate correspondences only, to support a later USDM mapping exercise.
// This export is NOT a USDM-conformant file.
const USDM_MAPPING_HINTS = {
  study: 'Study',
  protocol: 'StudyVersion / StudyProtocolDocumentVersion',
  objectives: 'Objective (level: Primary / Secondary / Exploratory)',
  endpoints: 'Endpoint (level, purpose)',
  objectiveEndpointLinks: 'Objective.objectiveEndpoints',
  studyArms: 'StudyArm + StudyIntervention',
  eligibilityCriteria: 'EligibilityCriterion (category: Inclusion / Exclusion)',
  'scheduleOfActivities.visits': 'Encounter',
  'scheduleOfActivities.activities': 'Activity',
  'scheduleOfActivities.cells': 'ScheduledActivityInstance',
  sections: 'NarrativeContent',
};

export function renderJson(bundle: ProtocolBundle) {
  const template = getTemplate(bundle.protocol.templateId, bundle.protocol.templateVersion);
  return {
    exportFormat: 'protocoliq.protocol',
    formatVersion: '1.0',
    exportedAt: new Date().toISOString(),
    template: { id: bundle.protocol.templateId, version: bundle.protocol.templateVersion, name: template?.name, notice: template?.notice },
    study: bundle.study,
    protocol: bundle.protocol,
    sections: bundle.sections.map((sec) => ({
      id: sec.id,
      sectionNumber: sec.sectionNumber,
      sectionTitle: sec.sectionTitle,
      subsections: sec.subsections.map((sub) => ({
        id: sub.id,
        protocolId: sub.protocolId,
        sectionNumber: sub.sectionNumber,
        sectionTitle: sub.sectionTitle,
        subsectionNumber: sub.subsectionNumber,
        subsectionTitle: sub.subsectionTitle,
        templateKey: sub.templateKey,
        contentType: sub.contentType,
        completionStatus: sub.completionStatus,
        isOptional: sub.isOptional,
        isCustom: sub.isCustom,
        lastModified: sub.lastModified,
        fields: sub.fields.map((f) => ({
          key: f.key,
          label: f.label,
          type: f.type,
          required: !!f.required,
          value: f.bind ? metaValue(bundle, f.bind) : ['objectives', 'endpoints', 'arms', 'criteria', 'soa'].includes(f.type) ? { ref: f.type, category: f.objectiveCategory ?? f.criterionType } : sub.content[f.key] ?? null,
        })),
      })),
    })),
    objectives: bundle.objectives,
    endpoints: bundle.endpoints.map(({ objectiveIds, ...e }) => e),
    objectiveEndpointLinks: bundle.endpoints.flatMap((e) => e.objectiveIds.map((objectiveId) => ({ objectiveId, endpointId: e.id }))),
    studyArms: bundle.arms,
    eligibilityCriteria: bundle.criteria,
    scheduleOfActivities: bundle.soa,
    validation: validateProtocol(bundle),
    usdmMappingHints: USDM_MAPPING_HINTS,
  };
}
