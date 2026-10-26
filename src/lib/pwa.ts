/**
 * Install plumbing for the web app.
 *
 * A browser fires `beforeinstallprompt` when the app qualifies and the user has
 * not already installed it. The event can only be used once, and only from a
 * user gesture, so it is parked here and handed to the Account page's button.
 * Everything degrades quietly: a browser without the event simply never offers
 * the button, and the app remains a normal website.
 */

export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export const INSTALL_AVAILABLE_EVENT = 'hdsat:install-available';

let deferred: InstallPromptEvent | null = null;

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  if (iosStandalone) return true;
  return window.matchMedia?.('(display-mode: standalone)').matches ?? false;
}

/** Whether the browser has handed us an install prompt that has not been used. */
export function canInstall(): boolean {
  return deferred !== null;
}

/** Mark the shell so CSS can drop browser-only chrome when installed. */
function markDisplayMode(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('is-standalone', isStandalone());
}

export function installApp(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const prompt = deferred;
  if (!prompt) return Promise.resolve('unavailable');
  deferred = null;
  return prompt
    .prompt()
    .then(() => prompt.userChoice)
    .then((choice): 'accepted' | 'dismissed' =>
      choice.outcome === 'accepted' ? 'accepted' : 'dismissed'
    )
    .catch((): 'unavailable' => 'unavailable')
    .finally(() => {
      window.dispatchEvent(new Event(INSTALL_AVAILABLE_EVENT));
    });
}

export function watchInstallPrompt(): void {
  if (typeof window === 'undefined') return;
  markDisplayMode();
  window
    .matchMedia?.('(display-mode: standalone)')
    ?.addEventListener?.('change', markDisplayMode);

  window.addEventListener('beforeinstallprompt', (event) => {
    // The browser's own mini-infobar duplicates the Account card, so suppress it
    // and let the student choose from a place that also explains what installs.
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    window.dispatchEvent(new Event(INSTALL_AVAILABLE_EVENT));
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    markDisplayMode();
    window.dispatchEvent(new Event(INSTALL_AVAILABLE_EVENT));
  });
}

watchInstallPrompt();
