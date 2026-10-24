// @vitest-environment jsdom
/**
 * The guest progress nudge is a two-strike banner: close it once and it waits
 * for the next visit, close it twice and it is gone for good. It never appears
 * to a signed-in student, and never on a blank browser that has not started yet.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const openAuthModal = vi.fn();

vi.mock('../lib/store', () => ({
  useApp: () => appState,
}));

const storage = await import('../lib/storage');
const { SyncNudge } = await import('./SyncNudge');
const { STORAGE_KEY, SYNC_NUDGE_VISIT_KEY } = storage;

let appState: Record<string, unknown>;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  appState = {
    user: null,
    cloudConfigured: true,
    actions: { openAuthModal },
  };
  window.localStorage.clear();
  window.sessionStorage.clear();
  openAuthModal.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount() {
  act(() => root.render(<SyncNudge />));
}

function remount() {
  act(() => root.unmount());
  root = createRoot(container);
  mount();
}

function close() {
  const button = container.querySelector('.sync-nudge-close') as HTMLButtonElement | null;
  expect(button).not.toBeNull();
  act(() => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function startProfile() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1 }));
}

describe('guest progress nudge', () => {
  it('appears once a guest has started, and offers sign-in', () => {
    startProfile();
    mount();
    expect(container.querySelector('.sync-nudge')).not.toBeNull();
    expect(container.textContent).toContain('Save your progress');
    const signIn = container.querySelector('.sync-nudge .btn') as HTMLButtonElement;
    act(() => {
      signIn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(openAuthModal).toHaveBeenCalledWith('signin');
  });

  it('stays away from a blank browser, a signed-in student and an offline build', () => {
    mount();
    expect(container.querySelector('.sync-nudge')).toBeNull();

    startProfile();
    appState = { ...appState, user: { id: 'u1', email: 'a@b.c', displayName: 'A' } };
    remount();
    expect(container.querySelector('.sync-nudge')).toBeNull();

    appState = { ...appState, user: null, cloudConfigured: false };
    remount();
    expect(container.querySelector('.sync-nudge')).toBeNull();
  });

  it('shows twice in a browser lifetime, then never again', () => {
    startProfile();
    mount();
    expect(container.querySelector('.sync-nudge')).not.toBeNull();

    close();
    expect(container.querySelector('.sync-nudge')).toBeNull();

    // Still the same visit: navigating away and back is not a new visit.
    remount();
    expect(container.querySelector('.sync-nudge')).toBeNull();

    // Next visit (a new page load) gets the second and final showing.
    window.sessionStorage.removeItem(SYNC_NUDGE_VISIT_KEY);
    remount();
    expect(container.querySelector('.sync-nudge')).not.toBeNull();

    close();
    window.sessionStorage.removeItem(SYNC_NUDGE_VISIT_KEY);
    remount();
    expect(container.querySelector('.sync-nudge')).toBeNull();
    expect(storage.loadSyncNudge().dismissals).toBe(2);
  });
});
