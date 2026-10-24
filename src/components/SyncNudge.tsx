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
          ×
        </button>
      </span>
    </div>
  );
}
