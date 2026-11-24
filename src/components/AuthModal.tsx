import { useEffect, useLayoutEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import { BrandMark } from './BrandMark';
import { DatePicker } from './DatePicker';
import { GoogleSignInButton } from './GoogleSignInButton';
import { MenuSelect, Select, Toggle } from './ui';
import * as cloud from '../lib/cloud';
import { validateConsent } from '../lib/dataRights';
import { AGE_BANDS, COPYRIGHT_PATH, LEGAL_VERSION, MIN_AGE, PRIVACY_PATH, TERMS_PATH } from '../lib/legal';
import { formatCooldown } from '../lib/password';
import { formatRemainingHours, pendingCodeEndsAt } from '../lib/storage';
import * as emailAllowance from '../lib/emailAllowance';
import { budgetAllows, queueEmail, removeQueuedEmail } from '../lib/emailQueue';
import { useApp } from '../lib/store';
import { useBackdropDismiss } from '../lib/useBackdropDismiss';

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
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleFallback, setGoogleFallback] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // Sign-in and account creation are two screens of the same window: the
  // second one appears only when the email turns out to be new.
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [prefAssessment, setPrefAssessment] = useState(app.settings?.assessment ?? 'SAT');
  const [prefTestDate, setPrefTestDate] = useState<string | null>(
    app.settings?.testDate ?? null
  );

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

  // Every open starts on the screen it was called for, whatever the last visit
  // ended on: the homepage's Sign up button goes straight to account creation,
  // while an ordinary sign-in call still opens the sign-in form.
  useLayoutEffect(() => {
    if (!app.authModalOpen) return;
    setMode(app.authModalView === 'signup' ? 'signup' : 'signin');
    setFormError(null);
    setStatusMessage(null);
    setGoogleFallback(false);
    // Start from what this browser already studies, so the optional box is a
    // confirmation rather than a form to fill in.
    setPrefAssessment(app.settings?.assessment ?? 'SAT');
    setPrefTestDate(app.settings?.testDate ?? null);
    // Deliberately keyed on open only: applying the signup preferences changes
    // settings, and that must not clear the confirmation message that follows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.authModalOpen]);

  // Pressing outside closes the card; dragging a selection out of it does not.
  // Declared before the early return so the hook order never changes.
  const backdrop = useBackdropDismiss(app.actions.closeAuthModal);

  if (!app.authModalOpen) return null;

  const targetEmail = email.trim() || app.pendingAccount?.email || '';
  const remainingMs = app.pendingAccount
    ? Math.max(0, pendingCodeEndsAt(app.pendingAccount) - Date.now())
    : 0;
  const isVerify = app.authModalView === 'verify';
  const isSignup = !isVerify && mode === 'signup';

  const openVerify = (address: string, message: string) => {
    if (address) setEmail(address);
    setPassword('');
    setFormError(null);
    setStatusMessage(message);
    setMode('signin');
    app.actions.openAuthModal('verify');
  };

  const sendRecoveryLink = async (address: string) => {
    if (!address) {
      setFormError('Enter your email address first.');
      return;
    }
    // Same daily allowance as the confirmation code: one message per address,
    // whichever button sent it. Checked locally first so the answer is instant
    // even when the network is slow, then confirmed against the database.
    const localWait = emailAllowance.emailAllowanceRemaining(address);
    if (localWait > 0) {
      setStatusMessage(emailAllowance.oneEmailPerDayMessage(address, localWait));
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
    if (!budgetAllows('reset', budget)) {
      queueEmail(address, 'reset');
      setStatusMessage(
        `Today's email limit is used up, so this recovery link is queued: it goes out the next time you open HDSAT after midnight UTC. Your password is unchanged until you open it.`
      );
      return;
    }
    await cloud.requestPasswordReset(address);
    await cloud.recordEmailRequest(address, 'reset').catch(() => {});
    emailAllowance.recordEmailSent(address);
    removeQueuedEmail(address, 'reset');
    setStatusMessage(
      'Recovery link sent. It works for 12 hours and can be used once. It can take a few minutes — only one is sent per day, so check spam before asking again.'
    );
  };

  const handleGoogle = async () => {
    setFormError(null);
    setStatusMessage(null);
    setGoogleBusy(true);
    try {
      // This navigates to Google and back to Account; the button stays in its
      // pending state until the page leaves or the provider returns an error.
      await cloud.signInWithGoogle();
    } catch (err) {
      setGoogleBusy(false);
      const message = (err as Error).message;
      setFormError(
        /provider is not enabled|unsupported provider/i.test(message)
          ? 'Google sign-in is not enabled on this deployment yet. Use email or Guest Mode, or ask the operator to enable the Google provider.'
          : message
      );
    }
  };

  const handleGoogleCredential = async (credential: string) => {
    setFormError(null);
    setStatusMessage(null);
    setGoogleBusy(true);
    try {
      await cloud.signInWithGoogleIdToken(credential);
      await app.actions.completeGoogleSignIn();
      app.actions.closeAuthModal();
    } catch (err) {
      const message = (err as Error).message;
      setFormError(
        /invalid.*token|audience|provider is not enabled|unsupported provider/i.test(message)
          ? 'Google could not finish signing you in. Try again, or use your email and password.'
          : message
      );
    } finally {
      setGoogleBusy(false);
    }
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

      // Supabase answers the same way for a wrong password and an address it
      // has never seen, so this must not guess. Sending a mistyped password
      // into account creation is how duplicate accounts get made; the sign-in
      // screen says the password is wrong and offers creation as its own,
      // explicit next step.
      setFormError('Incorrect email or password. Check the password and try again.');
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * The new-account screen. It is the same window as sign-in, expanded once: the
   * details a new account needs, plus the two preferences that shape the first
   * session, so nothing has to be set up again in Account afterwards.
   */
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setStatusMessage(null);
    if (!email.trim() || !password) {
      setFormError('Please enter both your email address and password.');
      return;
    }
    const consent = validateConsent({ ageBand, guardianConsent, acceptedTerms });
    if (!consent.ok) {
      setFormError(
        ageBand
          ? `Accept the Terms of Service and Privacy Policy (v${LEGAL_VERSION}) to create an account.`
          : 'Choose your age group and accept the Terms to create an account.'
      );
      return;
    }
    setBusy(true);
    try {
      const result = await app.actions.signUp(
        email.trim(),
        password,
        displayName.trim() || 'Student',
        consent.metadata
      );
      app.actions.updateSettings({
        assessment: prefAssessment,
        testDate: prefTestDate,
      });
      // The cloud profile keeps its own copy of the goal; the local write above
      // cannot reach it while the modal still holds the guest render.
      if (
        prefAssessment !== app.settings?.assessment ||
        (prefTestDate ?? null) !== (app.settings?.testDate ?? null)
      ) {
        await cloud.setTestGoalCloud(prefAssessment, prefTestDate).catch(() => {});
      }
      setPassword('');
      setStatusMessage(result.message);
      if (result.verificationRequired) app.actions.openAuthModal('verify');
    } catch (err) {
      if (err instanceof cloud.AccountExistsError) {
        openVerify(
          email.trim(),
          'That email already has an account. Enter its 6-digit code, use Continue with Google if you signed up that way, or request a recovery link below.'
        );
        return;
      }
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
      setStatusMessage('Confirmation email sent. The 6-digit code works for 12 hours.');
    } catch (err) {
      // A cooldown or the day's cap is guidance, not a failed action: the
      // account already works, so this stays a notice rather than a red alarm.
      setStatusMessage((err as Error).message);
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
      className="modal-backdrop auth-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      {...backdrop}
    >
      <div className="auth-ambient" aria-hidden="true">
        <span className="auth-aurora auth-aurora-top" />
        <span className="auth-aurora auth-aurora-bottom" />
        <span className="auth-aurora auth-aurora-left" />
        <span className="auth-aurora auth-aurora-right" />
        <span className="auth-noise" />
      </div>

      <div className="auth-stage">
        <div className={`auth-glass${isVerify ? ' is-confirm' : ''}`}>
          {/* Kept outside the scrolling card so it remains reachable on a
              short phone screen. */}
          <button
            type="button"
            className="auth-close"
            onClick={app.actions.closeAuthModal}
            aria-label="Close sign-in window"
          >
            <X size={16} aria-hidden="true" />
          </button>

          <div className="auth-card">
            <header className="auth-head">
              <div className="auth-brand">
                <BrandMark size={38} />
                <span className="auth-brand-name">HDSAT</span>
              </div>
              <h2 id="auth-modal-title">
                {isVerify
                  ? 'Check your email'
                  : isSignup
                  ? 'Create your account'
                  : 'Welcome back'}
              </h2>
              <p className="auth-subtitle">
                {isVerify
                  ? 'Enter the 6-digit code we sent to finish signing in.'
                  : isSignup
                  ? 'One step, then your practice is saved to the cloud.'
                  : 'Sign in to sync your practice, coins and test history.'}
              </p>
            </header>

            {statusMessage ? (
              <div className="auth-status" role="status">
                {statusMessage}
              </div>
            ) : null}
            {formError ? (
              <div className="auth-error" role="alert">
                {formError}
              </div>
            ) : null}

            {!app.cloudConfigured ? (
              <div className="auth-empty">
                <p>
                  Cloud authentication is not configured in this build. You can continue studying in
                  Guest Mode on this device.
                </p>
                <button
                  type="button"
                  className="auth-submit"
                  onClick={() => {
                    app.actions.continueAsGuest();
                    app.actions.closeAuthModal();
                  }}
                >
                  <span>Continue in Guest Mode</span>
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
              </div>
            ) : isVerify ? (
              <form onSubmit={handleVerify} className="auth-form">
                {app.user ? (
                  <p className="auth-note">
                    You are signed in. Confirming lifts the light-account limit: full answer history
                    and test detail are kept in the cloud.
                  </p>
                ) : null}

                <label className="auth-field">
                  <span className="auth-label">Email address</span>
                  <span className="auth-input-wrap">
                    <Mail className="auth-input-icon" size={16} aria-hidden="true" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                      required
                    />
                  </span>
                </label>

                <label className="auth-field">
                  <span className="auth-label">6-digit code</span>
                  <span className="auth-input-wrap">
                    <KeyRound className="auth-input-icon" size={16} aria-hidden="true" />
                    <input
                      className="auth-code-input"
                      type="text"
                      inputMode="numeric"
                      value={verifyCode}
                      onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="123456"
                      autoComplete="one-time-code"
                      autoFocus
                      required
                    />
                  </span>
                </label>

                <button className="auth-submit" type="submit" disabled={verifying}>
                  {verifying ? (
                    <span className="auth-spinner" aria-label="Confirming" />
                  ) : (
                    <>
                      <span>{app.user ? 'Confirm email' : 'Confirm & Sign In'}</span>
                      <ArrowRight size={15} aria-hidden="true" />
                    </>
                  )}
                </button>

                <div className="auth-action-row">
                  <button
                    type="button"
                    className="auth-secondary"
                    onClick={() => void handleResend()}
                    disabled={verifying}
                  >
                    Resend code
                  </button>
                  <button
                    type="button"
                    className="auth-text-button"
                    onClick={() => void handleRecoveryFromVerify()}
                    disabled={verifying}
                  >
                    Email me a recovery link
                  </button>
                </div>

                {app.pendingAccount && remainingMs > 0 ? (
                  <p className="auth-meta">
                    {app.pendingAccount.email} · {formatRemainingHours(remainingMs)} left
                  </p>
                ) : null}

                <p className="auth-switch">
                  <button
                    type="button"
                    className="auth-text-button"
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
            ) : isSignup ? (
              /*
               * First-time account screen. It only ever appears after a sign-in
               * that matched no account, so an existing student never sees it.
               * Same panel, expanded: identity, consent, then the two study
               * preferences that shape the first session.
               */
              <form onSubmit={handleCreate} className="auth-form">
                <label className="auth-field">
                  <span className="auth-label">
                    Display name <span className="auth-optional">optional</span>
                  </span>
                  <span className="auth-input-wrap">
                    <UserRound className="auth-input-icon" size={16} aria-hidden="true" />
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="e.g. Hrishi"
                      autoComplete="nickname"
                    />
                  </span>
                </label>

                <label className="auth-field">
                  <span className="auth-label">Email address</span>
                  <span className="auth-input-wrap">
                    <Mail className="auth-input-icon" size={16} aria-hidden="true" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      required
                      autoComplete="email"
                    />
                  </span>
                </label>

                <label className="auth-field">
                  <span className="auth-label">Password</span>
                  <span className="auth-input-wrap">
                    <Lock className="auth-input-icon" size={16} aria-hidden="true" />
                    <input
                      className="auth-password-input"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 6 characters"
                      required
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="auth-eye"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? (
                        <EyeOff size={16} aria-hidden="true" />
                      ) : (
                        <Eye size={16} aria-hidden="true" />
                      )}
                    </button>
                  </span>
                </label>

                <MenuSelect
                  label="Your age group"
                  value={ageBand}
                  onChange={setAgeBand}
                  placeholder="Select your age group…"
                  options={AGE_BANDS}
                />
                {ageBand.length > 0 && ageBand !== '18+' ? (
                  <div className="auth-consent-box">
                    <p>Students aged {MIN_AGE}–17 require parent or guardian consent.</p>
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
                <p className="auth-consent-links">
                  <Link to={TERMS_PATH} onClick={app.actions.closeAuthModal}>
                    Terms
                  </Link>
                  {' · '}
                  <Link to={PRIVACY_PATH} onClick={app.actions.closeAuthModal}>
                    Privacy
                  </Link>
                  {' · '}
                  <Link to={COPYRIGHT_PATH} onClick={app.actions.closeAuthModal}>
                    Copyright
                  </Link>
                </p>

                <fieldset className="auth-prefs">
                  <legend>
                    How you study <span className="auth-optional">optional</span>
                  </legend>
                  <Select
                    label="Default assessment"
                    value={prefAssessment}
                    onChange={(v) => setPrefAssessment(v as typeof prefAssessment)}
                    options={[
                      { value: 'SAT', label: 'Digital SAT' },
                      { value: 'PSAT/NMSQT', label: 'PSAT/NMSQT' },
                      { value: 'PSAT 10', label: 'PSAT 10' },
                      { value: 'PSAT 8/9', label: 'PSAT 8/9' },
                    ]}
                  />
                  <div className="field" role="group" aria-labelledby="auth-test-date-label">
                    <span className="field-label" id="auth-test-date-label">
                      Test date <span className="auth-optional">optional</span>
                    </span>
                    <DatePicker
                      value={prefTestDate}
                      min="2026-01-01"
                      max="2035-12-31"
                      placeholder="Pick your test day"
                      onChange={setPrefTestDate}
                    />
                    <span className="field-hint">Shown on the Dashboard as your goal.</span>
                  </div>
                </fieldset>

                <button className="auth-submit" type="submit" disabled={busy}>
                  {busy ? (
                    <span className="auth-spinner" aria-label="Creating your account" />
                  ) : (
                    <>
                      <span>Create account</span>
                      <ArrowRight size={15} aria-hidden="true" />
                    </>
                  )}
                </button>

                <p className="auth-switch auth-switch-left">
                  <button
                    type="button"
                    className="auth-text-button"
                    onClick={() => {
                      setMode('signin');
                      setFormError(null);
                      setStatusMessage(null);
                    }}
                  >
                    Already have an account? Sign in
                  </button>
                </p>
              </form>
            ) : (
              <form onSubmit={handleSubmit} className="auth-form">
                {/* A display name belongs to account creation, not to signing
                    in: an existing account already has one, and a field here
                    would look like it changes it. */}
                <label className="auth-field">
                  <span className="auth-label">Email address</span>
                  <span className="auth-input-wrap">
                    <Mail className="auth-input-icon" size={16} aria-hidden="true" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      required
                      autoComplete="email"
                    />
                  </span>
                </label>

                <label className="auth-field">
                  <span className="auth-label">Password</span>
                  <span className="auth-input-wrap">
                    <Lock className="auth-input-icon" size={16} aria-hidden="true" />
                    <input
                      className="auth-password-input"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 6 characters"
                      required
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="auth-eye"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? (
                        <EyeOff size={16} aria-hidden="true" />
                      ) : (
                        <Eye size={16} aria-hidden="true" />
                      )}
                    </button>
                  </span>
                </label>

                <div className="auth-form-meta">
                  <button
                    type="button"
                    className="auth-text-button"
                    onClick={() => void handleForgotPassword()}
                    disabled={busy}
                  >
                    Forgot password?
                  </button>
                </div>

                <button className="auth-submit" type="submit" disabled={busy}>
                  {busy ? (
                    <span className="auth-spinner" aria-label="Signing in" />
                  ) : (
                    <>
                      <span>Continue</span>
                      <ArrowRight size={15} aria-hidden="true" />
                    </>
                  )}
                </button>

                <div className="auth-divider" aria-hidden="true">
                  <span>or</span>
                </div>

                {googleFallback ? (
                  <button
                    type="button"
                    className="auth-google"
                    onClick={() => void handleGoogle()}
                    disabled={googleBusy || busy}
                  >
                    <svg className="auth-google-mark" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="#4285F4"
                        d="M21.35 12.2c0-.7-.06-1.37-.18-2.02H12v3.82h5.26a4.5 4.5 0 0 1-1.95 2.95v2.45h3.16c1.85-1.7 2.88-4.2 2.88-7.2Z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 21.7c2.63 0 4.84-.87 6.45-2.36l-3.16-2.45c-.87.58-1.99.93-3.29.93-2.53 0-4.68-1.71-5.45-4.01H3.28v2.52A9.75 9.75 0 0 0 12 21.7Z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M6.55 13.81a5.86 5.86 0 0 1 0-3.62V7.67H3.28a9.75 9.75 0 0 0 0 8.66l3.27-2.52Z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 6.18c1.43 0 2.72.49 3.73 1.46l2.8-2.8A9.38 9.38 0 0 0 12 2.3a9.75 9.75 0 0 0-8.72 5.37l3.27 2.52C7.32 7.89 9.47 6.18 12 6.18Z"
                      />
                    </svg>
                    <span>{googleBusy ? 'Opening Google…' : 'Continue with Google'}</span>
                  </button>
                ) : (
                  <>
                    <GoogleSignInButton
                      onCredential={(credential) => void handleGoogleCredential(credential)}
                      onUnavailable={() => setGoogleFallback(true)}
                      disabled={googleBusy || busy}
                    />
                    <button
                      type="button"
                      className="auth-text-button auth-google-redirect"
                      onClick={() => void handleGoogle()}
                      disabled={googleBusy || busy}
                    >
                      Trouble with the popup? Use Google&apos;s redirect
                    </button>
                  </>
                )}
                {googleBusy ? (
                  <p className="auth-provider-note" role="status">
                    Finishing Google sign-in…
                  </p>
                ) : null}
                <p className="auth-provider-note">
                  Google verifies your email automatically. Use Google only if you are {MIN_AGE} or
                  older and accept the Terms and Privacy Policy. Keep that Google account — it is how
                  you sign back in to your saved progress.
                </p>

                <div className="auth-action-row">
                  <button
                    type="button"
                    className="auth-text-button"
                    onClick={() =>
                      openVerify(
                        email.trim(),
                        'Enter the 6-digit code from your confirmation email.'
                      )
                    }
                  >
                    Have a confirmation code?
                  </button>
                  <button
                    type="button"
                    className="auth-text-button"
                    onClick={() => {
                      setMode('signup');
                      setFormError(null);
                      setStatusMessage(null);
                    }}
                  >
                    Create an account
                  </button>
                </div>

                <div className="auth-guest">
                  <span className="auth-guest-rule" aria-hidden="true" />
                  <button
                    type="button"
                    className="auth-secondary auth-secondary-wide"
                    onClick={() => {
                      app.actions.continueAsGuest();
                      app.actions.closeAuthModal();
                    }}
                  >
                    Continue in Guest Mode
                  </button>
                </div>

                <p className="auth-privacy-line">
                  <ShieldCheck size={13} aria-hidden="true" />
                  <span>Your practice stays private. Guest progress stays on this device.</span>
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
