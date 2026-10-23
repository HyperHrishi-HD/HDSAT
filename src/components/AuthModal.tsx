import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Field, Select, Toggle } from './ui';
import { validateConsent } from '../lib/dataRights';
import { AGE_BANDS, COPYRIGHT_PATH, LEGAL_VERSION, MIN_AGE, PRIVACY_PATH, TERMS_PATH } from '../lib/legal';
import { formatRemainingHours } from '../lib/storage';
import { useApp } from '../lib/store';

export function AuthModal() {
  const app = useApp();
  const [email, setEmail] = useState(app.pendingAccount?.email ?? '');
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
        app.actions.openAuthModal('verify');
        setStatusMessage(
          `Your account exists, and a confirmation email is active for ${email.trim()}. Enter the 6-digit code below.`
        );
        return;
      }
      if (attempt.reason === 'error') {
        setFormError(attempt.message ?? 'Sign-in failed. Check your connection and try again.');
        return;
      }

      const consent = validateConsent({ ageBand, guardianConsent, acceptedTerms });
      if (!consent.ok) {
        setFormError('New account: ' + consent.errors.join(' '));
        return;
      }
      const msg = await app.actions.signUp(
        email.trim(),
        password,
        displayName.trim() || 'Student',
        consent.metadata
      );
      setStatusMessage(msg);
      setPassword('');
      app.actions.openAuthModal('verify');
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setStatusMessage(null);
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
      setStatusMessage(
        'Confirmation email sent. Your 6-digit code works for a full 24 hours.'
      );
    } catch (err) {
      setFormError((err as Error).message);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Sign in or create an account"
      onClick={(e) => {
        if (e.target === e.currentTarget) app.actions.closeAuthModal();
      }}
    >
      <div className="modal-card auth-modal-card">
        <div className="row-between" style={{ marginBottom: 8 }}>
          <div>
            <h2 style={{ margin: 0 }}>
              {app.authModalView === 'verify'
                ? 'Confirm your email (24-hour code)'
                : 'Sign in or create an account'}
            </h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {app.authModalView === 'verify'
                ? 'Your confirmation code stays active for a full 24 hours so you only need one email.'
                : 'Sync your practice history, streaks, and HDCoins across devices.'}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={app.actions.closeAuthModal}>
            Close
          </Button>
        </div>

        <div className="row" style={{ marginBottom: 12 }}>
          <Button
            type="button"
            size="sm"
            variant={app.authModalView === 'signin' ? 'primary' : 'outline'}
            onClick={() => app.actions.openAuthModal('signin')}
          >
            Sign in / Sign up
          </Button>
          <Button
            type="button"
            size="sm"
            variant={app.authModalView === 'verify' ? 'primary' : 'outline'}
            onClick={() => app.actions.openAuthModal('verify')}
          >
            Enter 6-digit code
          </Button>
          <Link
            to="/account"
            className="btn btn-ghost btn-sm"
            onClick={app.actions.closeAuthModal}
          >
            Full Account Page
          </Link>
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
        ) : app.authModalView === 'verify' ? (
          <form onSubmit={handleVerify} className="stack">
            <div className="muted-block">
              <strong>One email per 24 hours</strong>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                {app.pendingAccount && remainingMs > 0
                  ? `Active code for ${app.pendingAccount.email} (${formatRemainingHours(
                      remainingMs
                    )} remaining in its 24-hour window). You can also confirm anytime from the Account tab.`
                  : 'Enter the email address you signed up with and the 6-digit code from your confirmation email.'}
              </p>
            </div>
            <Field label="Email Address">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </Field>
            <Field label="6-Digit Confirmation Code">
              <input
                type="text"
                inputMode="numeric"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                autoComplete="one-time-code"
                required
              />
            </Field>
            <div className="row">
              <Button type="submit" disabled={verifying}>
                {verifying ? 'Confirming…' : 'Confirm & Sign In'}
              </Button>
              <Button type="button" variant="outline" onClick={handleResend}>
                Send / Check 24h Window
              </Button>
            </div>
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
            <Field label="Display name (for new accounts)">
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
          </form>
        )}
      </div>
    </div>
  );
}
