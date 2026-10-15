import { jsx as _jsx } from "react/jsx-runtime";
import katex from 'katex';
import { useMemo } from 'react';
function renderLatex(latex, displayMode, index) {
    try {
        return (_jsx("span", { dangerouslySetInnerHTML: {
                __html: katex.renderToString(latex, {
                    throwOnError: false,
                    displayMode,
                    output: 'html',
                }),
            } }, index));
    }
    catch {
        return _jsx("span", { children: latex }, index);
    }
}
/** Render text containing $inline$ and $$display$$ LaTeX plus line breaks. */
export function MathText({ text, className }) {
    const nodes = useMemo(() => {
        if (!text)
            return [];
        const parts = [];
        const pattern = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
        let lastIndex = 0;
        let match;
        let key = 0;
        while ((match = pattern.exec(text)) !== null) {
            if (match.index > lastIndex) {
                parts.push(...splitLines(text.slice(lastIndex, match.index), key));
                key += 10;
            }
            if (match[1] !== undefined) {
                parts.push(renderLatex(match[1], true, key));
            }
            else if (match[2] !== undefined) {
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
    return _jsx("span", { className: className, children: nodes });
}
function splitLines(chunk, keyBase) {
    return chunk.split('\n').flatMap((line, index) => {
        const nodes = [];
        if (index > 0)
            nodes.push(_jsx("br", {}, `br-${keyBase}-${index}`));
        if (line)
            nodes.push(_jsx("span", { children: line }, `t-${keyBase}-${index}`));
        return nodes;
    });
}
