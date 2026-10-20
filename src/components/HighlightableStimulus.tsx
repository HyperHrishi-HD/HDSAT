import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';

export type HighlightColor = 'yellow' | 'blue' | 'pink';

export interface HighlightRecord {
  id: string;
  color: HighlightColor;
  text: string;
  note: string;
}

const COLORS: { color: HighlightColor; label: string }[] = [
  { color: 'yellow', label: 'Yellow highlight' },
  { color: 'blue', label: 'Blue highlight' },
  { color: 'pink', label: 'Pink highlight' },
];

// Layout effect in the browser (no flash of unmarked text), plain effect in
// static rendering used by tests.
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * The stimulus subtree must never be reconciled by React once it is mounted:
 * highlights split text nodes and wrap slices in <mark> elements, and any React
 * patch of that DOM would strand stale fragments (the "highlight corrupts every
 * question" bug). This memo bails out on EVERY prop change, so the only DOM
 * writers inside the surface are the highlight functions below. Question
 * changes remount the subtree wholesale via `key`, discarding old DOM entirely.
 */
const FrozenSurface = memo(
  function FrozenSurface({ children }: { children: ReactNode }) {
    return <>{children}</>;
  },
  () => true
);

const BLOCK_ANCESTOR_SELECTOR =
  'p, li, td, th, div.stimulus-text-heading, div.figure-caption';

function closestBlock(node: Node, root: HTMLElement): Element | null {
  const el =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!el || !root.contains(el)) return null;
  return el.closest(BLOCK_ANCESTOR_SELECTOR);
}

/**
 * KaTeX prints every formula twice: a hidden MathML copy for screen readers and
 * the visible spans. Only the visible copy may be mapped or wrapped, or every
 * offset shifts by the duplicated text.
 */
function isHiddenMathCopy(node: Node): boolean {
  const el =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return Boolean(el?.closest('.katex-mathml'));
}

interface TextMapEntry {
  node: Text;
  start: number;
  end: number;
}

/**
 * Flattens the surface into one string with block boundaries joined by a single
 * space, remembering which text node each character lives in.
 */
function buildTextMap(root: HTMLElement): { fullText: string; entries: TextMapEntry[] } {
  const entries: TextMapEntry[] = [];
  let fullText = '';
  let prevBlock: Element | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const raw = textNode.nodeValue ?? '';
    if (raw.length > 0 && !isHiddenMathCopy(textNode)) {
      const block = closestBlock(textNode, root);
      if (
        prevBlock &&
        block &&
        prevBlock !== block &&
        fullText.length > 0 &&
        !/\s$/.test(fullText)
      ) {
        fullText += ' ';
      }
      prevBlock = block ?? prevBlock;
      const start = fullText.length;
      fullText += raw;
      entries.push({ node: textNode, start, end: fullText.length });
    }
    current = walker.nextNode();
  }
  return { fullText, entries };
}

function collectTextSlicesInRange(
  root: HTMLElement,
  range: Range
): { node: Text; start: number; end: number }[] {
  const slices: { node: Text; start: number; end: number }[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    if (!isHiddenMathCopy(textNode) && range.intersectsNode(textNode)) {
      const length = textNode.nodeValue?.length ?? 0;
      const start = textNode === range.startContainer ? range.startOffset : 0;
      const end = textNode === range.endContainer ? range.endOffset : length;
      if (
        end > start &&
        (textNode.nodeValue?.slice(start, end).trim().length ?? 0) > 0
      ) {
        slices.push({ node: textNode, start, end });
      }
    }
    current = walker.nextNode();
  }
  return slices;
}

/**
 * Wraps ONE slice inside ONE text node. splitText only ever divides a text node
 * into adjacent text nodes — it can never move, extract or merge block
 * elements, so bullet lists and paragraphs keep their exact layout no matter
 * where a selection starts or ends.
 */
function wrapTextSlice(
  node: Text,
  start: number,
  end: number,
  record: HighlightRecord,
  isLastSlice: boolean
): void {
  let target = node;
  // splitText returns the NEW tail; the original node keeps the head. Split the
  // end first so `target` still starts at 0, then split the start so `target`
  // becomes exactly the [start, end) slice.
  if (end < (target.nodeValue?.length ?? 0)) target.splitText(end);
  if (start > 0) target = target.splitText(start);
  const mark = document.createElement('mark');
  mark.className = `bb-hl bb-hl-${record.color}`;
  mark.dataset.hlId = record.id;
  if (record.note.trim() && isLastSlice) {
    mark.dataset.hasNote = 'true';
  }
  target.parentNode?.replaceChild(mark, target);
  mark.appendChild(target);
}

function wrapRange(root: HTMLElement, range: Range, record: HighlightRecord): void {
  const slices = collectTextSlicesInRange(root, range);
  for (let i = slices.length - 1; i >= 0; i -= 1) {
    const { node, start, end } = slices[i];
    wrapTextSlice(node, start, end, record, i === slices.length - 1);
  }
}

