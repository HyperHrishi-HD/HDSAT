import { useState } from 'react';
import { Alert, Badge, Button, Card, Field, Select, Toggle } from '../components/ui';
import { useApp } from '../lib/store';
import type { Assessment } from '../lib/types';

export function AccountPage() {
  const app = useApp();
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

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
      if (authMode === 'signin') {
        await app.actions.signIn(email.trim(), password);
        setStatusMessage('Signed in to your HDSAT cloud account.');
      } else {
        const msg = await app.actions.signUp(email.trim(), password, displayName.trim() || 'Student');
        setStatusMessage(msg);
      }
      setPassword('');
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
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
          <Badge tone={app.mode === 'cloud' ? 'good' : 'warn'}>
            {app.mode === 'cloud' ? 'Cloud Synchronized' : 'Local Guest Mode'}
          </Badge>
        </div>
      </Card>

      {statusMessage ? <Alert tone="notice">{statusMessage}</Alert> : null}
      {formError ? <Alert tone="error">{formError}</Alert> : null}
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
              <div className="row-between" style={{ marginBottom: 12 }}>
                <h2>{authMode === 'signin' ? 'Sign In to HDSAT' : 'Create an HDSAT Account'}</h2>
                <div className="row">
                  <Button
                    size="sm"
                    variant={authMode === 'signin' ? 'primary' : 'outline'}
                    onClick={() => setAuthMode('signin')}
                  >
                    Sign in
                  </Button>
                  <Button
                    size="sm"
                    variant={authMode === 'signup' ? 'primary' : 'outline'}
                    onClick={() => setAuthMode('signup')}
                  >
                    Create account
                  </Button>
                </div>
              </div>

              {!app.cloudConfigured ? (
                <div className="muted-block">
                  <p style={{ margin: 0 }}>
                    <strong>Cloud authentication is not configured in this build.</strong> Set{' '}
                    <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in your environment to enable
                    Supabase email-and-password sign-in. You can use every practice, test, flashcard, and reward feature
                    right now in local Guest Mode.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit}>
                  {authMode === 'signup' ? (
                    <Field label="Display Name">
                      <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="e.g. Hrishi"
                      />
                    </Field>
                  ) : null}
                  <Field label="Email Address">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      required
                    />
                  </Field>
                  <Field label="Password" hint="Minimum 6 characters">
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                    />
                  </Field>
                  <div className="row">
                    <Button type="submit" disabled={busy}>
                      {busy ? 'Working...' : authMode === 'signin' ? 'Sign In' : 'Create Account'}
                    </Button>
                    <Button type="button" variant="outline" onClick={app.actions.continueAsGuest}>
                      Continue in Guest Mode
                    </Button>
                  </div>
                </form>
              )}
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
    </div>
  );
}
