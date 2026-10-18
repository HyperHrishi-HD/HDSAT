import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';

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

function clearMarks(root: HTMLElement) {
  root.querySelectorAll('mark.bb-hl').forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
}

function wrapRange(range: Range, record: HighlightRecord): void {
  const mark = document.createElement('mark');
  mark.className = `bb-hl bb-hl-${record.color}`;
  mark.dataset.hlId = record.id;
  if (record.note.trim()) mark.dataset.hasNote = 'true';
  try {
    range.surroundContents(mark);
  } catch {
    // A selection that spans several elements cannot be surrounded directly.
    const fragment = range.extractContents();
    mark.appendChild(fragment);
    range.insertNode(mark);
  }
}

function wrapFirstMatch(root: HTMLElement, record: HighlightRecord): void {
  const needle = record.text;
  if (!needle) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const value = node.nodeValue ?? '';
    const at = value.indexOf(needle);
    if (at >= 0) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      wrapRange(range, record);
      return;
    }
    node = walker.nextNode();
  }
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

  // Restore saved highlights whenever the question changes.
  useEffect(() => {
    const root = surfaceRef.current;
    if (!root) return;
    clearMarks(root);
    records.forEach((record) => wrapFirstMatch(root, record));
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
    if (!selection) return;
    const record: HighlightRecord = {
      id: `hl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      color,
      text: selection.text,
      note: '',
    };
    wrapRange(selection.range, record);
    onChange([...records, record]);
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
    const mark = surfaceRef.current?.querySelector<HTMLElement>(`mark[data-hl-id="${id}"]`);
    if (mark) {
      mark.classList.remove('bb-hl-yellow', 'bb-hl-blue', 'bb-hl-pink');
      mark.classList.add(`bb-hl-${color}`);
    }
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
    const mark = surfaceRef.current?.querySelector<HTMLElement>(
      `mark[data-hl-id="${editor.id}"]`
    );
    if (mark) {
      if (draft.trim()) mark.dataset.hasNote = 'true';
      else delete mark.dataset.hasNote;
    }
    setEditor(null);
  };

  const deleteHighlight = () => {
    if (!editor) return;
    onChange(records.filter((record) => record.id !== editor.id));
    const mark = surfaceRef.current?.querySelector<HTMLElement>(
      `mark[data-hl-id="${editor.id}"]`
    );
    if (mark?.parentNode) {
      const parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    }
    setEditor(null);
  };

  const handleSurfaceClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!target.matches('mark.bb-hl')) return;
    const id = target.dataset.hlId;
    if (!id) return;
    openEditorFor(id, event.clientX, event.clientY);
  };

  return (
    <div
      className="hl-surface"
      ref={surfaceRef}
      onMouseUp={readSelection}
      onKeyUp={readSelection}
      onClick={handleSurfaceClick}
    >
      {children}

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
            <button type="button" onClick={() => setEditor(null)} aria-label="Close note">
              ✕
            </button>
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
