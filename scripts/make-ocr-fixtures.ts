// Generates synthetic OCR test documents in tests/fixtures/ocr/ (all content is fictional).
//   npm run ocr:fixtures
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';

const require = createRequire(import.meta.url);
const pdfmake = require('pdfmake');
pdfmake.addFonts(require('pdfmake/fonts/Roboto.js'));
pdfmake.setUrlAccessPolicy(() => false);

const out = path.resolve('tests/fixtures/ocr');
const py = path.resolve('.venv-ocr/bin/python');
fs.mkdirSync(out, { recursive: true });
const diagramPath = path.join(out, 'design-schema.png');
execFileSync(py, ['-m', 'ocr_service.tools.fixtures', 'diagram', diagramPath], { stdio: 'inherit' });
const diagram = `data:image/png;base64,${fs.readFileSync(diagramPath).toString('base64')}`;

const lorem = (topic: string) =>
  `This section describes the ${topic} for the synthetic study QX-301. The text is fictional and exists only to test document processing. ` +
  `Each paragraph spans several lines so that paragraph grouping, reading order and line joining can be verified across digital and scanned pages.`;

// pdfmake mutates cell objects, so every cell must be a fresh object. Pattern: 'X' = required, '.' = not done.
const soaRow = (name: string, pattern: string): TableCell[] => [{ text: name }, ...[...pattern].map((c) => ({ text: c === 'X' ? 'X' : '', alignment: 'center' as const }))];

const soa: TableCell[][] = [
  [
    { text: 'Assessment / Procedure', rowSpan: 2, bold: true },
    { text: 'Screening', rowSpan: 2, bold: true, alignment: 'center' },
    { text: 'Treatment Period', colSpan: 4, bold: true, alignment: 'center' },
    {},
    {},
    {},
    { text: 'Follow-up', rowSpan: 2, bold: true, alignment: 'center' },
  ],
  [{}, {}, { text: 'Day 1', bold: true, alignment: 'center' }, { text: 'Week 4', bold: true, alignment: 'center' }, { text: 'Week 8', bold: true, alignment: 'center' }, { text: 'Week 12', bold: true, alignment: 'center' }, {}],
  soaRow('Informed consent', 'X.....'),
  soaRow('Inclusion/exclusion criteria', 'XX....'),
  soaRow('Physical examination', 'XX..XX'),
  soaRow('Vital signs', 'XXXXXX'),
  soaRow('12-lead ECG a', 'XX.XX.'),
  soaRow('Haematology and chemistry', 'XXXXXX'),
  soaRow('PK blood sampling b', '.XX.X.'),
  soaRow('Study drug dispensing', '.XXX..'),
  soaRow('Adverse event review', '.XXXXX'),
];

