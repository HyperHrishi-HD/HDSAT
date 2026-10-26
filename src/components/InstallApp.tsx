import { useEffect, useState } from 'react';
import { Button } from './ui';
import {
  canInstall,
  INSTALL_AVAILABLE_EVENT,
  installApp,
  isStandalone,
} from '../lib/pwa';

/**
 * One line about installing the app, and a button when the browser is willing.
 *
 * The browser only offers an install prompt once it considers the app
 * installable (manifest, icons, a service worker) and the student has not
 * already installed it, so the button appears exactly when pressing it can
 * work. Everything else — iOS Safari, an already-installed app, a browser with
 * no prompt — reads as a sentence instead of a dead button.
 */
export function InstallApp() {
  const [available, setAvailable] = useState(() => canInstall());
  const [installed, setInstalled] = useState(() => isStandalone());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const update = () => {
      setAvailable(canInstall());
      setInstalled(isStandalone());
    };
    window.addEventListener(INSTALL_AVAILABLE_EVENT, update);
    return () => window.removeEventListener(INSTALL_AVAILABLE_EVENT, update);
  }, []);

  if (installed) {
    return (
      <p className="muted install-row">
        Installed. HDSAT opens in its own window and keeps working with no connection —
        answers sync when you are back online.
      </p>
    );
  }

  if (!available) {
    return (
      <p className="muted install-row">
        On a phone, open your browser&rsquo;s menu and choose <strong>Add to Home Screen</strong>{' '}
        to install HDSAT. It keeps the question bank offline.
      </p>
    );
  }

  return (
    <div className="install-row">
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void installApp()
            .then((outcome) => {
              if (outcome === 'accepted') setInstalled(true);
              if (outcome === 'dismissed') setNote('Install cancelled. You can try again any time.');
              if (outcome === 'unavailable') setNote('Your browser did not offer an install prompt.');
            })
            .finally(() => {
              setBusy(false);
              setAvailable(canInstall());
            });
        }}
      >
        {busy ? 'Opening…' : 'Install app'}
      </Button>
      <span className="muted">
        {note ?? 'Adds HDSAT to your home screen and caches the bank for offline practice.'}
      </span>
    </div>
  );
}
