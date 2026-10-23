import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DesmosPane } from '../components/MathTools';
import { ReferenceWindow } from '../components/ReferenceWindow';
import { PaneSwitch, SplitWorkbench, useSplitPane } from '../components/SplitWorkbench';
import { QuestionView, type Feedback } from '../components/QuestionView';
import { Badge, Button, Card, EmptyState, InfoTip, MultiSelect, Select, Stat, Toggle } from '../components/ui';
import { buildPracticeSession, filterQuestions, formatClock } from '../lib/examEngine';
import { newEventId } from '../lib/storage';
import { useApp } from '../lib/store';
import type { Assessment, Difficulty, Question, Section } from '../lib/types';

type TabMode = 'custom' | 'assistant';

export function PracticePage() {
  const app = useApp();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<TabMode>('custom');

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
  const [showCalc, setShowCalc] = useState<boolean>(true);
  const split = useSplitPane('hdsat.split.practice', { ratio: 46, minRatio: 30, maxRatio: 70 });
  const [showRef, setShowRef] = useState<boolean>(false);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const questionStartRef = useRef<number>(Date.now());

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
                Filter the bank by assessment, section, domain, and difficulty, or use the
                rule-based Study Coach to target your lowest-accuracy domains. Practice Rush and
                timed games live in the Arcade.
              </InfoTip>
            </div>
          </div>
          <div className="row">
            <Button
              variant={tab === 'custom' ? 'primary' : 'outline'}
              size="sm"
              icon="practice"
              onClick={() => {
                setTab('custom');
                if (sessionDone || sessionId) {
                  setSessionId(null);
                  setSessionDone(false);
                }
              }}
            >
              Custom Practice
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
              {currentQuestion.section === 'Math' ? (
                <>
                  <Button size="sm" variant="subtle" onClick={() => setShowCalc((v) => !v)}>
                    {showCalc ? 'Hide Calculator' : 'Calculator'}
                  </Button>
                  <PaneSwitch side={split.side} onClick={split.toggleSide} />
                </>
              ) : null}
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

          {showRef ? (
            <ReferenceWindow assessment={assessment} onClose={() => setShowRef(false)} />
          ) : null}

          <SplitWorkbench
            className="practice-workbench"
            maxViewportHeight={720}
            side={split.side}
            ratio={split.ratio}
            minRatio={split.minRatio}
            maxRatio={split.maxRatio}
            onRatioChange={split.setRatio}
            toolVisible={currentQuestion.section === 'Math' && showCalc}
            toolKind="calc"
            tool={<DesmosPane />}
            main={
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
              onNext={() => {
                if (currentIndex + 1 < sessionQuestions.length) {
                  setCurrentIndex((i) => i + 1);
                  questionStartRef.current = Date.now();
                } else {
                  finishCustomSession();
                }
              }}
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
            }
          />
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
                        setSessionId(null);
                        setSessionDone(false);
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
