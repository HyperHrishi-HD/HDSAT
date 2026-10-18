import React from 'react';
import ReactDOM from 'react-dom/client';
import 'katex/dist/katex.min.css';
import './styles/global.css';
import { App } from './App';
import { AppProvider } from './lib/store';
import { getSupabase } from './lib/supabaseClient';

const AUTH_CALLBACK_PATH = '/account';

function landOnAccount(): void {
  const base = window.location.pathname + window.location.search;
  window.history.replaceState(null, '', `${base}#${AUTH_CALLBACK_PATH}`);
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
    } catch {
      window.sessionStorage.setItem(
        'hdsat.auth-error',
        'That confirmation link could not be used. Sign in, then resend the confirmation email.'
      );
    }
  }

  landOnAccount();
}

void consumeAuthRedirect().finally(() => {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <AppProvider>
        <App />
      </AppProvider>
    </React.StrictMode>
  );
});