function removeMarks(root: HTMLElement, hlId: string): void {
  root.querySelectorAll<HTMLElement>(`mark[data-hl-id="${hlId}"]`).forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
}

function clearMarks(root: HTMLElement) {
  root.querySelectorAll('mark.bb-hl').forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
}

/**
 * Re-applies one saved highlight on the (pristine) surface of a freshly mounted
 * question. Match exact text first, then fall back to whitespace-normalised
 * matching so multi-block selections (whose stored text contains line breaks)
 * still land on the right words.
 */
function restoreRecord(root: HTMLElement, record: HighlightRecord): void {
  const needle = record.text.replace(/\s+/g, ' ').trim();
  if (!needle) return;

  const { fullText, entries } = buildTextMap(root);
  let matchStart = fullText.indexOf(record.text);
  let matchEnd = matchStart >= 0 ? matchStart + record.text.length : -1;

  if (matchStart < 0) {
    // Whitespace-free comparison. Selection.toString() serialises the boundary
    // between two blocks differently per engine — Chrome inserts "\n", jsdom
    // inserts nothing — while this surface joins blocks with a single space.
    // Dropping all whitespace from both sides makes the comparison independent
    // of which separator was used, and the character map turns the match back
    // into exact offsets, so a saved highlight lands on the right words instead
    // of failing silently or being wrapped mid-word.
    const compactNeedle = needle.replace(/\s+/g, '');
    if (compactNeedle) {
      let compact = '';
      const origin: number[] = [];
      for (let i = 0; i < fullText.length; i += 1) {
        if (!/\s/.test(fullText[i])) {
          compact += fullText[i];
          origin.push(i);
        }
      }
      const hit = compact.indexOf(compactNeedle);
      if (hit >= 0) {
        matchStart = origin[hit];
        matchEnd = origin[hit + compactNeedle.length - 1] + 1;
      }
    }
  }
  if (matchStart < 0 || matchEnd <= matchStart) return;

  const slices = entries.filter((e) => e.end > matchStart && e.start < matchEnd);
  slices.forEach((slice, idx) => {
    const start = Math.max(matchStart, slice.start) - slice.start;
    const end = Math.min(matchEnd, slice.end) - slice.start;
    wrapTextSlice(slice.node, start, end, record, idx === slices.length - 1);
  });
}

interface SelectionState {
  x: number;
  y: number;
  text: string;
  range: Range;
}

/**
 * College Board style passage surface: select text to get the three highlight
 * colors, or add a note to a highlight. Highlights are stored per question by
 * the caller, so navigating away and back restores them.
 */
