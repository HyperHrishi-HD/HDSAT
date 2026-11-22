// @vitest-environment jsdom
/**
 * The report control is reused as a student moves through questions. A previous
 * "Report received" acknowledgement must not survive the next question, or the
 * next report becomes impossible without leaving the runner.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let appState: Record<string, unknown>;

vi.mock('../lib/store', () => ({
  useApp: () => appState,
}));

vi.mock('../lib/cloud', () => ({
  reportQuestion: vi.fn(),
}));

const cloud = await import('../lib/cloud');
const reportQuestion = vi.mocked(cloud.reportQuestion);
const { ReportQuestion } = await import('./ReportQuestion');

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  appState = {
    cloudConfigured: true,
    user: { email: 'student@example.com' },
    accountStatus: 'active',
    actions: { openAuthModal: vi.fn() },
  };
  reportQuestion.mockReset();
  reportQuestion.mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderQuestion(questionId: string) {
  act(() => {
    root.render(<ReportQuestion questionId={questionId} />);
  });
}

function buttonWithText(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) =>
    item.textContent?.includes(text)
  );
  if (!button) throw new Error(`missing button: ${text}`);
  return button;
}

async function openAndSubmit() {
  act(() => buttonWithText('Report a problem with this question').click());
  const form = container.querySelector('form');
  if (!form) throw new Error('report form did not open');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

describe('question report reset', () => {
  it('clears the acknowledgement and allows the next question to be reported', async () => {
    renderQuestion('M-DAT-76026');
    await openAndSubmit();

    expect(reportQuestion).toHaveBeenCalledTimes(1);
    expect(reportQuestion.mock.calls[0][0]).toMatchObject({ questionId: 'M-DAT-76026' });
    expect(container.textContent).toContain('Report received');

    renderQuestion('RW-INF-319');

    expect(container.textContent).not.toContain('Report received');
    expect(container.textContent).toContain('Report a problem with this question');

    await openAndSubmit();

    expect(reportQuestion).toHaveBeenCalledTimes(2);
    expect(reportQuestion.mock.calls[1][0]).toMatchObject({ questionId: 'RW-INF-319' });
    expect(container.textContent).toContain('Report received');
  });
});
