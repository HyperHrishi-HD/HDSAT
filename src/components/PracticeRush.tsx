import { useEffect, useMemo, useRef, useState } from 'react';
import { FigureView, StimulusView } from './FigureView';
import { DesmosPane } from './MathTools';
import { PaneSwitch, SplitWorkbench, useSplitPane } from './SplitWorkbench';
import { MathText } from './MathText';
import { Badge, Button, Card, InfoTip, Select, Stat } from './ui';
import { buildPracticeSession, formatClock } from '../lib/examEngine';
import { checkAnswer } from '../lib/grading';
import {
  chooseRushQuestion,
  describeRushKey,
  describeRushMix,
  emptyRushServed,
  parseRushDuration,
  rushAnswerPoints,
  rushDifficultyMix,
  RUSH_DIFFICULTY_OPTIONS,
  RUSH_DURATION_OPTIONS,
  RUSH_MIN_ATTEMPTS_FOR_RECORD,
  rushSetupKey,
  rushSetupLabel,
  type RushDifficultyMode,
  type RushDuration,
  type RushServed,
} from '../lib/rush';
import { newEventId } from '../lib/storage';
import { useApp } from '../lib/store';
import type { Question, Section } from '../lib/types';

/**
 * Practice Rush lives inside the Arcade because it is a game: a timed run with
 * a personal best per setup. It is deliberately self-contained so the Arcade
 * can mount and unmount it without touching Practice state.
 */
