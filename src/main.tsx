import React from 'react';
import ReactDOM from 'react-dom/client';
import 'katex/dist/katex.min.css';
import './styles/global.css';
import { App } from './App';
import { AppProvider } from './lib/store';
import {
  PASSWORD_RECOVERY_FLAG,
  PASSWORD_RESET_REQUESTED_KEY,
} from './lib/password';
import { getSupabase } from './lib/supabaseClient';

const AUTH_CALLBACK_PATH = '/account';

/**
 * The operator console lives on a plain `/admin` path so the link can be typed
 * without a hash. The app itself is hash-routed, so rewrite the entry point to
 * its hash route before the router mounts; reloading keeps working because the
 * server serves the SPA for any unknown path.
 */
function normaliseAdminEntry(): void {
  if (typeof window === 'undefined') return;
  const path = window.location.pathname.replace(/\/+$/, '').toLowerCase();
  if (!path.endsWith('/admin')) return;
  if (window.location.hash.length > 1) return;
  window.history.replaceState(null, '', `${window.location.pathname}#/admin`);
}

function landOnAccount(): void {
  const base = window.location.pathname + window.location.search;
  window.history.replaceState(null, '', `${base}#${AUTH_CALLBACK_PATH}`);
}

/** Remembers that this browser asked for a recovery link, so a PKCE `?code=`
 *  return opens the new-password form instead of looking like a signup link. */
function recoveryRequestedOnThisDevice(): boolean {
  try {
    const at = Number(window.sessionStorage.getItem(PASSWORD_RESET_REQUESTED_KEY) ?? 0);
    return at > 0 && Date.now() - at < 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function markRecoveryLanding(): void {
  try {
    window.sessionStorage.setItem(PASSWORD_RECOVERY_FLAG, '1');
    window.sessionStorage.removeItem(PASSWORD_RESET_REQUESTED_KEY);
  } catch {
    /* private mode: the Account page simply shows the Change password button */
  }
}

/**
 * Supabase confirmation emails return to the app origin with either an implicit
 * session in the hash (`#access_token=...&refresh_token=...`) or a PKCE code in
 * the query string (`?code=...`). Consume either one before React Router reads
 * the URL, then land on Account where cloud status and the import notice show.
 */
async function consumeAuthRedirect(): Promise<void> {
  if (typeof window === 'undefined') return;

  const search = new URLSearchParams(window.location.search);
  const code = search.get('code');
  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : '';
  const params = new URLSearchParams(hash);

  const errorDescription =
    search.get('error_description') ?? params.get('error_description');
  if (errorDescription) {
    window.sessionStorage.setItem(
      'hdsat.auth-error',
      decodeURIComponent(errorDescription.replace(/\+/g, ' '))
    );
    landOnAccount();
    return;
  }

  if (code) {
    const supabase = getSupabase();
    if (supabase) {
      try {
        await supabase.auth.exchangeCodeForSession(code);
        if (recoveryRequestedOnThisDevice()) markRecoveryLanding();
      } catch {
        window.sessionStorage.setItem(
          'hdsat.auth-error',
          'That confirmation link has expired. Sign in, then resend the confirmation email.'
        );
      }
    }
    landOnAccount();
    return;
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return;

  const supabase = getSupabase();
  if (supabase) {
    try {
      await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (params.get('type') === 'recovery') markRecoveryLanding();
    } catch {
      window.sessionStorage.setItem(
        'hdsat.auth-error',
        'That confirmation link could not be used. Sign in, then resend the confirmation email.'
      );
    }
  }

  landOnAccount();
}

normaliseAdminEntry();

void consumeAuthRedirect().finally(() => {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <AppProvider>
        <App />
      </AppProvider>
    </React.StrictMode>
  );
});