const content: Content[] = [
  { text: 'CLINICAL STUDY PROTOCOL', fontSize: 26, bold: true, alignment: 'center', margin: [0, 120, 0, 30] },
  { text: 'A Phase 3, Randomised, Double-Blind, Placebo-Controlled Study of Drug Q in Adults with Moderate Chronic Example Disease', fontSize: 16, bold: true, alignment: 'center', margin: [30, 0, 30, 40] },
  {
    table: {
      widths: [160, 260],
      body: [
        ['Protocol Number:', 'QX-301'],
        ['Sponsor:', 'Example Pharma Ltd (fictional)'],
        ['Version:', '2.0'],
        ['Date:', '12 March 2026'],
        ['Phase:', 'Phase 3'],
      ],
    },
    layout: 'noBorders',
    margin: [60, 0, 0, 0],
  },
  { text: 'CONFIDENTIAL', alignment: 'center', bold: true, margin: [0, 120, 0, 0], pageBreak: 'after' },

  { text: '1. INTRODUCTION', style: 'h1' },
  { text: lorem('background and rationale'), style: 'p' },
  { text: '1.1 Background', style: 'h2' },
  { text: lorem('disease background'), style: 'p' },
  { text: `${lorem('unmet medical need')} The assessment schedule is provided in Table 2.`, style: 'p' },
  { text: '2. OBJECTIVES AND ENDPOINTS', style: 'h1' },
  { text: 'Table 1: Objectives and Endpoints', style: 'caption' },
  {
    table: {
      headerRows: 1,
      widths: [150, '*', 80],
      body: [
        [{ text: 'Objective', bold: true }, { text: 'Endpoint', bold: true }, { text: 'Timepoint', bold: true }],
        ['Primary: To compare the efficacy of Drug Q with placebo', 'Change from baseline in disease activity score', 'Week 12'],
        ['Secondary: To evaluate the safety and tolerability of Drug Q', 'Incidence of treatment-emergent adverse events', 'Week 16'],
        ['Secondary: To characterise pharmacokinetics', 'Trough plasma concentration of Drug Q', 'Week 8'],
      ],
    },
    margin: [0, 0, 0, 10],
  },
  { text: lorem('estimands'), style: 'p', pageBreak: 'after' },

  { text: '3. STUDY DESIGN', style: 'h1' },
  { text: lorem('overall study design'), style: 'p' },
  { image: diagram, width: 460, alignment: 'center', margin: [0, 6, 0, 4] },
  { text: 'Figure 1: Study Design Schema', style: 'caption', alignment: 'center' },
  { text: '4. SELECTION OF SUBJECTS', style: 'h1' },
  { text: '4.1 Inclusion Criteria', style: 'h2' },
  {
    ol: [
      'Male or female participants aged 18 to 75 years at the time of consent.',
      'Diagnosis of chronic example disease for at least 6 months before screening.',
      'Able to understand and sign the informed consent form.',
    ],
    style: 'p',
  },
  { text: '4.2 Exclusion Criteria', style: 'h2' },
  {
    ol: [
      'Any prior exposure to Drug Q or another drug of the same class.',
      'Clinically significant abnormal ECG at screening.',
      'Pregnancy or breastfeeding.',
    ],
    style: 'p',
  },

  { text: 'Table 2: Schedule of Activities', style: 'caption', pageBreak: 'before', pageOrientation: 'landscape' },
  { table: { headerRows: 2, widths: [210, 70, 70, 70, 70, 70, 70], body: soa }, fontSize: 10 },
  { text: 'a. ECG performed in triplicate, at least 5 minutes apart.', style: 'fn', margin: [0, 6, 0, 0] },
  { text: 'b. Pre-dose sample only.', style: 'fn' },
  { text: 'Abbreviations: ECG = electrocardiogram; PK = pharmacokinetics; X = required procedure.', style: 'fn' },

  { text: '5. STATISTICAL METHODS', style: 'h1', pageBreak: 'before', pageOrientation: 'portrait' },
  { text: '5.1 Sample Size', style: 'h2' },
  { text: lorem('sample size determination'), style: 'p' },
  { text: '5.2 Analysis Populations', style: 'h2' },
  { text: lorem('analysis populations'), style: 'p' },
  { text: '6. REFERENCES', style: 'h1' },
  {
    columns: [
      { text: ['Left column. ', lorem('first reference list column')], style: 'p' },
      { text: ['Right column. ', lorem('second reference list column')], style: 'p' },
    ],
    columnGap: 30,
  },
];

const doc: TDocumentDefinitions = {
  pageSize: 'A4',
  pageMargins: [60, 70, 60, 60],
  content,
  defaultStyle: { font: 'Roboto', fontSize: 11, lineHeight: 1.2 },
  styles: {
    h1: { fontSize: 15, bold: true, margin: [0, 14, 0, 6] },
    h2: { fontSize: 12.5, bold: true, margin: [0, 10, 0, 4] },
    p: { margin: [0, 0, 0, 8], alignment: 'justify' },
    caption: { bold: true, fontSize: 11, margin: [0, 6, 0, 6] },
    fn: { fontSize: 8.5 },
  },
  header: (page) => (page === 1 ? null : { text: 'Protocol QX-301 | Version 2.0 | Confidential', fontSize: 8, color: '#555', margin: [60, 30, 60, 0] }),
  footer: (page, pages) => ({ text: `Page ${page} of ${pages}`, alignment: 'center', fontSize: 8, color: '#555', margin: [0, 20, 0, 0] }),
};

const digital = path.join(out, 'protocol-digital.pdf');
fs.writeFileSync(digital, await pdfmake.createPdf(doc).getBuffer());
execFileSync(py, ['-m', 'ocr_service.tools.fixtures', 'derive', digital, out], { stdio: 'inherit' });
console.log(fs.readdirSync(out).join('\n'));
