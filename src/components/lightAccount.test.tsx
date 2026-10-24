// @vitest-environment jsdom
/**
 * Light accounts: signed in, address not proven yet. The reminder must appear
 * for them (and only them, and never inside the timed runner), and the missed
 * log must keep wrong answers even after the retry list has cleared them.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
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

const { VerifyEmailBanner } = await import('./VerifyEmailBanner');
const { MissedLog } = await import('./MissedLog');

let container: HTMLDivElement;
let root: Root;

const resendVerification = vi.fn(async () => {});

function baseApp(overrides: MinimalApp = {}): MinimalApp {
  return {
    questions: [],
    attempts: [],
    user: { id: 'u1', email: 'student@example.com', displayName: 'Hrishi' },
    emailVerified: false,
    cloudConfigured: true,
    actions: {
      openAuthModal: () => {},
      resendVerification,
    },
    ...overrides,
  };
}

function render(node: React.ReactNode, path = '/') {
  act(() => {
    root.render(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>);
  });
}

beforeEach(() => {
  appState = baseApp();
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  resendVerification.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('confirm-email reminder', () => {
  it('holds back briefly, then invites an unverified account to confirm', () => {
    render(<VerifyEmailBanner />);
    expect(container.querySelector('.verify-banner')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    const banner = container.querySelector('.verify-banner');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain('Confirm your email');
    expect(banner!.textContent).toContain('Enter code');
  });

  it('never shows for a verified account', () => {
    appState = baseApp({ emailVerified: true });
    render(<VerifyEmailBanner />);
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(container.querySelector('.verify-banner')).toBeNull();
  });

  it('never shows for a guest', () => {
    appState = baseApp({ user: null });
    render(<VerifyEmailBanner />);
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(container.querySelector('.verify-banner')).toBeNull();
  });

  it('stays out of the timed full test', () => {
    render(<VerifyEmailBanner />, '/test');
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(container.querySelector('.verify-banner')).toBeNull();
  });

  it('comes back after "Later" instead of disappearing for good', () => {
    render(<VerifyEmailBanner />);
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    const later = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Later')
    );
    expect(later).toBeTruthy();
    act(() => {
      later!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('.verify-banner')).toBeNull();

    // Hidden for the repeat window...
    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });
    expect(container.querySelector('.verify-banner')).toBeNull();

    // ...then the minute check brings it back.
    act(() => {
      vi.advanceTimersByTime(20 * 60 * 1000);
    });
    expect(container.querySelector('.verify-banner')).not.toBeNull();
  });

  it('sends a fresh code from the banner', async () => {
    render(<VerifyEmailBanner />);
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    const resend = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Resend')
    );
    expect(resend).toBeTruthy();
    await act(async () => {
      resend!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(resendVerification).toHaveBeenCalledWith('student@example.com');
  });
});

const question = {
  id: 'Q-1',
  section: 'Math',
  domain: 'Algebra',
  skill: 'Linear equations',
  difficulty: 'Medium',
  prompt: 'If 2x + 3 = 11, what is x?',
};

describe('missed log', () => {
  it('keeps a wrong answer after the retry list has cleared it', () => {
    appState = baseApp({
      questions: [question],
      attempts: [
        {
          eventId: 'e1',
          questionId: 'Q-1',
          response: 'B',
          isCorrect: false,
          mode: 'practice',
          difficulty: 'Medium',
          section: 'Math',
          timeSpentSeconds: 20,
          createdAt: '2026-10-24T10:00:00.000Z',
          sessionId: null,
        },
      ],
      // The current progress says "answered correctly now", so the Dashboard's
      // retry count is zero — the log still remembers the miss.
      progress: { 'Q-1': { lastIsCorrect: true } },
    });
    render(<MissedLog />);
    const button = container.querySelector('button');
    expect(button?.textContent).toContain('Missed log (1)');
    act(() => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('.missed-log')).not.toBeNull();
    expect(container.textContent).toContain('If 2x + 3 = 11, what is x?');
    expect(container.textContent).toContain('2026-10-24');
    expect(container.textContent).toContain('B');
  });

  it('says so when nothing has been missed', () => {
    render(<MissedLog />);
    const button = container.querySelector('button');
    expect(button?.textContent).toContain('Missed log (0)');
    act(() => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).toContain('Nothing missed yet.');
  });
});
