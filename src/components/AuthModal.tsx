import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Field, Select, Toggle } from './ui';
import * as cloud from '../lib/cloud';
import { validateConsent } from '../lib/dataRights';
import { AGE_BANDS, COPYRIGHT_PATH, LEGAL_VERSION, MIN_AGE, PRIVACY_PATH, TERMS_PATH } from '../lib/legal';
import { formatCooldown } from '../lib/password';
import { formatRemainingHours } from '../lib/storage';
import { queueEmail, removeQueuedEmail } from '../lib/emailQueue';
import { useApp } from '../lib/store';

/**
 * One entry point for accounts.
 *
 * The sign-in card doubles as sign-up: a password that matches an account signs
 * in, and a new address creates one. Whenever the account turns out to exist
 * but is not confirmed, this opens a second, narrower card that asks only for
 * the 6-digit code — the same fields and buttons, so the jump is obvious. There
 * are no tabs: the code card appears exactly when a code is what is needed.
 */
export function AuthModal() {
  const app = useApp();
  const [email, setEmail] = useState(app.pendingAccount?.email ?? app.user?.email ?? '');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(app.pendingAccount?.displayName ?? '');
  const [ageBand, setAgeBand] = useState('');
  const [guardianConsent, setGuardianConsent] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (app.pendingAccount?.email && !email) {
      setEmail(app.pendingAccount.email);
      setDisplayName(app.pendingAccount.displayName);
    }
  }, [app.pendingAccount, email]);

  // A signed-in light account is confirming the address it already owns, so the
  // field arrives filled instead of asking them to retype it.
  useEffect(() => {
    if (app.authModalOpen && app.user?.email && !email) setEmail(app.user.email);
  }, [app.authModalOpen, app.user?.email, email]);

  useEffect(() => {
    if (!app.authModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        app.actions.closeAuthModal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [app.authModalOpen, app.actions]);

  if (!app.authModalOpen) return null;

  const targetEmail = email.trim() || app.pendingAccount?.email || '';
  const remainingMs = app.pendingAccount
    ? Math.max(0, app.pendingAccount.expiresAt - Date.now())
    : 0;
  const isVerify = app.authModalView === 'verify';

  const openVerify = (address: string, message: string) => {
    if (address) setEmail(address);
    setPassword('');
    setFormError(null);
    setStatusMessage(message);
    app.actions.openAuthModal('verify');
  };

  const sendRecoveryLink = async (address: string) => {
    if (!address) {
      setFormError('Enter your email address first.');
      return;
    }
    const wait = await cloud.emailRequestWait(address, 'reset').catch(() => 0);
    if (wait > 0) {
      setStatusMessage(
        `A recovery link was already sent to ${address}. You can request another in ${formatCooldown(wait)}.`
      );
      return;
    }
    // The day's provider allowance covers recovery links too. When it is gone,
    // the request is parked rather than refused: the link goes out on the next
    // app open after the UTC reset.
    const budget = await cloud.emailSendBudget().catch(() => null);
    if (budget && !budget.allowed) {
      queueEmail(address, 'reset');
      setStatusMessage(
        `Today's email limit is used up, so this recovery link is queued: it goes out the next time you open HDSAT after midnight UTC. Your password is unchanged until you open it.`
      );
      return;
    }
    await cloud.requestPasswordReset(address);
    await cloud.recordEmailRequest(address, 'reset').catch(() => {});
    removeQueuedEmail(address, 'reset');
    setStatusMessage('Recovery link sent. Open it to set a new password.');
  };

  const handleForgotPassword = async () => {
    setFormError(null);
    setStatusMessage(null);
    if (!targetEmail) {
      setFormError('Enter your email address first.');
      return;
    }
    setBusy(true);
    try {
      await sendRecoveryLink(targetEmail);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setStatusMessage(null);
    if (!email.trim() || !password) {
      setFormError('Please enter both your email address and password.');
      return;
    }
    setBusy(true);
    try {
      const attempt = await app.actions.attemptSignIn(email.trim(), password);
      if (attempt.ok) {
        setPassword('');
        app.actions.closeAuthModal();
        return;
      }
      if (attempt.reason === 'unconfirmed') {
        openVerify(
          email.trim(),
          `This account is waiting for its confirmation email. Enter the 6-digit code sent to ${email.trim()}.`
        );
        return;
      }
      if (attempt.reason === 'error') {
        setFormError(attempt.message ?? 'Sign-in failed. Check your connection and try again.');
        return;
      }

      const consent = validateConsent({ ageBand, guardianConsent, acceptedTerms });
      if (!consent.ok) {
        // The only way to know whether this address is already registered is to
        // ask for a signup, which needs consent. Say that plainly instead of
        // showing a bare "new account" validation error.
        setFormError(
          'That email and password did not sign in. New here? Complete the age and policy section below, then press Continue again — or use Forgot password.'
        );
        return;
      }
      try {
        const result = await app.actions.signUp(
          email.trim(),
          password,
          displayName.trim() || 'Student',
          consent.metadata
        );
        setPassword('');
        setStatusMessage(result.message);
        if (result.verificationRequired) app.actions.openAuthModal('verify');
      } catch (err) {
        if (err instanceof cloud.AccountExistsError) {
          openVerify(
            email.trim(),
            `That email already has an account. Enter its 6-digit code, or request a recovery link below.`
          );
          return;
        }
        throw err;
      }
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!targetEmail || !verifyCode.trim()) {
      setFormError('Enter your email address and the 6-digit code from the confirmation email.');
      return;
    }
    setVerifying(true);
    try {
      await app.actions.verifySignupCode(targetEmail, verifyCode.trim());
      setVerifyCode('');
      app.actions.closeAuthModal();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    setFormError(null);
    setStatusMessage(null);
    if (!targetEmail) {
      setFormError('Enter your email address first.');
      return;
    }
    try {
      await app.actions.resendVerification(targetEmail);
      setStatusMessage('Confirmation email sent. The 6-digit code works for 24 hours.');
    } catch (err) {
      setFormError((err as Error).message);
    }
  };

  const handleRecoveryFromVerify = async () => {
    setFormError(null);
    setStatusMessage(null);
    setVerifying(true);
    try {
      await sendRecoveryLink(targetEmail);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={isVerify ? 'Confirm your email' : 'Sign in or create an account'}
      onClick={(e) => {
        if (e.target === e.currentTarget) app.actions.closeAuthModal();
      }}
    >
      <div className={`modal-card auth-modal-card${isVerify ? ' auth-modal-confirm' : ''}`}>
        <div className="row-between" style={{ marginBottom: 8 }}>
          <div>
            <h2 style={{ margin: 0 }}>
              {isVerify ? 'Confirm your email' : 'Sign in or create an account'}
            </h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {isVerify ? 'The code works for 24 hours.' : 'Sync across devices.'}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={app.actions.closeAuthModal}>
            Close
          </Button>
        </div>

        {statusMessage ? <Alert tone="notice">{statusMessage}</Alert> : null}
        {formError ? <Alert tone="error">{formError}</Alert> : null}

        {!app.cloudConfigured ? (
          <div className="muted-block">
            <p style={{ margin: 0 }}>
              Cloud authentication is not configured in this build. You can continue studying in
              Guest Mode on this device.
            </p>
          </div>
        ) : isVerify ? (
          <form onSubmit={handleVerify} className="stack">
            {app.user ? (
              <p className="muted" style={{ margin: 0 }}>
                You are signed in. Confirming lifts the light-account limit: full answer history and
                test detail are kept in the cloud.
              </p>
            ) : null}
            <Field label="Email Address">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </Field>
            <Field label="6-digit code">
              <input
                type="text"
                inputMode="numeric"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                autoComplete="one-time-code"
                autoFocus
                required
              />
            </Field>
            <div className="row">
              <Button type="submit" disabled={verifying}>
                {verifying ? 'Confirming…' : app.user ? 'Confirm' : 'Confirm & Sign In'}
              </Button>
              <Button type="button" variant="outline" onClick={() => void handleResend()}>
                Resend
              </Button>
              {app.user ? (
                <Button type="button" variant="ghost" onClick={app.actions.closeAuthModal}>
                  Later
                </Button>
              ) : null}
            </div>
            {app.pendingAccount && remainingMs > 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                {app.pendingAccount.email} · {formatRemainingHours(remainingMs)} left
              </p>
            ) : null}
            <p className="auth-switch">
              <button
                type="button"
                className="link-button"
                onClick={() => void handleRecoveryFromVerify()}
                disabled={verifying}
              >
                Email me a recovery link
              </button>
              <span className="muted"> · </span>
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setFormError(null);
                  setStatusMessage(null);
                  if (app.user) app.actions.closeAuthModal();
                  else app.actions.openAuthModal('signin');
                }}
              >
                {app.user ? 'Close' : 'Back to sign in'}
              </button>
            </p>
          </form>
        ) : (
          <form onSubmit={handleSubmit}>
            <Field label="Email Address">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </Field>
            <Field label="Password" hint="At least 6 characters.">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </Field>
            <p style={{ margin: '0 0 10px' }}>
              <button
                type="button"
                className="link-button"
                onClick={() => void handleForgotPassword()}
                disabled={busy}
              >
                Forgot password?
              </button>
            </p>
            <Field label="Display name">
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Hrishi"
                autoComplete="nickname"
              />
            </Field>

            <details className="auth-details">
              <summary>New account? Age &amp; policy consent</summary>
              <Select
                label="Your age group"
                value={ageBand}
                onChange={setAgeBand}
                options={[{ value: '', label: 'Select your age group…' }, ...AGE_BANDS]}
              />
              {ageBand.length > 0 && ageBand !== '18+' ? (
                <div className="muted-block" style={{ marginBottom: 10 }}>
                  <p className="muted" style={{ marginTop: 0, marginBottom: 6 }}>
                    Students aged {MIN_AGE}–17 require parent or guardian consent.
                  </p>
                  <Toggle
                    checked={guardianConsent}
                    onChange={setGuardianConsent}
                    label="My parent or guardian agrees to the Terms and Privacy Policy"
                  />
                </div>
              ) : null}
              <Toggle
                checked={acceptedTerms}
                onChange={setAcceptedTerms}
                label={`I accept the Terms of Service & Privacy Policy (v${LEGAL_VERSION})`}
              />
              <p className="muted" style={{ marginBottom: 8 }}>
                <Link to={TERMS_PATH} onClick={app.actions.closeAuthModal}>
                  Terms
                </Link>{' '}
                ·{' '}
                <Link to={PRIVACY_PATH} onClick={app.actions.closeAuthModal}>
                  Privacy
                </Link>{' '}
                ·{' '}
                <Link to={COPYRIGHT_PATH} onClick={app.actions.closeAuthModal}>
                  Copyright
                </Link>
              </p>
            </details>

            <div className="row" style={{ marginTop: 12 }}>
              <Button type="submit" disabled={busy}>
                {busy ? 'Checking…' : 'Continue'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  app.actions.continueAsGuest();
                  app.actions.closeAuthModal();
                }}
              >
                Continue in Guest Mode
              </Button>
            </div>

            <p className="auth-switch">
              <button
                type="button"
                className="link-button"
                onClick={() =>
                  openVerify(
                    email.trim(),
                    'Enter the 6-digit code from your confirmation email.'
                  )
                }
              >
                Have a confirmation code?
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
