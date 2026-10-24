// @vitest-environment jsdom
/**
 * Bluebook cross-out in practice.
 *
 * The runner keeps each option's strike control visible and toggles a
 * line-through. Picking a crossed-out option must select it and lift the
 * cross-out in one click — never be refused, and never require an Undo first.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bankJson from '../data/questionBank.json';
import type { Question, QuestionBank } from '../lib/types';
import { QuestionView } from './QuestionView';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../lib/store', () => ({
  useApp: () => ({ cloudConfigured: false, user: null }),
}));

const bank = bankJson as unknown as QuestionBank;
const question = bank.questions.find(
  (item) => item.format === 'multiple_choice' && item.choices?.length === 4
) as Question;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderView(eliminated: string[], handlers: {
  onResponseChange: (id: string) => void;
  onToggleEliminate: (id: string) => void;
}) {
  act(() => {
    root.render(
      <QuestionView
        question={question}
        index={0}
        response={null}
        onResponseChange={handlers.onResponseChange}
        eliminated={eliminated}
        onToggleEliminate={handlers.onToggleEliminate}
        feedback={null}
      />
    );
  });
}

describe('practice cross-out', () => {
  it('keeps a strike control on every option', () => {
    renderView([], { onResponseChange: () => {}, onToggleEliminate: () => {} });
    const buttons = container.querySelectorAll('.choice-eliminate');
    expect(buttons).toHaveLength(question.choices?.length ?? 0);
    expect(container.innerHTML).not.toContain('is-eliminated');
  });

  it('marks a crossed-out option with a line-through wrapper, not a faded row', () => {
    renderView([question.choices![0].id], {
      onResponseChange: () => {},
      onToggleEliminate: () => {},
    });
    const row = container.querySelector('li.is-eliminated');
    expect(row).not.toBeNull();
    expect(row?.querySelector('.choice-text')).not.toBeNull();
    expect(row?.querySelector('.choice-eliminate.is-on')).not.toBeNull();
  });

  it('selects a crossed-out option and lifts the cross-out instead of refusing', () => {
    const chosen = question.choices![1].id;
    const onResponseChange = vi.fn();
    const onToggleEliminate = vi.fn();
    renderView([chosen], { onResponseChange, onToggleEliminate });

    const main = container.querySelectorAll<HTMLButtonElement>('.choice-main')[1];
    act(() => main.click());

    expect(onResponseChange).toHaveBeenCalledWith(chosen);
    expect(onToggleEliminate).toHaveBeenCalledWith(chosen);
  });

  it('does not lift a cross-out when picking a clean option', () => {
    const onResponseChange = vi.fn();
    const onToggleEliminate = vi.fn();
    renderView([question.choices![3].id], { onResponseChange, onToggleEliminate });

    const main = container.querySelectorAll<HTMLButtonElement>('.choice-main')[0];
    act(() => main.click());

    expect(onResponseChange).toHaveBeenCalledWith(question.choices![0].id);
    expect(onToggleEliminate).not.toHaveBeenCalled();
  });
});
