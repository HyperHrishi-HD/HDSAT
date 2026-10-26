// @vitest-environment jsdom
/**
 * The vault's rune panel has to behave like the rest of the workspace: a Math
 * rune can pull up Desmos and the reference sheet, a Reading rune cannot, and
 * neither is open until the student asks for it. These tests drive the panel
 * directly, because the game loop that normally opens it needs a real canvas.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuneQuestionCard } from './RuneQuestionCard';
import type { RuneItem } from '../lib/arcadeGames';
import type { Question } from '../lib/types';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../lib/store', () => ({
  useApp: () => ({ cloudConfigured: false, user: null }),
}));

const base: Question = {
  id: 'q-1',
  external_id: null,
  assessments: ['SAT'],
  section: 'Math',
  domain: 'Algebra',
  skill: 'Linear equations in one variable',
  difficulty: 'Medium',
  format: 'multiple_choice',
  stimulus: null,
  prompt: 'If 3x + 5 = 20, what is x?',
  choices: [
    { id: 'A', text: '3' },
    { id: 'B', text: '5' },
    { id: 'C', text: '8' },
    { id: 'D', text: '15' },
  ],
  figure_metadata: null,
  source_id: 'src',
  source_name: 'Public domain set',
  license: 'CC0',
  attribution: '',
  is_released_practice_set: false,
  correct_answer: 'B',
  acceptable_answers: [],
  explanation: 'Subtract 5, then divide by 3.',
  distractor_rationales: {},
};

function item(overrides: Partial<RuneItem> = {}): RuneItem {
  return {
    key: 'rune-q-1',
    questionId: 'q-1',
    section: 'Math',
    skill: 'Linear equations in one variable',
    format: 'multiple_choice',
    stimulus: null,
    prompt: base.prompt,
    choices: base.choices,
    correctId: 'B',
    answer: 'B',
    acceptable: [],
    explanation: base.explanation,
    ...overrides,
  };
}

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

function mount(overrides: Partial<RuneItem> = {}, onAnswer = vi.fn()) {
  act(() => {
    root.render(
      <RuneQuestionCard
        item={item(overrides)}
        question={base}
        feedback={null}
        sprInput=""
        onSprChange={() => undefined}
        onAnswer={onAnswer}
        assessment="SAT"
      />
    );
  });
  return { onAnswer };
}

const button = (label: string) =>
  [...container.querySelectorAll('button')].find(
    (b) => (b.textContent ?? '').trim() === label
  );

describe('vault rune panel', () => {
  it('starts closed: no calculator and no reference sheet until asked', () => {
    mount();
    expect(container.querySelector('.split-tool')?.hasAttribute('hidden')).toBe(true);
    expect(container.querySelector('[data-testid="reference-sheet-modal"]')).toBeNull();
  });

  it('offers Desmos and the reference sheet for a Math rune', () => {
    mount();
    expect(button('Desmos')).toBeTruthy();
    expect(button('Reference')).toBeTruthy();
    act(() => button('Desmos')!.click());
    const tool = container.querySelector('.split-tool');
    expect(tool?.hasAttribute('hidden')).toBe(false);
    expect(tool?.querySelector('iframe')?.getAttribute('src')).toContain('desmos.com');
  });

  it('opens the reference sheet as a movable window over the question', () => {
    mount();
    act(() => button('Reference')!.click());
    expect(container.querySelector('[data-testid="reference-sheet-modal"]')).toBeTruthy();
    const close = [...container.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'Close math reference'
    );
    expect(close).toBeTruthy();
    act(() => close!.click());
    expect(container.querySelector('[data-testid="reference-sheet-modal"]')).toBeNull();
  });

  it('keeps both tools away from a Reading rune', () => {
    mount({ section: 'Reading and Writing', skill: 'Words in context' });
    expect(button('Desmos')).toBeUndefined();
    expect(button('Reference')).toBeUndefined();
  });

  it('reports the chosen answer', () => {
    const { onAnswer } = mount();
    const right = [...container.querySelectorAll<HTMLButtonElement>('.vault-choices button')].find(
      (b) => b.textContent?.includes('5')
    )!;
    act(() => right.click());
    expect(onAnswer).toHaveBeenLastCalledWith(true);
  });
});
