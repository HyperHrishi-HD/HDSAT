import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Icon } from './ui';

/**
 * Fullscreen frame for the Arcade's 2D rooms.
 *
 * Every game is playable inline, but a phone with the page chrome around it
 * leaves very little room for the board. This shell hands the room the whole
 * screen (browser chrome included, where the browser allows it), asks for
 * landscape orientation on devices that support the lock, and — when the
 * device is still held upright — shows a rotate prompt instead of a sliver of
 * canvas. Escape or the toolbar button always comes back.
 */

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type LockingScreenOrientation = ScreenOrientation & {
  lock?: (orientation: string) => Promise<void>;
};

function fullscreenElement(): Element | null {
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export function GameShell({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [isFull, setIsFull] = useState(false);
  const [portrait, setPortrait] = useState(false);
  /**
   * A phone that is locked to portrait (or an iPad in a stand) cannot obey the
   * rotate hint. Without this the prompt is a dead end that only offers to
   * leave the game, so it can be dismissed once per fullscreen session: the
   * board then plays in the strip it has, exactly as it does inline.
   */
  const [portraitDismissed, setPortraitDismissed] = useState(false);

  /**
   * Full screen is a layout state first and a browser API second: the overlay
   * is applied even when the API is missing or refused (embedded webviews,
   * older iOS), and the API call only strips the browser chrome on top of it.
   * Nothing about the game depends on the browser granting the request.
   */

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = () => {
      // Leaving the API's fullscreen (Esc, system gesture) always leaves the
      // overlay too; entering it keeps the overlay that is already on.
      if (!fullscreenElement()) setIsFull(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  // Portrait in fullscreen means the board would be a letterbox strip: say so.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const query = window.matchMedia?.('(orientation: portrait)');
    if (!query) return;
    const update = () => setPortrait(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  const exitFullscreen = useCallback(async () => {
    setIsFull(false);
    setPortraitDismissed(false);
    // Always try to leave the browser's own fullscreen, even if the change
    // event has not landed yet: this is the click that is supposed to work.
    const doc = document as Document & {
      webkitExitFullscreen?: () => Promise<void> | void;
      webkitCancelFullScreen?: () => void;
    };
    try {
      if (fullscreenElement()) {
        if (doc.exitFullscreen) await doc.exitFullscreen();
        else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
        else doc.webkitCancelFullScreen?.();
      }
    } catch {
      /* the overlay is already gone */
    }
    const orientation = screen.orientation as LockingScreenOrientation | undefined;
    try {
      await orientation?.unlock?.();
    } catch {
      /* the device keeps its orientation; nothing to undo */
    }
  }, []);

  const enterFullscreen = useCallback(async () => {
    setIsFull(true);
    setPortraitDismissed(false);
    const shell = shellRef.current as FullscreenElement | null;
    if (!shell || fullscreenElement()) return;
    try {
      if (shell.requestFullscreen) await shell.requestFullscreen({ navigationUI: 'hide' });
      else await shell.webkitRequestFullscreen?.();
      const orientation = screen.orientation as LockingScreenOrientation | undefined;
      // Best effort: desktop browsers reject the lock, which is fine.
      await orientation?.lock?.('landscape').catch(() => undefined);
    } catch {
      /* the overlay is already filling the screen */
    }
  }, []);

  // `isFull` has to be a dependency: the old version captured the initial
  // `false` forever, so the button called enterFullscreen on every press and
  // "Exit full screen" did nothing.
  const toggle = useCallback(async () => {
    if (isFull) await exitFullscreen();
    else await enterFullscreen();
  }, [enterFullscreen, exitFullscreen, isFull]);

  // While the overlay is up the page behind it must not scroll away, or
  // closing the game drops the student somewhere else on the page.
  useEffect(() => {
    if (!isFull || typeof document === 'undefined') return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isFull]);

  // Escape closes the overlay when the browser is not in real fullscreen.
  useEffect(() => {
    if (!isFull) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !fullscreenElement()) setIsFull(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFull]);

  return (
    <div
      ref={shellRef}
      className={`game-shell${isFull ? ' is-fullscreen' : ''}`}
      data-portrait={portrait ? 'true' : 'false'}
    >
      <div className="game-shell-bar">
        <span className="game-shell-title">{title}</span>
        {hint ? <span className="game-shell-hint">{hint}</span> : null}
        <Button
          size="sm"
          variant="subtle"
          type="button"
          onClick={() => void toggle()}
          title={isFull ? 'Exit full screen (Esc)' : 'Play full screen'}
        >
          <Icon name={isFull ? 'collapse' : 'expand'} size={14} />
          <span className="game-shell-exit-label">
            {isFull ? 'Exit full screen' : 'Full screen'}
          </span>
        </Button>
      </div>

      <div className="game-shell-stage">{children}</div>

      {isFull && portrait && !portraitDismissed ? (
        <div className="game-rotate" role="status">
          <div className="game-rotate-phone" aria-hidden="true" />
          <strong>Turn your device sideways</strong>
          <span className="muted">
            The vault, the interceptor and the table all play in landscape.
          </span>
          <div className="game-rotate-actions">
            <Button size="sm" variant="primary" onClick={() => setPortraitDismissed(true)}>
              Play in portrait
            </Button>
            <Button size="sm" variant="outline" onClick={() => void exitFullscreen()}>
              Back to the page
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
