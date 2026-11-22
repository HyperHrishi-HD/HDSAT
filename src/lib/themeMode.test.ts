// @vitest-environment jsdom
/**
 * Appearance is a device setting: "system" follows the phone, Light and Dark
 * override it, and the choice survives a reload. The attribute on <html> is the
 * contract the stylesheet reads, so these tests check that and the theme-color
 * the browser paints its chrome with.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  THEME_MODE_KEY,
  THEME_TRANSITION_CLASS,
  THEME_TRANSITION_MS,
  applyThemeMode,
  isThemeMode,
  loadThemeMode,
  resolveThemeMode,
  saveThemeMode,
  setThemeMode,
} from './themeMode';

const DARK = '#0f1216';
const LIGHT = '#1f5fd0';

function stubSystem(dark: boolean, reducedMotion = false) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('prefers-reduced-motion')
        ? reducedMotion
        : query.includes('prefers-color-scheme: dark')
        ? dark
        : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

function themeColor(): string | null {
  return document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  document.head.innerHTML = '<meta name="theme-color" content="#1f5fd0" />';
  document.documentElement.removeAttribute('data-mode');
  document.documentElement.style.colorScheme = '';
  document.documentElement.classList.remove(THEME_TRANSITION_CLASS);
  stubSystem(false);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  document.documentElement.classList.remove(THEME_TRANSITION_CLASS);
  vi.restoreAllMocks();
});

describe('theme mode', () => {
  it('defaults to following the device when nothing has been chosen', () => {
    expect(loadThemeMode()).toBe('system');
  });

  it('ignores a stored value that is not a mode', () => {
    localStorage.setItem(THEME_MODE_KEY, 'sepia');
    expect(loadThemeMode()).toBe('system');
  });

  it('remembers an explicit choice', () => {
    saveThemeMode('dark');
    expect(loadThemeMode()).toBe('dark');
    saveThemeMode('light');
    expect(loadThemeMode()).toBe('light');
    saveThemeMode('system');
    expect(loadThemeMode()).toBe('system');
  });

  it('recognises only the three modes', () => {
    expect(isThemeMode('system')).toBe(true);
    expect(isThemeMode('dark')).toBe(true);
    expect(isThemeMode('light')).toBe(true);
    expect(isThemeMode('auto')).toBe(false);
    expect(isThemeMode(null)).toBe(false);
  });

  it('resolves system against the device preference', () => {
    expect(resolveThemeMode('system', true)).toBe('dark');
    expect(resolveThemeMode('system', false)).toBe('light');
    // An explicit choice wins over the device.
    expect(resolveThemeMode('light', true)).toBe('light');
    expect(resolveThemeMode('dark', false)).toBe('dark');
  });

  it('paints the attribute, the colour-scheme and the browser chrome', () => {
    expect(applyThemeMode('dark')).toBe('dark');
    expect(document.documentElement.getAttribute('data-mode')).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(themeColor()).toBe(DARK);

    expect(applyThemeMode('light')).toBe('light');
    expect(document.documentElement.getAttribute('data-mode')).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(themeColor()).toBe(LIGHT);
  });

  it('follows the device while the choice is system', () => {
    stubSystem(true);
    expect(applyThemeMode('system')).toBe('dark');
    stubSystem(false);
    expect(applyThemeMode('system')).toBe('light');
  });

  it('stores the choice when set through the shared setter', () => {
    expect(setThemeMode('dark')).toBe('dark');
    expect(localStorage.getItem(THEME_MODE_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-mode')).toBe('dark');
  });

  it('uses one coordinated transition when the painted theme changes', () => {
    document.documentElement.setAttribute('data-mode', 'light');
    applyThemeMode('dark');
    expect(document.documentElement.classList.contains(THEME_TRANSITION_CLASS)).toBe(true);
    vi.advanceTimersByTime(THEME_TRANSITION_MS - 1);
    expect(document.documentElement.classList.contains(THEME_TRANSITION_CLASS)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(document.documentElement.classList.contains(THEME_TRANSITION_CLASS)).toBe(false);
  });

  it('does not animate the first paint or ask for motion the device has reduced', () => {
    applyThemeMode('dark');
    expect(document.documentElement.classList.contains(THEME_TRANSITION_CLASS)).toBe(false);

    stubSystem(false, true);
    applyThemeMode('light');
    expect(document.documentElement.getAttribute('data-mode')).toBe('light');
    expect(document.documentElement.classList.contains(THEME_TRANSITION_CLASS)).toBe(false);
  });
});
