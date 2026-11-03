import clsx from 'clsx';
import { FileText } from 'lucide-react';
import type { DocBlock, DocModel, DocRun } from '../../shared/docModel';
import { attachmentUrl } from '../lib/api';

export function Runs({ runs }: { runs: DocRun[] }) {
  return (
    <>
      {runs.map((r, i) => {
        if (r.text === '\n') return <br key={i} />;
        const parts = r.text.split('\n');
        const content = parts.map((p, j) => (
          <span key={j}>
            {j > 0 && <br />}
            {p}
          </span>
        ));
        if (r.placeholder)
          return (
            <mark key={i} className="rounded-sm bg-amber-100 px-0.5 italic text-orange-800" title="Placeholder: content not yet entered">
              {content}
            </mark>
          );
        return (
          <span key={i} className={clsx(r.bold && 'font-semibold', r.italic && 'italic', r.underline && 'underline')}>
            {content}
          </span>
        );
      })}
    </>
  );
}

export function DocBlocks({ blocks, onHeadingClick }: { blocks: DocBlock[]; onHeadingClick?: (anchor: string) => void }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'heading':
            return b.level === 1 ? (
              <h2 key={i} id={b.anchor} className="mb-2 mt-8 scroll-mt-28 border-b border-slate-300 pb-1 text-[15px] font-bold tracking-wide text-[#12264a]">
                {b.number}.&nbsp;&nbsp;{b.text}
              </h2>
            ) : (
              <h3 key={i} id={b.anchor} className={clsx('mb-1.5 mt-5 scroll-mt-28 text-[13.5px] font-bold text-slate-800', onHeadingClick && 'cursor-pointer hover:text-brand-700')} onClick={() => onHeadingClick?.(b.anchor)}>
                {b.number}&nbsp;&nbsp;{b.text}
              </h3>
            );
          case 'label':
            return (
              <div key={i} className="mb-0.5 mt-3 text-[12.5px] font-semibold text-slate-600">
                {b.text}
              </div>
            );
          case 'para':
            return (
              <p key={i} className="mb-2 text-justify">
                <Runs runs={b.runs} />
              </p>
            );
          case 'list': {
            const Tag = b.style === 'number' ? 'ol' : 'ul';
            return (
              <Tag key={i} className={clsx('mb-2 space-y-1', b.style === 'number' ? 'list-decimal pl-6' : b.style === 'bullet' ? 'list-disc pl-6' : 'list-none pl-2')}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Runs runs={it} />
                  </li>
                ))}
              </Tag>
            );
          }
          case 'table':
            return (
              <div key={i} className="mb-3 overflow-x-auto">
                <table className={clsx('w-full border-collapse', b.compact ? 'text-[11px]' : 'text-[12px]')}>
                  <thead>
                    <tr>
                      {b.headers.map((h, j) => (
                        <th key={j} className="border border-slate-400 bg-[#e8edf5] px-1.5 py-1 text-left font-semibold text-[#12264a]" style={b.widths ? { width: `${b.widths[j]}%` } : undefined}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {r.map((c, k) => (
                          <td key={k} className="border border-slate-400 px-1.5 py-1 align-top">
                            <Runs runs={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'image':
            return (
              <figure key={i} className="my-3 text-center">
                <img src={attachmentUrl(b.attachmentId)} alt={b.filename} className="mx-auto max-h-[420px] max-w-full" />
                <figcaption className="mt-1 text-[11px] italic text-slate-500">{b.filename}</figcaption>
              </figure>
            );
          case 'attachment':
            return (
              <p key={i} className="mb-2 flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-slate-400" />
                <span className="font-semibold">Attachment:</span> {b.filename} ({Math.max(1, Math.round(b.size / 1024))} KB)
              </p>
            );
        }
      })}
    </>
  );
}

function Sheet({ children, footer, landscape, header }: { children: React.ReactNode; footer?: string; header?: string; landscape?: boolean }) {
  return (
    <div className={clsx('mx-auto mb-8 flex flex-col bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12),0_8px_24px_rgba(15,23,42,0.08)]', landscape ? 'max-w-[1123px]' : 'max-w-[794px]')}>
      {header && <div className="flex justify-between px-[64px] pt-6 text-[10px] text-slate-500">{header}</div>}
      <div className="flex-1 px-[64px] py-10 font-[Arial,Helvetica,sans-serif] text-[13px] leading-[1.55] text-slate-900">{children}</div>
      {footer && <div className="mx-[64px] border-t border-slate-300 py-3 text-[10px] text-slate-500">{footer}</div>}
    </div>
  );
}

export function DocumentPreview({ model, onNavigate }: { model: DocModel; onNavigate?: (anchor: string) => void }) {
  const c = model.cover;
  const go = (anchor: string) => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const header = `${c.title.length > 90 ? c.title.slice(0, 87) + '…' : c.title}    ${model.headerText}`;
  const missing = (v: string) => (v ? v : <mark className="bg-amber-100 italic text-orange-800">{model.draft ? '[Not entered]' : '—'}</mark>);

  return (
    <div className="relative">
      {model.draft && <div className="pointer-events-none sticky top-2 z-10 mx-auto mb-2 w-fit rounded-full bg-amber-500 px-3 py-0.5 text-xs font-bold tracking-widest text-white shadow">DRAFT PREVIEW</div>}
      <Sheet>
        <div className="min-h-[900px] pt-24">
          <div className="mb-5 text-[12px] font-bold tracking-[0.25em] text-slate-500">CLINICAL TRIAL PROTOCOL</div>
          <h1 className={clsx('mb-10 text-[26px] font-bold leading-tight text-[#12264a]', !c.title && 'bg-amber-100 italic text-orange-800')}>{c.title || '[Enter protocol title]'}</h1>
          <table className="w-full text-[13px]">
            <tbody>
              {[
                ['Protocol number', c.protocolNumber],
                ['Version', c.version],
                ['Protocol date', c.protocolDate],
                ...(c.amendmentNumber ? [['Amendment', `${c.amendmentNumber}${c.amendmentDate ? ` (${c.amendmentDate})` : ''}`]] : []),
                ['Sponsor', c.sponsorName],
                ['Clinical phase', c.phase],
                ['Therapeutic area', c.therapeuticArea],
                ['Indication', c.indication],
                ['Study design', c.studyDesign],
                ['Document status', c.status],
              ].map(([k, v]) => (
                <tr key={k} className="border-b border-slate-200">
                  <td className="w-48 py-2 font-semibold text-slate-600">{k}</td>
                  <td className="py-2">{missing(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-20 text-[11px] text-slate-500">
            CONFIDENTIAL: This document contains confidential information belonging to the sponsor. It may not be disclosed, reproduced or used without written permission of the sponsor.
          </p>
          <p className="mt-2 text-[10px] text-slate-400">
            Prepared with ProtocolIQ using the {c.templateName} (template v{c.templateVersion}).
          </p>
        </div>
      </Sheet>

      <Sheet header={header} footer={model.footerText}>
        <h2 className="mb-4 text-[15px] font-bold text-[#12264a]">TABLE OF CONTENTS</h2>
        <ul className="text-[12.5px]">
          <li>
            <button className="py-0.5 font-semibold hover:text-brand-700" onClick={() => go('doc-soa')}>
              SCHEDULE OF ACTIVITIES
            </button>
          </li>
          {model.toc.map((t) => (
            <li key={t.anchor} className={t.level === 1 ? 'mt-2' : 'pl-6'}>
              <button className={clsx('py-0.5 text-left hover:text-brand-700', t.level === 1 && 'font-semibold')} onClick={() => go(t.anchor)}>
                {t.number}
                {t.level === 1 ? '.' : ''}&nbsp;&nbsp;{t.title}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[10px] italic text-slate-400">Page numbers are applied in the paginated PDF and DOCX outputs.</p>
      </Sheet>

      <Sheet header={header} footer={model.footerText} landscape>
        <h2 id="doc-soa" className="mb-3 scroll-mt-28 text-[15px] font-bold text-[#12264a]">
          SCHEDULE OF ACTIVITIES
        </h2>
        {model.soa && model.soa.rows.length ? (
          <>
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  <th className="border border-slate-400 bg-[#e8edf5] px-1.5 py-1 text-left">Assessment / Procedure</th>
                  {model.soa.visits.map((v, i) => (
                    <th key={i} className="border border-slate-400 bg-[#e8edf5] px-1.5 py-1 text-center">
                      {v.name}
                      {v.markers && <sup className="ml-0.5 text-violet-700">{v.markers}</sup>}
                      {v.timing && <div className="font-normal text-slate-600">{v.timing}</div>}
                      {v.window && <div className="font-normal text-slate-500">{v.window}</div>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {model.soa.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="border border-slate-400 px-1.5 py-1">
                      {r.name || <mark className="bg-amber-100 italic">[Unnamed assessment]</mark>}
                      {r.markers && <sup className="ml-0.5 text-violet-700">{r.markers}</sup>}
                    </td>
                    {r.cells.map((c, j) => (
                      <td key={j} className={clsx('border border-slate-400 px-1.5 py-1 text-center', c === 'X' && 'font-bold')}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1.5 text-[11px] italic text-slate-500">X = required procedure; (X) = optional procedure.</p>
            {model.soa.footnotes.map((f, i) => (
              <p key={i} className="text-[11px]">
                <strong className="mr-1.5">{f.marker}</strong>
                {f.text}
              </p>
            ))}
          </>
        ) : (
          <p>
            <mark className="bg-amber-100 italic text-orange-800">{model.draft ? '[Schedule of Activities not yet defined]' : '[Not provided]'}</mark>
          </p>
        )}
      </Sheet>

      <Sheet header={header} footer={model.footerText}>
        <DocBlocks blocks={model.body} onHeadingClick={onNavigate} />
      </Sheet>
    </div>
  );
}
