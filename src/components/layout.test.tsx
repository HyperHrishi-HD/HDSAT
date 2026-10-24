// @vitest-environment jsdom
/**
 * The guest onboarding banner ("Welcome to HDSAT... create account or continue
 * as a guest") must never appear to a student who already has a session. It
 * used to stay on screen after sign-in because its visibility only depended on
 * a localStorage "seen" flag.
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

const markWelcomeSeen = vi.fn();

vi.mock('../lib/storage', () => ({
  hasSeenWelcome: () => false,
  markWelcomeSeen: () => markWelcomeSeen(),
}));

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
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  markWelcomeSeen.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('welcome banner', () => {
  it('invites a first-time guest to create an account', () => {
    render();
    expect(container.querySelector('.welcome-banner')).not.toBeNull();
    expect(container.textContent).toContain('Welcome to HDSAT');
  });

  it('disappears for a signed-in student and is marked seen', () => {
    appState = baseApp({
      mode: 'cloud',
      accountStatus: 'cloud',
      user: { email: 'student@example.com', displayName: 'Hrishi' },
    });
    render();
    expect(container.querySelector('.welcome-banner')).toBeNull();
    expect(container.textContent).not.toContain('Keep studying as a guest');
    expect(markWelcomeSeen).toHaveBeenCalled();
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

  it('stays hidden after the guest dismisses it', () => {
    render();
    const dismiss = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Keep as guest')
    );
    expect(dismiss).toBeTruthy();
    act(() => {
      dismiss!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('.welcome-banner')).toBeNull();
    expect(markWelcomeSeen).toHaveBeenCalled();
  });
});
