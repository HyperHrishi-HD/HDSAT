import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, Select, Toggle } from '../components/ui';
import { AppealForm } from '../components/AppealForm';
import * as cloud from '../lib/cloud';
import { buildAiSnapshot, buildDataExport, downloadExport } from '../lib/dataRights';
import {
  LEGAL_VERSION,
  SITE_NAME,
  SUPPORT_EMAIL,
} from '../lib/legal';
import { formatRemainingHours } from '../lib/storage';
import { useApp } from '../lib/store';
import type { Assessment } from '../lib/types';

export function AccountPage() {
  const app = useApp();
  const [verifyEmail, setVerifyEmail] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
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

  const saveDisplayName = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setNameSaving(true);
    try {
      await app.actions.updateDisplayName(nameDraft);
      setNameDraft('');
    } catch (err) {
      setFormError(`Could not change your name: ${(err as Error).message}`);
    } finally {
      setNameSaving(false);
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

  const handleAiSnapshot = async () => {
    setAiMessage(null);
    const payload = buildAiSnapshot({
      user: app.user,
      mode: app.mode,
      assessment: app.settings.assessment,
      account: {
        hdCoins: app.hdCoins,
        currentStreak: app.currentStreak,
        bestStreak: app.bestStreak,
        achievements: app.achievements,
        ownedItems: app.ownedItems,
        settings: { ...app.settings },
      },
      totals: {
        attempts: app.totals.attempts,
        correct: app.totals.correct,
        accuracy: app.totals.accuracy,
        mastered: app.totals.mastered,
        dueCards: app.totals.dueCards,
      },
      progress: app.progress,
      questions: app.questions.map((question) => ({
        id: question.id,
        section: question.section,
        domain: question.domain,
        skill: question.skill,
        difficulty: question.difficulty,
        prompt: question.prompt,
      })),
      saved: app.saved,
      flashcardProgress: app.flashcardProgress,
      testAttempts: app.testAttempts.map((attempt) => ({
        id: attempt.id,
        assessment: attempt.assessment,
        createdAt: attempt.createdAt,
        status: attempt.status,
        rwEstimate: attempt.rwEstimate ?? null,
        mathEstimate: attempt.mathEstimate ?? null,
        totalEstimate: attempt.totalEstimate ?? null,
        modules: attempt.modules.map((module) => ({
          section: module.section,
          tier: module.tier,
          correct: module.correct,
          total: module.total,
        })),
      })),
      dailyActivity: app.dailyActivity,
    });
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setAiMessage(
        `Copied a ${text.length.toLocaleString()}-character snapshot. Paste it into any AI tutor or into a Freebuff chat — it has no answer keys and no other students' data.`
      );
    } catch {
      setAiMessage(
        'Your browser blocked clipboard access. Use "Download data export (JSON)" above, or copy from the box below.'
      );
    }
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
            <strong>
              Account created for {app.pendingAccount.email} — 24-hour confirmation active (
              {formatRemainingHours(Math.max(0, app.pendingAccount.expiresAt - Date.now()))}{' '}
              remaining).
            </strong>
            <p style={{ margin: '6px 0' }}>
              You can keep studying now. Answers, saves and past tests are stored on this device, and
              the HDCoins above are <em>provisional</em>: they are replaced by your cloud balance when
              you confirm. Your 6-digit code works for a full 24 hours so you only need one email.
            </p>
            <p style={{ margin: '6px 0 0' }}>
              Enter your 6-digit code in the confirmation panel below.
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

              <form onSubmit={saveDisplayName} className="row" style={{ alignItems: 'flex-end' }}>
                <Field label="Change display name" hint="Shown in the top bar and on your profile.">
                  <input
                    type="text"
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    placeholder={app.user.displayName}
                    maxLength={40}
                    autoComplete="nickname"
                  />
                </Field>
                <Button
                  type="submit"
                  size="sm"
                  disabled={nameSaving || nameDraft.trim().length === 0}
                >
                  {nameSaving ? 'Saving…' : 'Save name'}
                </Button>
              </form>

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
                <div className="muted-block">
                  <p className="muted" style={{ marginTop: 0, marginBottom: 10 }}>
                    Open the Sign-In popup to log into an existing account or create a new cloud
                    account.
                  </p>
                  <div className="row">
                    <Button
                      type="button"
                      onClick={() =>
                        app.actions.openAuthModal(
                          app.accountStatus === 'pending' ? 'verify' : 'signin'
                        )
                      }
                    >
                      Open Sign-In / Sign-Up Modal
                    </Button>
                    <Button type="button" variant="outline" onClick={app.actions.continueAsGuest}>
                      Continue in Guest Mode
                    </Button>
                  </div>
                </div>
              )}

              <div className="muted-block" style={{ marginTop: 16 }}>
                <strong>Confirm an email with your 24-hour code</strong>
                <p className="muted" style={{ margin: '6px 0 10px' }}>
                  {app.pendingAccount
                    ? `We sent a confirmation link and a 6-digit code to ${
                        app.pendingAccount.email
                      }. Your code stays active for 24 hours (${formatRemainingHours(
                        Math.max(0, app.pendingAccount.expiresAt - Date.now())
                      )} remaining) so you don't need to request another email.`
                    : 'Already received a confirmation email within the last 24 hours? Enter your email address and the 6-digit code below to activate cloud sync.'}
                </p>
                {app.pendingAccount ? (
                  <form onSubmit={saveDisplayName} className="row" style={{ alignItems: 'flex-end' }}>
                    <Field label="Your name" hint="Used once you confirm; you can change it later.">
                      <input
                        type="text"
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        placeholder={app.pendingAccount?.displayName ?? 'Student'}
                        maxLength={40}
                        autoComplete="nickname"
                      />
                    </Field>
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      disabled={nameSaving || nameDraft.trim().length === 0}
                    >
                      {nameSaving ? 'Saving…' : 'Save name'}
                    </Button>
                  </form>
                ) : null}
                <form onSubmit={handleVerifyCode}>
                  {!app.pendingAccount ? (
                    <Field label="Email Address">
                      <input
                        type="email"
                        value={verifyEmail}
                        onChange={(e) => setVerifyEmail(e.target.value)}
                        placeholder="you@example.com"
                      />
                    </Field>
                  ) : null}
                  <Field label="6-digit code from the email (valid 24 hours)">
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
                      Resend email (after 24h)
                    </Button>
                  </div>
                </form>
              </div>
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
            <h3>Copy an AI-ready snapshot</h3>
            <p className="muted">
              One click copies a structured JSON snapshot of your progress, domain accuracy, missed
              items, simulations and activity. Paste it into any AI tutor — or into Freebuff — and
              ask what to study next. It contains no answer keys and no other students&apos; data.
            </p>
            <Button variant="outline" size="sm" onClick={() => void handleAiSnapshot()}>
              Copy full account snapshot for AI
            </Button>
            {aiMessage ? (
              <p className="muted" style={{ margin: '8px 0 0', wordBreak: 'break-word' }}>
                {aiMessage}
              </p>
            ) : null}
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

        <details
          className="auth-details"
          style={{ marginTop: 14 }}
          onToggle={(e) => {
            if ((e.currentTarget as HTMLDetailsElement).open && reports === null && app.user) {
              void loadReports();
            }
          }}
        >
          <summary style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px' }}>
            <div>
              <strong>Your Submitted Question Reports</strong>
              <span className="muted" style={{ display: 'block', fontSize: '0.86rem', fontWeight: 400 }}>
                Expand to view the status and history of questions you have reported for review.
              </span>
            </div>
            <Badge tone="neutral">{reports ? `${reports.length} filed` : 'Click to view'}</Badge>
          </summary>
          <div style={{ padding: '12px 16px' }}>
            {!app.user ? (
              <p className="muted" style={{ margin: 0 }}>
                Sign in to view and track your submitted question reports across devices.
              </p>
            ) : reports === null ? (
              <div className="row-between">
                <p className="muted" style={{ margin: 0 }}>
                  Loading your submitted question reports…
                </p>
                <Button variant="outline" size="sm" onClick={loadReports}>
                  Refresh reports
                </Button>
              </div>
            ) : reports.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
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
        </details>

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
