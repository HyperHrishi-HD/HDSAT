// @vitest-environment jsdom
/**
 * The starting homepage is a one-way door for a blank browser and a normal
 * page for anyone who navigates to it on purpose: a signed-in student who
 * opens /welcome from Credits can read it, and pressing Start now still
 * returns to the app.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const markEntered = vi.fn();
const markWelcomeSeen = vi.fn();
const openAuthModal = vi.fn();

vi.mock('../lib/storage', () => ({
  markEntered: () => markEntered(),
  markWelcomeSeen: () => markWelcomeSeen(),
}));

vi.mock('../lib/store', () => ({
  useApp: () => appState,
}));

const { WelcomePage } = await import('./Welcome');
const { MOTTOS, nextMotto } = await import('../lib/motto');

type MinimalApp = Record<string, unknown>;
let appState: MinimalApp;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  appState = {
    user: null,
    cloudConfigured: true,
    authModalOpen: false,
    pendingAccount: null,
    actions: { openAuthModal, closeAuthModal: () => {} },
  };
  markEntered.mockClear();
  markWelcomeSeen.mockClear();
  openAuthModal.mockClear();
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render() {
  act(() => {
    root.render(
      <MemoryRouter initialEntries={['/welcome']}>
        <Routes>
          <Route path="/welcome" element={<WelcomePage />} />
          <Route path="/" element={<div>app shell</div>} />
        </Routes>
      </MemoryRouter>
    );
  });
}

function button(label: string) {
  return [...container.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(label)
  ) as HTMLButtonElement | undefined;
}

describe('starting homepage', () => {
  it('leads with one clear action and the corrected wording', () => {
    render();
    expect(container.querySelector('h1')?.textContent).toContain('Practice the way');
    expect(container.querySelector('h1')?.textContent).not.toContain('Practise');
    expect(container.querySelector('.welcome-sub')?.textContent).toBe(
      'Adaptive full length tests, in depth practice and drills, flashcards and arcades.'
    );
    const start = button('Start now');
    expect(start).toBeTruthy();
    expect(start!.className).toContain('btn-primary');
  });

  it('draws the brand mark with a white H, never accent-on-accent', () => {
    render();
    const marks = container.querySelectorAll('.welcome-brand .brand-mark');
    expect(marks.length).toBe(1);
    const label = container.querySelector('.welcome-brand strong');
    expect(label?.textContent).toBe('HDSAT');
    expect(container.querySelector('.welcome-emblem svg')).not.toBeNull();
  });

  it('shows a motto, and a different one on the next visit', () => {
    render();
    const first = container.querySelector('.welcome-motto')?.textContent?.replace(/[“”]/g, '').trim();
    expect(MOTTOS).toContain(first);
    act(() => root.unmount());
    root = createRoot(container);
    render();
    const second = container.querySelector('.welcome-motto')?.textContent?.replace(/[“”]/g, '').trim();
    expect(second).not.toBe(first);
    expect(MOTTOS).toContain(second);
  });

  it('enters the app for good when Start now is pressed', () => {
    render();
    act(() => {
      button('Start now')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(markEntered).toHaveBeenCalledTimes(1);
    expect(markWelcomeSeen).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('app shell');
  });

  it('offers sign-in without entering first', () => {
    render();
    act(() => {
      button('I have an account')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(openAuthModal).toHaveBeenCalledWith('signin');
    expect(markEntered).not.toHaveBeenCalled();
  });

  it('lets a signed-in student read the page when they navigate here', () => {
    appState = {
      ...appState,
      user: { id: 'u1', email: 'student@example.com', displayName: 'Hrishi' },
    };
    render();
    expect(container.textContent).toContain('Start now');
    expect(container.textContent).not.toContain('app shell');
  });

  it('enters the app when a visitor signs in from here', () => {
    render();
    appState = {
      ...appState,
      user: { id: 'u1', email: 'student@example.com', displayName: 'Hrishi' },
    };
    act(() => root.render(
      <MemoryRouter initialEntries={['/welcome']}>
        <Routes>
          <Route path="/welcome" element={<WelcomePage />} />
          <Route path="/" element={<div>app shell</div>} />
        </Routes>
      </MemoryRouter>
    ));
    expect(container.textContent).toContain('app shell');
  });
});

describe('motto rotation', () => {
  it('never repeats the previous line and wraps around the list', () => {
    const seen = new Set<string>();
    let last: number | null = null;
    for (let i = 0; i < MOTTOS.length; i += 1) {
      const next = nextMotto(last);
      expect(next.index).toBe((next.index) % MOTTOS.length);
      expect(next.text).toBe(MOTTOS[next.index]);
      seen.add(next.text);
      last = next.index;
    }
    expect(seen.size).toBe(MOTTOS.length);
    expect(nextMotto(last).index).toBe(0);
  });
});
