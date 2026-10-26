import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Icon } from './ui';
import { useApp } from '../lib/store';

/** How long "Later" hides the reminder before it comes back. */
const REPEAT_MS = 20 * 60 * 1000;
const HIDE_KEY = 'hdsat.verify-reminder.v1';

/**
 * A light account can study, sync progress and take full tests — it just has
 * not proved it owns the address. This strip is the nudge: it appears shortly
 * after the app opens, and again every 20 minutes after "Later", because a
 * single dismissable banner gets ignored and the account stays limited forever.
 *
 * It is deliberately absent inside the full-test runner: nothing may interrupt
 * a timed section.
 */
export function VerifyEmailBanner() {
  const app = useApp();
  const location = useLocation();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const eligible = Boolean(app.user) && !app.emailVerified && app.cloudConfigured;
  const inTest = location.pathname.startsWith('/test');

  useEffect(() => {
    if (!eligible || inTest) {
      setVisible(false);
      return;
    }
    let hiddenUntil = 0;
    try {
      hiddenUntil = Number(window.localStorage.getItem(HIDE_KEY) ?? 0);
    } catch {
      hiddenUntil = 0;
    }
    if (Date.now() < hiddenUntil) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), 1500);
    return () => window.clearTimeout(timer);
  }, [eligible, inTest]);

  // A light account is also where a request parked by yesterday's mail ceiling
  // gets sent: opening the app after the UTC reset is the trigger, and the
  // store refuses to send twice for the same address in one day.
  const flushQueued = app.actions.flushQueuedEmails;
  useEffect(() => {
    if (!eligible || inTest) return;
    void flushQueued();
  }, [eligible, inTest, flushQueued]);

  useEffect(() => {
    if (!eligible || inTest) return;
    const id = window.setInterval(() => {
      let hiddenUntil = 0;
      try {
        hiddenUntil = Number(window.localStorage.getItem(HIDE_KEY) ?? 0);
      } catch {
        hiddenUntil = 0;
      }
      if (Date.now() >= hiddenUntil) setVisible(true);
    }, 60_000);
    return () => window.clearInterval(id);
  }, [eligible, inTest]);

  if (!eligible || inTest || !visible) return null;

  const later = () => {
    try {
      window.localStorage.setItem(HIDE_KEY, String(Date.now() + REPEAT_MS));
    } catch {
      /* storage disabled: the interval will simply bring it back */
    }
    setVisible(false);
  };

  const resend = async () => {
    setMessage(null);
    setBusy(true);
    try {
      await app.actions.resendVerification(app.user?.email ?? '');
      setMessage('Code sent. It works for 24 hours.');
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="welcome-banner verify-banner" role="status">
      <span>
        <strong>Confirm your email.</strong>{' '}
        {message ?? 'Progress syncs now; answer detail stays on this device until you confirm.'}
      </span>
      <div className="welcome-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => app.actions.openAuthModal('verify')}
        >
          <Icon name="check" size={13} />
          <span>Enter code</span>
        </button>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => void resend()}
          disabled={busy}
        >
          {busy ? 'Sending…' : 'Resend'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={later}>
          Later
        </button>
      </div>
    </div>
  );
}
