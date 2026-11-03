// Creates one clearly-labelled SYNTHETIC example protocol for demos and testing.
// Run explicitly with `npm run seed:example`; the application never seeds content on its own.
import { createProtocol, getBundle, saveProtocol, uid } from '../server/repo.ts';
import type { SaveRequest } from '../shared/types.ts';

const id = createProtocol({
  title: 'SYNTHETIC EXAMPLE – A Randomised, Double-Blind, Placebo-Controlled Phase 2 Study of EXA-101 in Adults with Moderate Plaque Psoriasis',
  protocolNumber: 'EXA-101-201',
  sponsorName: 'Example Therapeutics Ltd (fictional)',
  therapeuticArea: 'Dermatology',
  indication: 'Moderate plaque psoriasis',
  phase: 'Phase 2',
  studyDesign: 'Randomised, parallel group',
  version: '1.0',
  protocolDate: '2026-11-03',
});

const b = getBundle(id);
const sub = (key: string) => b.sections.flatMap((s) => s.subsections).find((s) => s.templateKey === key)!;
const po1 = uid();
const so1 = uid();
const ep1 = uid();
const ep2 = uid();
const visits = b.soa.visits;
const [scr, base, w4, w8, w12, eot, fu] = visits.map((v) => v.id);
const fn1 = uid();

const req: SaveRequest = {
  subsections: [
    { id: sub('general.sponsor').id, content: { sponsorAddress: '1 Example Street\nExample City, EX1 2AB\nUnited Kingdom (fictional)' } },
    { id: sub('general.signatories').id, content: { signatories: { rows: [{ name: 'Dr A. Example', title: 'Medical Director', organisation: 'Example Therapeutics Ltd' }] } } },
    { id: sub('background.ip').id, content: { productName: 'EXA-101 (synthetic)', description: '<p>EXA-101 is a <strong>fictional</strong> oral small molecule used only to demonstrate ProtocolIQ.</p>' } },
    { id: sub('objectives.purpose').id, content: { purpose: '<p>To demonstrate document authoring in ProtocolIQ with synthetic content.</p>' } },
    { id: sub('design.type').id, content: { trialType: 'Parallel group', description: '<p>Synthetic two-arm parallel group design.</p>' } },
    { id: sub('design.bias').id, content: { randomization: 'Randomised', randomizationDetails: '1:1 allocation (synthetic example).', blinding: 'Double-blind' } },
    { id: sub('treatment.medications').id, content: { prohibited: ['Example prohibited therapy A', 'Example prohibited therapy B'], rescue: ['Example rescue therapy'] } },
    { id: sub('safety.parameters').id, content: { parameters: ['Adverse events', 'Vital signs', 'Clinical laboratory tests'] } },
    { id: sub('statistics.methods').id, content: { methods: '<p>Synthetic example text describing the analysis approach.</p><ul><li>Primary analysis: example model</li><li>Sensitivity analyses: examples</li></ul>' } },
    { id: sub('statistics.sampleSize').id, content: { plannedSampleSize: 120, justification: '<p>Synthetic justification text for demonstration.</p>' } },
    { id: sub('statistics.populations').id, content: { populations: { rows: [{ population: 'Full analysis set', definition: 'All randomised subjects (example)', use: 'Efficacy' }, { population: 'Safety set', definition: 'All dosed subjects (example)', use: 'Safety' }] } } },
    { id: sub('background.literature').id, content: { references: [{ id: uid(), citation: 'Example A, Example B. A fictional reference. J Example. 2025;1:1-10.', link: 'https://example.org' }] } },
  ],
  objectives: [
    { id: po1, code: 'O1', category: 'Primary', description: 'To evaluate the efficacy of EXA-101 compared with placebo (synthetic example).' },
    { id: so1, code: 'O2', category: 'Secondary', description: 'To evaluate the safety and tolerability of EXA-101 (synthetic example).' },
  ],
  endpoints: [
    { id: ep1, code: 'EP1', category: 'Primary', name: 'Example responder rate', definition: 'Proportion of subjects achieving the example response criterion.', measurementMethod: 'Example clinician-rated scale', timepoint: 'Week 12', objectiveIds: [po1] },
    { id: ep2, code: 'EP2', category: 'Safety', name: 'Incidence of adverse events', definition: 'Number of subjects with treatment-emergent AEs.', measurementMethod: 'AE reporting', timepoint: 'Baseline to Follow-up', objectiveIds: [so1] },
  ],
  arms: [
    { id: uid(), code: 'A1', name: 'EXA-101', armType: 'Experimental', interventionName: 'EXA-101 (synthetic)', dosage: '10 mg', route: 'Oral', frequency: 'Once daily', duration: '12 weeks', comparator: '' },
    { id: uid(), code: 'A2', name: 'Placebo', armType: 'Placebo comparator', interventionName: 'Matching placebo', dosage: '—', route: 'Oral', frequency: 'Once daily', duration: '12 weeks', comparator: 'Placebo' },
  ],
  criteria: [
    { id: uid(), type: 'inclusion', code: 'I1', text: 'Example inclusion criterion one (synthetic).' },
    { id: uid(), type: 'inclusion', code: 'I2', text: 'Example inclusion criterion two (synthetic).' },
    { id: uid(), type: 'exclusion', code: 'E1', text: 'Example exclusion criterion one (synthetic).' },
  ],
  soa: {
    schemaVersion: 1,
    visits: visits.map((v, i) => ({ ...v, timing: ['Day -28 to -1', 'Day 1', 'Week 4 ± 3 d', 'Week 8 ± 3 d', 'Week 12 ± 3 d', 'Week 12', 'Week 16'][i], footnoteIds: i === 0 ? [fn1] : [] })),
    activities: [
      { id: uid(), name: 'Informed consent', category: 'Administrative', cells: { [scr]: 'required' }, footnoteIds: [] },
      { id: uid(), name: 'Example efficacy assessment', category: 'Efficacy', cells: { [base]: 'required', [w4]: 'required', [w8]: 'required', [w12]: 'required' }, footnoteIds: [] },
      { id: uid(), name: 'Vital signs', category: 'Safety', cells: { [scr]: 'required', [base]: 'required', [w4]: 'required', [w8]: 'required', [w12]: 'required', [eot]: 'required', [fu]: 'optional' }, footnoteIds: [fn1] },
    ],
    footnotes: [{ id: fn1, marker: 'a', text: 'Synthetic example footnote.' }],
  },
};

saveProtocol(id, req);
console.log(`Created synthetic example protocol ${id}`);
