// @vitest-environment jsdom
/**
 * The app shell: identity, status pills and the emblem chip. The guest welcome
 * card this file used to cover was replaced by the Dashboard's thin sign-in
 * nudge (see SyncNudge.test.tsx).
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

type MinimalApp = Record<string, unknown>;

let appState: MinimalApp;

vi.mock('../lib/store', () => ({
  useApp: () => appState,
}));

const { Layout } = await import('./Layout');

let container: HTMLDivElement;
let root: Root;

function baseApp(overrides: MinimalApp = {}): MinimalApp {
  return {
    bankVersion: 'test',
    questions: [],
    hdCoins: 0,
    currentStreak: 0,
    totals: { attempts: 0 },
    mode: 'guest',
    accountStatus: 'guest',
    user: null,
    cloudConfigured: true,
    error: null,
    notice: null,
    authModalOpen: false,
    authModalView: 'signin',
    actions: {
      dismissMessages: () => {},
      openAuthModal: () => {},
      closeAuthModal: () => {},
      flushQueuedEmails: async () => {},
      ensureBank: () => {},
    },
    ...overrides,
  };
}

function render() {
  act(() => {
    root.render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<div>home</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
  });
}

beforeEach(() => {
  appState = baseApp();
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('app shell', () => {
  it('greets a signed-in student by name, never by email', () => {
    appState = baseApp({
      mode: 'cloud',
      accountStatus: 'cloud',
      user: { email: 'student@example.com', displayName: 'Hrishi' },
    });
    render();
    // The top bar greets the student by name, never by email address. The
    // cloud icon replaces the old "Cloud ·" text so the pill stays compact.
    const cloud = container.querySelector('.badge-cloud');
    expect(cloud?.textContent).toBe('Hrishi');
    expect(cloud?.querySelector('svg')).not.toBeNull();
    expect(container.textContent).not.toContain('student@example.com');
  });

  it('falls back to the email when a cloud account has no display name', () => {
    appState = baseApp({
      mode: 'cloud',
      accountStatus: 'cloud',
      user: { email: 'student@example.com', displayName: '' },
    });
    render();
    expect(container.querySelector('.badge-cloud')?.textContent).toBe(
      'student@example.com'
    );
  });

  it('shows the equipped emblem as its own icon, with no text label', () => {
    appState = baseApp({ settings: { activeFlair: 'badge-grapher', activeTheme: null } });
    render();
    const chip = container.querySelector('.flair-chip');
    expect(chip).not.toBeNull();
    expect(chip!.querySelector('svg')).not.toBeNull();
    expect(chip!.textContent).toBe('');
    expect(container.textContent).not.toContain('Adaptive Navigator');
    expect(container.textContent).not.toContain('★');
  });

  it('renders a different glyph for a different emblem', () => {
    appState = baseApp({ settings: { activeFlair: 'badge-navigator' } });
    render();
    const navigatorGlyph = container.querySelector('.flair-chip svg')!.getAttribute('class');
    expect(navigatorGlyph).toBe('ui-icon');

    appState = baseApp({ settings: { activeFlair: 'badge-centurion' } });
    act(() => root.unmount());
    root = createRoot(container);
    render();
    const crown = container.querySelector('.flair-chip svg')!;
    expect(crown.querySelector('path')?.getAttribute('d')).toContain('M3 8.5');
  });

  it('shows no emblem chip when no emblem is equipped', () => {
    appState = baseApp({ settings: { activeFlair: null } });
    render();
    expect(container.querySelector('.flair-chip')).toBeNull();
  });

  it('holds the route behind the Skullet skeleton until the bank is ready', () => {
    appState = baseApp({ bankReady: false });
    render();

    expect(container.textContent).not.toContain('home');
    expect(container.querySelector('[skullet-reveal]')).not.toBeNull();
    expect(container.querySelector('.route-skeleton')).not.toBeNull();
  });

  it('hides and restores the desktop menu from the top bar', () => {
    render();
    const shell = container.querySelector('.app-shell')!;
    const toggle = container.querySelector('.sidebar-toggle') as HTMLButtonElement;

    expect(shell.classList.contains('is-sidebar-hidden')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('app-sidebar');

    act(() => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(shell.classList.contains('is-sidebar-hidden')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(window.localStorage.getItem('hdsat.sidebar.hidden.v1')).toBe('1');

    act(() => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(shell.classList.contains('is-sidebar-hidden')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(window.localStorage.getItem('hdsat.sidebar.hidden.v1')).toBeNull();
  });

  it('keeps the menu control icon-only and names both states', () => {
    appState = baseApp({
      mode: 'cloud',
      accountStatus: 'cloud',
      user: { email: 'student@example.com', displayName: 'Hrishi' },
    });
    render();
    const toggle = container.querySelector('.sidebar-toggle') as HTMLButtonElement;

    expect(toggle.querySelector('.sidebar-toggle-label')).toBeNull();
    expect(toggle.textContent?.trim()).toBe('');
    expect(toggle.querySelector('svg path')?.getAttribute('d')).toBe(
      'M4 7h16M4 12h16M4 17h16'
    );
    expect(toggle.getAttribute('aria-label')).toBe('Hide navigation menu');
    expect(toggle.getAttribute('title')).toBe('Hide navigation menu');

    act(() => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(toggle.textContent?.trim()).toBe('');
    expect(toggle.getAttribute('aria-label')).toBe('Show navigation menu');
    expect(toggle.getAttribute('title')).toBe('Show navigation menu');
  });

  it('remembers a hidden desktop menu on the next visit', () => {
    window.localStorage.setItem('hdsat.sidebar.hidden.v1', '1');
    render();

    expect(container.querySelector('.app-shell')!.classList.contains('is-sidebar-hidden')).toBe(
      true
    );
    expect(
      container.querySelector('.sidebar-toggle')!.getAttribute('aria-expanded')
    ).toBe('false');
  });
});
