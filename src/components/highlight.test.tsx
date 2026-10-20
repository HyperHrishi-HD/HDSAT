// @vitest-environment jsdom
/**
 * Regression tests for the bullet-list highlight corruption.
 *
 * The bug being pinned: highlighting a selection that spans two bulleted notes
 * rewrote the list so a bullet's text was cut mid-word and the tail became its
 * own separate line, and later visits showed text spliced in from other
 * questions. Root causes were DOM-level: a range that extracted block elements
 * instead of splitting text nodes, and a stimulus subtree that React kept
 * patching after highlighting had split its text nodes.
 *
 * These tests drive the real component with real DOM ranges and assert that
 * every `<li>` keeps its exact number, order and text through highlight,
 * navigation and restore.
 */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HighlightableStimulus, type HighlightRecord } from './HighlightableStimulus';

// React 18 only flushes effects synchronously inside act() when it can tell it
// is running in a test environment.
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { StimulusView } from './FigureView';

const NOTES_A = [
  'While researching bioluminescent dinoflagellate defense mechanisms (study note set 8), a student has taken the following notes:',
  '• Lingulodinium polyedra is a marine dinoflagellate species that emits brief blue light flashes when mechanically agitated.',
  '• Laboratory shear-flow experiments show that a single cell flash lasts approximately 100 milliseconds at 475 nanometers wavelength.',
  '• When grazing copepods disturb the water, the resulting flashes startle the copepods and reduce their feeding rates by 55%.',
  '• The flashes also illuminate the copepods, making them visible to nocturnal predatory fish from up to two meters away.',
  '• Cultures kept under constant light lose their circadian bioluminescence rhythm within four days.',
].join('\n');

const NOTES_B = [
  'While researching the 1956 Stockholm urban tramway conversion (study note set 4), a student has taken the following notes:',
  '• In 1956, transit planners in Stockholm evaluated replacing central streetcar lines with underground metro tunnels.',
  '• Surface streetcars averaged 14 km/h in mixed downtown traffic during peak winter months.',
  '• The newly excavated Tunnelbana metro lines achieved an average commercial speed of 36 km/h.',
  '• Converting the central corridor reduced cross-city commute times by 42% within the first year of operation.',
].join('\n');

type Controls = {
  setQuestion: (key: string, stimulus: string) => void;
  records: Record<string, HighlightRecord[]>;
};

function Harness({ controls }: { controls: Controls }) {
  const [question, setQuestion] = useState({ key: 'q1', stimulus: NOTES_A });
  const [records, setRecords] = useState<Record<string, HighlightRecord[]>>({});
  controls.setQuestion = (key, stimulus) => setQuestion({ key, stimulus });
  controls.records = records;
  return (
    <HighlightableStimulus
      questionKey={question.key}
      records={records[question.key] ?? []}
      onChange={(next) => setRecords((prev) => ({ ...prev, [question.key]: next }))}
    >
      <div className="bb-stimulus-text">
        <StimulusView stimulus={question.stimulus} />
      </div>
    </HighlightableStimulus>
  );
}

let container: HTMLDivElement;
let root: Root;
let controls: Controls;

const surface = () => document.querySelector('.hl-surface-content') as HTMLElement;
const listItems = () => [...surface().querySelectorAll('li')].map((li) => li.textContent ?? '');
const marks = () => [...surface().querySelectorAll<HTMLElement>('mark.bb-hl')];

function firstTextNode(el: Node): Text {
  if (el.nodeType === Node.TEXT_NODE) return el as Text;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode();
  if (!node) throw new Error('no text node');
  return node as Text;
}

/** Selects from inside one bullet to inside another, like a real mouse drag. */
function selectAcrossBullets(startIndex: number, startChars: number, endIndex: number, endChars: number) {
  const items = surface().querySelectorAll('li');
  const startNode = firstTextNode(items[startIndex]);
  const endNode = firstTextNode(items[endIndex]);
  const range = document.createRange();
  range.setStart(startNode, startChars);
  range.setEnd(endNode, endChars);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  act(() => {
    items[startIndex].dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
}

function click(selector: string) {
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) throw new Error(`missing ${selector}`);
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function render() {
  act(() => {
    root.render(<Harness controls={controls} />);
  });
}

beforeEach(() => {
  controls = { setQuestion: () => {}, records: {} };
  // jsdom lays nothing out, so give ranges a non-zero box or the toolbar is
  // suppressed as an empty selection.
  Range.prototype.getBoundingClientRect = () =>
    ({ left: 120, top: 200, width: 240, height: 22, right: 360, bottom: 222, x: 120, y: 200 }) as DOMRect;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  render();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.getSelection()?.removeAllRanges();
});

describe('highlighting across bulleted notes', () => {
  it('wraps the selection without changing the bullets', () => {
    const before = listItems();
    expect(before).toHaveLength(5);

    selectAcrossBullets(1, 4, 2, 40);
    click('.hl-swatch-yellow');

    // Same bullets, same order, same words — only <mark> wrappers were added.
    expect(listItems()).toEqual(before);
    expect(surface().querySelectorAll('li')).toHaveLength(5);
    expect(marks().length).toBeGreaterThanOrEqual(2);
    // The selection started mid-word ("Lab|oratory") and must not leave a
    // fragment as its own bullet.
    expect(listItems()[1].startsWith('Laboratory shear-flow experiments')).toBe(true);
    expect(surface().textContent).toContain('Lingulodinium polyedra');
  });

  it('keeps bullets intact and restores highlights after leaving and returning', () => {
    const pristine = listItems();
    selectAcrossBullets(1, 4, 2, 40);
    click('.hl-swatch-yellow');
    const highlighted = listItems();
    const markCount = marks().length;
    expect(markCount).toBeGreaterThanOrEqual(2);

    for (let i = 0; i < 6; i += 1) {
      act(() => controls.setQuestion('q2', NOTES_B));
      expect(listItems()).toHaveLength(4);
      expect(marks()).toHaveLength(0);
      expect(listItems()[1].startsWith('Surface streetcars averaged')).toBe(true);

      act(() => controls.setQuestion('q1', NOTES_A));
      expect(listItems()).toEqual(pristine);
      expect(listItems()).toEqual(highlighted);
      expect(marks()).toHaveLength(markCount);
    }
  });

  it('never leaks one question\'s notes into another', () => {
    selectAcrossBullets(1, 4, 3, 30);
    click('.hl-swatch-blue');

    act(() => controls.setQuestion('q2', NOTES_B));
    const stockholm = listItems();
    expect(stockholm).toHaveLength(4);
    expect(surface().textContent).not.toContain('Lingulodinium');
    expect(stockholm.join(' ')).not.toMatch(/\b(?:ry shear-fl|n selected|s by 55%)/);

    act(() => controls.setQuestion('q1', NOTES_A));
    expect(surface().textContent).not.toContain('Stockholm');
    expect(surface().textContent).not.toContain('Tunnelbana');
  });

  it('removes only its own highlight and returns the pristine text', () => {
    const pristine = listItems();
    selectAcrossBullets(1, 4, 2, 40);
    click('.hl-swatch-yellow');
    const id = marks()[0].dataset.hlId!;

    act(() => {
      marks()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    click('.hl-note-delete');

    expect(marks()).toHaveLength(0);
    expect(listItems()).toEqual(pristine);
    expect(controls.records.q1 ?? []).not.toContainEqual(expect.objectContaining({ id }));
  });
});
