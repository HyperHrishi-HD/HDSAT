import { useEffect, useMemo, useRef, useState } from 'react';
import { FigureView, StimulusView } from '../components/FigureView';
import { HighlightableStimulus, type HighlightRecord } from '../components/HighlightableStimulus';
import { MathText } from '../components/MathText';
import { DESMOS_CB_GRAPHING_URL, MathReferenceSheet } from '../components/MathTools';
import { QuestionView } from '../components/QuestionView';
import { ReportQuestion } from '../components/ReportQuestion';
import { Alert, Badge, Button, Card, Select, Stat, Toggle } from '../components/ui';
import {
  BLENDED_PSAT,
  SECTION_BREAK_MINUTES,
  assessmentDifficultyPolicy,
  assessmentMatches,
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
import type { TestAttempt, TestModuleResult } from '../lib/types';

/**
 * Full-length simulation tracks. PSAT/NMSQT and PSAT 10 are blended because
 * they share a blueprint and difficulty ceiling; PSAT 8/9 keeps its own track
 * with no trigonometry and no hard items.
 */
const FULL_TEST_TRACKS: { value: string; label: string }[] = [
  { value: 'SAT', label: 'Digital SAT (Full Adaptive — 98 Qs / 134 min)' },
  {
    value: BLENDED_PSAT,
    label: 'PSAT/NMSQT & PSAT 10 (combined — 98 Qs / 134 min)',
  },
  {
    value: 'PSAT 8/9',
    label: 'PSAT 8/9 (Full Adaptive — 98 Qs / 134 min, no trigonometry, no hard items)',
  },
];

interface ActiveStage {
  sectionIndex: number;
  stageNumber: 1 | 2;
  plan: ModulePlan;
}

const RW_DIRECTIONS =
  'The questions in this section address a number of important reading and writing skills. Each question includes one or more passages, which may include a table or graph. Read each passage and question carefully, and then choose the best answer to the question based on the passage(s). All questions in this section are multiple-choice with four answer choices. Each question has a single best answer.';

const MATH_DIRECTIONS =
  'The questions in this section address a number of important math skills. Use of a calculator is permitted for all questions. Unless otherwise indicated: All variables and expressions represent real numbers. Figures provided are drawn to scale. All figures lie in a plane. The domain of a given function f is the set of all real numbers x for which f(x) is a real number.';

function DesmosCollegeBoardWindow({ onClose }: { onClose: () => void }) {
  return (
    <div className="bb-calc-window" data-testid="desmos-cb-window">
      <div className="bb-calc-titlebar">
        <span>Calculator</span>
        <span className="bb-calc-drag-dots">⋮⋮⋮</span>
        <button
          type="button"
          className="bb-calc-close"
          onClick={onClose}
          aria-label="Close calculator"
        >
          ✕
        </button>
      </div>
      <div className="bb-calc-iframe-wrap">
        <iframe
          src={DESMOS_CB_GRAPHING_URL}
          title="Desmos Graphing Calculator — College Board Version"
          className="bb-calc-iframe"
          allow="clipboard-write; fullscreen"
        />
      </div>
    </div>
  );
}

export function FullTestPage() {
  const app = useApp();

  const [assessment, setAssessment] = useState<string>(() =>
    app.settings.assessment === 'PSAT 8/9' ? 'PSAT 8/9' : app.settings.assessment === 'SAT' ? 'SAT' : BLENDED_PSAT
  );
  const [excludeReleased, setExcludeReleased] = useState<boolean>(false);

  const seenQuestionIds = useMemo(() => Object.keys(app.progress), [app.progress]);
  const unseenPool = useMemo(() => {
    const seen = new Set(seenQuestionIds);
    const policy = assessmentDifficultyPolicy(assessment);
    const counts = { rw: 0, math: 0 };
    for (const q of app.questions) {
      if (!assessmentMatches(q, assessment)) continue;
      if (!policy.hardAllowed && q.difficulty === 'Hard') continue;
      if (seen.has(q.id)) continue;
      if (q.section === 'Reading and Writing') counts.rw += 1;
      else counts.math += 1;
    }
    return counts;
  }, [app.questions, assessment, seenQuestionIds]);

  const [testPlan, setTestPlan] = useState<TestPlan | null>(null);
  const [activeStage, setActiveStage] = useState<ActiveStage | null>(null);
  const [inSectionBreak, setInSectionBreak] = useState<boolean>(false);
  const [breakSeconds, setBreakSeconds] = useState<number>(SECTION_BREAK_MINUTES * 60);
  const [pendingNextSectionIdx, setPendingNextSectionIdx] = useState<number | null>(null);

  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [eliminated, setEliminated] = useState<Record<string, string[]>>({});
  const [flagged, setFlagged] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [completedModules, setCompletedModules] = useState<TestModuleResult[]>([]);
  const [finishedAttempt, setFinishedAttempt] = useState<TestAttempt | null>(null);
  const [reviewQuestionId, setReviewQuestionId] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<Record<string, HighlightRecord[]>>({});
  const [exitConfirmOpen, setExitConfirmOpen] = useState<boolean>(false);
  const [exitSaving, setExitSaving] = useState<boolean>(false);

  // Bluebook UI toggles
  const [showDirections, setShowDirections] = useState<boolean>(false);
  const [hideClock, setHideClock] = useState<boolean>(false);
  const [showCalc, setShowCalc] = useState<boolean>(false);
  const [showRef, setShowRef] = useState<boolean>(false);
  const [showNotes, setShowNotes] = useState<boolean>(false);
  const [showReportModal, setShowReportModal] = useState<boolean>(false);
  const [showNavPopover, setShowNavPopover] = useState<boolean>(false);
  const [showReviewScreen, setShowReviewScreen] = useState<boolean>(false);
  const [eliminateMode, setEliminateMode] = useState<boolean>(false);
  const [splitRatio, setSplitRatio] = useState<number>(50);
  const isDraggingSplitRef = useRef<boolean>(false);

  const sessionStartRef = useRef<number>(Date.now());
  const clientSessionIdRef = useRef<string>(newEventId());

  const previewPlan = useMemo(
    () =>
      buildTestPlan(app.questions, {
        assessment,
        excludeReleasedPracticeSet: excludeReleased,
        seed: 'preview',
        seenQuestionIds,
      }),
    [app.questions, assessment, excludeReleased, seenQuestionIds]
  );

  // Module countdown timer
  useEffect(() => {
    if (!activeStage || inSectionBreak) return;
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
  }, [activeStage, inSectionBreak]); // eslint-disable-line react-hooks/exhaustive-deps

  // 10-minute inter-section break countdown timer
  useEffect(() => {
    if (!inSectionBreak) return;
    const timer = window.setInterval(() => {
      setBreakSeconds((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          resumeFromSectionBreak();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [inSectionBreak]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resizable split divider mouse listener
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDraggingSplitRef.current) return;
      const pct = Math.min(72, Math.max(28, (e.clientX / window.innerWidth) * 100));
      setSplitRatio(pct);
    };
    const onUp = () => {
      isDraggingSplitRef.current = false;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startFullSimulation = () => {
    const seed = `sim:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const plan = buildTestPlan(app.questions, {
      assessment,
      excludeReleasedPracticeSet: excludeReleased,
      seed,
      seenQuestionIds,
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
    setNotes({});
    setCurrentIndex(0);
    setShowCalc(false);
    setShowRef(false);
    setShowDirections(false);
    setShowNavPopover(false);
    setShowReviewScreen(false);
    setInSectionBreak(false);
    setActiveStage({
      sectionIndex: 0,
      stageNumber: 1,
      plan: firstMod,
    });
    setRemainingSeconds(firstMod.minutes * 60);
  };

  const resumeFromSectionBreak = () => {
    if (!testPlan || pendingNextSectionIdx === null) {
      setInSectionBreak(false);
      return;
    }
    const nextMod1 = testPlan.sections[pendingNextSectionIdx]?.module1;
    setInSectionBreak(false);
    setPendingNextSectionIdx(null);
    if (!nextMod1) return;
    setCurrentIndex(0);
    setShowReviewScreen(false);
    setShowNavPopover(false);
    setShowDirections(false);
    setActiveStage({
      sectionIndex: pendingNextSectionIdx,
      stageNumber: 1,
      plan: nextMod1,
    });
    setRemainingSeconds(nextMod1.minutes * 60);
  };

  /**
   * Grades one module against the current responses and records every answered
   * item. Shared by module submission and by "Save & exit" so an interrupted
   * test keeps its answers and elapsed time.
   */
  const gradeModule = async (mod: ModulePlan, timedOut: boolean) => {
    const unscoredSet = new Set(mod.unscoredQuestionIds ?? []);
    const moduleResponses: TestModuleResult['responses'] = [];
    let correctCount = 0;
    let operationalCorrect = 0;
    let operationalTotal = 0;

    // Grading happens ONLY here when the module ends — never on Next.
    for (const q of mod.questions) {
      const given = responses[q.id] ?? null;
      const isCorrect = checkAnswer(q, given);
      if (isCorrect) correctCount += 1;
      if (!unscoredSet.has(q.id)) {
        operationalTotal += 1;
        if (isCorrect) operationalCorrect += 1;
      }
      moduleResponses.push({ questionId: q.id, response: given, isCorrect });
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
    return { modResult, correctCount, operationalCorrect, operationalTotal };
  };

  const submitCurrentModule = async (timedOut = false) => {
    if (!activeStage || !testPlan) return;
    const mod = activeStage.plan;
    const { modResult, correctCount, operationalCorrect, operationalTotal } =
      await gradeModule(mod, timedOut);

    const nextCompleted = [...completedModules, modResult];
    setCompletedModules(nextCompleted);
    setShowReviewScreen(false);
    setShowNavPopover(false);

    const currentSectionPlan = testPlan.sections[activeStage.sectionIndex];

    // 1-to-2 Multi-Stage Adaptive Routing from Module 1 -> Module 2 (upper or lower)
    if (activeStage.stageNumber === 1) {
      const routeScore = operationalTotal > 0 ? operationalCorrect : correctCount;
      const routeTotal = operationalTotal > 0 ? operationalTotal : mod.questions.length;
      const route = routeModule(routeScore, routeTotal);
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

    // Between Section 1 (Reading & Writing) and Section 2 (Math): 10-minute break
    const nextSecIdx = activeStage.sectionIndex + 1;
    if (
      nextSecIdx < testPlan.sections.length &&
      testPlan.sections[nextSecIdx].module1.questions.length > 0
    ) {
      setPendingNextSectionIdx(nextSecIdx);
      setBreakSeconds(SECTION_BREAK_MINUTES * 60);
      setInSectionBreak(true);
      return;
    }

    // Entire 98-question simulation completed
    setActiveStage(null);
    setShowCalc(false);
    setShowRef(false);
    const summary = summarizeTest(nextCompleted);
    const totalDuration = Math.max(1, Math.round((Date.now() - sessionStartRef.current) / 1000));
    const attempt: TestAttempt = {
      id: clientSessionIdRef.current,
      assessment,
      status: 'completed',
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

  const exitSimulation = () => {
    setActiveStage(null);
    setInSectionBreak(false);
    setPendingNextSectionIdx(null);
    setShowReviewScreen(false);
    setShowNavPopover(false);
    setShowCalc(false);
    setShowRef(false);
    setExitConfirmOpen(false);
  };

  /**
   * Exit without discarding the run: grade the module in progress, keep every
   * completed module, stamp the elapsed time, and save the attempt locally or
   * to the signed-in account. The score report opens immediately afterwards.
   */
  const saveAndExit = async () => {
    if (!activeStage) {
      exitSimulation();
      return;
    }
    setExitSaving(true);
    try {
      const { modResult } = await gradeModule(activeStage.plan, false);
      const nextCompleted = [...completedModules, modResult];
      const summary = summarizeTest(nextCompleted);
      const totalDuration = Math.max(1, Math.round((Date.now() - sessionStartRef.current) / 1000));
      const attempt: TestAttempt = {
        id: clientSessionIdRef.current,
        assessment,
        status: 'incomplete',
        createdAt: new Date().toISOString(),
        modules: nextCompleted,
        rwEstimate: summary.rwEstimate,
        mathEstimate: summary.mathEstimate,
        totalEstimate: summary.totalEstimate,
        durationSeconds: totalDuration,
      };
      setCompletedModules(nextCompleted);
      setFinishedAttempt(attempt);
      await app.actions.recordTest(attempt, clientSessionIdRef.current);
      exitSimulation();
    } finally {
      setExitSaving(false);
    }
  };

  const openPastAttempt = (attempt: TestAttempt) => {
    const restored: Record<string, string> = {};
    attempt.modules.forEach((module) =>
      module.responses.forEach((response) => {
        if (response.response) restored[response.questionId] = response.response;
      })
    );
    setResponses(restored);
    setFinishedAttempt(attempt);
    setReviewQuestionId(null);
  };

  const currentQuestion = activeStage ? activeStage.plan.questions[currentIndex] ?? null : null;
  const isMathSection = activeStage?.plan.section === 'Math';
  const sectionNumber = activeStage ? activeStage.sectionIndex + 1 : 1;

  // -------------------------------------------------------------------------
  // 10-Minute Break Screen (Full-Screen Bluebook Style)
  // -------------------------------------------------------------------------
  if (inSectionBreak && activeStage) {
    return (
      <div className="bb-fullscreen bb-break-screen">
        <div className="bb-break-card">
          <div className="bb-break-timer-box">
            <div className="bb-break-timer-label">Remaining Break Time</div>
            <div className="bb-break-timer-value">{formatClock(breakSeconds)}</div>
          </div>
          <div className="bb-break-info">
            <h1>Practice Test Break</h1>
            <p>
              You have completed <strong>Section 1: Reading and Writing</strong>. Take a 10-minute
              break before beginning{' '}
              <strong>Section 2: Math (Module 1, 22 questions, 35 minutes)</strong>, or click below
              to start Section 2 right away.
            </p>
            <div className="bb-break-rules">
              <strong>Take a Break: Do Not Close Your Device</strong>
              <ul>
                <li>
                  Section 2: Math consists of two 35-minute adaptive modules (22 questions each).
                </li>
                <li>
                  The built-in College Board Desmos Graphing Calculator and Math Reference Sheet are
                  available for every question.
                </li>
              </ul>
            </div>
            <button
              type="button"
              className="bb-pill-btn bb-pill-btn-primary"
              onClick={resumeFromSectionBreak}
            >
              Resume Testing Now
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Active Full-Screen Bluebook Test Runner
  // -------------------------------------------------------------------------
  if (activeStage && currentQuestion) {
    const qId = currentQuestion.id;
    const givenResp = responses[qId] ?? '';
    const qEliminated = eliminated[qId] ?? [];
    const isFlagged = Boolean(flagged[qId]);
    const showLeftPane = !isMathSection || showCalc;

    return (
      <div className="bb-fullscreen" data-testid="bluebook-runner">
        {/* Top Bluebook Header */}
        <header className="bb-header">
          <div className="bb-header-left">
            <div className="bb-section-title">
              <span className="bb-section-line">
                Section {sectionNumber}: {activeStage.plan.section}
              </span>
              <span className="bb-module-line">
                Module {activeStage.stageNumber}
                {activeStage.stageNumber === 2 ? (
                  <span className="bb-tier-badge">Adaptive {activeStage.plan.tier}</span>
                ) : null}
              </span>
            </div>
            <button
              type="button"
              className="bb-directions-btn"
              onClick={() => setShowDirections((v) => !v)}
              aria-expanded={showDirections}
            >
              <span>Directions</span>
              <span className="bb-caret">{showDirections ? '▴' : '▾'}</span>
            </button>
          </div>

          <div className="bb-header-center">
            {!hideClock ? (
              <div className={`bb-clock${remainingSeconds < 300 ? ' is-low' : ''}`}>
                {formatClock(remainingSeconds)}
              </div>
            ) : (
              <div className="bb-clock-hidden" aria-label="Timer hidden">
                ⏱
              </div>
            )}
            <button
              type="button"
              className="bb-hide-pill"
              onClick={() => setHideClock((v) => !v)}
            >
              {hideClock ? 'Show' : 'Hide'}
            </button>
          </div>

          <div className="bb-header-right">
            <button
              type="button"
              className="bb-tool-btn"
              onClick={() => setShowReportModal((v) => !v)}
            >
              <span className="bb-tool-icon">⚠</span>
              <span className="bb-tool-label">Report</span>
            </button>

            {isMathSection ? (
              <>
                <button
                  type="button"
                  className={`bb-tool-btn${showCalc ? ' is-active' : ''}`}
                  onClick={() => setShowCalc((v) => !v)}
                >
                  <span className="bb-tool-icon">🖩</span>
                  <span className="bb-tool-label">Calculator</span>
                </button>
                <button
                  type="button"
                  className={`bb-tool-btn${showRef ? ' is-active' : ''}`}
                  onClick={() => setShowRef((v) => !v)}
                >
                  <span className="bb-tool-icon">𝑥²</span>
                  <span className="bb-tool-label">Reference</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                className={`bb-tool-btn${showNotes ? ' is-active' : ''}`}
                onClick={() => setShowNotes((v) => !v)}
              >
                <span className="bb-tool-icon">✎</span>
                <span className="bb-tool-label">Notes</span>
              </button>
            )}              <button
                type="button"
                className="bb-tool-btn"
                onClick={() => setExitConfirmOpen(true)}
                title="Save and exit practice test"
              >
              <span className="bb-tool-icon">↪</span>
              <span className="bb-tool-label">Exit</span>
            </button>
          </div>
        </header>

        {/* Top rule: a quiet grey line instead of the segmented practice banner */}
        <div className="bb-frame-rule" />

        {/* Directions dropdown popover */}
        {showDirections ? (
          <div className="bb-directions-popover" role="dialog" aria-label="Section directions">
            <div className="bb-directions-body">
              <p>{isMathSection ? MATH_DIRECTIONS : RW_DIRECTIONS}</p>
            </div>
            <div className="bb-directions-foot">
              <button
                type="button"
                className="bb-pill-btn bb-pill-btn-gold"
                onClick={() => setShowDirections(false)}
              >
                Close
              </button>
            </div>
          </div>
        ) : null}

        {/* Reference sheet floating window */}
        {showRef ? (
          <div className="bb-floating-modal">
            <div className="bb-floating-head">
              <strong>Reference Sheet</strong>
              <button type="button" onClick={() => setShowRef(false)}>
                ✕
              </button>
            </div>
            <div className="bb-floating-body">
              <MathReferenceSheet />
            </div>
          </div>
        ) : null}

        {/* Report question floating window */}
        {showReportModal ? (
          <div className="bb-floating-modal">
            <div className="bb-floating-head">
              <strong>Report Question · {currentQuestion.id}</strong>
              <button type="button" onClick={() => setShowReportModal(false)}>
                ✕
              </button>
            </div>
            <div className="bb-floating-body">
              <ReportQuestion questionId={currentQuestion.id} />
            </div>
          </div>
        ) : null}

        {/* End-of-module Check Your Work screen OR Active Question Workspace */}
        {showReviewScreen ? (
          <main className="bb-review-page">
            <div className="bb-review-card">
              <h1>Check Your Work</h1>
              <p>
                On test day, you won&apos;t be able to move on to the next module until time expires.
                For this practice test, you can click <strong>Next</strong> when you&apos;re ready
                to submit this module and move on.
              </p>
              <div className="bb-review-head">
                <strong>
                  Section {sectionNumber}: {activeStage.plan.section}, Module{' '}
                  {activeStage.stageNumber}
                </strong>
                <div className="bb-review-legend">
                  <span>▢ Unanswered</span>
                  <span>■ Answered</span>
                  <span style={{ color: '#b3261e' }}>⚑ For Review</span>
                </div>
              </div>
              <div className="bb-review-grid">
                {activeStage.plan.questions.map((q, idx) => {
                  const answered = Boolean(responses[q.id] && responses[q.id].trim() !== '');
                  const rev = Boolean(flagged[q.id]);
                  return (
                    <button
                      key={q.id}
                      type="button"
                      className={`bb-nav-cell${answered ? ' is-answered' : ''}${
                        rev ? ' is-flagged' : ''
                      }`}
                      onClick={() => {
                        setCurrentIndex(idx);
                        setShowReviewScreen(false);
                      }}
                    >
                      {rev ? <span className="bb-cell-flag">⚑</span> : null}
                      {idx + 1}
                    </button>
                  );
                })}
              </div>
            </div>
          </main>
        ) : (
          <main className={`bb-workspace${showLeftPane ? ' is-split' : ' is-single'}`}>
            {/* Left Pane: Reading Passage + Figure/Chart OR College Board Desmos Graphing Calculator */}
            {showLeftPane ? (
              <>
                <section
                  className={`bb-pane bb-pane-left${isMathSection && showCalc ? ' is-calc-pane' : ''}`}
                  style={{ width: `${splitRatio}%` }}
                >
                  {isMathSection && showCalc ? (
                    <DesmosCollegeBoardWindow onClose={() => setShowCalc(false)} />
                  ) : (
                    <div className="bb-stimulus-pane">
                      <HighlightableStimulus
                        questionKey={qId}
                        records={highlights[qId] ?? []}
                        onChange={(next) =>
                          setHighlights((prev) => ({ ...prev, [qId]: next }))
                        }
                      >
                        <FigureView question={currentQuestion} />
                        {currentQuestion.stimulus ? (
                          <div className="bb-stimulus-text">
                            <StimulusView stimulus={currentQuestion.stimulus} />
                          </div>
                        ) : null}
                      </HighlightableStimulus>

                      {showNotes ? (
                        <div className="bb-notes-box">
                          <label className="field-label">
                            Scratch Notes for Question {currentIndex + 1}
                          </label>
                          <textarea
                            rows={3}
                            value={notes[qId] ?? ''}
                            onChange={(e) =>
                              setNotes((prev) => ({ ...prev, [qId]: e.target.value }))
                            }
                            placeholder="Add your highlight notes or outline thoughts here..."
                          />
                        </div>
                      ) : null}
                    </div>
                  )}
                </section>

                {/* Vertical Resizable Divider with handle */}
                <div
                  className="bb-divider"
                  onMouseDown={() => {
                    isDraggingSplitRef.current = true;
                  }}
                  role="separator"
                  aria-orientation="vertical"
                  title="Drag to resize panes"
                >
                  <span className="bb-divider-handle">◂▸</span>
                </div>
              </>
            ) : null}

            {/* Right Pane (or centered column on Math when calculator is closed): Question Stem + Options / SPR */}
            <section
              className="bb-pane bb-pane-right"
              style={showLeftPane ? { width: `${100 - splitRatio}%` } : undefined}
            >
              <div className="bb-question-column">
                {/* Question Banner Bar */}
                <div className="bb-q-banner">
                  <div className="bb-q-banner-top">
                    <div className="bb-q-banner-left">
                      <span className="bb-q-number">{currentIndex + 1}</span>
                      <button
                        type="button"
                        className={`bb-mark-review${isFlagged ? ' is-flagged' : ''}`}
                        onClick={() =>
                          setFlagged((prev) => ({
                            ...prev,
                            [qId]: !prev[qId],
                          }))
                        }
                        aria-pressed={isFlagged}
                      >
                        <span className="bb-bookmark-icon">{isFlagged ? '⚑' : '⚐'}</span>
                        <span>Mark for Review</span>
                      </button>
                    </div>

                    <div className="bb-q-banner-right">
                      {currentQuestion.format === 'multiple_choice' ? (
                        <button
                          type="button"
                          className={`bb-abc-btn${eliminateMode ? ' is-active' : ''}`}
                          onClick={() => setEliminateMode((v) => !v)}
                          title="Toggle answer choice eliminator"
                          aria-pressed={eliminateMode}
                        >
                          <s>ABC</s>
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="bb-frame-rule is-dashed" />
                </div>

                {/* For Math questions, render any figure/table/chart and stimulus above the prompt */}
                {isMathSection ? (
                  <div className="bb-math-stimulus">
                    <FigureView question={currentQuestion} />
                    {currentQuestion.stimulus ? (
                      <StimulusView stimulus={currentQuestion.stimulus} />
                    ) : null}
                  </div>
                ) : null}

                {/* Prompt */}
                <div className="bb-prompt-text">
                  <MathText text={currentQuestion.prompt} />
                </div>

                {/* Answer Area: Multiple Choice OR Student-Produced Response (SPR) */}
                {currentQuestion.format === 'multiple_choice' && currentQuestion.choices ? (
                  <ul className="bb-choices">
                    {currentQuestion.choices.map((choice) => {
                      const isSelected = givenResp === choice.id;
                      const isElim = qEliminated.includes(choice.id);
                      return (
                        <li
                          key={choice.id}
                          className={`bb-choice-row${isElim ? ' is-eliminated' : ''}`}
                        >
                          <button
                            type="button"
                            className={`bb-choice-box${isSelected ? ' is-selected' : ''}`}
                            onClick={() => {
                              if (isElim) return;
                              setResponses((prev) => ({
                                ...prev,
                                [qId]: choice.id,
                              }));
                            }}
                            aria-pressed={isSelected}
                          >
                            <span
                              className={`bb-choice-letter${isSelected ? ' is-selected' : ''}`}
                            >
                              {choice.id}
                            </span>
                            <span className="bb-choice-text">
                              <MathText text={choice.text} />
                            </span>
                          </button>

                          {eliminateMode ? (
                            <button
                              type="button"
                              className="bb-choice-strike-btn"
                              onClick={() =>
                                setEliminated((prev) => {
                                  const list = prev[qId] ?? [];
                                  const next = list.includes(choice.id)
                                    ? list.filter((c) => c !== choice.id)
                                    : [...list, choice.id];
                                  return { ...prev, [qId]: next };
                                })
                              }
                              title={isElim ? 'Undo strikeout' : `Cross out choice ${choice.id}`}
                            >
                              {isElim ? 'Undo' : <s>{choice.id}</s>}
                            </button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="bb-spr-area">
                    <div className="bb-spr-input-shell">
                      <input
                        type="text"
                        inputMode="text"
                        value={givenResp}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === '' || /^-?[0-9./\s]*$/.test(v)) {
                            setResponses((prev) => ({
                              ...prev,
                              [qId]: v,
                            }));
                          }
                        }}
                        aria-label="Student-produced response"
                        maxLength={6}
                      />
                    </div>
                    <div className="bb-spr-preview">
                      <strong>Answer Preview:</strong>{' '}
                      {givenResp.trim() ? (
                        <span className="bb-spr-preview-val">{givenResp.trim()}</span>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            </section>
          </main>
        )}

        {/* Question Navigator Popover above footer */}
        {showNavPopover ? (
          <div className="bb-nav-popover" role="dialog" aria-label="Question navigator">
            <div className="bb-nav-popover-head">
              <strong>
                Section {sectionNumber}: {activeStage.plan.section}, Module{' '}
                {activeStage.stageNumber} Questions
              </strong>
              <button
                type="button"
                className="bb-nav-popover-close"
                onClick={() => setShowNavPopover(false)}
              >
                ✕
              </button>
            </div>
            <div className="bb-nav-popover-legend">
              <span>📍 Current</span>
              <span>▢ Unanswered</span>
              <span style={{ color: '#b3261e' }}>⚑ For Review</span>
            </div>
            <div className="bb-nav-popover-grid">
              {activeStage.plan.questions.map((q, idx) => {
                const answered = Boolean(responses[q.id] && responses[q.id].trim() !== '');
                const rev = Boolean(flagged[q.id]);
                const isCurr = !showReviewScreen && idx === currentIndex;
                return (
                  <button
                    key={q.id}
                    type="button"
                    className={`bb-nav-cell${answered ? ' is-answered' : ''}${
                      rev ? ' is-flagged' : ''
                    }${isCurr ? ' is-current' : ''}`}
                    onClick={() => {
                      setCurrentIndex(idx);
                      setShowReviewScreen(false);
                      setShowNavPopover(false);
                    }}
                  >
                    {rev ? <span className="bb-cell-flag">⚑</span> : null}
                    {idx + 1}
                  </button>
                );
              })}
            </div>
            <div className="bb-nav-popover-foot">
              <button
                type="button"
                className="bb-pill-btn bb-pill-btn-outline"
                onClick={() => {
                  setShowReviewScreen(true);
                  setShowNavPopover(false);
                }}
              >
                Go to Review Page
              </button>
            </div>
          </div>
        ) : null}

        {/* Bottom rule: matching quiet grey line */}
        <div className="bb-frame-rule" />

        {/* Bottom Bluebook Footer */}
        <footer className="bb-footer">
          <div className="bb-footer-left">
            <strong>HDSAT</strong>
          </div>

          <div className="bb-footer-center">
            <button
              type="button"
              className="bb-question-pill"
              onClick={() => setShowNavPopover((v) => !v)}
              aria-expanded={showNavPopover}
            >
              <span>
                {showReviewScreen
                  ? 'Check Your Work'
                  : `Question ${currentIndex + 1} of ${activeStage.plan.questions.length}`}
              </span>
              <span>▴</span>
            </button>
          </div>

          <div className="bb-footer-right">
            <button
              type="button"
              className="bb-pill-btn bb-pill-btn-primary"
              disabled={!showReviewScreen && currentIndex === 0}
              onClick={() => {
                if (showReviewScreen) {
                  setShowReviewScreen(false);
                  setCurrentIndex(activeStage.plan.questions.length - 1);
                } else {
                  setCurrentIndex((i) => Math.max(0, i - 1));
                }
              }}
            >
              Back
            </button>

            {showReviewScreen ? (
              <button
                type="button"
                className="bb-pill-btn bb-pill-btn-primary"
                onClick={() => submitCurrentModule(false)}
              >
                Next
              </button>
            ) : currentIndex + 1 < activeStage.plan.questions.length ? (
              <button
                type="button"
                className="bb-pill-btn bb-pill-btn-primary"
                onClick={() => setCurrentIndex((i) => i + 1)}
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                className="bb-pill-btn bb-pill-btn-primary"
                onClick={() => setShowReviewScreen(true)}
              >
                Next
              </button>
            )}
          </div>
        </footer>

        {exitConfirmOpen ? (
          <div
            className="bb-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bb-exit-title"
          >
            <div className="bb-modal">
              <h2 id="bb-exit-title">Save this test and exit?</h2>
              <p>
                Your answers from this module and every module you already submitted are saved with
                the elapsed time. Open it again any time under <strong>Past simulations</strong> on
                the Full test page.
              </p>
              <p className="bb-modal-meta">
                <span>
                  <strong>{formatClock(remainingSeconds)}</strong> left in this module
                </span>{' '}
                <span>
                  <strong>{Object.values(responses).filter((v) => v.trim() !== '').length}</strong>{' '}
                  answered
                </span>{' '}
                <span>
                  {app.mode === 'cloud' ? 'Saving to your account' : 'Saving in this browser'}
                </span>
              </p>
              <div className="bb-modal-actions">
                <button
                  type="button"
                  className="bb-pill-btn bb-pill-btn-outline"
                  onClick={() => setExitConfirmOpen(false)}
                  disabled={exitSaving}
                >
                  Keep testing
                </button>
                <button
                  type="button"
                  className="bb-pill-btn bb-pill-btn-primary"
                  onClick={saveAndExit}
                  disabled={exitSaving}
                >
                  {exitSaving ? 'Saving…' : 'Save & exit'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Pre-Test Setup Card & Post-Test Score Report (inside normal app shell)
  // -------------------------------------------------------------------------
  return (
    <div>
      {!finishedAttempt ? (
        <Card>
          <h1>Full-Length Bluebook Adaptive Practice Test</h1>
          <p>
            Simulates the official full-length Digital {assessment} structure in a full-screen
            Bluebook interface: <strong>98 total questions</strong> across{' '}
            <strong>134 minutes</strong> (plus a 10-minute inter-section break). Responses are
            never graded on Next—each module is scored only when you submit it.
          </p>

          <div className="card-grid" style={{ marginTop: 14 }}>
            <Select
              label="Assessment"
              value={assessment}
              onChange={setAssessment}
              options={FULL_TEST_TRACKS}
            />
          </div>

          <Toggle
            checked={excludeReleased}
            onChange={setExcludeReleased}
            label="Exclude Benchmark Simulation Set items"
            hint="Optional: reserve the HDSAT Benchmark Form A items for a dedicated benchmark sitting. Leave unchecked to let them appear in this simulation."
          />

          <p className="muted" style={{ marginTop: 8 }}>
            <strong>Fresh-item mode:</strong> every full test draws only questions you have not
            attempted yet — {unseenPool.rw} unseen Reading &amp; Writing items and {unseenPool.math}{' '}
            unseen Math items are available for this assessment. Previously attempted items can only
            return if the unseen supply runs out, and the notice below will say so.
          </p>

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
            <div className="muted-block">
              <strong>Section 1: Reading and Writing (54 items · 64 minutes)</strong>
              <div className="muted" style={{ marginTop: 4 }}>
                • Module 1 (Routing): 27 questions · 32 minutes (30% Easy / 40% Medium / 30% Hard)
              </div>
              <div className="muted">
                • Module 2 (Adaptive Upper or Lower): 27 questions · 32 minutes
              </div>
              <div className="muted" style={{ marginTop: 4 }}>
                Domain order: Craft &amp; Structure → Information &amp; Ideas → Standard English
                Conventions → Expression of Ideas. The four bands follow that order but overlap by up
                to three items (for example, Information &amp; Ideas can start near item 5 and finish
                near item 16) so no two runs share a rigid layout.
              </div>
            </div>
            <div className="muted-block">
              <strong>Section 2: Math (44 items · 70 minutes)</strong>
              <div className="muted" style={{ marginTop: 4 }}>
                • Module 1 (Routing): 22 questions · 35 minutes (~75% MC / ~25% SPR intermixed)
              </div>
              <div className="muted">
                • Module 2 (Adaptive Upper or Lower): 22 questions · 35 minutes
              </div>
              <div className="muted" style={{ marginTop: 4 }}>
                Continuous linear difficulty progression (1 → 22) across Algebra (~35%), Advanced
                Math (~35%), Problem-Solving &amp; Data Analysis (~15%), and Geometry &amp; Trig
                (~15%).
              </div>
            </div>
          </div>

          <div className="row-between" style={{ marginTop: 16 }}>
            <span className="muted">
              92 operational scored items + 6 embedded unscored experimental items · 10-minute
              break between sections.
            </span>
            <Button onClick={startFullSimulation}>Launch Full-Screen Bluebook Test</Button>
          </div>

          {app.testAttempts.length > 0 ? (
            <div style={{ marginTop: 20 }}>
              <div className="row-between">
                <h3 style={{ margin: 0 }}>Past simulations</h3>
                <span className="muted">
                  {app.testAttempts.length} saved{' '}
                  {app.mode === 'cloud' ? 'to your account' : 'in this browser'} · no cap
                </span>
              </div>
              <table style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Track</th>
                    <th>R&amp;W</th>
                    <th>Math</th>
                    <th>Total</th>
                    <th>Time</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {app.testAttempts
                    .slice()
                    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                    .map((attempt) => (
                      <tr key={attempt.id}>
                        <td>
                          {new Date(attempt.createdAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </td>
                        <td>{attempt.assessment}</td>
                        <td>{attempt.rwEstimate ?? '—'}</td>
                        <td>{attempt.mathEstimate ?? '—'}</td>
                        <td>{attempt.totalEstimate ?? '—'}</td>
                        <td>{formatClock(attempt.durationSeconds)}</td>
                        <td>
                          <Badge tone={attempt.status === 'incomplete' ? 'warn' : 'good'}>
                            {attempt.status === 'incomplete' ? 'Saved on exit' : 'Completed'}
                          </Badge>
                        </td>
                        <td>
                          <Button size="sm" variant="outline" onClick={() => openPastAttempt(attempt)}>
                            Open
                          </Button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>
      ) : null}

      {finishedAttempt ? (
        <div>
          <Card>
            <div className="row-between">
              <div>
                <h1>Adaptive Simulation Report ({finishedAttempt.assessment})</h1>
                {finishedAttempt.status === 'incomplete' ? (
                  <Badge tone="warn">Incomplete · saved when you exited</Badge>
                ) : null}
                <p className="muted">
                  Estimated practice score range based on raw module accuracy and adaptive Stage-2
                  tier routing. Not an official College Board scaled score.
                </p>
              </div>
              <div className="row">
                <Button variant="outline" onClick={() => setFinishedAttempt(null)}>
                  Past simulations
                </Button>
                <Button
                  onClick={() => {
                    setFinishedAttempt(null);
                    startFullSimulation();
                  }}
                >
                  Start New Simulation
                </Button>
              </div>
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
              <Stat label="Math (200–800)" value={finishedAttempt.mathEstimate ?? '—'} />
              <Stat label="Total Time" value={formatClock(finishedAttempt.durationSeconds)} />
            </div>

            <h3 style={{ marginTop: 16 }}>Module Routing &amp; Breakdown</h3>
            <div className="grid-2" style={{ marginTop: 8 }}>
              {finishedAttempt.modules.map((m) => (
                <div key={m.moduleId} className="muted-block">
                  <div className="row-between">
                    <strong>{m.section}</strong>
                    <Badge
                      tone={m.tier === 'upper' ? 'good' : m.tier === 'lower' ? 'warn' : 'info'}
                    >
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
