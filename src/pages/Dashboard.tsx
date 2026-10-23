import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, Icon, InfoTip, ProgressBar, Stat } from '../components/ui';
import { hasSeenIntro, markIntroSeen } from '../lib/storage';
import { useApp } from '../lib/store';

export function DashboardPage() {
  const app = useApp();
  const [showIntro, setShowIntro] = useState(() => !hasSeenIntro());

  const domainBreakdown = useMemo(() => {
    const map = new Map<
      string,
      { domain: string; section: string; total: number; attempted: number; correct: number }
    >();
    app.questions.forEach((q) => {
      if (!q.assessments.includes(app.settings.assessment)) return;
      const entry = map.get(q.domain) ?? {
        domain: q.domain,
        section: q.section,
        total: 0,
        attempted: 0,
        correct: 0,
      };
      entry.total += 1;
      const prog = app.progress[q.id];
      if (prog && prog.attemptCount > 0) {
        entry.attempted += 1;
        if (prog.lastIsCorrect) entry.correct += 1;
      }
      map.set(q.domain, entry);
    });
    return Array.from(map.values());
  }, [app.questions, app.progress, app.settings.assessment]);

  const incorrectCount = useMemo(
    () => Object.values(app.progress).filter((p) => p.lastIsCorrect === false).length,
    [app.progress]
  );

  const maxDailyQuestions = useMemo(
    () => Math.max(5, ...app.dailyActivity.map((d) => d.questionsCompleted)),
    [app.dailyActivity]
  );

  const todayActivity = app.dailyActivity[app.dailyActivity.length - 1];
  const latestTest = app.testAttempts[0] ?? null;

  const dismissIntro = () => {
    markIntroSeen();
    setShowIntro(false);
  };

  return (
    <div>
      {showIntro && !app.user ? (
        <Card className="intro-card">
          <div className="row-between">
            <div>
              <Badge tone="info">Welcome to HDSAT</Badge>
              <h2 style={{ marginTop: 8, marginBottom: 4 }}>
                Your Complete Digital SAT &amp; PSAT Command Center
              </h2>
              <p className="muted" style={{ maxWidth: 680 }}>
                Practice with realistic adaptive simulations, targeted domain drills, interactive
                Desmos &amp; reference sheets, spaced-repetition flashcards, and the Arcade reward
                economy. Everything works immediately in local guest mode—or sign in anytime to sync
                across devices.
              </p>
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <Link to="/practice" className="btn btn-primary" onClick={dismissIntro}>
              <Icon name="practice" size={15} />
              <span>Start First Practice</span>
            </Link>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                dismissIntro();
                app.actions.openAuthModal(app.accountStatus === 'pending' ? 'verify' : 'signin');
              }}
            >
              <Icon name="account" size={14} />
              <span>Sign In / Create Account</span>
            </Button>
            <Button type="button" variant="ghost" onClick={dismissIntro}>
              Continue as Guest
            </Button>
          </div>
        </Card>
      ) : null}

      <Card>
        <div className="row-between">
          <div>
            <div className="row">
              <h1>Dashboard</h1>
              <InfoTip label="About HDSAT">
                Adaptive Digital {app.settings.assessment} preparation. Every statistic reflects
                your recorded attempts across practice drills, flashcards, and full-length
                simulations. Change your target assessment in Account Preferences.
              </InfoTip>
            </div>
            <p className="muted">
              Track your study streak, domain accuracy, and recent practice simulations.
            </p>
          </div>
          <Badge tone="info">{app.settings.assessment}</Badge>
        </div>

        <div className="row" style={{ marginTop: 8 }}>
          <Link to="/practice" className="btn btn-primary">
            <Icon name="practice" size={15} />
            <span>Start custom practice</span>
          </Link>
          <Link to="/test" className="btn btn-outline">
            <Icon name="test" size={15} />
            <span>Adaptive full simulation</span>
          </Link>
          <Link to="/bank" className="btn btn-outline">
            <Icon name="bank" size={15} />
            <span>Browse question bank</span>
          </Link>
          <Link to="/flashcards" className="btn btn-outline">
            <Icon name="flashcards" size={15} />
            <span>Review flashcards</span>
          </Link>
          {incorrectCount > 0 ? (
            <Link to="/practice?mode=incorrect" className="btn btn-subtle">
              <Icon name="refresh" size={14} />
              <span>
                Retry {incorrectCount} missed item{incorrectCount === 1 ? '' : 's'}
              </span>
            </Link>
          ) : null}
        </div>
      </Card>

      <div className="card-grid" style={{ marginBottom: 16 }}>
        <Card>
          <Stat
            label="Questions Answered"
            value={app.totals.attempts}
            hint={`${app.totals.uniqueQuestions} unique answered`}
          />
        </Card>
        <Card>
          <Stat
            label="Overall Accuracy"
            value={app.totals.attempts > 0 ? `${Math.round(app.totals.accuracy * 100)}%` : '—'}
            hint={
              app.totals.attempts > 0
                ? `${app.totals.correct} correct · ${app.totals.mastered} mastered`
                : 'Answer a question to compute'
            }
          />
        </Card>
        <Card>
          <Stat
            label="Study Streak"
            value={`${app.currentStreak} day${app.currentStreak === 1 ? '' : 's'}`}
            hint={`Best: ${app.bestStreak} day${app.bestStreak === 1 ? '' : 's'}`}
          />
        </Card>
        <Card>
          <Stat
            label="HDCoins Balance"
            value={app.hdCoins}
            hint={`${todayActivity?.coinsEarned ?? 0} today · ${app.achievements.length} badges`}
          />
        </Card>
      </div>

      <div className="grid-2">
        <Card>
          <div className="row-between" style={{ marginBottom: 8 }}>
            <h3>Domain Mastery</h3>
          </div>
          <div className="stack">
            {domainBreakdown.map((item) => {
              const pct = item.attempted > 0 ? Math.round((item.correct / item.attempted) * 100) : 0;
              return (
                <div key={item.domain} className="stack" style={{ gap: 4 }}>
                  <div className="row-between" style={{ fontSize: '0.86rem' }}>
                    <span>
                      <strong>{item.domain}</strong>{' '}
                      <span className="muted">({item.section === 'Math' ? 'Math' : 'R&W'})</span>
                    </span>
                    <span className="muted">
                      {item.attempted === 0
                        ? 'No attempts yet'
                        : `${item.correct}/${item.attempted} (${pct}%)`}
                    </span>
                  </div>
                  <ProgressBar value={item.correct} max={Math.max(1, item.attempted)} />
                </div>
              );
            })}
          </div>
        </Card>

        <div className="stack">
          <Card>
            <div className="row-between" style={{ marginBottom: 10 }}>
              <div>
                <h3>14-Day Activity</h3>
                <p className="muted">
                  Today: {todayActivity?.questionsCompleted ?? 0} questions ·{' '}
                  {todayActivity?.flashcardsReviewed ?? 0} flashcards
                </p>
              </div>
              <Badge tone={(todayActivity?.questionsCompleted ?? 0) >= 3 ? 'good' : 'neutral'}>
                {(todayActivity?.questionsCompleted ?? 0) >= 3
                  ? 'Daily goal met'
                  : 'Goal: 3+ questions/day'}
              </Badge>
            </div>
            <div className="sparkline" aria-label="14-day question activity chart">
              {app.dailyActivity.map((day) => {
                const heightPct =
                  day.questionsCompleted > 0
                    ? Math.max(12, Math.round((day.questionsCompleted / maxDailyQuestions) * 100))
                    : 4;
                return (
                  <span
                    key={day.date}
                    data-empty={day.questionsCompleted === 0 ? 'true' : 'false'}
                    style={{ height: `${heightPct}%` }}
                    title={`${day.date}: ${day.questionsCompleted} questions (${day.correctQuestions} correct)`}
                  />
                );
              })}
            </div>
            <div className="chart-axis">
              <span>{app.dailyActivity[0]?.date ?? ''}</span>
              <span>Today ({todayActivity?.date ?? ''})</span>
            </div>
          </Card>

          <Card>
            <div className="row-between" style={{ marginBottom: 8 }}>
              <h3>Recent Simulations</h3>
              <Link to="/test" className="btn btn-outline btn-sm">
                <Icon name="play" size={12} />
                <span>New simulation</span>
              </Link>
            </div>
            {latestTest ? (
              <div className="stack">
                {app.testAttempts.slice(0, 3).map((attempt) => (
                  <div key={attempt.id} className="muted-block row-between">
                    <div>
                      <strong>{attempt.assessment}</strong>
                      <div className="muted">{attempt.createdAt.slice(0, 10)}</div>
                    </div>
                    <div className="row">
                      {attempt.totalEstimate ? (
                        <Badge tone="info">Est. {attempt.totalEstimate}</Badge>
                      ) : null}
                      <span className="muted">
                        {attempt.modules.reduce((a, m) => a + m.correct, 0)}/
                        {attempt.modules.reduce((a, m) => a + m.total, 0)} raw
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No completed simulations yet.</p>
            )}
          </Card>

          <Card>
            <div className="row-between">
              <div>
                <h3>Saved &amp; Missed</h3>
                <p className="muted">
                  {app.saved.length} saved · {incorrectCount} missed
                </p>
              </div>
              <div className="row">
                <Link to="/bank?saved=1" className="btn btn-outline btn-sm">
                  <Icon name="bookmark" size={13} />
                  <span>View saved</span>
                </Link>
                <Link to="/arcade" className="btn btn-outline btn-sm">
                  <Icon name="arcade" size={13} />
                  <span>Arcade &amp; Lab</span>
                </Link>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
