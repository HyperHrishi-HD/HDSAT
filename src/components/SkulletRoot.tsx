import type { ReactNode } from 'react';
import { SkulletProvider } from 'skullet/react';
import type { SkulletTheme } from 'skullet';
import { useResolvedTheme } from '../lib/useThemeMode';

/**
 * Skullet only needs colours for the two resolved modes. The colours point at
 * the app's existing surface tokens, so an owned store theme changes the
 * skeletons without needing another provider or a second set of values.
 */
const HDSAT_SKULLET_THEME: SkulletTheme = {
  light: { base: 'var(--surface-2)', highlight: 'var(--line)' },
  dark: { base: 'var(--surface-2)', highlight: 'var(--line)' },
  radius: '8px',
  animation: 'pulse',
  speed: 'slow',
  text: { top: 'ascender', bottom: 'descender' },
};

export function SkulletRoot({ children }: { children: ReactNode }) {
  const mode = useResolvedTheme();

  return (
    <SkulletProvider mode={mode} theme={HDSAT_SKULLET_THEME} reveal="smart">
      {children}
    </SkulletProvider>
  );
}
