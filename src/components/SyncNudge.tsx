import { useState } from 'react';
import {
  dismissSyncNudge,
  hasStoredProfile,
  shouldShowSyncNudge,
} from '../lib/storage';
import { useApp } from '../lib/store';
import { Icon } from './ui';

/**
 * One thin amber strip at the top of the Dashboard, for a guest who has begun
 * using the app: sign in and this progress follows them to another device.
 *
 * It is shown at most twice. The first close covers this visit; the second
 * appearance waits for the next visit, and closing that one retires the strip
 * permanently. A signed-in student never sees it.
 */
export function SyncNudge() {
  const app = useApp();
  const [visible, setVisible] = useState(() => shouldShowSyncNudge());

  // Awaiting sync is the whole strip when there is something waiting, because
  // that is the only thing a student needs to know at that moment.
  if (app.outboxPending > 0) {
    return (
      <div className="sync-nudge is-queue" role="status">
        <span className="sync-nudge-text">
          <Icon name="cloud" size={13} />
          <span>
            {app.outboxPending} answer{app.outboxPending === 1 ? '' : 's'} saved here, waiting to
            sync
          </span>
        </span>
      </div>
    );
  }

  if (!visible || app.user || !app.cloudConfigured || !hasStoredProfile()) return null;

  const close = () => {
    dismissSyncNudge();
    setVisible(false);
  };

  return (
    <div className="sync-nudge" role="status">
      <span className="sync-nudge-text">
        <Icon name="cloud" size={14} />
        <span>
          <strong>Save your progress.</strong> Sign in and it follows you to any device.
        </span>
      </span>
      <span className="sync-nudge-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => app.actions.openAuthModal('signin')}
        >
          Sign in
        </button>
        <button type="button" className="sync-nudge-close" aria-label="Dismiss" onClick={close}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </span>
    </div>
  );
}
