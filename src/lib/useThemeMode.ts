import { useSyncExternalStore } from 'react';
import {
  currentResolvedTheme,
  currentThemeMode,
  setThemeMode,
  subscribeThemeMode,
  type ResolvedTheme,
  type ThemeMode,
} from './themeMode';

/**
 * The appearance choice, shared by every mounted control.
 *
 * `setThemeMode` writes, paints and notifies in one step, so a toggle in Account
 * and any other surface reading the mode can never disagree about what is on
 * screen.
 */
export function useThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
  const mode = useSyncExternalStore(
    subscribeThemeMode,
    currentThemeMode,
    () => 'system' as ThemeMode
  );
  return [mode, setThemeMode];
}

/**
 * The theme actually painted. Separate from `useThemeMode` on purpose: while the
 * choice is "system", a device that flips to dark has to repaint *and* refresh
 * any copy that names the current theme, and the stored choice alone never
 * changes in that case.
 */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(
    subscribeThemeMode,
    currentResolvedTheme,
    () => 'light' as ResolvedTheme
  );
}
