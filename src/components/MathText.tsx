import katex from 'katex';
import { useMemo } from 'react';

export type RichTextToken =
  | { type: 'text'; value: string }
  | { type: 'math'; value: string; display: boolean };

const LATEX_HINT = /[\\^_{}=+\-*/<>()[\]|]/;

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
            output: 'html',
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

  return <span className={className}>{nodes}</span>;
}
