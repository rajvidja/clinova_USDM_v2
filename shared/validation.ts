import { fieldStatus, isWidget } from './completion.ts';
import type { ProtocolBundle, Subsection, ValidationIssue, ValidationReport } from './types.ts';

// Rule-based checks only. Nothing here fills in or suggests clinical content.

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function validateProtocol(bundle: ProtocolBundle): ValidationReport {
  const issues: ValidationIssue[] = [];
  const subs = bundle.sections.flatMap((s) => s.subsections);
  const byKey = new Map<string, Subsection>();
  subs.forEach((s) => s.templateKey && !s.isCustom && byKey.set(s.templateKey, s));
  const loc = (s?: Subsection) => (s ? `${s.subsectionNumber} ${s.subsectionTitle}` : undefined);
  const add = (i: Omit<ValidationIssue, 'id'>) => issues.push({ id: `${i.rule}:${issues.length}`, ...i });

  // Core identification
  const general = byKey.get('general.title');
  const sponsor = byKey.get('general.sponsor');
  if (!str(bundle.study.title))
    add({ severity: 'error', rule: 'missing-title', message: 'Protocol title is missing.', subsectionId: general?.id, location: loc(general), target: 'subsection' });
  if (!str(bundle.study.protocolNumber))
    add({ severity: 'error', rule: 'missing-protocol-number', message: 'Protocol number is missing.', subsectionId: general?.id, location: loc(general), target: 'subsection' });
  if (!str(bundle.study.sponsorName))
    add({ severity: 'error', rule: 'missing-sponsor', message: 'Sponsor name is missing.', subsectionId: sponsor?.id, location: loc(sponsor), target: 'subsection' });
  if (sponsor && !str(sponsor.content.sponsorAddress))
    add({ severity: 'error', rule: 'missing-sponsor', message: 'Sponsor registered address is missing.', subsectionId: sponsor.id, location: loc(sponsor), target: 'subsection' });

  // Objectives and endpoints
  const primaryObjectives = bundle.objectives.filter((o) => o.category === 'Primary' && str(o.description));
  const primaryEndpoints = bundle.endpoints.filter((e) => e.category === 'Primary' && str(e.name));
  const po = byKey.get('objectives.primary');
  const ep = byKey.get('design.endpoints');
  if (!primaryObjectives.length)
    add({ severity: 'error', rule: 'missing-primary-objective', message: 'No primary objective has been defined.', subsectionId: po?.id, location: loc(po), target: 'objectives' });
  if (!primaryEndpoints.length)
    add({ severity: 'error', rule: 'missing-primary-endpoint', message: 'No primary endpoint has been defined.', subsectionId: ep?.id, location: loc(ep), target: 'endpoints' });

  // Eligibility
  const inc = byKey.get('selection.inclusion');
  const exc = byKey.get('selection.exclusion');
  if (!bundle.criteria.some((c) => c.type === 'inclusion' && str(c.text)))
    add({ severity: 'error', rule: 'missing-inclusion', message: 'No inclusion criteria have been entered.', subsectionId: inc?.id, location: loc(inc), target: 'criteria' });
  if (!bundle.criteria.some((c) => c.type === 'exclusion' && str(c.text)))
    add({ severity: 'error', rule: 'missing-exclusion', message: 'No exclusion criteria have been entered.', subsectionId: exc?.id, location: loc(exc), target: 'criteria' });

  // Treatment
  const arms = byKey.get('treatment.arms');
  if (!bundle.arms.length) {
    add({ severity: 'error', rule: 'missing-treatment', message: 'No study arms / treatments have been defined.', subsectionId: arms?.id, location: loc(arms), target: 'arms' });
  } else {
    bundle.arms.forEach((a, i) => {
      const label = a.code || a.name || `Arm ${i + 1}`;
      if (!str(a.name) || !str(a.interventionName))
        add({ severity: 'error', rule: 'missing-treatment', message: `${label}: arm name and intervention name are required.`, subsectionId: arms?.id, location: loc(arms), target: 'arms' });
      const missing = (['dosage', 'route', 'frequency', 'duration'] as const).filter((k) => !str(a[k]));
      if (missing.length)
        add({ severity: 'warning', rule: 'incomplete-treatment', message: `${label}: missing ${missing.join(', ')}.`, subsectionId: arms?.id, location: loc(arms), target: 'arms' });
    });
  }

  // Safety and statistics headline checks
  const safetyParams = byKey.get('safety.parameters');
  const safetyMethods = byKey.get('safety.methods');
  const statMethods = byKey.get('statistics.methods');
  const checkFilled = (s: Subsection | undefined, rule: string, message: string) => {
    if (!s) return;
    const required = s.fields.filter((f) => f.required && !isWidget(f));
    if (required.some((f) => fieldStatus(f, s.content, bundle) !== 'complete'))
      add({ severity: 'error', rule, message, subsectionId: s.id, location: loc(s), target: 'subsection' });
  };
  checkFilled(safetyParams, 'missing-safety', 'Safety parameters are missing.');
  checkFilled(safetyMethods, 'missing-safety', 'Safety assessment methods and timing are missing.');
  checkFilled(statMethods, 'missing-statistics', 'Statistical methodology is missing.');

  const handled = new Set([general, sponsor, safetyParams, safetyMethods, statMethods].filter(Boolean).map((s) => s!.id));

  // Generic mandatory field / subsection checks
  for (const s of subs) {
    if (handled.has(s.id)) continue;
    const plainRequired = s.fields.filter((f) => f.required && !isWidget(f) && !f.bind);
    const missing = plainRequired.filter((f) => fieldStatus(f, s.content, bundle) !== 'complete');
    if (missing.length) {
      add({
        severity: 'error',
        rule: 'missing-mandatory-field',
        message: `Mandatory field(s) not completed: ${missing.map((f) => f.label).join(', ')}.`,
        subsectionId: s.id,
        location: loc(s),
        target: 'subsection',
      });
    } else if (!s.isOptional && s.completionStatus === 'not_started' && !s.fields.some(isWidget)) {
      add({ severity: 'warning', rule: 'empty-subsection', message: 'Subsection has no content.', subsectionId: s.id, location: loc(s), target: 'subsection' });
    }
  }

  // Dates and amendments
  if (!str(bundle.protocol.protocolDate))
    add({ severity: 'error', rule: 'missing-mandatory-field', message: 'Protocol date is missing.', subsectionId: general?.id, location: loc(general), target: 'subsection' });
  if (!str(bundle.protocol.version))
    add({ severity: 'error', rule: 'missing-mandatory-field', message: 'Protocol version is missing.', subsectionId: general?.id, location: loc(general), target: 'subsection' });
  if (str(bundle.protocol.amendmentNumber) && !str(bundle.protocol.amendmentDate))
    add({ severity: 'warning', rule: 'amendment-date', message: 'An amendment number is entered without an amendment date.', subsectionId: general?.id, location: loc(general), target: 'subsection' });

  // Duplicate identifiers
  const dupCheck = (label: string, codes: string[], target: ValidationIssue['target'], subsectionId?: string) => {
    const seen = new Set<string>();
    const dups = new Set<string>();
    codes.map(str).filter(Boolean).forEach((c) => (seen.has(c) ? dups.add(c) : seen.add(c)));
    if (dups.size) add({ severity: 'error', rule: 'duplicate-id', message: `Duplicate ${label} ID(s): ${[...dups].join(', ')}.`, target, subsectionId });
  };
  dupCheck('objective', bundle.objectives.map((o) => o.code), 'objectives', po?.id);
  dupCheck('endpoint', bundle.endpoints.map((e) => e.code), 'endpoints', ep?.id);
  dupCheck('arm', bundle.arms.map((a) => a.code), 'arms', arms?.id);
  dupCheck('criterion', bundle.criteria.map((c) => c.code), 'criteria', inc?.id);

  // Objective / endpoint traceability
  bundle.objectives.forEach((o) => {
    if (!bundle.endpoints.some((e) => e.objectiveIds.includes(o.id)))
      add({ severity: 'warning', rule: 'objective-unlinked', message: `Objective ${o.code || '(no ID)'} is not linked to any endpoint.`, target: 'objectives', subsectionId: po?.id });
  });
  bundle.endpoints.forEach((e) => {
    const label = e.code || e.name || '(unnamed endpoint)';
    if (!e.objectiveIds.length)
      add({ severity: 'warning', rule: 'endpoint-unlinked', message: `Endpoint ${label} is not linked to an objective.`, target: 'endpoints', subsectionId: ep?.id });
    if (e.category === 'Primary' && e.objectiveIds.length && !e.objectiveIds.some((id) => bundle.objectives.find((o) => o.id === id)?.category === 'Primary'))
      add({ severity: 'warning', rule: 'primary-endpoint-link', message: `Primary endpoint ${label} is not linked to a primary objective.`, target: 'endpoints', subsectionId: ep?.id });
    if (!str(e.definition) || !str(e.timepoint))
      add({ severity: 'warning', rule: 'endpoint-incomplete', message: `Endpoint ${label} is missing a definition or assessment timepoint.`, target: 'endpoints', subsectionId: ep?.id });
  });

  // Schedule of activities
  const soa = bundle.soa;
  if (!soa.activities.length) {
    add({ severity: 'warning', rule: 'soa-empty', message: 'The Schedule of Activities has no assessments.', target: 'soa' });
  } else {
    soa.activities.forEach((a) => {
      if (!str(a.name)) add({ severity: 'warning', rule: 'soa-activity', message: 'A Schedule of Activities row has no assessment name.', target: 'soa' });
      else if (!Object.values(a.cells).some(Boolean))
        add({ severity: 'warning', rule: 'soa-activity', message: `Assessment "${a.name}" is not scheduled at any visit.`, target: 'soa' });
    });
    soa.visits.forEach((v) => {
      if (!str(v.timing)) add({ severity: 'warning', rule: 'soa-timing', message: `Visit "${v.name || '(unnamed)'}" has no timepoint defined.`, target: 'soa' });
    });
  }

  return {
    errors: issues.filter((i) => i.severity === 'error'),
    warnings: issues.filter((i) => i.severity === 'warning'),
    checkedAt: new Date().toISOString(),
  };
}
