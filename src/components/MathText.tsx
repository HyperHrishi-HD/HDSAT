import katex from 'katex';
import { useMemo } from 'react';

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

/** Render text containing $inline$ and $$display$$ LaTeX plus line breaks. */
export function MathText({ text, className }: { text: string; className?: string }) {
  const nodes = useMemo(() => {
    if (!text) return [];
    const parts: React.ReactNode[] = [];
    const pattern = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let key = 0;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(...splitLines(text.slice(lastIndex, match.index), key));
        key += 10;
      }
      if (match[1] !== undefined) {
        parts.push(renderLatex(match[1], true, key));
      } else if (match[2] !== undefined) {
        parts.push(renderLatex(match[2], false, key));
      }
      key += 1;
      lastIndex = pattern.lastIndex;
    }
    if (lastIndex < text.length) {
      parts.push(...splitLines(text.slice(lastIndex), key));
    }
    return parts;
  }, [text]);

  return <span className={className}>{nodes}</span>;
}

function splitLines(chunk: string, keyBase: number): React.ReactNode[] {
  return chunk.split('\n').flatMap((line, index) => {
    const nodes: React.ReactNode[] = [];
    if (index > 0) nodes.push(<br key={`br-${keyBase}-${index}`} />);
    if (line) nodes.push(<span key={`t-${keyBase}-${index}`}>{line}</span>);
    return nodes;
  });
}
