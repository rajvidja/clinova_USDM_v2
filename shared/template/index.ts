import type { FieldDef, FieldType, ProtocolTemplate } from '../types.ts';
import { ICH_GCP_TEMPLATE } from './ichGcp.ts';

export const TEMPLATES: ProtocolTemplate[] = [ICH_GCP_TEMPLATE];

export function getTemplate(id: string, version?: string): ProtocolTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id && (!version || t.version === version));
}

export function contentTypeOf(fields: FieldDef[]): string {
  if (fields.length === 1) return fields[0].type;
  return 'composite';
}

export const CUSTOM_CONTENT_TYPES: { type: FieldType; label: string }[] = [
  { type: 'richtext', label: 'Rich text' },
  { type: 'textarea', label: 'Multiline text' },
  { type: 'text', label: 'Single-line text' },
  { type: 'list', label: 'Repeatable list' },
  { type: 'table', label: 'Table' },
  { type: 'references', label: 'References' },
  { type: 'file', label: 'File attachments' },
  { type: 'number', label: 'Number' },
  { type: 'date', label: 'Date' },
];

export function customFieldFor(type: FieldType, title: string): FieldDef[] {
  const base = { key: 'content', label: title, type, placeholder: `[Enter ${title.toLowerCase()}]` } as FieldDef;
  if (type === 'table') {
    base.columns = [
      { key: 'c1', label: 'Column 1' },
      { key: 'c2', label: 'Column 2' },
    ];
    base.editableColumns = true;
  }
  return [base];
}
