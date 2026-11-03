import type { FieldDef, ProtocolTemplate, SubsectionTemplate } from '../types.ts';

// Template version is configurable: bump `version` (or add a second template object to
// TEMPLATES in ./index.ts) and new protocols will record the new id/version. Existing
// protocols keep the field definitions that were copied into them at creation time.
export const ICH_GCP_TEMPLATE_ID = 'ich-gcp-protocol';
export const ICH_GCP_TEMPLATE_VERSION = '1.0';

const rt = (key: string, label: string, placeholder: string, extra: Partial<FieldDef> = {}): FieldDef => ({
  key,
  label,
  type: 'richtext',
  placeholder,
  ...extra,
});
const ta = (key: string, label: string, placeholder: string, extra: Partial<FieldDef> = {}): FieldDef => ({
  key,
  label,
  type: 'textarea',
  placeholder,
  ...extra,
});
const tx = (key: string, label: string, placeholder: string, extra: Partial<FieldDef> = {}): FieldDef => ({
  key,
  label,
  type: 'text',
  placeholder,
  ...extra,
});
const sub = (
  key: string,
  title: string,
  guidance: string,
  fields: FieldDef[],
  optional = false,
): SubsectionTemplate => ({ key, title, guidance, fields, optional });

export const ICH_GCP_TEMPLATE: ProtocolTemplate = {
  id: ICH_GCP_TEMPLATE_ID,
  version: ICH_GCP_TEMPLATE_VERSION,
  name: 'ICH-GCP Clinical Trial Protocol Format',
  basis: 'Structure based on the clinical trial protocol contents described in ICH E6 (GCP), Section 6.',
  notice:
    'This template reproduces a historical ICH-GCP protocol structure as an authoring aid. Using it does not by itself ' +
    'demonstrate compliance with current ICH guidelines (e.g. E6(R3), M11) or with any national regulatory requirement. ' +
    'Content must be written and reviewed by qualified personnel.',
  sections: [
    {
      key: 'general',
      number: 1,
      title: 'General Information',
      subsections: [
        sub(
          'general.title',
          'Protocol Title, Identifying Number and Date',
          'Protocol title, protocol identifying number and date. Any amendment(s) should also bear the amendment number(s) and date(s). These values are shared with the study record and the cover page.',
          [
            tx('title', 'Protocol title', '[Enter protocol title]', { required: true, bind: 'study.title' }),
            tx('protocolNumber', 'Protocol number', '[Enter protocol identifying number]', {
              required: true,
              bind: 'study.protocolNumber',
            }),
            tx('version', 'Protocol version', '[Enter protocol version]', { required: true, bind: 'protocol.version' }),
            { key: 'protocolDate', label: 'Protocol date', type: 'date', placeholder: '[Select protocol date]', required: true, bind: 'protocol.protocolDate' },
            tx('amendmentNumber', 'Amendment number', '[Enter amendment number, if applicable]', { bind: 'protocol.amendmentNumber' }),
            { key: 'amendmentDate', label: 'Amendment date', type: 'date', placeholder: '[Select amendment date, if applicable]', bind: 'protocol.amendmentDate' },
          ],
        ),
        sub(
          'general.sponsor',
          'Sponsor and Monitor',
          'Name and address of the sponsor and monitor (if other than the sponsor).',
          [
            tx('sponsorName', 'Sponsor name', '[Enter sponsor name]', { required: true, bind: 'study.sponsorName' }),
            ta('sponsorAddress', 'Sponsor registered address', '[Enter sponsor name and registered address]', { required: true }),
            tx('monitorName', 'Monitor / CRO name', '[Enter monitor or CRO name, if other than the sponsor]'),
            ta('monitorAddress', 'Monitor / CRO address', '[Enter monitor or CRO address]'),
          ],
        ),
        sub(
          'general.signatories',
          'Sponsor-Authorized Signatories',
          'Name and title of the person(s) authorized to sign the protocol and the protocol amendment(s) for the sponsor.',
          [
            {
              key: 'signatories',
              label: 'Authorized signatories',
              type: 'table',
              placeholder: '[Add sponsor-authorized signatories]',
              required: true,
              columns: [
                { key: 'name', label: 'Name' },
                { key: 'title', label: 'Title / Role' },
                { key: 'organisation', label: 'Organisation' },
              ],
            },
          ],
        ),
        sub(
          'general.medicalExpert',
          'Sponsor Medical Expert',
          "Name, title, address and telephone number(s) of the sponsor's medical expert (or dentist when appropriate) for the trial.",
          [
            tx('name', 'Name', '[Enter medical expert name]', { required: true }),
            tx('title', 'Title / Qualification', '[Enter title and qualification]'),
            ta('address', 'Address', '[Enter address]'),
            tx('phone', 'Telephone', '[Enter telephone number(s)]'),
            tx('email', 'Email', '[Enter email address]'),
          ],
        ),
        sub(
          'general.investigators',
          'Investigator(s) and Trial Site(s)',
          'Name and title of the investigator(s) responsible for conducting the trial, and the address and telephone number(s) of the trial site(s).',
          [
            {
              key: 'sites',
              label: 'Investigators and sites',
              type: 'table',
              placeholder: '[Add investigators and trial sites]',
              required: true,
              columns: [
                { key: 'siteId', label: 'Site ID' },
                { key: 'investigator', label: 'Investigator (name, title)' },
                { key: 'institution', label: 'Institution' },
                { key: 'address', label: 'Address' },
                { key: 'phone', label: 'Telephone' },
              ],
            },
          ],
        ),
        sub(
          'general.qualifiedPhysician',
          'Qualified Physician Responsible for Site Medical Decisions',
          'Name, title, address and telephone number(s) of the qualified physician (or dentist, if applicable) responsible for all trial-site related medical (or dental) decisions, if other than the investigator.',
          [
            {
              key: 'physicians',
              label: 'Qualified physicians',
              type: 'table',
              placeholder: '[Add qualified physician(s), if other than the investigator]',
              columns: [
                { key: 'name', label: 'Name and title' },
                { key: 'site', label: 'Site' },
                { key: 'address', label: 'Address' },
                { key: 'phone', label: 'Telephone' },
              ],
            },
          ],
        ),
        sub(
          'general.laboratories',
          'Clinical Laboratories and Technical Departments',
          'Name(s) and address(es) of the clinical laboratory(ies) and other medical and/or technical department(s) and/or institutions involved in the trial.',
          [
            {
              key: 'laboratories',
              label: 'Laboratories and departments',
              type: 'table',
              placeholder: '[Add clinical laboratories and technical departments]',
              columns: [
                { key: 'name', label: 'Name' },
                { key: 'function', label: 'Function / Service' },
                { key: 'address', label: 'Address' },
              ],
            },
          ],
          true,
        ),
      ],
    },
    {
      key: 'background',
      number: 2,
      title: 'Background Information',
      subsections: [
        sub('background.ip', 'Investigational Product(s)', 'Name and description of the investigational product(s).', [
          tx('productName', 'Investigational product name', '[Enter investigational product name]', { required: true }),
          rt('description', 'Description', '[Enter investigational product name and description]', { required: true }),
        ]),
        sub(
          'background.studies',
          'Nonclinical Studies and Clinical Trials',
          'A summary of findings from nonclinical studies that potentially have clinical significance and from clinical trials that are relevant to the trial.',
          [rt('summary', 'Summary', '[Summarise relevant nonclinical studies and clinical trials]', { required: true })],
        ),
        sub(
          'background.riskBenefit',
          'Known and Potential Risks and Benefits',
          'Summary of the known and potential risks and benefits, if any, to human subjects.',
          [
            rt('risks', 'Known and potential risks', '[Enter known and potential risks to subjects]', { required: true }),
            rt('benefits', 'Known and potential benefits', '[Enter known and potential benefits to subjects]'),
          ],
        ),
        sub(
          'background.dosing',
          'Route of Administration, Dosage, Regimen and Treatment Period(s)',
          'Description of and justification for the route of administration, dosage, dosage regimen, and treatment period(s).',
          [rt('description', 'Description and justification', '[Describe and justify the route of administration, dosage, dosage regimen and treatment period(s)]', { required: true })],
        ),
        sub(
          'background.compliance',
          'Compliance Statement',
          'A statement that the trial will be conducted in compliance with the protocol, GCP and the applicable regulatory requirement(s).',
          [rt('statement', 'Compliance statement', '[Enter compliance statement for the protocol, GCP and applicable regulatory requirements]', { required: true })],
        ),
        sub('background.population', 'Study Population', 'Description of the population to be studied.', [
          rt('description', 'Population description', '[Describe the population to be studied]', { required: true }),
        ]),
        sub(
          'background.literature',
          'Relevant Literature and Data',
          'References to literature and data that are relevant to the trial, and that provide background for the trial.',
          [{ key: 'references', label: 'References', type: 'references', placeholder: '[Add relevant literature and references]' }],
        ),
      ],
    },
    {
      key: 'objectives',
      number: 3,
      title: 'Trial Objectives and Purpose',
      subsections: [
        sub('objectives.primary', 'Primary Objective(s)', 'A detailed description of the primary objective(s) of the trial. Each objective should be linked to at least one endpoint (see 4.1).', [
          { key: 'objectives', label: 'Primary objectives', type: 'objectives', objectiveCategory: 'Primary', placeholder: '[Enter primary objective]', required: true },
        ]),
        sub('objectives.secondary', 'Secondary Objective(s)', 'A detailed description of the secondary objective(s) of the trial.', [
          { key: 'objectives', label: 'Secondary objectives', type: 'objectives', objectiveCategory: 'Secondary', placeholder: '[Enter secondary objective(s)]' },
        ]),
        sub(
          'objectives.exploratory',
          'Exploratory Objective(s)',
          'Exploratory objectives, if any.',
          [{ key: 'objectives', label: 'Exploratory objectives', type: 'objectives', objectiveCategory: 'Exploratory', placeholder: '[Enter exploratory objective(s), if any]' }],
          true,
        ),
        sub('objectives.purpose', 'Overall Purpose of the Trial', 'A description of the overall purpose of the trial.', [
          rt('purpose', 'Purpose', '[Describe the overall purpose of the trial]', { required: true }),
        ]),
      ],
    },
    {
      key: 'design',
      number: 4,
      title: 'Trial Design',
      subsections: [
        sub('design.endpoints', 'Primary and Secondary Endpoints', 'A specific statement of the primary endpoints and the secondary endpoints, if any, to be measured during the trial. Link each endpoint to the objective(s) it supports.', [
          { key: 'endpoints', label: 'Endpoints', type: 'endpoints', placeholder: '[Enter primary endpoint and its definition]', required: true },
        ]),
        sub('design.type', 'Trial Type, Design and Schematic Diagram', 'A description of the type/design of trial to be conducted (e.g. double-blind, placebo-controlled, parallel design) and a schematic diagram of trial design, procedures and stages.', [
          { key: 'trialType', label: 'Trial type', type: 'select', placeholder: '[Select trial type]', options: ['Parallel group', 'Crossover', 'Factorial', 'Single-arm', 'Adaptive', 'Other'], required: true },
          rt('description', 'Design description', '[Describe the trial design, procedures and stages]', { required: true }),
          { key: 'schematic', label: 'Schematic diagram', type: 'file', placeholder: '[Upload trial schematic diagram (PNG or JPEG is embedded in exports)]' },
        ]),
        sub('design.bias', 'Measures to Minimize Bias', 'A description of the measures taken to minimize/avoid bias, including randomization and blinding.', [
          { key: 'randomization', label: 'Randomization', type: 'select', placeholder: '[Select randomization approach]', options: ['Randomised', 'Non-randomised'], required: true },
          ta('randomizationDetails', 'Randomization details', '[Describe randomization method, allocation ratio and stratification factors]'),
          { key: 'blinding', label: 'Blinding', type: 'select', placeholder: '[Select blinding level]', options: ['Open-label', 'Single-blind', 'Double-blind', 'Triple-blind'], required: true },
          ta('blindingDetails', 'Blinding details', '[Describe who is blinded and how blinding is maintained]'),
        ]),
        sub('design.treatments', 'Trial Treatments and Investigational Product Details', 'A description of the trial treatment(s) and the dosage and dosage regimen of the investigational product(s). Include a description of the dosage form, packaging, and labelling. Per-arm treatment details are captured in the Study Arms builder (6.1).', [
          rt('description', 'Treatments and investigational product details', '[Describe trial treatments, dosage form, packaging and labelling of the investigational product(s)]', { required: true }),
        ]),
        sub('design.duration', 'Duration of Subject Participation and Trial Periods', 'The expected duration of subject participation, and a description of the sequence and duration of all trial periods, including follow-up, if any.', [
          tx('participationDuration', 'Expected duration of subject participation', '[Enter expected duration of subject participation]', { required: true }),
          {
            key: 'periods',
            label: 'Trial periods',
            type: 'table',
            placeholder: '[Add trial periods with sequence and duration]',
            columns: [
              { key: 'period', label: 'Period' },
              { key: 'duration', label: 'Duration' },
              { key: 'description', label: 'Description' },
            ],
          },
        ]),
        sub('design.stopping', 'Stopping Rules and Discontinuation Criteria', 'A description of the "stopping rules" or "discontinuation criteria" for individual subjects, parts of trial and entire trial.', [
          ta('individual', 'Individual subjects', '[Enter discontinuation criteria for individual subjects]', { required: true }),
          ta('parts', 'Parts of the trial', '[Enter stopping rules for parts of the trial]'),
          ta('entire', 'Entire trial', '[Enter stopping rules for the entire trial]'),
        ]),
        sub('design.accountability', 'Investigational Product Accountability', 'Accountability procedures for the investigational product(s), including the placebo(s) and comparator(s), if any.', [
          rt('procedures', 'Accountability procedures', '[Describe investigational product accountability procedures]', { required: true }),
        ]),
        sub('design.codes', 'Randomization Code Maintenance and Unblinding', 'Maintenance of trial treatment randomization codes and procedures for breaking codes.', [
          rt('procedures', 'Code maintenance and emergency unblinding', '[Describe maintenance of randomization codes and emergency unblinding procedures]', { required: true }),
        ]),
        sub('design.sourceData', 'Data Recorded Directly on CRFs', 'The identification of any data to be recorded directly on the CRFs (i.e. no prior written or electronic record of data), and to be considered to be source data.', [
          { key: 'items', label: 'Data items recorded directly on CRFs', type: 'list', placeholder: '[Add data items recorded directly on CRFs and considered source data]' },
        ]),
      ],
    },
    {
      key: 'selection',
      number: 5,
      title: 'Selection and Withdrawal of Subjects',
      subsections: [
        sub('selection.inclusion', 'Inclusion Criteria', 'Subject inclusion criteria. Enter one criterion per row.', [
          { key: 'criteria', label: 'Inclusion criteria', type: 'criteria', criterionType: 'inclusion', placeholder: '[Add inclusion criteria]', required: true },
        ]),
        sub('selection.exclusion', 'Exclusion Criteria', 'Subject exclusion criteria. Enter one criterion per row.', [
          { key: 'criteria', label: 'Exclusion criteria', type: 'criteria', criterionType: 'exclusion', placeholder: '[Add exclusion criteria]', required: true },
        ]),
        sub('selection.withdrawal', 'Subject Withdrawal Criteria and Procedures', 'Subject withdrawal criteria (i.e. terminating investigational product treatment/trial treatment) and procedures specifying when and how to withdraw subjects, the type and timing of data to be collected, whether and how subjects are to be replaced, and the follow-up for withdrawn subjects.', [
          ta('conditions', 'Withdrawal conditions', '[Enter conditions under which subjects will be withdrawn]', { required: true }),
          ta('dataCollection', 'Data collection after withdrawal', '[Describe the type and timing of data to be collected for withdrawn subjects]', { required: true }),
          ta('replacement', 'Subject replacement', '[State whether and how withdrawn subjects will be replaced]'),
          ta('followUp', 'Follow-up after withdrawal', '[Describe follow-up for subjects withdrawn from treatment or the trial]'),
        ]),
      ],
    },
    {
      key: 'treatment',
      number: 6,
      title: 'Treatment of Subjects',
      subsections: [
        sub('treatment.arms', 'Treatments per Study Arm', 'The treatment(s) to be administered, including the name(s) of all the product(s), the dose(s), the dosing schedule(s), the route/mode(s) of administration, and the treatment period(s), including the follow-up period(s) for subjects for each investigational product treatment/trial treatment group/arm of the trial.', [
          { key: 'arms', label: 'Study arms', type: 'arms', placeholder: '[Enter treatment name, dosage, route and frequency]', required: true },
        ]),
        sub('treatment.medications', 'Permitted and Prohibited Medications', 'Medication(s)/treatment(s) permitted (including rescue medication) and not permitted before and/or during the trial.', [
          { key: 'permitted', label: 'Permitted medications / treatments', type: 'list', placeholder: '[Add permitted medications or treatments]' },
          { key: 'prohibited', label: 'Prohibited medications / treatments', type: 'list', placeholder: '[Add prohibited medications or treatments]', required: true },
          { key: 'rescue', label: 'Rescue medications', type: 'list', placeholder: '[Add rescue medications, if any]' },
        ]),
        sub('treatment.compliance', 'Monitoring Subject Compliance', 'Procedures for monitoring subject compliance.', [
          rt('procedures', 'Compliance monitoring procedures', '[Describe procedures for monitoring subject compliance]', { required: true }),
        ]),
      ],
    },
    {
      key: 'efficacy',
      number: 7,
      title: 'Assessment of Efficacy',
      subsections: [
        sub('efficacy.parameters', 'Efficacy Parameters', 'Specification of the efficacy parameters.', [
          { key: 'parameters', label: 'Efficacy parameters', type: 'list', placeholder: '[Enter efficacy parameters]', required: true },
        ]),
        sub('efficacy.methods', 'Methods and Timing of Efficacy Assessments', 'Methods and timing for assessing, recording, and analysing of efficacy parameters. Visit-level timing is defined in the Schedule of Activities.', [
          rt('methods', 'Methods and timing', '[Describe methods and timing for assessing, recording and analysing efficacy parameters]', { required: true }),
        ]),
      ],
    },
    {
      key: 'safety',
      number: 8,
      title: 'Assessment of Safety',
      subsections: [
        sub('safety.parameters', 'Safety Parameters', 'Specification of safety parameters.', [
          { key: 'parameters', label: 'Safety parameters', type: 'list', placeholder: '[Enter safety parameters]', required: true },
        ]),
        sub('safety.methods', 'Safety Assessment Methods and Timing', 'The methods and timing for assessing, recording, and analysing safety parameters. Visit-level timing is defined in the Schedule of Activities.', [
          rt('methods', 'Methods and timing', '[Describe methods and timing for assessing, recording and analysing safety parameters]', { required: true }),
        ]),
        sub('safety.reporting', 'Adverse Event and Intercurrent Illness Reporting', 'Procedures for eliciting reports of and for recording and reporting adverse event and intercurrent illnesses.', [
          rt('procedures', 'Reporting procedures', '[Describe procedures for eliciting, recording and reporting adverse events and intercurrent illnesses]', { required: true }),
        ]),
        sub('safety.followUp', 'Follow-up of Adverse Events', 'The type and duration of the follow-up of subjects after adverse events.', [
          rt('followUp', 'Follow-up', '[Describe the type and duration of follow-up of subjects after adverse events]', { required: true }),
        ]),
      ],
    },
    {
      key: 'statistics',
      number: 9,
      title: 'Statistics',
      subsections: [
        sub('statistics.methods', 'Statistical Methods and Interim Analyses', 'A description of the statistical methods to be employed, including timing of any planned interim analysis(ses).', [
          rt('methods', 'Statistical methods', '[Describe the statistical methods to be employed]', { required: true }),
          ta('interim', 'Interim analyses', '[Describe timing and purpose of any planned interim analyses, or state none planned]'),
        ]),
        sub('statistics.sampleSize', 'Sample Size', 'The number of subjects planned to be enrolled. In multicentre trials, the numbers of enrolled subjects projected for each trial site should be specified. Reason for choice of sample size, including reflections on (or calculations of) the power of the trial and clinical justification.', [
          { key: 'plannedSampleSize', label: 'Planned sample size (total)', type: 'number', placeholder: '[Enter planned number of subjects]', unit: 'subjects', required: true },
          rt('justification', 'Sample size justification', '[Enter planned sample size and statistical justification]', { required: true }),
          ta('perSite', 'Projected enrolment per site', '[Enter projected enrolment per site for multicentre trials]'),
        ]),
        sub('statistics.significance', 'Level of Significance', 'The level of significance to be used.', [
          { key: 'alpha', label: 'Significance level (alpha)', type: 'number', placeholder: '[Enter significance level]', required: true },
          { key: 'sidedness', label: 'Test sidedness', type: 'select', placeholder: '[Select sidedness]', options: ['One-sided', 'Two-sided'] },
          ta('rationale', 'Rationale / multiplicity', '[Describe rationale and any multiplicity adjustment]'),
        ]),
        sub('statistics.termination', 'Criteria for Termination of the Trial', 'Criteria for the termination of the trial.', [
          rt('criteria', 'Termination criteria', '[Enter statistical criteria for termination of the trial]', { required: true }),
        ]),
        sub('statistics.missingData', 'Missing, Unused and Spurious Data', 'Procedure for accounting for missing, unused, and spurious data.', [
          rt('procedure', 'Procedure', '[Describe handling of missing, unused and spurious data]', { required: true }),
        ]),
        sub('statistics.deviations', 'Deviations from the Statistical Plan', 'Procedures for reporting any deviation(s) from the original statistical plan (any deviation(s) from the original statistical plan should be described and justified in protocol and/or in the final report, as appropriate).', [
          rt('procedure', 'Procedure', '[Describe procedures for reporting deviations from the statistical plan]', { required: true }),
        ]),
        sub('statistics.populations', 'Analysis Populations', 'The selection of subjects to be included in the analyses (e.g. all randomized subjects, all dosed subjects, all eligible subjects, evaluable subjects).', [
          {
            key: 'populations',
            label: 'Analysis populations',
            type: 'table',
            placeholder: '[Add analysis populations and their definitions]',
            required: true,
            columns: [
              { key: 'population', label: 'Population' },
              { key: 'definition', label: 'Definition' },
              { key: 'use', label: 'Analyses' },
            ],
          },
        ]),
      ],
    },
    {
      key: 'access',
      number: 10,
      title: 'Direct Access to Source Data/Documents',
      subsections: [
        sub('access.monitoring', 'Monitoring Access', 'The sponsor should ensure that the investigator(s)/institution(s) will permit trial-related monitoring by providing direct access to source data/documents.', [
          rt('statement', 'Statement', '[Enter provisions for direct access to source data/documents for monitoring]', { required: true }),
        ]),
        sub('access.audit', 'Audit Access', 'Provisions permitting trial-related audits.', [rt('statement', 'Statement', '[Enter provisions for direct access for audits]', { required: true })]),
        sub('access.irb', 'IRB/IEC Review Access', 'Provisions permitting IRB/IEC review.', [rt('statement', 'Statement', '[Enter provisions for direct access for IRB/IEC review]', { required: true })]),
        sub('access.inspection', 'Regulatory Inspection Access', 'Provisions permitting regulatory inspection(s).', [
          rt('statement', 'Statement', '[Enter provisions for direct access for regulatory inspection]', { required: true }),
        ]),
      ],
    },
    {
      key: 'quality',
      number: 11,
      title: 'Quality Control and Quality Assurance',
      subsections: [
        sub('quality.qc', 'Quality Control Procedures', 'Quality control procedures applied to the trial.', [rt('procedures', 'Procedures', '[Describe quality control procedures]', { required: true })]),
        sub('quality.qa', 'Quality Assurance Procedures', 'Quality assurance procedures applied to the trial.', [rt('procedures', 'Procedures', '[Describe quality assurance procedures]', { required: true })]),
        sub('quality.monitoring', 'Monitoring and Audit Arrangements', 'Arrangements for monitoring and auditing the trial.', [rt('arrangements', 'Arrangements', '[Describe monitoring and audit arrangements]', { required: true })]),
      ],
    },
    {
      key: 'ethics',
      number: 12,
      title: 'Ethics',
      subsections: [
        sub('ethics.considerations', 'Ethical Considerations', 'Description of ethical considerations relating to the trial.', [rt('considerations', 'Ethical considerations', '[Describe ethical considerations relating to the trial]', { required: true })]),
        sub('ethics.consent', 'Informed Consent', 'Process for obtaining and documenting informed consent.', [rt('process', 'Informed consent process', '[Describe the informed consent process]', { required: true })]),
        sub('ethics.irb', 'IRB/IEC Approval', 'Institutional Review Board / Independent Ethics Committee review and approval.', [
          rt('description', 'Approval process', '[Describe IRB/IEC submission and approval]', { required: true }),
          {
            key: 'committees',
            label: 'Committees',
            type: 'table',
            placeholder: '[Add IRB/IEC details per site]',
            columns: [
              { key: 'committee', label: 'Committee' },
              { key: 'site', label: 'Site(s)' },
              { key: 'reference', label: 'Approval reference / date' },
            ],
          },
        ]),
      ],
    },
    {
      key: 'data',
      number: 13,
      title: 'Data Handling and Recordkeeping',
      subsections: [
        sub('data.collection', 'Data Collection Procedures', 'Procedures for collecting trial data.', [rt('procedures', 'Procedures', '[Describe data collection procedures]', { required: true })]),
        sub('data.crf', 'Case Report Forms', 'Case report forms (paper or electronic) used in the trial.', [
          rt('description', 'Description', '[Describe the case report forms (paper or electronic)]', { required: true }),
          { key: 'modules', label: 'CRF modules', type: 'list', placeholder: '[Add CRF modules]' },
        ]),
        sub('data.management', 'Data Management', 'Data management processes, including data review, query management and database lock.', [rt('procedures', 'Procedures', '[Describe data management processes]', { required: true })]),
        sub('data.confidentiality', 'Data Confidentiality and Protection', 'Measures to protect subject confidentiality and personal data.', [rt('measures', 'Measures', '[Describe data confidentiality and protection measures]', { required: true })]),
        sub('data.retention', 'Record Retention', 'Retention of essential documents and trial records.', [
          tx('period', 'Retention period', '[Enter record retention period]', { required: true }),
          rt('details', 'Details', '[Describe record retention arrangements]'),
        ]),
      ],
    },
    {
      key: 'financing',
      number: 14,
      title: 'Financing and Insurance',
      subsections: [
        sub('financing.financing', 'Trial Financing', 'Financing of the trial, if not addressed in a separate agreement.', [rt('details', 'Financing', '[Describe trial financing or reference the separate agreement]', { required: true })]),
        sub('financing.insurance', 'Insurance and Indemnification', 'Insurance and indemnification arrangements, if not addressed in a separate agreement.', [rt('details', 'Insurance', '[Describe insurance and indemnification arrangements]', { required: true })]),
      ],
    },
    {
      key: 'publication',
      number: 15,
      title: 'Publication Policy',
      subsections: [
        sub('publication.principles', 'Publication Principles', 'Publication policy, if not addressed in a separate agreement.', [rt('principles', 'Principles', '[Describe publication principles]', { required: true })]),
        sub('publication.authorship', 'Authorship and Publication Responsibilities', 'Authorship criteria and responsibilities for publication.', [rt('details', 'Authorship', '[Describe authorship criteria and publication responsibilities]', { required: true })]),
      ],
    },
    {
      key: 'supplements',
      number: 16,
      title: 'Supplements',
      subsections: [
        sub(
          'supplements.appendices',
          'Appendices',
          'Appendices to the protocol.',
          [
            {
              key: 'appendices',
              label: 'Appendix list',
              type: 'table',
              placeholder: '[Add appendices]',
              columns: [
                { key: 'id', label: 'Appendix' },
                { key: 'title', label: 'Title' },
                { key: 'description', label: 'Description' },
              ],
            },
            { key: 'files', label: 'Appendix files', type: 'file', placeholder: '[Attach appendix files]' },
          ],
          true,
        ),
        sub(
          'supplements.documents',
          'Supplementary Documents',
          'Supplementary documents supporting the protocol.',
          [
            { key: 'documents', label: 'Supplementary documents', type: 'list', placeholder: '[List supplementary documents]' },
            { key: 'files', label: 'Files', type: 'file', placeholder: '[Attach supplementary documents]' },
          ],
          true,
        ),
        sub(
          'supplements.references',
          'Reference Documents',
          'Reference documents cited in the protocol.',
          [{ key: 'references', label: 'Reference documents', type: 'references', placeholder: '[Add reference documents]' }],
          true,
        ),
      ],
    },
  ],
};
