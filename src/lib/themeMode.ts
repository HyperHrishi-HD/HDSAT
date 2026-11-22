/**
 * Appearance mode: light, dark, or whatever the device is set to.
 *
 * The choice belongs to the device, not the account: it is about the screen the
 * student is reading on right now, so it is stored in localStorage and never
 * synced. "System" is the default so a phone that switches to dark at sunset
 * takes the app with it, and an explicit Light or Dark choice overrides that
 * until the student changes it back.
 *
 * The attribute lives on <html>, which lets plain CSS do the work and keeps the
 * theme independent of React's render cycle. main.tsx applies it before the
 * first paint; this module is the single place that knows how.
 */

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_MODE_KEY = 'hdsat.theme-mode.v1';

const DARK_QUERY = '(prefers-color-scheme: dark)';
export const THEME_TRANSITION_CLASS = 'theme-switching';
export const THEME_TRANSITION_MS = 280;
const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: '#1f5fd0',
  dark: '#0f1216',
};



const listeners = new Set<() => void>();
let mediaQuery: MediaQueryList | null = null;
let visibilityBound = false;
let transitionTimer: ReturnType<typeof setTimeout> | null = null;

function motionIsReduced(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Applies one temporary transition class to <html>. Every surface, control and
 * label then changes colour on the same clock. Without this, elements that
 * already had their own 120ms button transition repainted at a different time
 * from the page around them, which read as buttons arriving late.
 */
export function beginThemeTransition(): void {
  if (typeof document === 'undefined' || motionIsReduced()) return;
  const root = document.documentElement;
  root.classList.add(THEME_TRANSITION_CLASS);
  if (transitionTimer) clearTimeout(transitionTimer);
  transitionTimer = setTimeout(() => {
    root.classList.remove(THEME_TRANSITION_CLASS);
    transitionTimer = null;
  }, THEME_TRANSITION_MS);
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** The stored choice, or "system" when nothing has ever been chosen. */
export function loadThemeMode(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'system';
  try {
    const raw = localStorage.getItem(THEME_MODE_KEY);
    return isThemeMode(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

export function saveThemeMode(mode: ThemeMode): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(THEME_MODE_KEY, mode);
  } catch {
    /* private mode: the choice simply does not survive the session */
  }
}

export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(DARK_QUERY).matches;
}

/** The theme actually painted, after the system preference is taken into account. */
export function resolveThemeMode(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return prefersDark ? 'dark' : 'light';
  return mode;
}

/**
 * Paints the resolved theme. The attribute is what the stylesheet keys on; the
 * `color-scheme` property tells the browser to render form controls, scrollbars
 * and the caret in the same theme instead of assuming a light page.
 */
export function applyResolvedTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const previous = root.getAttribute('data-mode');
  if (previous && previous !== resolved) beginThemeTransition();
  if (previous !== resolved) root.setAttribute('data-mode', resolved);
  if (root.style.colorScheme !== resolved) root.style.colorScheme = resolved;
  // Keep an inline canvas colour as the last-resort fallback for a tab
  // restored from the compositor's snapshot. It is set to the theme's own
  // `--bg` when the stylesheet is live, so a tinted store theme is not covered
  // by a neutral band; the stylesheet's `!important` rule still owns the final
  // paint. Before the stylesheet loads, the neutral colour is the safe value.
  const token = getComputedStyle(root).getPropertyValue('--bg').trim();
  const canvas = token || (resolved === 'dark' ? '#0f1216' : '#f6f8fb');
  if (root.style.backgroundColor !== canvas) root.style.backgroundColor = canvas;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && meta.getAttribute('content') !== THEME_COLORS[resolved]) {
    meta.setAttribute('content', THEME_COLORS[resolved]);
  }
}

/** Applies a stored choice and returns the theme it resolved to. */
export function applyThemeMode(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveThemeMode(mode, systemPrefersDark());
  applyResolvedTheme(resolved);
  return resolved;
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Stores the choice, paints it and tells every mounted toggle about it. */
export function setThemeMode(mode: ThemeMode): ResolvedTheme {
  saveThemeMode(mode);
  const resolved = applyThemeMode(mode);
  notify();
  return resolved;
}

export function subscribeThemeMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function currentThemeMode(): ThemeMode {
  return loadThemeMode();
}

/** The theme on screen right now, after the device preference is applied. */
export function currentResolvedTheme(): ResolvedTheme {
  return resolveThemeMode(loadThemeMode(), systemPrefersDark());
}

/**
 * Watches the device preference so "System" keeps working while the app is open
 * — a phone that flips to dark at its scheduled time repaints without a reload.
 * Safe to call more than once; the listener is installed only once.
 */
export function initThemeMode(): void {
  if (typeof window === 'undefined') return;
  applyThemeMode(loadThemeMode());
  // A backgrounded phone tab can be restored without re-running the module.
  // Re-assert the attribute and canvas colour on the way back, which is what
  // keeps a dark-mode tab from showing a white frame while React wakes up.
  if (!visibilityBound) {
    visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      applyThemeMode(loadThemeMode());
      notify();
    });
    window.addEventListener('pageshow', () => {
      applyThemeMode(loadThemeMode());
      notify();
    });
  }
  if (mediaQuery || typeof window.matchMedia !== 'function') return;
  mediaQuery = window.matchMedia(DARK_QUERY);
  const onChange = () => {
    if (loadThemeMode() !== 'system') return;
    applyThemeMode('system');
    notify();
  };
  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', onChange);
  } else if (typeof mediaQuery.addListener === 'function') {
    mediaQuery.addListener(onChange);
  }
}
