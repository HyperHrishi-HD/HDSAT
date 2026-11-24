import katex from 'katex';
import { useMemo } from 'react';
import { hasHtmlMarkup } from '../lib/questionSources';

export type RichTextToken =
  | { type: 'text'; value: string }
  | { type: 'math'; value: string; display: boolean };

const LATEX_HINT = /[\\^_{}=+\-*/<>()[\]|]/;

/**
 * College Board payloads are trusted official content, but they are still
 * remote HTML. Remove executable/embedded content while keeping the semantic
 * MathML, SVG, tables and figure markup the questions need.
 */
export function sanitizeHtml(value: string): string {
  let out = value;
  // Paired dangerous elements, including their contents.
  out = out.replace(
    /<\s*(script|style|iframe|object|embed|link|meta|base|form|textarea|select|button)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
    ''
  );
  // Self-closing or unpaired dangerous elements.
  out = out.replace(
    /<\s*(script|style|iframe|object|embed|link|meta|base|form|textarea|select|button)\b[^>]*\/?\s*>/gi,
    ''
  );
  // Inline event handlers and dangerous CSS URLs.
  out = out.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  out = out.replace(/\s+style\s*=\s*(["'])(.*?)\1/gi, (match: string, _quote: string, css: string) =>
    /(?:url|expression|javascript|@import)\s*\(/i.test(css) ? '' : match
  );
  out = out.replace(/\s+srcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  out = out.replace(
    /(\s(?:href|src|xlink:href)\s*=\s*["'])\s*(?:javascript|data:text\/html)[^"']*(["'])/gi,
    '$1#$2'
  );
  return out;
}

function isHtml(value: string): boolean {
  return hasHtmlMarkup(value);
}

/**
 * Currency amounts are written as a bare `$` before a number ("$80"), while
 * mathematics is delimited with `$...$` ("$480$"). A candidate segment that
 * holds ordinary prose rather than an expression is therefore a price, not
 * LaTeX, and its opening dollar sign must stay literal.
 */
function isCurrencySegment(content: string): boolean {
  return /\s/.test(content) && /[A-Za-z]/.test(content) && !LATEX_HINT.test(content);
}

function findClosingDollar(text: string, from: number): number {
  for (let i = from; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\\' && text[i + 1] === '$') {
      i += 1;
      continue;
    }
    if (char === '\n') return -1;
    if (char === '$') return i;
  }
  return -1;
}

/**
 * Split mixed prose/LaTeX into renderable tokens.
 * Handles `$$display$$`, `$inline$`, escaped `\$`, and currency amounts such as
 * "$80" or "$40 by 25$\%$" that would otherwise be swallowed as bad LaTeX.
 */
export function parseRichText(text: string): RichTextToken[] {
  const tokens: RichTextToken[] = [];
  let buffer = '';
  let i = 0;

  const flush = () => {
    if (buffer) {
      tokens.push({ type: 'text', value: buffer });
      buffer = '';
    }
  };

  while (i < text.length) {
    const char = text[i];

    if (char === '\\' && text[i + 1] === '$') {
      buffer += '$';
      i += 2;
      continue;
    }

    if (char === '$' && text[i + 1] === '$') {
      const close = text.indexOf('$$', i + 2);
      if (close === -1) {
        buffer += '$$';
        i += 2;
        continue;
      }
      flush();
      tokens.push({ type: 'math', value: text.slice(i + 2, close), display: true });
      i = close + 2;
      continue;
    }

    if (char === '$') {
      const close = findClosingDollar(text, i + 1);
      if (close === -1) {
        buffer += '$';
        i += 1;
        continue;
      }
      const content = text.slice(i + 1, close);
      if (!content.trim() || isCurrencySegment(content)) {
        buffer += '$';
        i += 1;
        continue;
      }
      flush();
      tokens.push({ type: 'math', value: content, display: false });
      i = close + 1;
      continue;
    }

    buffer += char;
    i += 1;
  }

  flush();
  return tokens;
}

function renderLatex(latex: string, displayMode: boolean, index: number) {
  try {
    return (
      <span
        key={index}
        dangerouslySetInnerHTML={{
          __html: katex.renderToString(latex, {
            throwOnError: false,
            displayMode,
            // The MathML half is visually hidden by katex.css and is what a
            // screen reader reads; the HTML half alone is aria-hidden.
            output: 'htmlAndMathml',
          }),
        }}
      />
    );
  } catch {
    return <span key={index}>{latex}</span>;
  }
}

function splitLines(chunk: string, keyBase: number): React.ReactNode[] {
  return chunk.split('\n').flatMap((line, index) => {
    const nodes: React.ReactNode[] = [];
    if (index > 0) nodes.push(<br key={`br-${keyBase}-${index}`} />);
    if (line) nodes.push(<span key={`t-${keyBase}-${index}`}>{line}</span>);
    return nodes;
  });
}

/** Render text containing $inline$ and $$display$$ LaTeX plus line breaks. */
export function MathText({ text, className }: { text: string; className?: string }) {
  const nodes = useMemo(() => {
    if (!text) return [];
    const parts: React.ReactNode[] = [];
    parseRichText(text).forEach((token, index) => {
      if (token.type === 'math') {
        parts.push(renderLatex(token.value, token.display, index));
      } else {
        parts.push(...splitLines(token.value, index * 100));
      }
    });
    return parts;
  }, [text]);

  if (isHtml(text)) {
    return (
      <span
        className={`rich-html${className ? ` ${className}` : ''}`}
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(text) }}
      />
    );
  }

  return <span className={className}>{nodes}</span>;
}
