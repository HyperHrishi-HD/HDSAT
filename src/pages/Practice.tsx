import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FigureView, StimulusView } from '../components/FigureView';
import { CalculatorPanel, MathReferenceSheet } from '../components/MathTools';
import { MathText } from '../components/MathText';
import { QuestionView, type Feedback } from '../components/QuestionView';
import { Badge, Button, Card, EmptyState, InfoTip, MultiSelect, Select, Stat, Toggle } from '../components/ui';
import { buildPracticeSession, filterQuestions, formatClock } from '../lib/examEngine';
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
import type { Assessment, Difficulty, Question, Section } from '../lib/types';

type TabMode = 'custom' | 'rush' | 'assistant';

export function PracticePage() {
  const app = useApp();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<TabMode>(() => (searchParams.get('tab') === 'rush' ? 'rush' : 'custom'));

  // Custom practice configuration
  const [assessment, setAssessment] = useState<Assessment>(app.settings.assessment);
  const [section, setSection] = useState<Section | 'all'>('all');
  const [domains, setDomains] = useState<string[]>([]);
  const [difficulties, setDifficulties] = useState<Difficulty[]>([]);
  const [sourceId, setSourceId] = useState<string>('all');
  const [count, setCount] = useState<number>(10);
  const [onlyIncorrect, setOnlyIncorrect] = useState<boolean>(searchParams.get('mode') === 'incorrect');
  const [onlySaved, setOnlySaved] = useState<boolean>(searchParams.get('mode') === 'saved');
  const [excludeCorrect, setExcludeCorrect] = useState<boolean>(app.settings.excludePreviouslyCorrect);
  const [excludeReleased, setExcludeReleased] = useState<boolean>(app.settings.excludeReleasedPracticeSet);
  const [timedPerQuestion, setTimedPerQuestion] = useState<boolean>(false);

  // Active Custom Session
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionQuestions, setSessionQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [eliminated, setEliminated] = useState<Record<string, string[]>>({});
  const [flagged, setFlagged] = useState<Record<string, boolean>>({});
  const [feedbackMap, setFeedbackMap] = useState<Record<string, Feedback>>({});
  const [sessionDone, setSessionDone] = useState<boolean>(false);
  const [showCalc, setShowCalc] = useState<boolean>(false);
  const [showRef, setShowRef] = useState<boolean>(false);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const questionStartRef = useRef<number>(Date.now());

  // Practice Rush State
  const [rushDuration, setRushDuration] = useState<RushDuration>(180);
  const [rushSection, setRushSection] = useState<Section | 'all'>('all');
  const [rushDifficulty, setRushDifficulty] = useState<RushDifficultyMode>('Mixed');
  const [rushActive, setRushActive] = useState<boolean>(false);
  const [rushFinished, setRushFinished] = useState<boolean>(false);
  const [rushElapsed, setRushElapsed] = useState<number>(0);
  const [rushPool, setRushPool] = useState<Question[]>([]);
  const [rushCurrent, setRushCurrent] = useState<Question | null>(null);
  const [rushCorrect, setRushCorrect] = useState<number>(0);
  const [rushAttempted, setRushAttempted] = useState<number>(0);
  const [rushScore, setRushScore] = useState<number>(0);
  const [rushNewBest, setRushNewBest] = useState<boolean>(false);
  const [rushStreak, setRushStreak] = useState<number>(0);
  const [rushBestStreak, setRushBestStreak] = useState<number>(0);
  const [rushInput, setRushInput] = useState<string>('');
  const [rushLastFeedback, setRushLastFeedback] = useState<{ correct: boolean; key: string } | null>(null);
  const rushSessionIdRef = useRef<string>(newEventId());
  const rushServedRef = useRef<RushServed>(emptyRushServed());
  const rushUsedRef = useRef<Set<string>>(new Set());
  const rushRecordedRef = useRef<boolean>(false);

  const rushKey = useMemo(
    () => rushSetupKey({ duration: rushDuration, section: rushSection, difficulty: rushDifficulty }),
    [rushDuration, rushSection, rushDifficulty]
  );
  const rushRecord = app.rushScores[rushKey] ?? null;
  const rushMix = rushDifficultyMix(rushElapsed);

  const domainOptions = useMemo(() => {
    const set = new Set<string>();
    app.questions.forEach((q) => {
      if (section === 'all' || q.section === section) set.add(q.domain);
    });
    return Array.from(set);
  }, [app.questions, section]);

  const matchingPool = useMemo(
    () =>
      filterQuestions(
        app.questions,
        {
          assessment,
          section,
          domains,
          difficulties,
          sourceId,
          onlyIncorrect,
          onlySaved,
          excludePreviouslyCorrect: excludeCorrect,
          excludeReleasedPracticeSet: excludeReleased,
        },
        app.progress,
        app.saved
      ),
    [
      app.questions,
      app.progress,
      app.saved,
      assessment,
      section,
      domains,
      difficulties,
      sourceId,
      onlyIncorrect,
      onlySaved,
      excludeCorrect,
      excludeReleased,
    ]
  );

  // Elapsed timer for active custom session
  useEffect(() => {
    if (!sessionId || sessionDone) return;
    const timer = window.setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sessionId, sessionDone]);

  // Practice Rush clock: counts up for every mode, so the free stopwatch and the
  // increasing-difficulty curve both read from one honest source.
  useEffect(() => {
    if (!rushActive) return;
    const timer = window.setInterval(() => {
      setRushElapsed((seconds) => seconds + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [rushActive]);

  // A timed run ends when its budget is spent; a free run ends only on demand
  // (or when the question supply runs out).
  useEffect(() => {
    if (!rushActive || rushDuration === 'free') return;
    if (rushElapsed >= rushDuration) {
      setRushActive(false);
      setRushFinished(true);
    }
  }, [rushActive, rushDuration, rushElapsed]);

  // Exactly once per finished run: store the personal best for this exact
  // combination and record the activity session.
  useEffect(() => {
    if (!rushFinished || rushRecordedRef.current) return;
    rushRecordedRef.current = true;
    if (rushAttempted < RUSH_MIN_ATTEMPTS_FOR_RECORD) return;
    const outcome = app.actions.recordRushScore(rushKey, rushScore);
    setRushNewBest(outcome.improved);
    void app.actions.completeSession({
      activityType: 'practice_rush',
      sessionId: rushSessionIdRef.current,
      questions: rushAttempted,
      correct: rushCorrect,
      timeSpentSeconds: rushElapsed,
    });
  }, [rushFinished]); // eslint-disable-line react-hooks/exhaustive-deps

  const startCustomSession = () => {
    const chosen = buildPracticeSession(
      app.questions,
      {
        assessment,
        section,
        domains,
        difficulties,
        sourceId,
        onlyIncorrect,
        onlySaved,
        excludePreviouslyCorrect: excludeCorrect,
        excludeReleasedPracticeSet: excludeReleased,
      },
      {
        count: Math.min(count, Math.max(1, matchingPool.length)),
        progress: app.progress,
        savedIds: app.saved,
        seed: `custom:${Date.now()}`,
      }
    );
    if (chosen.length === 0) return;
    setSessionId(newEventId());
    setSessionQuestions(chosen);
    setCurrentIndex(0);
    setResponses({});
    setEliminated({});
    setFlagged({});
    setFeedbackMap({});
    setSessionDone(false);
    setElapsedSeconds(0);
    questionStartRef.current = Date.now();
  };

  const currentQuestion = sessionQuestions[currentIndex] ?? null;

  const handleSubmitCurrent = async () => {
    if (!currentQuestion) return;
    const resp = responses[currentQuestion.id] ?? '';
    if (!resp.trim()) return;
    const spent = Math.max(1, Math.round((Date.now() - questionStartRef.current) / 1000));
    const res = await app.actions.submitAttempt(currentQuestion, resp, {
      mode: 'practice',
      timeSpentSeconds: spent,
      sessionId,
    });
    setFeedbackMap((prev) => ({
      ...prev,
      [currentQuestion.id]: {
        isCorrect: res.isCorrect,
        correctAnswer: currentQuestion.correct_answer,
        explanation: currentQuestion.explanation,
        distractorRationales: currentQuestion.distractor_rationales,
      },
    }));
  };

  const finishCustomSession = async () => {
    setSessionDone(true);
    const answeredCount = Object.keys(feedbackMap).length;
    const correctCount = Object.values(feedbackMap).filter((f) => f.isCorrect).length;
    if (timedPerQuestion && answeredCount >= 3 && sessionId) {
      await app.actions.completeSession({
        activityType: 'timed_session',
        sessionId,
        questions: answeredCount,
        correct: correctCount,
        timeSpentSeconds: elapsedSeconds,
      });
    }
  };

  const startRush = () => {
    const built = buildPracticeSession(
      app.questions,
      {
        assessment,
        section: rushSection,
        excludeReleasedPracticeSet: excludeReleased,
      },
      {
        count: 400,
        progress: app.progress,
        savedIds: app.saved,
        seed: `rush:${Date.now()}`,
      }
    );
    if (built.length === 0) return;
    // A fixed difficulty draws from that band only; if the bank has nothing in
    // that band for this section, fall back to the full mix rather than an
    // empty run.
    const banded =
      rushDifficulty === 'Easy' || rushDifficulty === 'Medium' || rushDifficulty === 'Hard'
        ? built.filter((q) => q.difficulty === rushDifficulty)
        : built;
    const pool = banded.length > 0 ? banded : built;
    rushServedRef.current = emptyRushServed();
    rushUsedRef.current = new Set();
    rushRecordedRef.current = false;
    const first = chooseRushQuestion(pool, rushDifficulty, 0, rushServedRef.current, rushUsedRef.current);
    if (!first) return;
    rushUsedRef.current.add(first.id);
    rushSessionIdRef.current = newEventId();
    setRushPool(pool);
    setRushCurrent(first);
    setRushCorrect(0);
    setRushAttempted(0);
    setRushScore(0);
    setRushNewBest(false);
    setRushStreak(0);
    setRushBestStreak(0);
    setRushInput('');
    setRushLastFeedback(null);
    setRushElapsed(0);
    setRushFinished(false);
    setRushActive(true);
  };

  const submitRushAnswer = async (value: string) => {
    const q = rushCurrent;
    if (!q || !rushActive) return;
    const isCorrect = checkAnswer(q, value);
    const nextStreak = isCorrect ? rushStreak + 1 : 0;
    if (isCorrect) {
      setRushScore((points) => points + rushAnswerPoints(q.difficulty, nextStreak));
      setRushCorrect((n) => n + 1);
      setRushStreak(nextStreak);
      setRushBestStreak((best) => Math.max(best, nextStreak));
    } else {
      setRushStreak(0);
    }
    setRushAttempted((n) => n + 1);
    rushServedRef.current = {
      ...rushServedRef.current,
      [q.difficulty]: rushServedRef.current[q.difficulty] + 1,
    };
    setRushLastFeedback({ correct: isCorrect, key: q.correct_answer });
    await app.actions.submitAttempt(q, value, {
      mode: 'rush',
      timeSpentSeconds: 5,
      sessionId: rushSessionIdRef.current,
    });
    setRushInput('');
    const next = chooseRushQuestion(
      rushPool,
      rushDifficulty,
      rushElapsed,
      rushServedRef.current,
      rushUsedRef.current
    );
    if (next) {
      rushUsedRef.current.add(next.id);
      setRushCurrent(next);
    } else {
      setRushActive(false);
      setRushFinished(true);
    }
  };

  // Deterministic Rule-Based Study Coach Diagnostics
  const studyCoachPlan = useMemo(() => {
    const domainStats: {
      domain: string;
      section: Section;
      attempted: number;
      correct: number;
      accuracy: number;
      unseen: number;
    }[] = [];
    const byDomain = new Map<string, Question[]>();
    app.questions.forEach((q) => {
      if (!q.assessments.includes(assessment)) return;
      const list = byDomain.get(q.domain) ?? [];
      list.push(q);
      byDomain.set(q.domain, list);
    });

    byDomain.forEach((items, dom) => {
      let attempted = 0;
      let correct = 0;
      let unseen = 0;
      items.forEach((q) => {
        const p = app.progress[q.id];
        if (!p || p.attemptCount === 0) unseen += 1;
        else {
          attempted += 1;
          if (p.lastIsCorrect) correct += 1;
        }
      });
      domainStats.push({
        domain: dom,
        section: items[0].section,
        attempted,
        correct,
        accuracy: attempted > 0 ? correct / attempted : 0,
        unseen,
      });
    });

    const weakest = [...domainStats].sort((a, b) => {
      if (a.attempted === 0 && b.attempted === 0) return b.unseen - a.unseen;
      if (a.attempted === 0) return 1;
      if (b.attempted === 0) return -1;
      return a.accuracy - b.accuracy;
    });

    return weakest;
  }, [app.questions, app.progress, assessment]);

  return (
    <div>
      <Card>
        <div className="row-between">
          <div>
            <div className="row">
              <h1>Practice &amp; Skill Drills</h1>
              <InfoTip label="Practice modes">
                Filter the bank by assessment, section, domain, and difficulty, run a timed Practice
                Rush, or use the rule-based Study Coach to target your lowest-accuracy domains.
              </InfoTip>
            </div>
          </div>
          <div className="row">
            <Button
              variant={tab === 'custom' ? 'primary' : 'outline'}
              size="sm"
              icon="practice"
              onClick={() => setTab('custom')}
            >
              Custom Practice
            </Button>
            <Button
              variant={tab === 'rush' ? 'primary' : 'outline'}
              size="sm"
              icon="bolt"
              onClick={() => setTab('rush')}
            >
              Practice Rush
            </Button>
            <Button
              variant={tab === 'assistant' ? 'primary' : 'outline'}
              size="sm"
              icon="spark"
              onClick={() => setTab('assistant')}
            >
              Study Coach
            </Button>
          </div>
        </div>
      </Card>

      {tab === 'custom' && !sessionId ? (
        <Card>
          <div className="row-between">
            <h2>Custom Practice</h2>
            <Badge tone="info">{matchingPool.length} matching items</Badge>
          </div>

          <div className="card-grid" style={{ marginTop: 12 }}>
            <Select
              label="Assessment"
              value={assessment}
              onChange={(v) => setAssessment(v as Assessment)}
              options={[
                { value: 'SAT', label: 'Digital SAT' },
                { value: 'PSAT/NMSQT', label: 'PSAT/NMSQT' },
                { value: 'PSAT 10', label: 'PSAT 10' },
                { value: 'PSAT 8/9', label: 'PSAT 8/9' },
              ]}
            />
            <Select
              label="Section"
              value={section}
              onChange={(v) => {
                setSection(v as Section | 'all');
                setDomains([]);
              }}
              options={[
                { value: 'all', label: 'Both Sections (Mixed)' },
                { value: 'Reading and Writing', label: 'Reading and Writing' },
                { value: 'Math', label: 'Math' },
              ]}
            />
            <MultiSelect
              label="Domains"
              values={domains}
              onChange={setDomains}
              allLabel="All Domains"
              hint="Mix as many domains as you like."
              options={domainOptions.map((d) => ({ value: d, label: d }))}
            />
            <MultiSelect
              label="Difficulties"
              values={difficulties}
              onChange={(next) => setDifficulties(next as Difficulty[])}
              allLabel="All Difficulties"
              hint="Select any combination of levels."
              options={[
                { value: 'Easy', label: 'Easy' },
                { value: 'Medium', label: 'Medium' },
                { value: 'Hard', label: 'Hard' },
              ]}
            />
            <Select
              label="Dataset Source"
              value={sourceId}
              onChange={setSourceId}
              options={[
                { value: 'all', label: 'All Licensed Sources' },
                ...app.sources.map((s) => ({ value: s.source_id, label: s.name })),
              ]}
            />
            <Select
              label="Session Length"
              value={String(count)}
              onChange={(v) => setCount(Number(v))}
              options={[
                { value: '5', label: '5 questions' },
                { value: '10', label: '10 questions' },
                { value: '15', label: '15 questions' },
                { value: '22', label: '22 questions' },
                { value: '25', label: '25 questions' },
                { value: '27', label: '27 questions' },
              ]}
            />
          </div>

          <div className="grid-2" style={{ marginTop: 8 }}>
            <div>
              <Toggle
                checked={excludeCorrect}
                onChange={(val) => {
                  setExcludeCorrect(val);
                  app.actions.updateSettings({ excludePreviouslyCorrect: val });
                }}
                label="Exclude previously correct questions"
                hint="Only serve unseen or previously missed items."
              />
              <Toggle
                checked={excludeReleased}
                onChange={(val) => {
                  setExcludeReleased(val);
                  app.actions.updateSettings({ excludeReleasedPracticeSet: val });
                }}
                label="Exclude Benchmark Simulation Set items"
                hint="Reserve designated full-length practice-set items so simulations stay fresh."
              />
            </div>
            <div>
              <Toggle
                checked={onlyIncorrect}
                onChange={setOnlyIncorrect}
                label="Incorrect-only drill"
                hint="Focus strictly on questions your last attempt missed."
              />
              <Toggle
                checked={onlySaved}
                onChange={setOnlySaved}
                label="Saved questions only"
                hint="Practice items you bookmarked in the Question Bank."
              />
              <Toggle
                checked={timedPerQuestion}
                onChange={setTimedPerQuestion}
                label="Track pace with session timer"
                hint="Displays elapsed time and awards timed-session bonus HDCoins."
              />
            </div>
          </div>

          <div className="row-between" style={{ marginTop: 14 }}>
            <span className="muted">
              {matchingPool.length === 0
                ? 'No questions match these filters yet.'
                : `${Math.min(count, matchingPool.length)} items ready from ${matchingPool.length} matching.`}
            </span>
            <Button icon="play" onClick={startCustomSession} disabled={matchingPool.length === 0}>
              Start session
            </Button>
          </div>
        </Card>
      ) : null}

      {tab === 'custom' && sessionId && !sessionDone && currentQuestion ? (
        <div>
          <div className="test-bar">
            <div>
              <strong>Custom Practice · {assessment}</strong>
              <div className="muted">
                Item {currentIndex + 1} of {sessionQuestions.length}
              </div>
            </div>
            <div className="row">
              {timedPerQuestion ? <span className="timer">{formatClock(elapsedSeconds)}</span> : null}
              <Button size="sm" variant="subtle" onClick={() => setShowCalc((v) => !v)}>
                {showCalc ? 'Hide Calculator' : 'Calculator'}
              </Button>
              <Button size="sm" variant="subtle" onClick={() => setShowRef((v) => !v)}>
                {showRef ? 'Hide Reference' : 'Reference Sheet'}
              </Button>
              <Button size="sm" variant="subtle" onClick={() => app.actions.toggleSaved(currentQuestion.id)}>
                {app.saved.includes(currentQuestion.id) ? 'Saved ★' : 'Save ☆'}
              </Button>
              <Button size="sm" variant="danger" onClick={finishCustomSession}>
                End session
              </Button>
            </div>
          </div>

          {showCalc ? <CalculatorPanel /> : null}
          {showRef ? <MathReferenceSheet /> : null}

          <Card>
            <div className="navigator" style={{ marginBottom: 12 }}>
              {sessionQuestions.map((q, idx) => {
                const fb = feedbackMap[q.id];
                const isCurr = idx === currentIndex;
                return (
                  <button
                    key={q.id}
                    type="button"
                    className={`nav-dot${responses[q.id] ? ' is-answered' : ''}${isCurr ? ' is-current' : ''}${
                      flagged[q.id] ? ' is-flagged' : ''
                    }`}
                    onClick={() => {
                      setCurrentIndex(idx);
                      questionStartRef.current = Date.now();
                    }}
                    title={fb ? (fb.isCorrect ? 'Correct' : 'Incorrect') : `Question ${idx + 1}`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            <QuestionView
              question={currentQuestion}
              index={currentIndex}
              total={sessionQuestions.length}
              response={responses[currentQuestion.id] ?? null}
              onResponseChange={(val) =>
                setResponses((prev) => ({
                  ...prev,
                  [currentQuestion.id]: val,
                }))
              }
              eliminated={eliminated[currentQuestion.id] ?? []}
              onToggleEliminate={(choiceId) =>
                setEliminated((prev) => {
                  const list = prev[currentQuestion.id] ?? [];
                  const next = list.includes(choiceId) ? list.filter((c) => c !== choiceId) : [...list, choiceId];
                  return { ...prev, [currentQuestion.id]: next };
                })
              }
              flagged={Boolean(flagged[currentQuestion.id])}
              onToggleFlag={() =>
                setFlagged((prev) => ({ ...prev, [currentQuestion.id]: !prev[currentQuestion.id] }))
              }
              feedback={feedbackMap[currentQuestion.id] ?? null}
              onSubmit={handleSubmitCurrent}
              disabled={Boolean(feedbackMap[currentQuestion.id])}
            />

            <div className="row-between" style={{ marginTop: 14 }}>
              <Button
                variant="outline"
                disabled={currentIndex === 0}
                onClick={() => {
                  setCurrentIndex((i) => Math.max(0, i - 1));
                  questionStartRef.current = Date.now();
                }}
              >
                Previous
              </Button>
              {currentIndex + 1 < sessionQuestions.length ? (
                <Button
                  variant="primary"
                  onClick={() => {
                    setCurrentIndex((i) => i + 1);
                    questionStartRef.current = Date.now();
                  }}
                >
                  Next question
                </Button>
              ) : (
                <Button variant="primary" onClick={finishCustomSession}>
                  View session summary
                </Button>
              )}
            </div>
          </Card>
        </div>
      ) : null}

      {tab === 'custom' && sessionId && sessionDone ? (
        <Card>
          <div className="row-between">
            <div>
              <h2>Practice Session Complete</h2>
              <p className="muted">
                Elapsed time: {formatClock(elapsedSeconds)} · Answered {Object.keys(feedbackMap).length} of{' '}
                {sessionQuestions.length} questions
              </p>
            </div>
            <div className="row">
              <Button onClick={() => setSessionId(null)} variant="outline">
                Configure new session
              </Button>
              <Button onClick={startCustomSession}>Practice another set</Button>
            </div>
          </div>

          <div className="card-grid" style={{ marginTop: 12 }}>
            <Stat
              label="Correct"
              value={`${Object.values(feedbackMap).filter((f) => f.isCorrect).length} / ${sessionQuestions.length}`}
            />
            <Stat
              label="Accuracy"
              value={
                Object.keys(feedbackMap).length > 0
                  ? `${Math.round(
                      (Object.values(feedbackMap).filter((f) => f.isCorrect).length /
                        Object.keys(feedbackMap).length) *
                        100
                    )}%`
                  : '0%'
              }
            />
            <Stat label="Total Time" value={formatClock(elapsedSeconds)} />
          </div>
        </Card>
      ) : null}

      {tab === 'rush' ? (
        <Card>
          <div className="row-between">
            <div>
              <h2>Practice Rush</h2>
              <p className="muted">
                High-tempo SAT skill sprint. Answer as many questions accurately as you can before the clock expires.
              </p>
            </div>
            {rushActive ? (
              <Badge tone="warn">
                {rushDuration === 'free'
                  ? `${formatClock(rushElapsed)} stopwatch`
                  : `${formatClock(Math.max(0, rushDuration - rushElapsed))} remaining`}
              </Badge>
            ) : null}
          </div>

          {!rushActive && !rushFinished ? (
            <div style={{ marginTop: 12 }}>
              <div className="card-grid">
                <Select
                  label="Duration"
                  value={rushDuration === 'free' ? 'free' : String(rushDuration)}
                  onChange={(value) => setRushDuration(parseRushDuration(value))}
                  options={RUSH_DURATION_OPTIONS}
                />
                <Select
                  label="Section Focus"
                  value={rushSection}
                  onChange={(value) => setRushSection(value as Section | 'all')}
                  options={[
                    { value: 'all', label: 'Mixed (Reading & Writing + Math)' },
                    { value: 'Reading and Writing', label: 'Reading and Writing Only' },
                    { value: 'Math', label: 'Math Only' },
                  ]}
                />
                <Select
                  label="Difficulty"
                  value={rushDifficulty}
                  onChange={(value) => setRushDifficulty(value as RushDifficultyMode)}
                  options={RUSH_DIFFICULTY_OPTIONS}
                />
              </div>
              <div className="rush-score-line">
                <span>
                  This setup:{' '}
                  <strong>
                    {rushSetupLabel(rushDuration)} ·{' '}
                    {rushSection === 'all' ? 'Mixed sections' : rushSection} · {rushDifficulty}
                  </strong>
                </span>
                <span className="rush-score-best">
                  High score: <strong>{rushRecord ? rushRecord.best : '—'}</strong>
                </span>
                <span>
                  Last: <strong>{rushRecord ? rushRecord.last : '—'}</strong>
                </span>
                {rushRecord ? (
                  <span>
                    {rushRecord.plays} {rushRecord.plays === 1 ? 'run' : 'runs'}
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
                      <strong>Increasing:</strong> starts fully Easy, then shifts 10% → 22% → 35% →
                      50% Medium/Hard over the first five minutes, settling at the SAT module mix.
                    </li>
                    <li>
                      <strong>Records</strong> are kept separately for every duration, section and
                      difficulty combination, so a stopwatch run never competes with a blitz. Runs
                      with fewer than three answers are not saved as a record.
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
                      .map(([key, record]) => (
                        <div key={key} className="row-between" style={{ fontSize: '0.82rem' }}>
                          <span>{describeRushKey(key)}</span>
                          <span>
                            <strong>{record.best}</strong> best · {record.last} last ·{' '}
                            {record.plays} {record.plays === 1 ? 'run' : 'runs'}
                          </span>
                        </div>
                      ))}
                  </div>
                </details>
              ) : null}
              <Button onClick={startRush}>Launch Practice Rush</Button>
            </div>
          ) : null}

          {rushActive && rushCurrent ? (
            <div style={{ marginTop: 14 }}>
              {rushDuration === 'free' ? null : (
                <div className="timer-bar">
                  <div
                    className="timer-bar-fill"
                    style={{ width: `${Math.max(0, ((rushDuration - rushElapsed) / rushDuration) * 100)}%` }}
                  />
                </div>
              )}
              <div className="row-between" style={{ marginBottom: 12 }}>
                <div className="row">
                  <Badge tone="info">{rushScore} pts</Badge>
                  <Badge tone="good">{rushCorrect} correct</Badge>
                  <Badge>{rushAttempted} attempted</Badge>
                  <Badge tone="info">Streak: {rushStreak}</Badge>
                  {rushDuration === 'free' ? (
                    <Badge tone="warn">Stopwatch {formatClock(rushElapsed)}</Badge>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setRushActive(false);
                    setRushFinished(true);
                  }}
                >
                  End Rush
                </Button>
              </div>

              {rushDifficulty === 'Increasing' ? (
                <div className="rush-mix" style={{ marginBottom: 10 }}>
                  <span>Difficulty curve</span>
                  <span className="rush-mix-bar" aria-hidden="true">
                    <span className="rush-mix-easy" style={{ width: `${rushMix.Easy * 100}%` }} />
                    <span className="rush-mix-medium" style={{ width: `${rushMix.Medium * 100}%` }} />
                    <span className="rush-mix-hard" style={{ width: `${rushMix.Hard * 100}%` }} />
                  </span>
                  <span>{describeRushMix(rushMix)}</span>
                </div>
              ) : null}

              {rushLastFeedback ? (
                <p className="muted">
                  Previous item:{' '}
                  <strong style={{ color: rushLastFeedback.correct ? 'var(--good)' : 'var(--bad)' }}>
                    {rushLastFeedback.correct ? 'Correct!' : `Incorrect (Key: ${rushLastFeedback.key})`}
                  </strong>
                </p>
              ) : null}

              {(() => {
                const q = rushCurrent;
                if (!q) return null;
                return (
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
                            onClick={() => submitRushAnswer(c.id)}
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
                          if (rushInput.trim()) submitRushAnswer(rushInput.trim());
                        }}
                      >
                        <input
                          type="text"
                          value={rushInput}
                          onChange={(e) => setRushInput(e.target.value)}
                          placeholder="Enter numeric response"
                        />
                        <Button type="submit">Submit</Button>
                      </form>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : null}

          {rushFinished ? (
            <div style={{ marginTop: 14 }}>
              <h3>Practice Rush Summary</h3>
              <div className="card-grid" style={{ margin: '12px 0' }}>
                <Stat label="Score" value={rushScore} hint={rushNewBest ? 'New personal best!' : undefined} />
                <Stat label="Correct" value={`${rushCorrect} / ${rushAttempted}`} />
                <Stat
                  label="Accuracy"
                  value={rushAttempted > 0 ? `${Math.round((rushCorrect / rushAttempted) * 100)}%` : '0%'}
                />
                <Stat label="Best Streak" value={rushBestStreak} />
                <Stat
                  label="Time"
                  value={formatClock(rushElapsed)}
                  hint={rushDuration === 'free' ? 'Stopwatch run' : `of ${rushSetupLabel(rushDuration)}`}
                />
              </div>
              <div className="rush-score-line" style={{ marginBottom: 12 }}>
                <span>
                  {rushSetupLabel(rushDuration)} · {rushSection === 'all' ? 'Mixed sections' : rushSection} ·{' '}
                  {rushDifficulty}
                </span>
                <span className="rush-score-best">
                  High score: <strong>{rushRecord ? rushRecord.best : '—'}</strong>
                </span>
                <span>
                  Last: <strong>{rushRecord ? rushRecord.last : '—'}</strong>
                </span>
              </div>
              <div className="row">
                <Button onClick={startRush}>Play Again</Button>
                <Button variant="outline" onClick={() => setRushFinished(false)}>
                  Change Rush Settings
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      {tab === 'assistant' ? (
        <Card>
          <h2>Deterministic Study Coach</h2>
          <p className="muted">
            Rule-based diagnostic engine that inspects your actual attempt history, domain accuracy, and spaced-repetition
            queue—without generating synthetic questions or unverified advice.
          </p>

          {studyCoachPlan.length === 0 ? (
            <EmptyState title="No domains found" body="Select an assessment to view domain diagnostics." />
          ) : (
            <div className="stack" style={{ marginTop: 12 }}>
              {studyCoachPlan.map((d, idx) => {
                const statusLabel =
                  d.attempted === 0
                    ? 'Unexplored domain — start with 5 foundational items'
                    : d.accuracy < 0.6
                    ? 'Priority focus — accuracy below 60% routing threshold'
                    : d.accuracy < 0.85
                    ? 'Developing — drill Medium/Hard items to lock in upper-module routing'
                    : 'Strong mastery — maintain with periodic spaced review';
                return (
                  <div key={d.domain} className="muted-block row-between">
                    <div>
                      <strong>
                        {idx + 1}. {d.domain} ({d.section})
                      </strong>
                      <div className="muted">
                        {d.attempted > 0
                          ? `${d.correct}/${d.attempted} correct (${Math.round(d.accuracy * 100)}%) · ${d.unseen} unseen`
                          : `${d.unseen} unseen items available`}
                      </div>
                      <div style={{ fontSize: '0.84rem', marginTop: 4 }}>{statusLabel}</div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        setSection(d.section);
                        setDomains([d.domain]);
                        setDifficulties([]);
                        setOnlyIncorrect(false);
                        setOnlySaved(false);
                        setTab('custom');
                      }}
                    >
                      Drill {d.domain}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}
