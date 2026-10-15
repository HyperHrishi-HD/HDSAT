import { useEffect, useMemo, useRef, useState } from 'react';
import { CalculatorPanel, MathReferenceSheet } from '../components/MathTools';
import { QuestionView } from '../components/QuestionView';
import { Alert, Badge, Button, Card, Select, Stat, Toggle } from '../components/ui';
import {
  buildTestPlan,
  formatClock,
  routeModule,
  summarizeTest,
  type ModulePlan,
  type TestPlan,
} from '../lib/examEngine';
import { checkAnswer } from '../lib/grading';
import { newEventId } from '../lib/storage';
import { useApp } from '../lib/store';
import type { Assessment, TestAttempt, TestModuleResult } from '../lib/types';

interface ActiveStage {
  sectionIndex: number;
  stageNumber: 1 | 2;
  plan: ModulePlan;
}

export function FullTestPage() {
  const app = useApp();

  const [assessment, setAssessment] = useState<Assessment>(app.settings.assessment);
  const [excludeReleased, setExcludeReleased] = useState<boolean>(false);
  const [itemCap, setItemCap] = useState<number>(8);

  const [testPlan, setTestPlan] = useState<TestPlan | null>(null);
  const [activeStage, setActiveStage] = useState<ActiveStage | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [eliminated, setEliminated] = useState<Record<string, string[]>>({});
  const [flagged, setFlagged] = useState<Record<string, boolean>>({});
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [completedModules, setCompletedModules] = useState<TestModuleResult[]>([]);
  const [finishedAttempt, setFinishedAttempt] = useState<TestAttempt | null>(null);
  const [reviewQuestionId, setReviewQuestionId] = useState<string | null>(null);
  const [showCalc, setShowCalc] = useState<boolean>(false);
  const [showRef, setShowRef] = useState<boolean>(false);
  const [hideClock, setHideClock] = useState<boolean>(false);

  const sessionStartRef = useRef<number>(Date.now());
  const clientSessionIdRef = useRef<string>(newEventId());

  const previewPlan = useMemo(
    () =>
      buildTestPlan(app.questions, {
        assessment,
        excludeReleasedPracticeSet: excludeReleased,
        itemCap,
        seed: 'preview',
      }),
    [app.questions, assessment, excludeReleased, itemCap]
  );

  useEffect(() => {
    if (!activeStage) return;
    const timer = window.setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          submitCurrentModule(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeStage]); // eslint-disable-line react-hooks/exhaustive-deps

  const startFullSimulation = () => {
    const seed = `sim:${Date.now()}`;
    const plan = buildTestPlan(app.questions, {
      assessment,
      excludeReleasedPracticeSet: excludeReleased,
      itemCap,
      seed,
    });
    const firstMod = plan.sections[0]?.module1;
    if (!firstMod || firstMod.questions.length === 0) return;

    clientSessionIdRef.current = newEventId();
    sessionStartRef.current = Date.now();
    setTestPlan(plan);
    setCompletedModules([]);
    setFinishedAttempt(null);
    setReviewQuestionId(null);
    setResponses({});
    setEliminated({});
    setFlagged({});
    setCurrentIndex(0);
    setActiveStage({
      sectionIndex: 0,
      stageNumber: 1,
      plan: firstMod,
    });
    setRemainingSeconds(firstMod.minutes * 60);
  };

  const submitCurrentModule = async (timedOut = false) => {
    if (!activeStage || !testPlan) return;
    const mod = activeStage.plan;

    const moduleResponses: { questionId: string; response: string | null; isCorrect: boolean }[] = [];
    let correctCount = 0;

    for (const q of mod.questions) {
      const given = responses[q.id] ?? null;
      const isCorrect = checkAnswer(q, given);
      if (isCorrect) correctCount += 1;
      moduleResponses.push({
        questionId: q.id,
        response: given,
        isCorrect,
      });
      if (given !== null && given.trim() !== '') {
        await app.actions.submitAttempt(q, given, {
          mode: 'test',
          timeSpentSeconds: 20,
          sessionId: clientSessionIdRef.current,
        });
      }
    }

    const modResult: TestModuleResult = {
      moduleId: mod.id,
      section: mod.section,
      tier: mod.tier,
      correct: correctCount,
      total: mod.questions.length,
      timedOut,
      responses: moduleResponses,
    };

    const nextCompleted = [...completedModules, modResult];
    setCompletedModules(nextCompleted);

    const currentSectionPlan = testPlan.sections[activeStage.sectionIndex];

    // Route from Module 1 -> Module 2 (upper or lower)
    if (activeStage.stageNumber === 1) {
      const route = routeModule(correctCount, mod.questions.length);
      const routedMod = route === 'upper' ? currentSectionPlan.upper : currentSectionPlan.lower;
      if (routedMod.questions.length > 0) {
        setCurrentIndex(0);
        setActiveStage({
          sectionIndex: activeStage.sectionIndex,
          stageNumber: 2,
          plan: routedMod,
        });
        setRemainingSeconds(routedMod.minutes * 60);
        return;
      }
    }

    // Advance to next section's Module 1 if available
    const nextSecIdx = activeStage.sectionIndex + 1;
    if (nextSecIdx < testPlan.sections.length && testPlan.sections[nextSecIdx].module1.questions.length > 0) {
      const nextMod1 = testPlan.sections[nextSecIdx].module1;
      setCurrentIndex(0);
      setActiveStage({
        sectionIndex: nextSecIdx,
        stageNumber: 1,
        plan: nextMod1,
      });
      setRemainingSeconds(nextMod1.minutes * 60);
      return;
    }

    // Entire simulation completed
    setActiveStage(null);
    const summary = summarizeTest(nextCompleted);
    const totalDuration = Math.max(1, Math.round((Date.now() - sessionStartRef.current) / 1000));
    const attempt: TestAttempt = {
      id: clientSessionIdRef.current,
      assessment,
      createdAt: new Date().toISOString(),
      modules: nextCompleted,
      rwEstimate: summary.rwEstimate,
      mathEstimate: summary.mathEstimate,
      totalEstimate: summary.totalEstimate,
      durationSeconds: totalDuration,
    };
    setFinishedAttempt(attempt);
    await app.actions.recordTest(attempt, clientSessionIdRef.current);

    const totalAnswered = nextCompleted.reduce((acc, m) => acc + m.total, 0);
    const totalCorrect = nextCompleted.reduce((acc, m) => acc + m.correct, 0);
    if (totalAnswered >= 3) {
      await app.actions.completeSession({
        activityType: 'full_simulation',
        sessionId: clientSessionIdRef.current,
        questions: totalAnswered,
        correct: totalCorrect,
        timeSpentSeconds: totalDuration,
      });
    }
  };

  const currentQuestion = activeStage ? activeStage.plan.questions[currentIndex] ?? null : null;

  return (
    <div>
      {!activeStage && !finishedAttempt ? (
        <Card>
          <h1>Multistage Adaptive Practice Test</h1>
          <p>
            Simulates the two-stage Digital {assessment} structure: Reading and Writing (Module 1 → adaptively routed
            Module 2) followed by Math (Module 1 → adaptively routed Module 2).
          </p>

          <div className="card-grid" style={{ marginTop: 14 }}>
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
              label="Target Items per Module"
              value={String(itemCap)}
              onChange={(v) => setItemCap(Number(v))}
              options={[
                { value: '6', label: '6 items per module (Compact Adaptive)' },
                { value: '8', label: '8 items per module (Balanced Adaptive)' },
                { value: '27', label: 'Full Blueprint Target (scales to available bank)' },
              ]}
            />
          </div>

          <Toggle
            checked={excludeReleased}
            onChange={setExcludeReleased}
            label="Exclude Benchmark Simulation Set items"
            hint="Leave unchecked to include HDSAT Benchmark Form A items in this full simulation."
          />

          {previewPlan.warnings.length > 0 ? (
            <div style={{ margin: '12px 0' }}>
              <Alert tone="info">
                <div>
                  <strong>Dataset Coverage &amp; Scaling Notice:</strong>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {previewPlan.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              </Alert>
            </div>
          ) : null}

          <div className="grid-2" style={{ marginTop: 12 }}>
            {previewPlan.sections.map((sec) => (
              <div key={sec.section} className="muted-block">
                <strong>{sec.section}</strong>
                <div className="muted" style={{ marginTop: 4 }}>
                  Module 1 (Baseline): {sec.module1.questions.length} items · {sec.module1.minutes} min
                </div>
                <div className="muted">
                  Module 2 (Adaptive Upper / Lower): {sec.upper.questions.length} / {sec.lower.questions.length} items ·{' '}
                  {sec.upper.minutes} min
                </div>
              </div>
            ))}
          </div>

          <div className="row-between" style={{ marginTop: 16 }}>
            <span className="muted">
              Routing threshold: ≥60% accuracy in Module 1 routes to the Higher-Difficulty Module 2.
            </span>
            <Button onClick={startFullSimulation}>Begin Adaptive Simulation</Button>
          </div>
        </Card>
      ) : null}

      {activeStage && currentQuestion ? (
        <div>
          <div className="test-bar">
            <div>
              <strong>
                {activeStage.plan.section} ·{' '}
                {activeStage.stageNumber === 1
                  ? 'Module 1 (Routing Baseline)'
                  : `Module 2 (${activeStage.plan.tier === 'upper' ? 'Higher-Difficulty Tier' : 'Lower-Difficulty Tier'})`}
              </strong>
              <div className="muted">
                Question {currentIndex + 1} of {activeStage.plan.questions.length}
              </div>
            </div>

            <div className="row">
              {!hideClock ? (
                <span className={`timer${remainingSeconds < 120 ? ' is-low' : ''}`}>
                  {formatClock(remainingSeconds)}
                </span>
              ) : (
                <span className="muted">Timer hidden</span>
              )}
              <Button size="sm" variant="subtle" onClick={() => setHideClock((v) => !v)}>
                {hideClock ? 'Show clock' : 'Hide clock'}
              </Button>
              <Button size="sm" variant="subtle" onClick={() => setShowCalc((v) => !v)}>
                {showCalc ? 'Hide Calculator' : 'Calculator'}
              </Button>
              <Button size="sm" variant="subtle" onClick={() => setShowRef((v) => !v)}>
                {showRef ? 'Hide Reference' : 'Reference'}
              </Button>
              <Button size="sm" variant="primary" onClick={() => submitCurrentModule(false)}>
                Submit Module
              </Button>
            </div>
          </div>

          {showCalc ? <CalculatorPanel /> : null}
          {showRef ? <MathReferenceSheet /> : null}

          <Card>
            <div className="navigator" style={{ marginBottom: 14 }}>
              {activeStage.plan.questions.map((q, idx) => (
                <button
                  key={q.id}
                  type="button"
                  className={`nav-dot${responses[q.id] ? ' is-answered' : ''}${idx === currentIndex ? ' is-current' : ''}${
                    flagged[q.id] ? ' is-flagged' : ''
                  }`}
                  onClick={() => setCurrentIndex(idx)}
                >
                  {idx + 1}
                </button>
              ))}
            </div>

            <QuestionView
              question={currentQuestion}
              index={currentIndex}
              total={activeStage.plan.questions.length}
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
                setFlagged((prev) => ({
                  ...prev,
                  [currentQuestion.id]: !prev[currentQuestion.id],
                }))
              }
              showMeta={false}
            />

            <div className="row-between" style={{ marginTop: 14 }}>
              <Button
                variant="outline"
                disabled={currentIndex === 0}
                onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
              >
                Previous
              </Button>
              {currentIndex + 1 < activeStage.plan.questions.length ? (
                <Button variant="primary" onClick={() => setCurrentIndex((i) => i + 1)}>
                  Next
                </Button>
              ) : (
                <Button variant="primary" onClick={() => submitCurrentModule(false)}>
                  Finish &amp; Submit Module
                </Button>
              )}
            </div>
          </Card>
        </div>
      ) : null}

      {finishedAttempt ? (
        <div>
          <Card>
            <div className="row-between">
              <div>
                <h1>Adaptive Simulation Report ({finishedAttempt.assessment})</h1>
                <p className="muted">
                   Estimated practice score range based on raw module accuracy and adaptive Stage-2 tier routing. Not an
                  official College Board scaled score.
                </p>
              </div>
              <Button onClick={() => setFinishedAttempt(null)}>Start New Simulation</Button>
            </div>

            <div className="card-grid" style={{ marginTop: 12 }}>
              <Stat
                label="Estimated Total (400–1600)"
                value={finishedAttempt.totalEstimate ?? '—'}
                hint="Practice estimate"
              />
              <Stat
                label="Reading & Writing (200–800)"
                value={finishedAttempt.rwEstimate ?? '—'}
              />
              <Stat
                label="Math (200–800)"
                value={finishedAttempt.mathEstimate ?? '—'}
              />
              <Stat
                label="Total Time"
                value={formatClock(finishedAttempt.durationSeconds)}
              />
            </div>

            <h3 style={{ marginTop: 16 }}>Module Routing &amp; Breakdown</h3>
            <div className="grid-2" style={{ marginTop: 8 }}>
              {finishedAttempt.modules.map((m) => (
                <div key={m.moduleId} className="muted-block">
                  <div className="row-between">
                    <strong>{m.section}</strong>
                    <Badge tone={m.tier === 'upper' ? 'good' : m.tier === 'lower' ? 'warn' : 'info'}>
                      {m.tier === 'module1'
                        ? 'Module 1 (Baseline)'
                        : m.tier === 'upper'
                        ? 'Module 2 (Routed Upper)'
                        : 'Module 2 (Routed Lower)'}
                    </Badge>
                  </div>
                  <p style={{ marginTop: 6 }}>
                    Score: <strong>{m.correct}</strong> / {m.total} (
                    {m.total > 0 ? Math.round((m.correct / m.total) * 100) : 0}%)
                  </p>
                  <div className="row" style={{ marginTop: 8 }}>
                    {m.responses.map((r, idx) => (
                      <button
                        key={r.questionId}
                        type="button"
                        className={`nav-dot ${r.isCorrect ? 'is-answered' : 'is-flagged'}`}
                        onClick={() => setReviewQuestionId(r.questionId)}
                        title={`Review ${r.questionId}`}
                      >
                        {idx + 1}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {reviewQuestionId ? (
            (() => {
              const q = app.questions.find((item) => item.id === reviewQuestionId);
              if (!q) return null;
              const given = responses[q.id] ?? null;
              const isCorrect = checkAnswer(q, given);
              return (
                <Card>
                  <div className="row-between" style={{ marginBottom: 10 }}>
                    <h3>Item Review · {q.id}</h3>
                    <Button size="sm" variant="outline" onClick={() => setReviewQuestionId(null)}>
                      Close review
                    </Button>
                  </div>
                  <QuestionView
                    question={q}
                    index={0}
                    total={1}
                    response={given}
                    onResponseChange={() => {}}
                    disabled
                    feedback={{
                      isCorrect,
                      correctAnswer: q.correct_answer,
                      explanation: q.explanation,
                      distractorRationales: q.distractor_rationales,
                    }}
                  />
                </Card>
              );
            })()
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
