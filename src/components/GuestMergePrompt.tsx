import { useState } from 'react';
import { Badge, Button } from './ui';
import { useApp } from '../lib/store';

/**
 * The only route from guest history into an account. Signing in parks the
 * merge behind this card: accepting is explicit, declining is remembered for
 * the account, and neither path silently changes the other side of the split.
 */
export function GuestMergePrompt() {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const prompt = app.guestMergePrompt;

  // The sign-in window owns the foreground while it is open. This card stays
  // queued and appears as soon as that window closes.
  if (!prompt || app.authModalOpen) return null;

  const total = prompt.attempts + prompt.saved + prompt.flashcards;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guest-merge-title"
    >
      <div className="modal-card guest-merge-card">
        <Badge tone="info">Guest progress</Badge>
        <h2 id="guest-merge-title" style={{ marginTop: 10 }}>
          Merge this device&rsquo;s history?
        </h2>
        <p>
          This browser has {total.toLocaleString()} guest item{total === 1 ? '' : 's'}:
          {' '}
          {prompt.attempts.toLocaleString()} answer{prompt.attempts === 1 ? '' : 's'},{' '}
          {prompt.saved.toLocaleString()} saved question{prompt.saved === 1 ? '' : 's'}, and{' '}
          {prompt.flashcards.toLocaleString()} flashcard review
          {prompt.flashcards === 1 ? '' : 's'}.
        </p>
        <p className="muted">
          Merging adds them to your signed-in account. Keeping them separate leaves the account
          exactly as it is; this device&rsquo;s guest history stays in this browser.
        </p>
        <div className="guest-merge-actions">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => app.actions.declineGuestMerge()}
          >
            Keep separate
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void app.actions.acceptGuestMerge();
            }}
          >
            {busy ? 'Merging…' : 'Merge into my account'}
          </Button>
        </div>
      </div>
    </div>
  );
}
