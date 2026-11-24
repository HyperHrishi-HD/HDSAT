import { useEffect, useRef } from 'react';
import { googleClientId, loadGoogleIdentity } from '../lib/googleIdentity';

interface GoogleSignInButtonProps {
  onCredential: (credential: string) => void;
  onUnavailable: () => void;
  disabled?: boolean;
}

/** GIS caps its own button width at 400px. */
const MAX_WIDGET_WIDTH = 400;
const MIN_WIDGET_WIDTH = 240;

/**
 * Google's official button, rendered into our card.
 *
 * The iframe is the part users click; keeping it official is what gives the
 * popup the correct branding and what Google's UX guidelines expect. If the
 * script cannot load, the parent swaps in the original redirect button.
 *
 * For a visitor with a Google session GIS swaps in a personalised
 * "Continue as …" chip. That chip is laid out wider than the button's box and
 * is clipped on a narrow card, and Google exposes no API to turn it off.
 * Size `medium` is the one size Google documents as never personalised, so the
 * button always matches the card exactly — no scaling, no cut-off G.
 */
export function GoogleSignInButton({
  onCredential,
  onUnavailable,
  disabled = false,
}: GoogleSignInButtonProps) {
  const host = useRef<HTMLDivElement>(null);
  const renderedWidth = useRef(0);
  const credential = useRef(onCredential);
  const unavailable = useRef(onUnavailable);
  credential.current = onCredential;
  unavailable.current = onUnavailable;

  useEffect(() => {
    let cancelled = false;
    const element = host.current;
    if (!element) return;
    if (!googleClientId()) {
      unavailable.current();
      return;
    }

    // GIS keeps the width it was rendered at, so a modal that survives a
    // viewport change must be drawn again at the new width.
    const draw = () => {
      if (cancelled) return;
      const api = window.google?.accounts?.id;
      if (!api || !element) return;
      const width = Math.min(
        Math.max(Math.round(element.clientWidth) || 320, MIN_WIDGET_WIDTH),
        MAX_WIDGET_WIDTH
      );
      if (width === renderedWidth.current && element.childElementCount) return;
      renderedWidth.current = width;

      element.replaceChildren();
      api.renderButton(element, {
        type: 'standard',
        theme: 'filled_black',
        // Google shows its personalised chip only at `large`; `medium` keeps
        // the plain button, which fits the card at any width.
        size: 'medium',
        text: 'continue_with',
        shape: 'pill',
        logo_alignment: 'center',
        width,
      });
    };

    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(draw) : null;
    observer?.observe(element);
    window.addEventListener('resize', draw);

    loadGoogleIdentity()
      .then(() => {
        if (cancelled || !element) return;
        const api = window.google?.accounts?.id;
        if (!api) throw new Error('Google sign-in is unavailable.');

        api.initialize({
          client_id: googleClientId(),
          callback: (response: { credential?: string }) => {
            if (response.credential) credential.current(response.credential);
          },
          ux_mode: 'popup',
          auto_select: false,
          cancel_on_tap_outside: true,
          // FedCM is not available on every embedded/older browser. Keep the
          // legacy GIS popup so the official button always has a working path.
          use_fedcm_for_button: false,
          use_fedcm_for_prompt: false,
        });

        draw();
      })
      .catch(() => {
        if (!cancelled) unavailable.current();
      });

    return () => {
      cancelled = true;
      observer?.disconnect();
      window.removeEventListener('resize', draw);
    };
  }, []);

  return (
    <div
      className={`auth-google-gsi${disabled ? ' is-busy' : ''}`}
      ref={host}
      role="group"
      aria-label="Continue with Google"
      aria-busy={disabled}
    />
  );
}
