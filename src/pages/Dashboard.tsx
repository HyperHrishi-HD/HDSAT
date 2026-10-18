import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, ProgressBar, Select, Stat } from '../components/ui';
import { useApp } from '../lib/store';
import type { Assessment } from '../lib/types';

const ASSESSMENTS: { value: Assessment; label: string }[] = [
  { value: 'SAT', label: 'Digital SAT' },
  { value: 'PSAT/NMSQT', label: 'PSAT/NMSQT' },
  { value: 'PSAT 10', label: 'PSAT 10' },
  { value: 'PSAT 8/9', label: 'PSAT 8/9' },
];

export function DashboardPage() {
  const app = useApp();

  const domainBreakdown = useMemo(() => {
    const map = new Map<string, { domain: string; section: string; total: number; attempted: number; correct: number }>();
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

  return (
    <div>
      <Card>
        <div className="row-between">
          <div>
            <h1>HDSAT Preparation Dashboard</h1>
            <p>
              Minimalist, adaptive Digital {app.settings.assessment} preparation. Every statistic below reflects your
              recorded attempts.
            </p>
          </div>
          <div style={{ minWidth: 210 }}>
            <Select
              label="Target assessment"
              value={app.settings.assessment}
              onChange={(val) => app.actions.updateSettings({ assessment: val as Assessment })}
              options={ASSESSMENTS}
            />
          </div>
        </div>

        <div className="row" style={{ marginTop: 8 }}>
          <Link to="/practice" className="btn btn-primary">
            Start custom practice
          </Link>
          <Link to="/test" className="btn btn-outline">
            Adaptive full simulation
          </Link>
          <Link to="/bank" className="btn btn-outline">
            Browse question bank ({app.questions.length})
          </Link>
          <Link to="/flashcards" className="btn btn-outline">
            Review flashcards ({app.totals.dueCards} due)
          </Link>
          {incorrectCount > 0 ? (
            <Link to="/practice?mode=incorrect" className="btn btn-subtle">
              Retry {incorrectCount} missed item{incorrectCount === 1 ? '' : 's'}
            </Link>
          ) : null}
        </div>
      </Card>

      <div className="card-grid" style={{ marginBottom: 16 }}>
        <Card>
          <Stat
            label="Questions Answered"
            value={app.totals.attempts}
            hint={`${app.totals.uniqueQuestions} of ${app.questions.length} unique bank items`}
          />
        </Card>
        <Card>
          <Stat
            label="Overall Accuracy"
            value={app.totals.attempts > 0 ? `${Math.round(app.totals.accuracy * 100)}%` : '—'}
            hint={
              app.totals.attempts > 0
                ? `${app.totals.correct} correct · ${app.totals.mastered} mastered`
                : 'Complete your first question to compute accuracy'
            }
          />
        </Card>
        <Card>
          <Stat
            label="Study Streak"
            value={`${app.currentStreak} day${app.currentStreak === 1 ? '' : 's'}`}
            hint={`Best streak: ${app.bestStreak} day${app.bestStreak === 1 ? '' : 's'}`}
          />
        </Card>
        <Card>
          <Stat
            label="HDCoins Balance"
            value={app.hdCoins}
            hint={`${todayActivity?.coinsEarned ?? 0} earned today · ${app.achievements.length} achievements`}
          />
        </Card>
      </div>

      <div className="grid-2">
        <Card>
          <div className="row-between" style={{ marginBottom: 8 }}>
            <h3>Domain Mastery ({app.settings.assessment})</h3>
            <Badge tone="info">{app.questions.filter((q) => q.assessments.includes(app.settings.assessment)).length} items</Badge>
          </div>
          <div className="stack">
            {domainBreakdown.map((item) => {
              const pct = item.total > 0 ? Math.round((item.correct / item.total) * 100) : 0;
              return (
                <div key={item.domain} className="stack" style={{ gap: 4 }}>
                  <div className="row-between" style={{ fontSize: '0.86rem' }}>
                    <span>
                      <strong>{item.domain}</strong>{' '}
                      <span className="muted">({item.section === 'Math' ? 'Math' : 'R&W'})</span>
                    </span>
                    <span className="muted">
                      {item.correct}/{item.total} correct ({pct}%)
                    </span>
                  </div>
                  <ProgressBar value={item.correct} max={item.total} />
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
                {(todayActivity?.questionsCompleted ?? 0) >= 3 ? 'Daily goal met' : 'Goal: 3+ questions/day'}
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
              <h3>Recent Adaptive Simulations</h3>
              <Link to="/test" className="btn btn-outline btn-sm">
                New simulation
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
              <p className="muted">
                No completed simulations yet. Take a timed, multistage adaptive test to see your module routing and
                estimated score breakdown.
              </p>
            )}
          </Card>

          <Card>
            <div className="row-between">
              <div>
                <h3>Saved Questions &amp; Review</h3>
                <p className="muted">
                  {app.saved.length} bookmarked item{app.saved.length === 1 ? '' : 's'} · {incorrectCount} currently
                  missed
                </p>
              </div>
              <div className="row">
                <Link to="/bank?saved=1" className="btn btn-outline btn-sm">
                  View saved
                </Link>
                <Link to="/arcade" className="btn btn-outline btn-sm">
                  Desmos Lab &amp; Mini-Games
                </Link>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
