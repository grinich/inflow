import type { ReactNode } from 'react';

/**
 * A tiny, dependency-free Markdown renderer for AI output.
 *
 * It handles the subset models actually emit — bold, italic, inline code,
 * links, bulleted/numbered lists, and headings — by parsing into React elements
 * (never `dangerouslySetInnerHTML`), so it's safe under the extension's strict
 * CSP and adds no bundle weight. Unknown syntax falls through as plain text.
 */

/** Parse inline spans (bold, italic, code, links) within a single line. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let k = 0;
  const patterns: { re: RegExp; node: (m: RegExpMatchArray) => ReactNode }[] = [
    { re: /\*\*([^*]+)\*\*/, node: (m) => <strong key={keyPrefix + k++}>{m[1]}</strong> },
    { re: /__([^_]+)__/, node: (m) => <strong key={keyPrefix + k++}>{m[1]}</strong> },
    {
      re: /`([^`]+)`/,
      node: (m) => (
        <code key={keyPrefix + k++} className="rounded bg-surface-input px-1 py-0.5 font-mono text-[0.85em]">
          {m[1]}
        </code>
      ),
    },
    {
      re: /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/,
      node: (m) => (
        <a
          key={keyPrefix + k++}
          href={m[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 underline hover:text-blue-300"
        >
          {m[1]}
        </a>
      ),
    },
    { re: /(?<![*_\w])[*_]([^*_\n]+)[*_](?![*_\w])/, node: (m) => <em key={keyPrefix + k++}>{m[1]}</em> },
  ];

  while (rest) {
    let best: { idx: number; len: number; node: ReactNode } | null = null;
    for (const p of patterns) {
      const m = rest.match(p.re);
      if (m && m.index != null && (!best || m.index < best.idx)) {
        best = { idx: m.index, len: m[0].length, node: p.node(m) };
      }
    }
    if (!best) {
      out.push(rest);
      break;
    }
    if (best.idx > 0) out.push(rest.slice(0, best.idx));
    out.push(best.node);
    rest = rest.slice(best.idx + best.len);
  }
  return out;
}

const BULLET_RE = /^\s*[-*]\s+/;
const NUMBER_RE = /^\s*\d+\.\s+/;
const HEADING_RE = /^(#{1,3})\s+(.*)$/;

export function Markdown({ text, className }: { text: string; className?: string }) {
  const src = (text || '').replace(/\r\n/g, '\n');
  if (!src.trim()) return null;

  const lines = src.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let b = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const h = line.match(HEADING_RE);
    if (h) {
      const level = h[1].length;
      const cls = level === 1 ? 'text-base font-semibold' : level === 2 ? 'text-sm font-semibold' : 'text-sm font-medium';
      blocks.push(
        <p key={b} className={`${cls} text-fg-strong`}>{renderInline(h[2], `h${b++}-`)}</p>,
      );
      i++; // advance past the heading line (missing this looped forever)
      continue;
    }

    if (BULLET_RE.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && BULLET_RE.test(lines[i])) {
        items.push(<li key={items.length}>{renderInline(lines[i].replace(BULLET_RE, ''), `ul${b}-${items.length}-`)}</li>);
        i++;
      }
      blocks.push(<ul key={b++} className="list-disc space-y-0.5 pl-5">{items}</ul>);
      continue;
    }

    if (NUMBER_RE.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && NUMBER_RE.test(lines[i])) {
        items.push(<li key={items.length}>{renderInline(lines[i].replace(NUMBER_RE, ''), `ol${b}-${items.length}-`)}</li>);
        i++;
      }
      blocks.push(<ol key={b++} className="list-decimal space-y-0.5 pl-5">{items}</ol>);
      continue;
    }

    // Paragraph: gather consecutive plain lines.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !BULLET_RE.test(lines[i]) &&
      !NUMBER_RE.test(lines[i]) &&
      !HEADING_RE.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={b++} className="leading-relaxed">
        {para.map((l, idx) => (
          <span key={idx}>
            {idx > 0 && <br />}
            {renderInline(l, `p${b}-${idx}-`)}
          </span>
        ))}
      </p>,
    );
  }

  return <div className={`space-y-2 ${className || ''}`}>{blocks}</div>;
}
