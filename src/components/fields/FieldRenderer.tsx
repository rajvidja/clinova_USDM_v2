import { Link } from 'react-router-dom';
import { isValueFilled, metaValue } from '../../../shared/completion';
import type { FieldDef, Subsection } from '../../../shared/types';
import { useEditor } from '../../store/editor';
import { ArmsBuilder, CriteriaBuilder } from '../builders/ArmsCriteria';
import { EndpointsEditor, ObjectivesEditor } from '../builders/ObjectivesEndpoints';
import { SoaBuilder } from '../builders/SoaBuilder';
import { FieldLabel, inputCls } from '../ui';
import { RichTextEditor } from './RichTextEditor';
import { FileField, ListField, ReferencesField, TableField } from './StructuredFields';

const TYPE_HINT: Partial<Record<FieldDef['type'], string>> = {
  richtext: 'Rich text',
  list: 'Repeatable list',
  table: 'Table',
  file: 'File attachments',
  references: 'References',
  objectives: 'Structured: objectives',
  endpoints: 'Structured: endpoints',
  arms: 'Structured: study arms',
  criteria: 'Structured: criteria',
};

export function FieldRenderer({ field, sub, protocolId }: { field: FieldDef; sub: Subsection; protocolId: string }) {
  const bundle = useEditor((s) => s.bundle!);
  const setSubContent = useEditor((s) => s.setSubContent);
  const setMeta = useEditor((s) => s.setMeta);
  const id = `f-${sub.id}-${field.key}`;
  const value = field.bind ? metaValue(bundle, field.bind) : sub.content?.[field.key];
  const onChange = (v: unknown) => {
    if (field.bind) setMeta(field.bind.split('.')[1] as never, String(v ?? ''));
    else setSubContent(sub.id, field.key, v);
  };
  const missing = field.required && !['objectives', 'endpoints', 'arms', 'criteria', 'soa'].includes(field.type) && !isValueFilled(field, value);
  const ring = missing ? ' border-amber-300' : '';

  let control: React.ReactNode;
  switch (field.type) {
    case 'text':
      control = <input id={id} className={inputCls + ring} value={String(value ?? '')} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'number':
      control = (
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="number"
            step="any"
            className={inputCls + ring + ' max-w-[220px]'}
            value={value === null || value === undefined ? '' : String(value)}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          />
          {field.unit && <span className="text-sm text-slate-500">{field.unit}</span>}
        </div>
      );
      break;
    case 'date':
      control = <input id={id} type="date" className={inputCls + ring + ' max-w-[220px]'} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'select':
      control = (
        <select id={id} className={inputCls + ring + ' max-w-sm'} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="">{field.placeholder}</option>
          {field.options?.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      );
      break;
    case 'textarea':
      control = <textarea id={id} className={inputCls + ring + ' min-h-[96px]'} value={String(value ?? '')} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'richtext':
      control = <RichTextEditor id={id} value={String(value ?? '')} placeholder={field.placeholder} onChange={onChange} />;
      break;
    case 'list':
      control = <ListField field={field} value={value} onChange={onChange} />;
      break;
    case 'table':
      control = <TableField field={field} value={value} onChange={onChange} />;
      break;
    case 'file':
      control = <FileField field={field} value={value} onChange={onChange} protocolId={protocolId} subsectionId={sub.id} />;
      break;
    case 'references':
      control = <ReferencesField field={field} value={value} onChange={onChange} />;
      break;
    case 'objectives':
      control = <ObjectivesEditor category={field.objectiveCategory} />;
      break;
    case 'endpoints':
      control = <EndpointsEditor />;
      break;
    case 'arms':
      control = <ArmsBuilder />;
      break;
    case 'criteria':
      control = <CriteriaBuilder type={field.criterionType!} />;
      break;
    case 'soa':
      control = <SoaBuilder />;
      break;
  }

  return (
    <div>
      <FieldLabel
        htmlFor={id}
        required={field.required}
        hint={
          field.bind ? (
            <span title="Shared with the study record, cover page and dashboards">Linked to study record</span>
          ) : field.type === 'endpoints' || field.type === 'objectives' ? (
            <Link to={`/builder/${protocolId}/objectives`} className="text-brand-700 hover:underline">
              Open Objectives &amp; Endpoints builder
            </Link>
          ) : field.type === 'arms' ? (
            <Link to={`/builder/${protocolId}/arms`} className="text-brand-700 hover:underline">
              Open Study Arms builder
            </Link>
          ) : (
            TYPE_HINT[field.type]
          )
        }
      >
        {field.label}
      </FieldLabel>
      {field.help && <p className="mb-1 text-xs text-slate-500">{field.help}</p>}
      {control}
    </div>
  );
}
