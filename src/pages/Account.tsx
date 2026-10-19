import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Button, Card, Field, Select, Toggle } from '../components/ui';
import { AppealForm } from '../components/AppealForm';
import * as cloud from '../lib/cloud';
import { buildDataExport, downloadExport, validateConsent } from '../lib/dataRights';
import {
  AGE_BANDS,
  COPYRIGHT_PATH,
  LEGAL_VERSION,
  MIN_AGE,
  PRIVACY_PATH,
  SITE_NAME,
  SUPPORT_EMAIL,
  TERMS_PATH,
} from '../lib/legal';
import { useApp } from '../lib/store';
import type { Assessment } from '../lib/types';

export function AccountPage() {
  const app = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [ageBand, setAgeBand] = useState('');
  const [guardianConsent, setGuardianConsent] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verifyEmail, setVerifyEmail] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [reports, setReports] = useState<{ id: string; question_id: string; reason: string; created_at: string }[] | null>(
    null
  );

  // A confirmation link that failed (expired, already used, wrong origin)
  // leaves a readable message for this page instead of a silent redirect.
  useEffect(() => {
    const message = window.sessionStorage.getItem('hdsat.auth-error');
    if (!message) return;
    window.sessionStorage.removeItem('hdsat.auth-error');
    setFormError(message);
  }, []);

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
        setStatusMessage('Signed in. This device history is backed up to your account.');
        setVerifyEmail('');
        setVerifyCode('');
        setPassword('');
        return;
      }
      if (attempt.reason === 'unconfirmed') {
        setVerifyEmail(email.trim());
        setStatusMessage(
          'Your account already exists, but ' +
            email.trim() +
            ' still needs confirmation. Open the link in the email, or enter the 6-digit code below.'
        );
        return;
      }
      if (attempt.reason === 'error') {
        setFormError(attempt.message ?? 'Sign-in failed. Check your connection and try again.');
        return;
      }

      // No account matched, so create one. Consent is required only here.
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
      setVerifyEmail(email.trim());
      setPassword('');
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setStatusMessage(null);
    const address = verifyEmail.trim() || app.pendingAccount?.email || '';
    if (!address || !verifyCode.trim()) {
      setFormError('Enter the 6-digit code from the confirmation email.');
      return;
    }
    setVerifying(true);
    try {
      await app.actions.verifySignupCode(address, verifyCode.trim());
      setStatusMessage('Email confirmed. Your device history is now saved to your account.');
      setVerifyCode('');
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    setFormError(null);
    const address = verifyEmail.trim() || app.pendingAccount?.email || '';
    if (!address) {
      setFormError('Enter your email address first.');
      return;
    }
    try {
      await app.actions.resendVerification(address);
    } catch (err) {
      setFormError((err as Error).message);
    }
  };

  const handleExport = () => {
    const payload = buildDataExport({
      user: app.user,
      mode: app.mode,
      account: {
        hdCoins: app.hdCoins,
        currentStreak: app.currentStreak,
        bestStreak: app.bestStreak,
        totals: { ...app.totals },
        achievements: app.achievements,
        ownedItems: app.ownedItems,
        settings: { ...app.settings },
      },
      progress: app.progress,
      saved: app.saved,
      flashcardProgress: app.flashcardProgress,
      testAttempts: app.testAttempts,
      dailyActivity: app.dailyActivity,
    });
    const name = downloadExport(payload, app.user);
    setExportMessage(`Downloaded ${name}. It contains only your own practice data.`);
  };

  const handleDelete = async () => {
    if (deleteConfirm.trim().toUpperCase() !== 'DELETE') {
      setFormError('Type DELETE to confirm account deletion.');
      return;
    }
    setDeleting(true);
    setFormError(null);
    try {
      const outcome = await cloud.deleteMyAccount();
      if (outcome.deleted) {
        app.actions.resetGuestProgress();
        setStatusMessage(outcome.message);
        setDeleteConfirm('');
      } else {
        setFormError(outcome.message);
      }
    } catch (err) {
      setFormError(`Account deletion failed: ${(err as Error).message}`);
    } finally {
      setDeleting(false);
    }
  };

  const loadReports = async () => {
    try {
      setReports(await cloud.fetchMyReports());
    } catch (err) {
      setFormError(`Could not load your reports: ${(err as Error).message}`);
    }
  };

  return (
    <div>
      <Card>
        <div className="row-between">
          <div>
            <h1>Account, Cloud Sync &amp; Preferences</h1>
            <p className="muted">
              Sign in with email and password to synchronize your question history, streaks, flashcards, and HDCoins
              across devices, or continue in local guest mode.
            </p>
          </div>
          <Badge
            tone={app.mode === 'cloud' ? 'good' : app.accountStatus === 'pending' ? 'info' : 'warn'}
          >
            {app.mode === 'cloud'
              ? 'Cloud Synchronized'
              : app.accountStatus === 'pending'
              ? 'Confirmation pending'
              : 'Local Guest Mode'}
          </Badge>
        </div>
      </Card>

      {statusMessage ? <Alert tone="notice">{statusMessage}</Alert> : null}
      {app.accountStatus === 'pending' && app.pendingAccount ? (
        <Alert tone="info">
          <div>
            <strong>Account created for {app.pendingAccount.email} — confirmation pending.</strong>
            <p style={{ margin: '6px 0' }}>
              You can keep studying now. Answers, saves and past tests are stored on this device, and
              the HDCoins above are <em>provisional</em>: they are replaced by your cloud balance when
              you confirm. Cloud sync and cloud coin earning start only after confirmation.
            </p>
            <p style={{ margin: '6px 0 0' }}>
              Enter the code, or use <em>Resend email</em>, in the confirmation panel below.
            </p>
          </div>
        </Alert>
      ) : null}
      {formError ? <Alert tone="error">{formError}</Alert> : null}
      {exportMessage ? <Alert tone="info">{exportMessage}</Alert> : null}
      {app.syncMessage ? <Alert tone="info">{app.syncMessage}</Alert> : null}

      <div className="grid-2">
        <Card>
          {app.user ? (
            <div className="stack">
              <h2>Signed-In Profile</h2>
              <div className="muted-block">
                <div>
                  <strong>Display Name:</strong> {app.user.displayName}
                </div>
                <div>
                  <strong>Email:</strong> {app.user.email}
                </div>
                <div>
                  <strong>User ID:</strong> <code>{app.user.id}</code>
                </div>
                <div>
                  <strong>Policies accepted:</strong> version {LEGAL_VERSION}
                </div>
              </div>

              <div className="stack" style={{ marginTop: 8 }}>
                <h3>Merge Browser Guest Progress</h3>
                <p className="muted">
                  Replays any local guest attempts, saved questions, and flashcard reviews into your cloud account using
                  idempotent event keys so nothing is double-counted.
                </p>
                <div className="row">
                  <Button onClick={app.actions.syncGuestData} disabled={app.syncing}>
                    {app.syncing ? 'Syncing guest history...' : 'Sync Guest History to Cloud'}
                  </Button>
                  <Button variant="outline" onClick={app.actions.signOut}>
                    Sign Out
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <h2>Sign in or create an account</h2>
              <p className="muted">
                One form for both. Enter your email and password: if the account exists we sign you
                in, otherwise we create it and email a confirmation link and code. You can keep
                studying before confirming — this device keeps your work and your HDCoins stay
                provisional until you do.
              </p>

              {!app.cloudConfigured ? (
                <div className="muted-block">
                  <p style={{ margin: 0 }}>
                    <strong>Cloud authentication is not configured in this build.</strong> Set{' '}
                    <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in your
                    environment to enable email-and-password accounts. Every practice, test,
                    flashcard and reward feature still works in local Guest Mode.
                  </p>
                </div>
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
                  <Field label="Password" hint="At least 6 characters. New accounts set it here.">
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      autoComplete="current-password"
                    />
                  </Field>
                  <Field label="Display name (new accounts)" hint="You can change this later.">
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="e.g. Hrishi"
                      autoComplete="nickname"
                    />
                  </Field>

                  <details className="auth-details">
                    <summary>New account? Age and consent</summary>
                    <Select
                      label="Your age group"
                      value={ageBand}
                      onChange={setAgeBand}
                      options={[{ value: '', label: 'Select your age group…' }, ...AGE_BANDS]}
                    />
                    {ageBand.length > 0 && ageBand !== '18+' ? (
                      <div className="muted-block" style={{ marginBottom: 12 }}>
                        <p className="muted" style={{ marginTop: 0, marginBottom: 8 }}>
                          Accounts for students under 18 need a parent or guardian. Accounts under{' '}
                          {MIN_AGE} years old are not permitted.
                        </p>
                        <Toggle
                          checked={guardianConsent}
                          onChange={setGuardianConsent}
                          label="My parent or guardian has reviewed and agrees to the Terms and Privacy Policy"
                          hint="Required for students aged 13–17."
                        />
                      </div>
                    ) : null}
                    <Toggle
                      checked={acceptedTerms}
                      onChange={setAcceptedTerms}
                      label={`I accept the Terms of Service and the Privacy & Data Rights policy (version ${LEGAL_VERSION})`}
                      hint="Only needed when a new account is created."
                    />
                    <p className="muted" style={{ marginBottom: 12 }}>
                      <Link to={TERMS_PATH}>Terms of Service</Link> ·{' '}
                      <Link to={PRIVACY_PATH}>Privacy &amp; Data Rights</Link> ·{' '}
                      <Link to={COPYRIGHT_PATH}>Copyright &amp; Content Policy</Link>
                    </p>
                  </details>

                  <div className="row" style={{ marginTop: 12 }}>
                    <Button type="submit" disabled={busy}>
                      {busy ? 'Checking…' : 'Continue'}
                    </Button>
                    <Button type="button" variant="outline" onClick={app.actions.continueAsGuest}>
                      Continue in Guest Mode
                    </Button>
                  </div>
                </form>
              )}

              {(verifyEmail || (app.accountStatus === 'pending' && app.pendingAccount)) ? (
                <div className="muted-block" style={{ marginTop: 16 }}>
                  <strong>Check your email to finish</strong>
                  <p className="muted" style={{ margin: '6px 0 10px' }}>
                    We sent a confirmation link and a 6-digit code to{' '}
                    <strong>{verifyEmail || app.pendingAccount?.email}</strong>. Click the link, or
                    paste the code here — either one signs you in and backs up this device&apos;s
                    history. No other steps are needed.
                  </p>
                  <form onSubmit={handleVerifyCode}>
                    <Field label="6-digit code from the email">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={verifyCode}
                        onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="123456"
                        autoComplete="one-time-code"
                      />
                    </Field>
                    <div className="row">
                      <Button type="submit" disabled={verifying}>
                        {verifying ? 'Confirming…' : 'Confirm & continue'}
                      </Button>
                      <Button type="button" variant="outline" onClick={handleResend}>
                        Resend email
                      </Button>
                    </div>
                  </form>
                </div>
              ) : null}
            </div>
          )}
        </Card>

        <Card>
          <h2>Study Preferences &amp; Local Storage</h2>
          <Select
            label="Default Assessment"
            value={app.settings.assessment}
            onChange={(v) => app.actions.updateSettings({ assessment: v as Assessment })}
            options={[
              { value: 'SAT', label: 'Digital SAT' },
              { value: 'PSAT/NMSQT', label: 'PSAT/NMSQT' },
              { value: 'PSAT 10', label: 'PSAT 10' },
              { value: 'PSAT 8/9', label: 'PSAT 8/9' },
            ]}
          />
          <Toggle
            checked={app.settings.excludePreviouslyCorrect}
            onChange={(val) => app.actions.updateSettings({ excludePreviouslyCorrect: val })}
            label="Exclude previously correct items by default"
            hint="Applies to new Custom Practice sessions."
          />
          <Toggle
            checked={app.settings.excludeReleasedPracticeSet}
            onChange={(val) => app.actions.updateSettings({ excludeReleasedPracticeSet: val })}
            label="Reserve Benchmark Simulation Set items"
            hint="Prevents benchmark simulation questions from appearing in general drills."
          />

          <div className="muted-block" style={{ marginTop: 14 }}>
            <h3>Local Guest Data</h3>
            <p className="muted">
              Your browser stores guest progress under <code>hdsat.profile.v1</code> so refreshing the page preserves
              your attempts, saved items, and streak.
            </p>
            <Button variant="danger" size="sm" onClick={app.actions.resetGuestProgress}>
              Reset Local Guest Progress
            </Button>
          </div>
        </Card>
      </div>

      <Card>
        <div className="row-between">
          <div>
            <h2>Safety &amp; Data Rights</h2>
            <p className="muted">
              Take a copy of your data, request deletion of your account or data, or file a safety,
              copyright, access or accuracy appeal. You never need to email us to exercise these rights.
            </p>
          </div>
          <Badge tone="info">Policy version {LEGAL_VERSION}</Badge>
        </div>

        <div className="grid-2">
          <div className="muted-block">
            <h3>Download my data</h3>
            <p className="muted">
              Creates a JSON file containing your practice history, saved questions, flashcard scheduling, test results
              and settings. It excludes other students&apos; data and all exam answer keys.
            </p>
            <Button variant="outline" size="sm" onClick={handleExport}>
              Download data export (JSON)
            </Button>
          </div>

          <div className="muted-block">
            <h3>Delete my account</h3>
            <p className="muted">
              Permanently removes your account and every row tied to it — progress, saves, flashcards, coins, test
              results and reports. This cannot be undone.
            </p>
            {app.user ? (
              <>
                <Field label="Type DELETE to confirm">
                  <input
                    type="text"
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    placeholder="DELETE"
                  />
                </Field>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={deleting || deleteConfirm.trim().toUpperCase() !== 'DELETE'}
                  onClick={handleDelete}
                >
                  {deleting ? 'Deleting…' : 'Delete my account permanently'}
                </Button>
              </>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                Sign in to delete a cloud account, or use <em>Reset Local Guest Progress</em> above to erase device-only
                data.
              </p>
            )}
          </div>
        </div>

        <div className="muted-block" style={{ marginTop: 14 }}>
          <div className="row-between">
            <h3 style={{ margin: 0 }}>Your recent question reports</h3>
            <Button variant="outline" size="sm" onClick={loadReports} disabled={!app.user}>
              Load my reports
            </Button>
          </div>
          {reports === null ? (
            <p className="muted" style={{ marginBottom: 0 }}>
              Reports you file from a question card are listed here so you can see they were received.
            </p>
          ) : reports.length === 0 ? (
            <p className="muted" style={{ marginBottom: 0 }}>
              You have not filed any question reports yet.
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Question</th>
                  <th>Reason</th>
                  <th>Filed</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.question_id}</td>
                    <td>{r.reason.replace(/_/g, ' ')}</td>
                    <td>{new Date(r.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <h3 style={{ marginTop: 16 }}>File an appeal or safety report</h3>
        {app.cloudConfigured ? (
          <AppealForm />
        ) : (
          <p className="muted">
            Appeals need the {SITE_NAME} backend. Configure{' '}
            <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>
            {SUPPORT_EMAIL ? `, or email ${SUPPORT_EMAIL}` : ''} to enable the appeal form.
          </p>
        )}
      </Card>
    </div>
  );
}
