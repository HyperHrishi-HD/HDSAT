// @vitest-environment jsdom
/**
 * The starting homepage is a one-way door: it appears only before this browser
 * has any HDSAT profile, one click enters the app, and a signed-in student is
 * never shown it.
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
const openAuthModal = vi.fn();

vi.mock('../lib/storage', () => ({
  markEntered: () => markEntered(),
}));

vi.mock('../lib/store', () => ({
  useApp: () => appState,
}));

const { WelcomePage } = await import('./Welcome');

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

describe('starting homepage', () => {
  it('leads with one clear action', () => {
    render();
    expect(container.querySelector('h1')?.textContent).toContain('the test is built');
    const start = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Start now')
    );
    expect(start).toBeTruthy();
    expect(start!.className).toContain('btn-primary');
  });

  it('enters the app for good when Start now is pressed', () => {
    render();
    const start = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Start now')
    )!;
    act(() => {
      start.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(markEntered).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('app shell');
  });

  it('offers sign-in without entering first', () => {
    render();
    const signIn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('I have an account')
    )!;
    act(() => {
      signIn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(openAuthModal).toHaveBeenCalledWith('signin');
    expect(markEntered).not.toHaveBeenCalled();
  });

  it('sends a signed-in student straight into the app', () => {
    appState = {
      ...appState,
      user: { id: 'u1', email: 'student@example.com', displayName: 'Hrishi' },
    };
    render();
    expect(container.textContent).toContain('app shell');
    expect(container.textContent).not.toContain('Start now');
  });
});
