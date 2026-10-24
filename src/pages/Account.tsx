import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, Select, Toggle } from '../components/ui';
import { AppealForm } from '../components/AppealForm';
import { PasswordDialog } from '../components/PasswordDialog';
import * as cloud from '../lib/cloud';
import { buildAiSnapshot, buildDataExport, downloadExport } from '../lib/dataRights';
import {
  LEGAL_VERSION,
  SITE_NAME,
  SUPPORT_EMAIL,
} from '../lib/legal';
import { PASSWORD_RECOVERY_FLAG } from '../lib/password';
import { formatRemainingHours } from '../lib/storage';
import { useApp } from '../lib/store';
import type { Assessment } from '../lib/types';

export function AccountPage() {
  const app = useApp();
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
  const [passwordDialog, setPasswordDialog] = useState<'change' | 'recover' | null>(null);

  // A confirmation link that failed (expired, already used, wrong origin)
  // leaves a readable message for this page instead of a silent redirect.
  useEffect(() => {
    const message = window.sessionStorage.getItem('hdsat.auth-error');
    if (!message) return;
    window.sessionStorage.removeItem('hdsat.auth-error');
    setFormError(message);
  }, []);

  // A recovery link lands signed in; offer the new-password form straight away.
  useEffect(() => {
    if (!app.user) return;
    if (window.sessionStorage.getItem(PASSWORD_RECOVERY_FLAG) !== '1') return;
    window.sessionStorage.removeItem(PASSWORD_RECOVERY_FLAG);
    setPasswordDialog('recover');
  }, [app.user]);

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
      attempts: app.attempts.map((attempt) => ({
        questionId: attempt.questionId,
        seconds: attempt.timeSpentSeconds,
        isCorrect: attempt.isCorrect,
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
      setAiMessage(`Copied ${text.length.toLocaleString()} characters.`);
    } catch {
      setAiMessage('Clipboard blocked. Use the download export instead.');
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
            <h1>Account</h1>
          </div>
          <Badge
            tone={
              app.mode === 'cloud'
                ? app.emailVerified
                  ? 'good'
                  : 'warn'
                : app.accountStatus === 'pending'
                ? 'info'
                : 'warn'
            }
          >
            {app.mode === 'cloud'
              ? app.emailVerified
                ? 'Cloud'
                : 'Light account'
              : app.accountStatus === 'pending'
              ? 'Confirm email'
              : 'Guest'}
          </Badge>
        </div>
      </Card>

      {statusMessage ? <Alert tone="notice">{statusMessage}</Alert> : null}
      {app.accountStatus === 'pending' && app.pendingAccount ? (
        <Alert tone="info">
          <div>
            <strong>
              Confirm {app.pendingAccount.email} (
              {formatRemainingHours(Math.max(0, app.pendingAccount.expiresAt - Date.now()))} left)
            </strong>
            <p style={{ margin: '6px 0 0' }}>
              Study now; this device keeps your work. HDCoins stay provisional until you confirm.
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
              <h2>{app.user.displayName}</h2>
              <div className="muted-block">
                <div>{app.user.email}</div>
                <div className="muted">
                  {app.emailVerified
                    ? 'Email confirmed'
                    : 'Not confirmed — progress and scores sync, answer detail stays on this device.'}
                </div>
                <div className="muted">
                  Policies v{LEGAL_VERSION} · ID <code>{app.user.id.slice(0, 8)}</code>
                </div>
                {!app.emailVerified ? (
                  <div style={{ marginTop: 8 }}>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => app.actions.openAuthModal('verify')}
                    >
                      Confirm email
                    </Button>
                  </div>
                ) : null}
              </div>

              <form onSubmit={saveDisplayName} className="row" style={{ alignItems: 'flex-end' }}>
                <Field label="Change display name">
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

              <div className="row">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setPasswordDialog('change')}
                >
                  Change password
                </Button>
              </div>

              <div className="stack" style={{ marginTop: 8 }}>
                <h3>Sync this device</h3>
                <p className="muted">Moves local attempts, saved questions and reviews into your account once.</p>
                <div className="row">
                  <Button onClick={app.actions.syncGuestData} disabled={app.syncing}>
                    {app.syncing ? 'Syncing…' : 'Sync device'}
                  </Button>
                  <Button variant="outline" onClick={app.actions.signOut}>
                    Sign out
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <h2>Sign in or create an account</h2>
              <p className="muted">One form for both. Sign in, or create an account on first use.</p>

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
                  <div className="row">
                    <Button
                      type="button"
                      onClick={() =>
                        app.actions.openAuthModal(
                          app.accountStatus === 'pending' ? 'verify' : 'signin'
                        )
                      }
                    >
                      Sign in
                    </Button>
                    <Button type="button" variant="outline" onClick={app.actions.continueAsGuest}>
                      Continue as guest
                    </Button>
                  </div>
                </div>
              )}

              {app.pendingAccount ? (
                <div className="muted-block" style={{ marginTop: 16 }}>
                  <strong>Confirm your email</strong>
                  <p className="muted" style={{ margin: '6px 0 10px' }}>
                    {app.pendingAccount.email} ·{' '}
                    {formatRemainingHours(Math.max(0, app.pendingAccount.expiresAt - Date.now()))}{' '}
                    left
                  </p>
                  <div className="row">
                    <Button size="sm" onClick={() => app.actions.openAuthModal('verify')}>
                      Enter code
                    </Button>
                  </div>
                  <form onSubmit={saveDisplayName} className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
                    <Field label="Your name">
                      <input
                        type="text"
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        placeholder={app.pendingAccount.displayName}
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
                </div>
              ) : null}
            </div>
          )}
        </Card>

        <Card>
          <h2>Preferences</h2>
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
          <Field label="Test date" hint="Shown on the Dashboard as your goal.">
            <input
              type="date"
              value={app.settings.testDate ?? ''}
              min="2026-01-01"
              max="2035-12-31"
              onChange={(e) => app.actions.updateSettings({ testDate: e.target.value || null })}
            />
          </Field>
          <Toggle
            checked={app.settings.excludePreviouslyCorrect}
            onChange={(val) => app.actions.updateSettings({ excludePreviouslyCorrect: val })}
            label="Exclude previously correct items by default"
          />
          <Toggle
            checked={app.settings.excludeReleasedPracticeSet}
            onChange={(val) => app.actions.updateSettings({ excludeReleasedPracticeSet: val })}
            label="Reserve Benchmark Simulation Set items"
          />

          <div className="muted-block" style={{ marginTop: 14 }}>
            <h3>This device</h3>
            <p className="muted">Guest progress is stored in this browser.</p>
            <Button variant="danger" size="sm" onClick={app.actions.resetGuestProgress}>
              Reset local progress
            </Button>
          </div>
        </Card>
      </div>

      <Card>
        <div className="row-between">
          <div>
            <h2>Safety &amp; Data Rights</h2>
            <p className="muted">Export, delete or appeal — no email required.</p>
          </div>
          <Badge tone="info">Policy v{LEGAL_VERSION}</Badge>
        </div>

        <div className="grid-2">
          <div className="muted-block">
            <h3>Download my data</h3>
            <p className="muted">Your history, saves, cards, tests and settings. No answer keys.</p>
            <Button variant="outline" size="sm" onClick={handleExport}>
              Download JSON
            </Button>
          </div>

          <div className="muted-block">
            <h3>AI snapshot</h3>
            <p className="muted">Copies a tutor-ready brief. No answer keys.</p>
            <Button variant="outline" size="sm" onClick={() => void handleAiSnapshot()}>
              Copy snapshot
            </Button>
            {aiMessage ? (
              <p className="muted" style={{ margin: '8px 0 0', wordBreak: 'break-word' }}>
                {aiMessage}
              </p>
            ) : null}
          </div>

          <div className="muted-block">
            <h3>Delete my account</h3>
            <p className="muted">Removes your account and every row tied to it. Permanent.</p>
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
                Sign in to delete an account. Device data can be reset above.
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
              <strong>Your question reports</strong>
            </div>
            <Badge tone="neutral">{reports ? `${reports.length} filed` : 'Click to view'}</Badge>
          </summary>
          <div style={{ padding: '12px 16px' }}>
            {!app.user ? (
              <p className="muted" style={{ margin: 0 }}>
                Sign in to track your reports.
              </p>
            ) : reports === null ? (
              <div className="row-between">
                <p className="muted" style={{ margin: 0 }}>
                  Loading…
                </p>
                <Button variant="outline" size="sm" onClick={loadReports}>
                  Refresh reports
                </Button>
              </div>
            ) : reports.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No reports filed.
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

      {passwordDialog && app.user ? (
        <PasswordDialog
          mode={passwordDialog}
          email={app.user.email}
          onClose={() => setPasswordDialog(null)}
          onDone={(done) => {
            setPasswordDialog(null);
            setStatusMessage(done);
          }}
        />
      ) : null}
    </div>
  );
}
