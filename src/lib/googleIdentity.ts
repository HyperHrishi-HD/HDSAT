/**
 * Google Identity Services (GIS) loader.
 *
 * The ID-token flow keeps the consent prompt on accounts.google.com and signs
 * into Supabase with the returned JWT, so the browser never round-trips through
 * the project's Supabase Auth host. The client ID is public and supplied at
 * build time; a missing value falls back to the old redirect flow.
 */

export interface GoogleCredentialResponse {
  credential?: string;
  select_by?: string;
}

interface GoogleIdentityApi {
  initialize: (options: Record<string, unknown>) => void;
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
  cancel: () => void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdentityApi } };
  }
}

const SCRIPT_ID = 'google-identity-services';
let loading: Promise<void> | null = null;

export function googleClientId(): string {
  return String(import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim();
}

export function googleIdentityConfigured(): boolean {
  return googleClientId().length > 0;
}

/**
 * Loads `https://accounts.google.com/gsi/client` once and resolves when the
 * global is ready. A failed load clears the cached promise so a later attempt
 * (for example after a network blip) can try again.
 */
export function loadGoogleIdentity(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google sign-in needs a browser.'));
  }
  if (window.google?.accounts?.id) return Promise.resolve();
  if (loading) return loading;

  loading = new Promise<void>((resolve, reject) => {
    const ready = () => {
      if (window.google?.accounts?.id) resolve();
      else reject(new Error('Google sign-in did not finish loading.'));
    };

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', ready, { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('Google sign-in could not load.')),
        { once: true }
      );
      return;
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = ready;
    script.onerror = () => {
      loading = null;
      reject(new Error('Google sign-in could not load.'));
    };
    document.head.appendChild(script);
  });

  return loading;
}
