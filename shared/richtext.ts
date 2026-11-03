// Minimal, dependency-free rich text handling shared by browser and server.
// Only a small allow-list is kept: paragraphs, line breaks, bold, italic, underline and lists.

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export type RtBlock = { kind: 'p'; runs: Run[] } | { kind: 'list'; ordered: boolean; items: Run[][] };

const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'tr', 'table']);
const SKIP_CONTENT = new Set(['script', 'style', 'head', 'title']);

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function parseRichText(html: string): RtBlock[] {
  const blocks: RtBlock[] = [];
  let runs: Run[] = [];
  let bold = 0;
  let italic = 0;
  let underline = 0;
  let skip = 0;
  const listStack: { ordered: boolean; items: Run[][] }[] = [];
  let inItem = false;

  const flushParagraph = () => {
    const trimmed = trimRuns(runs);
    if (trimmed.length) {
      if (listStack.length && inItem) {
        listStack[listStack.length - 1].items.push(trimmed);
      } else {
        blocks.push({ kind: 'p', runs: trimmed });
      }
    }
    runs = [];
  };

  const re = /<(\/?)([a-zA-Z0-9]+)\b[^>]*?(\/?)>|<!--[\s\S]*?-->|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const [, closing, rawTag, , text] = m;
    if (text !== undefined) {
      if (skip) continue;
      const t = decodeEntities(text.replace(/\s+/g, ' '));
      if (t) runs.push({ text: t, bold: bold > 0 || undefined, italic: italic > 0 || undefined, underline: underline > 0 || undefined });
      continue;
    }
    if (!rawTag) continue;
    const tag = rawTag.toLowerCase();
    if (SKIP_CONTENT.has(tag)) {
      skip += closing ? -1 : 1;
      if (skip < 0) skip = 0;
      continue;
    }
    if (skip) continue;
    switch (tag) {
      case 'b':
      case 'strong':
        bold += closing ? -1 : 1;
        break;
      case 'i':
      case 'em':
        italic += closing ? -1 : 1;
        break;
      case 'u':
        underline += closing ? -1 : 1;
        break;
      case 'br':
        runs.push({ text: '\n' });
        break;
      case 'ul':
      case 'ol':
        if (!closing) {
          flushParagraph();
          listStack.push({ ordered: tag === 'ol', items: [] });
          inItem = false;
        } else {
          flushParagraph();
          const list = listStack.pop();
          if (list && list.items.length) {
            if (listStack.length) listStack[listStack.length - 1].items.push(...list.items);
            else blocks.push({ kind: 'list', ordered: list.ordered, items: list.items });
          }
          inItem = listStack.length > 0;
        }
        break;
      case 'li':
        flushParagraph();
        inItem = !closing || listStack.length > 0;
        break;
      default:
        if (BLOCK_TAGS.has(tag)) flushParagraph();
        else if (tag === 'td' || tag === 'th') runs.push({ text: ' ' });
    }
    if (bold < 0) bold = 0;
    if (italic < 0) italic = 0;
    if (underline < 0) underline = 0;
  }
  flushParagraph();
  while (listStack.length) {
    const list = listStack.pop()!;
    if (list.items.length) blocks.push({ kind: 'list', ordered: list.ordered, items: list.items });
  }
  return blocks;
}

function trimRuns(runs: Run[]): Run[] {
  const out = runs.map((r) => ({ ...r }));
  while (out.length && !out[0].text.trim()) out.shift();
  while (out.length && !out[out.length - 1].text.trim()) out.pop();
  if (out.length) {
    out[0].text = out[0].text.replace(/^[ \t]+/, '');
    out[out.length - 1].text = out[out.length - 1].text.replace(/[ \t]+$/, '');
  }
  return out;
}

function runsToHtml(runs: Run[]): string {
  return runs
    .map((r) => {
      if (r.text === '\n') return '<br>';
      let s = escapeHtml(r.text);
      if (r.underline) s = `<u>${s}</u>`;
      if (r.italic) s = `<em>${s}</em>`;
      if (r.bold) s = `<strong>${s}</strong>`;
      return s;
    })
    .join('');
}

export function blocksToHtml(blocks: RtBlock[]): string {
  return blocks
    .map((b) =>
      b.kind === 'p'
        ? `<p>${runsToHtml(b.runs)}</p>`
        : `<${b.ordered ? 'ol' : 'ul'}>${b.items.map((i) => `<li>${runsToHtml(i)}</li>`).join('')}</${b.ordered ? 'ol' : 'ul'}>`,
    )
    .join('');
}

export function sanitizeRichText(html: string): string {
  if (!html) return '';
  return blocksToHtml(parseRichText(html));
}

export function richTextToPlain(html: string): string {
  return parseRichText(html || '')
    .map((b) => (b.kind === 'p' ? b.runs.map((r) => r.text).join('') : b.items.map((i) => '• ' + i.map((r) => r.text).join('')).join('\n')))
    .join('\n')
    .trim();
}

export function plainToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}