export function PracticeRush({ onFinished }: { onFinished?: () => void } = {}) {
  const app = useApp();
  const assessment = app.settings.assessment;
  const split = useSplitPane('hdsat.split.rush', { ratio: 46, minRatio: 30, maxRatio: 70 });

  const [duration, setDuration] = useState<RushDuration>(180);
  const [section, setSection] = useState<Section | 'all'>('all');
  const [difficulty, setDifficulty] = useState<RushDifficultyMode>('Mixed');
  const [active, setActive] = useState(false);
  const [finished, setFinished] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [pool, setPool] = useState<Question[]>([]);
  const [current, setCurrent] = useState<Question | null>(null);
  const [correct, setCorrect] = useState(0);
  const [attempted, setAttempted] = useState(0);
  const [score, setScore] = useState(0);
  const [newBest, setNewBest] = useState(false);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [input, setInput] = useState('');
  const [lastFeedback, setLastFeedback] = useState<{ correct: boolean; key: string } | null>(null);
  const [calcOpen, setCalcOpen] = useState(true);

  const sessionIdRef = useRef<string>(newEventId());
  const servedRef = useRef<RushServed>(emptyRushServed());
  const usedRef = useRef<Set<string>>(new Set());
  const recordedRef = useRef<boolean>(false);
  const answerStartRef = useRef<number>(Date.now());

  const rushKey = useMemo(
    () => rushSetupKey({ duration, section, difficulty }),
    [duration, section, difficulty]
  );
  const record = app.rushScores[rushKey] ?? null;
  const mix = rushDifficultyMix(elapsed);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (!active || duration === 'free') return;
    if (elapsed >= duration) {
      setActive(false);
      setFinished(true);
    }
  }, [active, duration, elapsed]);

  useEffect(() => {
    if (!finished || recordedRef.current) return;
    recordedRef.current = true;
    onFinished?.();
    if (attempted < RUSH_MIN_ATTEMPTS_FOR_RECORD) return;
    const outcome = app.actions.recordRushScore(rushKey, score);
    setNewBest(outcome.improved);
    void app.actions.completeSession({
      activityType: 'practice_rush',
      sessionId: sessionIdRef.current,
      questions: attempted,
      correct,
      timeSpentSeconds: elapsed,
    });
  }, [finished]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => {
    const built = buildPracticeSession(
      app.questions,
      {
        assessment,
        section,
        excludeReleasedPracticeSet: app.settings.excludeReleasedPracticeSet,
      },
      {
        count: 400,
        progress: app.progress,
        savedIds: app.saved,
        seed: `rush:${Date.now()}`,
      }
    );
    if (built.length === 0) return;
    const banded =
      difficulty === 'Easy' || difficulty === 'Medium' || difficulty === 'Hard'
        ? built.filter((q) => q.difficulty === difficulty)
        : built;
    const nextPool = banded.length > 0 ? banded : built;
    servedRef.current = emptyRushServed();
    usedRef.current = new Set();
    recordedRef.current = false;
    const first = chooseRushQuestion(nextPool, difficulty, 0, servedRef.current, usedRef.current);
    if (!first) return;
    usedRef.current.add(first.id);
    sessionIdRef.current = newEventId();
    answerStartRef.current = Date.now();
    setPool(nextPool);
    setCurrent(first);
    setCorrect(0);
    setAttempted(0);
    setScore(0);
    setNewBest(false);
    setStreak(0);
    setBestStreak(0);
    setInput('');
    setLastFeedback(null);
    setElapsed(0);
    setFinished(false);
    setActive(true);
  };

  const submit = async (value: string) => {
    const q = current;
    if (!q || !active) return;
    const isCorrect = checkAnswer(q, value);
    const nextStreak = isCorrect ? streak + 1 : 0;
    if (isCorrect) {
      setScore((points) => points + rushAnswerPoints(q.difficulty, nextStreak));
      setCorrect((n) => n + 1);
      setStreak(nextStreak);
      setBestStreak((best) => Math.max(best, nextStreak));
    } else {
      setStreak(0);
    }
    setAttempted((n) => n + 1);
    servedRef.current = {
      ...servedRef.current,
      [q.difficulty]: servedRef.current[q.difficulty] + 1,
    };
    setLastFeedback({ correct: isCorrect, key: q.correct_answer });
    const spent = Math.max(1, Math.round((Date.now() - answerStartRef.current) / 1000));
    answerStartRef.current = Date.now();
    await app.actions.submitAttempt(q, value, {
      mode: 'rush',
      timeSpentSeconds: spent,
      sessionId: sessionIdRef.current,
    });
    setInput('');
    const next = chooseRushQuestion(
      pool,
      difficulty,
      elapsed,
      servedRef.current,
      usedRef.current
    );
    if (next) {
      usedRef.current.add(next.id);
      setCurrent(next);
    } else {
      setActive(false);
      setFinished(true);
    }
  };

  if (!active && !finished) {
    return (
      <Card>
        <div className="row-between">
          <div>
            <h2>Practice Rush</h2>
            <p className="muted">
              High-tempo SAT skill sprint. Answer as many questions accurately as you can before the
              clock expires.
            </p>
          </div>
          <Badge tone="info">Mixed bank draw</Badge>
        </div>

        <div style={{ marginTop: 12 }}>
          <div className="card-grid">
            <Select
              label="Duration"
              value={duration === 'free' ? 'free' : String(duration)}
              onChange={(value) => setDuration(parseRushDuration(value))}
              options={RUSH_DURATION_OPTIONS}
            />
            <Select
              label="Section Focus"
              value={section}
              onChange={(value) => setSection(value as Section | 'all')}
              options={[
                { value: 'all', label: 'Mixed (Reading & Writing + Math)' },
                { value: 'Reading and Writing', label: 'Reading and Writing Only' },
                { value: 'Math', label: 'Math Only' },
              ]}
            />
            <Select
              label="Difficulty"
              value={difficulty}
              onChange={(value) => setDifficulty(value as RushDifficultyMode)}
              options={RUSH_DIFFICULTY_OPTIONS}
            />
          </div>
          <div className="rush-score-line">
            <span>
              This setup:{' '}
              <strong>
                {rushSetupLabel(duration)} · {section === 'all' ? 'Mixed sections' : section} ·{' '}
                {difficulty}
              </strong>
            </span>
            <span className="rush-score-best">
              High score: <strong>{record ? record.best : '—'}</strong>
            </span>
            <span>
              Last: <strong>{record ? record.last : '—'}</strong>
            </span>
            {record ? (
              <span>
                {record.plays} {record.plays === 1 ? 'run' : 'runs'}
              </span>
            ) : null}
            <InfoTip label="Rush scoring">
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.55 }}>
                <li>
                  <strong>Correct answers:</strong> Easy 10, Medium 15, Hard 20 points.
                </li>
                <li>
                  <strong>Streak:</strong> +10% per consecutive correct answer, capped at +50%.
                </li>
                <li>
                  <strong>Increasing:</strong> starts fully Easy, then shifts 10% → 22% → 35% → 50%
                  Medium/Hard over the first five minutes, settling at the SAT module mix.
                </li>
                <li>
                  <strong>Records</strong> are kept separately for every duration, section and
                  difficulty combination, so a stopwatch run never competes with a blitz. Runs with
                  fewer than three answers are not saved as a record.
                </li>
              </ul>
            </InfoTip>
          </div>
          {Object.keys(app.rushScores).length > 0 ? (
            <details className="rush-records">
              <summary>
                All personal bests ({Object.keys(app.rushScores).length}{' '}
                {Object.keys(app.rushScores).length === 1 ? 'setup' : 'setups'})
              </summary>
              <div className="stack" style={{ marginTop: 8 }}>
                {Object.entries(app.rushScores)
                  .sort((a, b) => b[1].best - a[1].best)
                  .map(([key, entry]) => (
                    <div key={key} className="row-between" style={{ fontSize: '0.82rem' }}>
                      <span>{describeRushKey(key)}</span>
                      <span>
                        <strong>{entry.best}</strong> best · {entry.last} last · {entry.plays}{' '}
                        {entry.plays === 1 ? 'run' : 'runs'}
                      </span>
                    </div>
                  ))}
              </div>
            </details>
          ) : null}
          <Button onClick={start}>Launch Practice Rush</Button>
        </div>
      </Card>
    );
  }

  if (finished) {
    return (
      <Card>
        <h2>Practice Rush Summary</h2>
        <div className="card-grid" style={{ margin: '12px 0' }}>
          <Stat label="Score" value={score} hint={newBest ? 'New personal best!' : undefined} />
          <Stat label="Correct" value={`${correct} / ${attempted}`} />
          <Stat
            label="Accuracy"
            value={attempted > 0 ? `${Math.round((correct / attempted) * 100)}%` : '0%'}
          />
          <Stat label="Best Streak" value={bestStreak} />
          <Stat
            label="Time"
            value={formatClock(elapsed)}
            hint={duration === 'free' ? 'Stopwatch run' : `of ${rushSetupLabel(duration)}`}
          />
        </div>
        <div className="rush-score-line" style={{ marginBottom: 12 }}>
          <span>
            {rushSetupLabel(duration)} · {section === 'all' ? 'Mixed sections' : section} ·{' '}
            {difficulty}
          </span>
          <span className="rush-score-best">
            High score: <strong>{record ? record.best : '—'}</strong>
          </span>
          <span>
            Last: <strong>{record ? record.last : '—'}</strong>
          </span>
        </div>
        <div className="row">
          <Button onClick={start}>Play Again</Button>
          <Button variant="outline" onClick={() => setFinished(false)}>
            Change Rush Settings
          </Button>
        </div>
      </Card>
    );
  }

  if (!current) return null;

  const q = current;

  return (
    <Card>
      <div className="row-between" style={{ marginBottom: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>Practice Rush</h2>
          <p className="muted" style={{ margin: '2px 0 0' }}>
            {duration === 'free'
              ? `${formatClock(elapsed)} stopwatch`
              : `${formatClock(Math.max(0, duration - elapsed))} remaining`}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setActive(false);
            setFinished(true);
          }}
        >
          End Rush
        </Button>
      </div>

      <SplitWorkbench
        className="rush-workbench"
        maxViewportHeight={660}
        side={split.side}
        ratio={split.ratio}
        minRatio={split.minRatio}
        maxRatio={split.maxRatio}
        onRatioChange={split.setRatio}
        toolVisible={q.section === 'Math' && calcOpen}
        toolKind="calc"
        tool={<DesmosPane />}
        main={
          <div>
            {duration === 'free' ? null : (
              <div className="timer-bar">
                <div
                  className="timer-bar-fill"
                  style={{ width: `${Math.max(0, ((duration - elapsed) / duration) * 100)}%` }}
                />
              </div>
            )}
            <div className="row-between" style={{ marginBottom: 12 }}>
              <div className="row">
                <Badge tone="info">{score} pts</Badge>
                <Badge tone="good">{correct} correct</Badge>
                <Badge>{attempted} attempted</Badge>
                <Badge tone="info">Streak: {streak}</Badge>
                {duration === 'free' ? (
                  <Badge tone="warn">Stopwatch {formatClock(elapsed)}</Badge>
                ) : null}
                {q.section === 'Math' ? (
                  <>
                    <Button size="sm" variant="subtle" onClick={() => setCalcOpen((v) => !v)}>
                      {calcOpen ? 'Hide Calculator' : 'Calculator'}
                    </Button>
                    <PaneSwitch side={split.side} onClick={split.toggleSide} />
                  </>
                ) : null}
              </div>
            </div>

            {difficulty === 'Increasing' ? (
              <div className="rush-mix" style={{ marginBottom: 10 }}>
                <span>Difficulty curve</span>
                <span className="rush-mix-bar" aria-hidden="true">
                  <span className="rush-mix-easy" style={{ width: `${mix.Easy * 100}%` }} />
                  <span className="rush-mix-medium" style={{ width: `${mix.Medium * 100}%` }} />
                  <span className="rush-mix-hard" style={{ width: `${mix.Hard * 100}%` }} />
                </span>
                <span>{describeRushMix(mix)}</span>
              </div>
            ) : null}

            {lastFeedback ? (
              <p className="muted">
                Previous item:{' '}
                <strong style={{ color: lastFeedback.correct ? 'var(--good)' : 'var(--bad)' }}>
                  {lastFeedback.correct ? 'Correct!' : `Incorrect (Key: ${lastFeedback.key})`}
                </strong>
              </p>
            ) : null}

            <div className="question">
              <div className="row-between" style={{ marginBottom: 8 }}>
                <Badge tone="info">{q.section}</Badge>
                <Badge>
                  {q.domain} · {q.difficulty}
                </Badge>
              </div>
              <FigureView question={q} />
              {q.stimulus ? (
                <div className="stimulus">
                  <StimulusView stimulus={q.stimulus} />
                </div>
              ) : null}
              <div className="prompt">
                <MathText text={q.prompt} />
              </div>
              {q.format === 'multiple_choice' && q.choices ? (
                <div>
                  {q.choices.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="rush-option"
                      onClick={() => void submit(c.id)}
                    >
                      <strong>{c.id}.</strong> <MathText text={c.text} />
                    </button>
                  ))}
                </div>
              ) : (
                <form
                  className="row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (input.trim()) void submit(input.trim());
                  }}
                >
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Enter numeric response"
                  />
                  <Button type="submit">Submit</Button>
                </form>
              )}
            </div>
          </div>
        }
      />
    </Card>
  );
}
