import { useEffect, useRef, useState } from 'react';

/**
 * Runs `save` once the page is closed or the component is unmounted, and
 * reports whether the page is currently hidden.
 *
 * The three arcade games that carry a real session (Table Talk, the Rune Vault
 * and Practice Rush) use it so a student who switches to another part of the app
 * mid-run still gets the session they sat written to their account instead of
 * losing it. Switching to another *browser* tab is treated as a pause, not an
 * exit: the run is still open and comes back where it was, and the save only
 * happens if the page is actually closed (pagehide) or the game is left.
 *
 * `save` is held in a ref that is refreshed on every render, so the callback
 * always sees the latest counters even though the listeners are attached once.
 * A game that already settled its own session guards against a second payout;
 * this hook only decides *when* to try, never how much to pay.
 */
export function useLeaveSave(save: () => void, enabled = true): boolean {
  const saveRef = useRef(save);
  saveRef.current = save;
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const run = () => {
      try {
        saveRef.current();
      } catch {
        /* saving is best effort: a closed tab must never throw */
      }
    };
    const onVisibility = () => setHidden(document.visibilityState === 'hidden');
    window.addEventListener('pagehide', run);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', run);
      document.removeEventListener('visibilitychange', onVisibility);
      setHidden(false);
      run();
    };
  }, [enabled]);

  return hidden;
}
