import { useEffect, useState } from 'react';
import { Alert, Button, Field, Toggle } from './ui';
import * as cloud from '../lib/cloud';
import {
  PASSWORD_MIN_LENGTH,
  cooldownMessage,
  remainingFor,
  validateNewPassword,
  type PasswordCooldown,
  type PasswordPath,
} from '../lib/password';

const NO_WAIT: Record<PasswordPath, PasswordCooldown> = {
  password: { nextAllowedAt: null, retryAfterSeconds: 0 },
  email: { nextAllowedAt: null, retryAfterSeconds: 0 },
};

interface PasswordDialogProps {
  /** `recover` is opened by a recovery link and skips the current-password check. */
  mode: 'change' | 'recover';
  email: string;
  onClose: () => void;
  onDone: (message: string) => void;
}

/**
 * Password change overlay. Both paths reserve time in the database before the
 * credential changes, so the countdown here mirrors a rule the server enforces
 * rather than being the rule itself.
 */
export function PasswordDialog({ mode, email, onClose, onDone }: PasswordDialogProps) {
  const [path, setPath] = useState<PasswordPath>('password');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cooldowns, setCooldowns] = useState(NO_WAIT);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    cloud
      .fetchPasswordCooldowns(email)
      .then((value) => {
        if (!cancelled) setCooldowns(value);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };      }, [email]);

  const passwordWait = remainingFor(cooldowns.password, now);
  const emailWait = remainingFor(cooldowns.email, now);

  const clearWait = (target: PasswordPath) => {
    setCooldowns((previous) => ({
      ...previous,
      [target]: { nextAllowedAt: null, retryAfterSeconds: 0 },
    }));
  };

  const handleBackdrop = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  const changeWithCurrentPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const invalid = validateNewPassword(next, confirm);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (!current) {
      setError('Enter your current password.');
      return;
    }
    if (passwordWait > 0) {
      setError(cooldownMessage('password', passwordWait));
      return;
    }

    setBusy(true);
    let actionId: string | null = null;
    try {
      const claim = await cloud.claimPasswordAction('password');
      setCooldowns((previous) => ({
        ...previous,
        password: {
          nextAllowedAt: claim.nextAllowedAt,
          retryAfterSeconds: claim.retryAfterSeconds,
        },
      }));
      if (!claim.allowed || !claim.actionId) {
        setError(cooldownMessage('password', remainingFor(claim, Date.now())));
        return;
      }
      actionId = claim.actionId;

      const verified = await cloud.verifyCurrentPassword(current);
      if (!verified) {
        await cloud.cancelPasswordAction(actionId).catch(() => {});
        actionId = null;
        clearWait('password');
        setError('Current password is incorrect.');
        return;
      }

      await cloud.updatePassword(next, signOutOthers);
      await cloud.completePasswordAction(actionId).catch(() => {});
      actionId = null;
      onDone(signOutOthers ? 'Password updated. Other sessions signed out.' : 'Password updated.');
    } catch (err) {
      if (actionId) {
        await cloud.cancelPasswordAction(actionId).catch(() => {});
        clearWait('password');
      }
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sendRecoveryLink = async () => {
    setError(null);
    setMessage(null);
    if (emailWait > 0) {
      setError(cooldownMessage('email', emailWait));
      return;
    }
    setBusy(true);
    try {
      // One recovery link per address per day, counted by the server. The row is
      // written only after Supabase accepts the send, so a failure never locks
      // this address out for 24 hours.
      await cloud.requestPasswordReset(email);
      await cloud.recordEmailRequest(email, 'reset').catch(() => {});
      setCooldowns((previous) => ({
        ...previous,
        email: { nextAllowedAt: null, retryAfterSeconds: 24 * 60 * 60 },
      }));
      setMessage(`Recovery link sent to ${email}. It works once.`);
    } catch (err) {
      clearWait('email');
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveRecoveredPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const invalid = validateNewPassword(next, confirm);
    if (invalid) {
      setError(invalid);
      return;
    }
    // No cooldown check here: the recovery link is the authorisation, and the
    // request itself was already rate-limited to one per day. Blocking this
    // would strand a student who asked for a link after a recent change.
    setBusy(true);
    try {
      await cloud.updatePassword(next, signOutOthers);
      // Best effort: a recovery change also consumes the 1/hour password window.
      // If a change already happened this hour the claim is refused, and the
      // credential change above has still succeeded.
      const claim = await cloud.claimPasswordAction('password').catch(() => null);
      if (claim?.allowed && claim.actionId) {
        await cloud.completePasswordAction(claim.actionId).catch(() => {});
      }
      onDone(signOutOthers ? 'Password updated. Other sessions signed out.' : 'Password updated.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={handleBackdrop}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-dialog-title"
      >
        <div className="row-between" style={{ marginBottom: 8 }}>
          <h2 id="password-dialog-title" style={{ margin: 0 }}>
            {mode === 'recover' ? 'Set a new password' : 'Change password'}
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        {mode === 'recover' ? (
          <p className="muted" style={{ marginTop: 0 }}>
            Recovery link accepted. Choose a new password.
          </p>
        ) : null}

        {error ? <Alert tone="error">{error}</Alert> : null}
        {message ? <Alert tone="notice">{message}</Alert> : null}

        {mode === 'change' ? (
          <div className="row" style={{ marginBottom: 12 }}>
            <Button
              type="button"
              size="sm"
              variant={path === 'password' ? 'primary' : 'outline'}
              onClick={() => {
                setPath('password');
                setError(null);
                setMessage(null);
              }}
            >
              Current password
            </Button>
            <Button
              type="button"
              size="sm"
              variant={path === 'email' ? 'primary' : 'outline'}
              onClick={() => {
                setPath('email');
                setError(null);
                setMessage(null);
              }}
            >
              Email link
            </Button>
          </div>
        ) : null}

        {mode === 'recover' ? (
          <form onSubmit={saveRecoveredPassword} className="stack">
            <Field label="New password" hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}>
              <input
                type="password"
                value={next}
                onChange={(event) => setNext(event.target.value)}
                autoComplete="new-password"
                autoFocus
                required
              />
            </Field>
            <Field label="Confirm new password">
              <input
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password"
                required
              />
            </Field>
            <Toggle
              checked={signOutOthers}
              onChange={setSignOutOthers}
              label="Sign out other sessions"
            />
            <div className="row">
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save password'}
              </Button>
            </div>
          </form>
        ) : path === 'password' ? (
          <form onSubmit={changeWithCurrentPassword} className="stack">
            <Field label="Current password">
              <input
                type="password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                autoComplete="current-password"
                autoFocus
                required
              />
            </Field>
            <Field label="New password" hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}>
              <input
                type="password"
                value={next}
                onChange={(event) => setNext(event.target.value)}
                autoComplete="new-password"
                required
              />
            </Field>
            <Field label="Confirm new password">
              <input
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password"
                required
              />
            </Field>
            <Toggle
              checked={signOutOthers}
              onChange={setSignOutOthers}
              label="Sign out other sessions"
            />
            <div className="row">
              <Button type="submit" disabled={busy || passwordWait > 0}>
                {busy ? 'Updating…' : 'Update password'}
              </Button>
            </div>
            {passwordWait > 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                {cooldownMessage('password', passwordWait)}
              </p>
            ) : null}
          </form>
        ) : (
          <div className="stack">
            <div className="muted-block">
              <p style={{ margin: 0 }}>We'll email a one-time recovery link to {email}.</p>
            </div>
            <div className="row">
              <Button type="button" onClick={() => void sendRecoveryLink()} disabled={busy || emailWait > 0}>
                {busy ? 'Sending…' : 'Send link'}
              </Button>
            </div>
            {emailWait > 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                {cooldownMessage('email', emailWait)}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