export function HighlightableStimulus({
  questionKey,
  records,
  onChange,
  children,
}: {
  questionKey: string;
  records: HighlightRecord[];
  onChange: (next: HighlightRecord[]) => void;
  children: ReactNode;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [editor, setEditor] = useState<{ id: string; x: number; y: number } | null>(null);
  const [draft, setDraft] = useState('');
  const [lastColor, setLastColor] = useState<HighlightColor>('yellow');

  // Restore saved highlights whenever the question mounts. The keyed subtree is
  // brand-new DOM at this point, so wrapping can never collide with React.
  useIsomorphicLayoutEffect(() => {
    const root = surfaceRef.current;
    if (!root) return;
    clearMarks(root);
    records.forEach((record) => restoreRecord(root, record));
    // records is intentionally read once per question switch: mid-question DOM
    // wrapping already reflects the current records.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionKey]);

  const readSelection = useCallback(() => {
    const root = surfaceRef.current;
    const current = window.getSelection();
    if (!root || !current || current.isCollapsed || current.rangeCount === 0) {
      setSelection(null);
      return;
    }
    const range = current.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) {
      setSelection(null);
      return;
    }
    const text = current.toString().trim();
    if (!text) {
      setSelection(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setSelection(null);
      return;
    }
    setSelection({
      x: rect.left + rect.width / 2,
      y: rect.top,
      text,
      range: range.cloneRange(),
    });
  }, []);

  const createHighlight = (color: HighlightColor, withNote: boolean) => {
    const root = surfaceRef.current;
    if (!selection || !root) return;

    // A selection that touches an existing highlight replaces it instead of
    // nesting <mark> elements (nested marks corrupt colours and deletion).
    const overlapped = new Set<string>();
    root.querySelectorAll<HTMLElement>('mark.bb-hl').forEach((mark) => {
      const id = mark.dataset.hlId;
      if (id && selection.range.intersectsNode(mark)) overlapped.add(id);
    });
    let nextRecords = records;
    if (overlapped.size > 0) {
      nextRecords = records.filter((record) => !overlapped.has(record.id));
      overlapped.forEach((id) => removeMarks(root, id));
    }

    const record: HighlightRecord = {
      id: `hl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      color,
      // Canonical single-space form: selection text carries whatever separators
      // the engine put between blocks, and those must not leak into saved data.
      text: selection.text.replace(/\s+/g, ' ').trim(),
      note: '',
    };
    wrapRange(root, selection.range, record);
    onChange([...nextRecords, record]);
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    setLastColor(color);
    if (withNote) {
      setEditor({ id: record.id, x: selection.x, y: selection.y });
      setDraft('');
    }
  };

  /** Recolour an existing highlight (College Board keeps the note with it). */
  const recolour = (id: string, color: HighlightColor) => {
    onChange(records.map((record) => (record.id === id ? { ...record, color } : record)));
    const marks = surfaceRef.current?.querySelectorAll<HTMLElement>(
      `mark[data-hl-id="${id}"]`
    );
    marks?.forEach((mark) => {
      mark.classList.remove('bb-hl-yellow', 'bb-hl-blue', 'bb-hl-pink');
      mark.classList.add(`bb-hl-${color}`);
    });
    setLastColor(color);
  };

  const openEditorFor = (id: string, x: number, y: number) => {
    const record = records.find((item) => item.id === id);
    if (!record) return;
    setEditor({ id, x, y });
    setDraft(record.note);
  };

  const saveNote = () => {
    if (!editor) return;
    onChange(
      records.map((record) =>
        record.id === editor.id ? { ...record, note: draft.trim() } : record
      )
    );
    const marks = surfaceRef.current?.querySelectorAll<HTMLElement>(
      `mark[data-hl-id="${editor.id}"]`
    );
    if (marks && marks.length > 0) {
      marks.forEach((mark, idx) => {
        if (draft.trim() && idx === marks.length - 1) mark.dataset.hasNote = 'true';
        else delete mark.dataset.hasNote;
      });
    }
    setEditor(null);
  };

  /** Removes the highlight entirely — the red ✕ in the editor header. */
  const deleteHighlight = () => {
    if (!editor) return;
    const root = surfaceRef.current;
    onChange(records.filter((record) => record.id !== editor.id));
    if (root) removeMarks(root, editor.id);
    setEditor(null);
  };

  const handleSurfaceClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('mark.bb-hl');
    if (!target) return;
    const id = target.dataset.hlId;
    if (!id) return;
    openEditorFor(id, event.clientX, event.clientY);
  };

  return (
    <div
      className="hl-surface"
      onMouseUp={readSelection}
      onKeyUp={readSelection}
      onClick={handleSurfaceClick}
    >
      {/* key remounts the whole subtree per question: stale highlight DOM can
          never leak from one question into the next. */}
      <div key={questionKey} ref={surfaceRef} className="hl-surface-content">
        <FrozenSurface>{children}</FrozenSurface>
      </div>

      {selection ? (
        <div
          className="hl-toolbar"
          style={{
            left: Math.min(window.innerWidth - 130, Math.max(130, selection.x)),
            top: Math.max(8, selection.y - 46),
          }}
          role="toolbar"
          aria-label="Highlight selection"
          onMouseDown={(e) => e.preventDefault()}
        >
          {COLORS.map((item) => (
            <button
              key={item.color}
              type="button"
              className={`hl-swatch hl-swatch-${item.color}`}
              title={item.label}
              aria-label={item.label}
              onClick={() => createHighlight(item.color, false)}
            />
          ))}
          <button
            type="button"
            className="hl-note-btn"
            title="Highlight and add a note"
            onClick={() => createHighlight(lastColor, true)}
          >
            ✎ Note
          </button>
        </div>
      ) : null}

      {editor ? (
        <div
          className="hl-note-editor"
          style={{ left: Math.min(window.innerWidth - 300, Math.max(12, editor.x - 136)), top: editor.y + 22 }}
          role="dialog"
          aria-label="Highlight and note"
        >
          <div className="hl-note-head">
            <strong>Highlight</strong>
            <span className="hl-note-head-actions">
              <button
                type="button"
                className="hl-note-remove-x"
                onClick={deleteHighlight}
                aria-label="Remove this highlight"
                title="Remove this highlight"
              >
                ✕
              </button>
              <button type="button" onClick={() => setEditor(null)} aria-label="Close note">
                ✕
              </button>
            </span>
          </div>

          <div className="hl-editor-colors" role="group" aria-label="Highlight colour">
            {COLORS.map((item) => {
              const active = records.find((record) => record.id === editor.id)?.color === item.color;
              return (
                <button
                  key={item.color}
                  type="button"
                  className={`hl-swatch hl-swatch-${item.color}${active ? ' is-active' : ''}`}
                  title={item.label}
                  aria-label={item.label}
                  aria-pressed={active}
                  onClick={() => recolour(editor.id, item.color)}
                />
              );
            })}
            <span className="hl-editor-colors-label">Highlight colour</span>
          </div>

          <textarea
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a note about this line (optional)"
            autoFocus
          />
          <div className="hl-note-actions">
            <button type="button" className="hl-note-delete" onClick={deleteHighlight}>
              Remove highlight
            </button>
            <button type="button" className="hl-note-save" onClick={saveNote}>
              Save
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
