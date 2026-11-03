import clsx from 'clsx';
import { Bold, Italic, List, ListOrdered, RemoveFormatting, Underline } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { richTextToPlain, sanitizeRichText } from '../../../shared/richtext';

const TOOLS = [
  { cmd: 'bold', icon: Bold, label: 'Bold' },
  { cmd: 'italic', icon: Italic, label: 'Italic' },
  { cmd: 'underline', icon: Underline, label: 'Underline' },
  { cmd: 'insertUnorderedList', icon: List, label: 'Bulleted list' },
  { cmd: 'insertOrderedList', icon: ListOrdered, label: 'Numbered list' },
  { cmd: 'removeFormat', icon: RemoveFormatting, label: 'Clear formatting' },
];

export function RichTextEditor({ value, onChange, placeholder, id }: { value: string; onChange: (html: string) => void; placeholder: string; id?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string | null>(null);
  const [empty, setEmpty] = useState(!richTextToPlain(value || ''));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value !== lastEmitted.current) {
      el.innerHTML = value || '';
      lastEmitted.current = value;
      setEmpty(!richTextToPlain(value || ''));
    }
  }, [value]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const html = sanitizeRichText(el.innerHTML);
    lastEmitted.current = html;
    setEmpty(!richTextToPlain(html));
    onChange(html);
  };

  return (
    <div className="rounded-md border border-slate-300 bg-white focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
      <div className="flex gap-0.5 border-b border-slate-200 px-1.5 py-1">
        {TOOLS.map(({ cmd, icon: Icon, label }) => (
          <button
            key={cmd}
            type="button"
            title={label}
            aria-label={label}
            onMouseDown={(e) => {
              e.preventDefault();
              document.execCommand(cmd);
              emit();
            }}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
      <div className="relative">
        {empty && <div className="pointer-events-none absolute left-3 top-2 text-sm italic text-slate-400">{placeholder}</div>}
        <div
          id={id}
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={placeholder}
          onInput={emit}
          onBlur={emit}
          onPaste={(e) => {
            e.preventDefault();
            const html = e.clipboardData.getData('text/html');
            const text = e.clipboardData.getData('text/plain');
            const clean = html ? sanitizeRichText(html) : text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!).replace(/\n/g, '<br>');
            document.execCommand('insertHTML', false, clean);
            emit();
          }}
          className={clsx('rt-content min-h-[120px] px-3 py-2 text-sm text-slate-800 focus:outline-none')}
        />
      </div>
    </div>
  );
}
