// Minimal Markdown → DOM for samples/SOURCES.md: headings, paragraphs, tables, `code`, **bold** and links.
// Everything is built from text nodes, so file content is never interpreted as HTML.

const INLINE = /(\[[^\]]+\]\([^)\s]+\)|`[^`]+`|\*\*[^*]+\*\*)/;

/** resolveLink(href) → URL to use for a relative link, or null to render the link text only. */
export function renderMarkdown(md, resolveLink = () => null) {
  const frag = document.createDocumentFragment();
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let para = [];
  const flush = () => {
    if (para.length) frag.append(el('p', inline(para.join(' '), resolveLink)));
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const head = line.match(/^(#{1,3})\s+(.*)$/);
    if (!line) flush();
    else if (head) { flush(); frag.append(el(`h${head[1].length + 1}`, inline(head[2], resolveLink))); }
    else if (line.startsWith('|')) {
      flush();
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      i--;
      const body = rows.filter((r, ri) => ri !== 1 || !r.every((c) => /^:?-+:?$/.test(c)));
      const [header, ...rest] = body;
      frag.append(el('div', [el('table', [
        el('thead', [el('tr', header.map((c) => el('th', inline(c, resolveLink))))]),
        el('tbody', rest.map((r) => el('tr', r.map((c) => el('td', inline(c, resolveLink)))))),
      ])], 'md-table'));
    } else para.push(line);
  }
  flush();
  return frag;
}

function cells(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}

function inline(text, resolveLink) {
  return text.split(INLINE).filter(Boolean).map((part) => {
    if (part.startsWith('`') && part.endsWith('`')) return el('code', [part.slice(1, -1)]);
    if (part.startsWith('**') && part.endsWith('**')) return el('b', inline(part.slice(2, -2), resolveLink));
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      const href = /^https?:\/\//.test(link[2]) ? link[2] : resolveLink(link[2]);
      const label = inline(link[1], resolveLink);
      if (!href) return el('span', label);
      const a = el('a', label);
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      return a;
    }
    return part;
  });
}

function el(tag, children = [], className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  for (const c of children) e.append(c);
  return e;
}
