import { useEffect, useMemo, useRef, useState } from 'react';
import { FigureView, StimulusView } from '../components/FigureView';
import { HighlightableStimulus, type HighlightRecord } from '../components/HighlightableStimulus';
import { MathText } from '../components/MathText';
import { DESMOS_CB_GRAPHING_URL, MathReferenceSheet } from '../components/MathTools';
import { QuestionView } from '../components/QuestionView';
import { ReportQuestion } from '../components/ReportQuestion';
import { Alert, Badge, Button, Card, InfoTip, Select, Stat, Toggle } from '../components/ui';
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
const FULL_TEST_TRACKS: { value: string; label: string; hint?: string }[] = [
  { value: 'SAT', label: 'Digital SAT', hint: 'Full Adaptive — 98 Qs / 134 min' },
  {
    value: BLENDED_PSAT,
    label: 'PSAT/NMSQT & PSAT 10',
    hint: 'Combined — 98 Qs / 134 min',
  },
  {
    value: 'PSAT 8/9',
    label: 'PSAT 8/9',
    hint: '98 Qs / 134 min, no trigonometry, no hard items',
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

  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [completedModules, setCompletedModules] = useState<TestModuleResult[]>([]);
  const [finishedAttempt, setFinishedAttempt] = useState<TestAttempt | null>(null);
  const [reviewQuestionId, setReviewQuestionId] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<Record<string, HighlightRecord[]>>({});
  const [exitConfirmOpen, setExitConfirmOpen] = useState<boolean>(false);
  const [exitSaving, setExitSaving] = useState<boolean>(false);
  const [priorElapsedSeconds, setPriorElapsedSeconds] = useState<number>(0);
  const [initialSeenQuestionIds, setInitialSeenQuestionIds] = useState<string[]>([]);

  // Bluebook UI toggles
  const [showDirections, setShowDirections] = useState<boolean>(false);
  const [hideClock, setHideClock] = useState<boolean>(false);
  const [showCalc, setShowCalc] = useState<boolean>(false);
  const [showRef, setShowRef] = useState<boolean>(false);
  const [showReportModal, setShowReportModal] = useState<boolean>(false);
  const [showNavPopover, setShowNavPopover] = useState<boolean>(false);
  const [showReviewScreen, setShowReviewScreen] = useState<boolean>(false);
  const [eliminateMode, setEliminateMode] = useState<boolean>(false);
  const [splitRatio, setSplitRatio] = useState<number>(50);
  const isDraggingSplitRef = useRef<boolean>(false);

  // Draggable Reference Sheet position & pointer state
  const [refPos, setRefPos] = useState<{ x: number; y: number }>(() => ({
    x: typeof window !== 'undefined' ? Math.max(24, window.innerWidth - 780) : 120,
    y: 74,
  }));
  const [isDraggingRef, setIsDraggingRef] = useState<boolean>(false);
  // Mirrors isDraggingRef so pointermove tracking never waits on a re-render.
  const refDraggingFlag = useRef<boolean>(false);
  const refDragOffset = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const refModalRef = useRef<HTMLDivElement>(null);

  const sessionStartRef = useRef<number>(Date.now());
  const clientSessionIdRef = useRef<string>(newEventId());
  // A module can be submitted exactly once. Guards the review-screen Next
  // button, the timer and a double click from grading the same module twice.
  const submittedModuleRef = useRef<string | null>(null);

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

  // Module countdown timer. Expiry is handled by the effect below, not inside
  // the state updater: updaters must stay pure (StrictMode calls them twice)
  // and a side effect there can grade the same module twice.
  useEffect(() => {
    if (!activeStage || inSectionBreak) return;
    const timer = window.setInterval(() => {
      setRemainingSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeStage, inSectionBreak]);

  // 10-minute inter-section break countdown. As with the module clock, the
  // interval only decrements; resuming happens in an effect below so the state
  // updater stays pure.
  useEffect(() => {
    if (!inSectionBreak) return;
    const timer = window.setInterval(() => {
      setBreakSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [inSectionBreak]);

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

  // Keep reference sheet clamped inside viewport on window resize
  useEffect(() => {
    const onResize = () => {
      setRefPos((prev) => ({
        x: Math.max(12, Math.min(window.innerWidth - 320, prev.x)),
        y: Math.max(56, Math.min(window.innerHeight - 120, prev.y)),
      }));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
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
    submittedModuleRef.current = null;
    suppressAutosaveRef.current = false;
    autosaveSignatureRef.current = null;
    attemptCreatedAtRef.current = new Date().toISOString();
    setPriorElapsedSeconds(0);
    setInitialSeenQuestionIds(seenQuestionIds);
    setTestPlan(plan);
    setCompletedModules([]);
    setFinishedAttempt(null);
    setReviewQuestionId(null);
    setResponses({});
    setEliminated({});
    setFlagged({});
    setHighlights({});
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

  // Start Section 2 automatically when the break clock hits zero.
  useEffect(() => {
    if (!inSectionBreak || breakSeconds > 0) return;
    resumeFromSectionBreak();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakSeconds, inSectionBreak]);

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
      // The section estimate is computed from these, so the 8 embedded
      // experimental items can never inflate or deflate a reported score.
      operationalCorrect,
      operationalTotal,
      timedOut,
      responses: moduleResponses,
    };
    return { modResult, correctCount, operationalCorrect, operationalTotal };
  };

  const submitCurrentModule = async (timedOut = false) => {
    if (!activeStage || !testPlan) return;
    const submitKey = `${activeStage.sectionIndex}:${activeStage.stageNumber}`;
    if (submittedModuleRef.current === submitKey) return;
    submittedModuleRef.current = submitKey;
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
    const currentRunDuration = Math.max(1, Math.round((Date.now() - sessionStartRef.current) / 1000));
    const totalDuration = priorElapsedSeconds + currentRunDuration;
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
    suppressAutosaveRef.current = true;
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

  // Auto-submit the module the moment the countdown reaches zero. This lives
  // outside the interval callback so the timer only ever decrements state.
  useEffect(() => {
    if (!activeStage || inSectionBreak || remainingSeconds > 0) return;
    void submitCurrentModule(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingSeconds, activeStage, inSectionBreak]);

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
   * Snapshot of the running test: current module position, answers, flags,
   * highlights, remaining timer and elapsed time. Shared by the autosave loop,
   * "Save & exit", and the pagehide flush so every path stores the same data.
   * Scores stay null until all four modules are submitted.
   */
  const buildPausedAttempt = (): TestAttempt | null => {
    if (!testPlan || !activeStage) return null;
    const currentRunDuration = Math.max(
      1,
      Math.round((Date.now() - sessionStartRef.current) / 1000)
    );
    return {
      id: clientSessionIdRef.current,
      assessment,
      status: 'incomplete',
      createdAt: attemptCreatedAtRef.current,
      modules: completedModules,
      rwEstimate: null,
      mathEstimate: null,
      totalEstimate: null,
      durationSeconds: priorElapsedSeconds + currentRunDuration,
      pausedState: {
        seed: testPlan.seed,
        excludeReleased,
        sectionIndex: activeStage.sectionIndex,
        stageNumber: activeStage.stageNumber,
        tier: activeStage.plan.tier,
        currentIndex,
        remainingSeconds,
        inSectionBreak,
        breakSeconds,
        pendingNextSectionIdx,
        responses,
        eliminated,
        flagged,
        highlights,
        seenQuestionIds: initialSeenQuestionIds,
      },
    };
  };

  // Always-current closures so the autosave timers (installed once) can read the
  // latest question state and store actions without re-registering on every
  // render — app.actions has a fresh identity each store render, so it must not
  // sit in the effect dependency array (that would re-arm timers forever).
  const buildPausedAttemptRef = useRef(buildPausedAttempt);
  buildPausedAttemptRef.current = buildPausedAttempt;
  const appActionsRef = useRef(app.actions);
  appActionsRef.current = app.actions;
  // Last-written snapshot signature: autosave skips identical data so a save
  // never triggers a render that triggers another save.
  const autosaveSignatureRef = useRef<string | null>(null);
  // Set when the run ends (completed or saved-and-exited): a stale debounced
  // snapshot must never overwrite the final attempt row with an incomplete one.
  const suppressAutosaveRef = useRef<boolean>(false);
  // Creation timestamp is fixed when the run starts/resumes so repeated
  // autosaves update one row instead of restamping the attempt every time.
  const attemptCreatedAtRef = useRef<string>(new Date().toISOString());

  /**
   * Continuous autosave. localStorage gets a synchronous snapshot 1.2s after
   * every meaningful change and every 15 seconds regardless, so closing the tab
   * or the whole browser mid-test — without touching Exit — still preserves the
   * run and its remaining timer. Cloud accounts get a throttled Supabase mirror
   * plus an immediate flush when the page is hidden or closed.
   */
  useEffect(() => {
    const snapshotNow = (flush: boolean) => {
      if (suppressAutosaveRef.current) return;
      const attempt = buildPausedAttemptRef.current();
      if (!attempt) return;
      const signature = JSON.stringify([
        attempt.durationSeconds,
        attempt.pausedState?.currentIndex,
        attempt.pausedState?.remainingSeconds,
        attempt.pausedState?.inSectionBreak,
        attempt.pausedState?.breakSeconds,
        attempt.pausedState?.responses,
        attempt.pausedState?.flagged,
        attempt.pausedState?.eliminated,
        attempt.pausedState?.highlights,
        attempt.modules.length,
      ]);
      const changed = signature !== autosaveSignatureRef.current;
      autosaveSignatureRef.current = signature;
      if (flush) {
        appActionsRef.current.flushTestSync(attempt, clientSessionIdRef.current);
      } else if (changed) {
        appActionsRef.current.autosaveTest(attempt, clientSessionIdRef.current);
      }
    };

    const debounce = window.setTimeout(() => snapshotNow(false), 1200);
    const interval = window.setInterval(() => snapshotNow(false), 15000);
    const onHide = () => {
      if (document.visibilityState === 'hidden') snapshotNow(true);
    };
    const onPageHide = () => snapshotNow(true);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.clearTimeout(debounce);
      window.clearInterval(interval);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onHide);
    };
    // Re-arms the debounced snapshot after every answer, flag, highlight or
    // navigation change; the 15s interval covers the ticking clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeStage,
    inSectionBreak,
    currentIndex,
    responses,
    flagged,
    eliminated,
    highlights,
    completedModules,
    pendingNextSectionIdx,
  ]);

  /**
   * Exit without discarding the run: save the current module progress, answers,
   * flags, highlights, and remaining timer so the student can resume later from
   * "Past simulations". Scores and answers stay hidden until the full simulation
   * is completed.
   */
  const saveAndExit = async () => {
    const attempt = buildPausedAttempt();
    if (!attempt) {
      exitSimulation();
      return;
    }
    setExitSaving(true);
    try {
      setFinishedAttempt(null);
      suppressAutosaveRef.current = true;
      await app.actions.recordTest(attempt, clientSessionIdRef.current);
      exitSimulation();
    } finally {
      setExitSaving(false);
    }
  };

  const resumeSavedAttempt = (attempt: TestAttempt) => {
    const ps = attempt.pausedState;
    if (!ps) {
      // Legacy incomplete attempt without pausedState: start a fresh run with its assessment
      setAssessment(attempt.assessment);
      startFullSimulation();
      return;
    }
    const plan = buildTestPlan(app.questions, {
      assessment: attempt.assessment,
      excludeReleasedPracticeSet: ps.excludeReleased,
      seed: ps.seed,
      seenQuestionIds: ps.seenQuestionIds ?? [],
    });
    const secPlan = plan.sections[ps.sectionIndex] ?? plan.sections[0];
    if (!secPlan) return;
    const modPlan =
      ps.tier === 'upper'
        ? secPlan.upper
        : ps.tier === 'lower'
        ? secPlan.lower
        : secPlan.module1;

    clientSessionIdRef.current = attempt.id;
    sessionStartRef.current = Date.now();
    submittedModuleRef.current = null;
    suppressAutosaveRef.current = false;
    autosaveSignatureRef.current = null;
    attemptCreatedAtRef.current = attempt.createdAt;
    setPriorElapsedSeconds(attempt.durationSeconds ?? 0);
    setInitialSeenQuestionIds(ps.seenQuestionIds ?? []);
    setAssessment(attempt.assessment);
    setExcludeReleased(ps.excludeReleased);
    setTestPlan(plan);
    setCompletedModules(attempt.modules ?? []);
    setFinishedAttempt(null);
    setReviewQuestionId(null);
    setResponses(ps.responses ?? {});
    setEliminated(ps.eliminated ?? {});
    setFlagged(ps.flagged ?? {});
    setHighlights((ps.highlights as Record<string, HighlightRecord[]>) ?? {});
    setCurrentIndex(Math.min(Math.max(0, ps.currentIndex ?? 0), Math.max(0, modPlan.questions.length - 1)));
    setShowCalc(false);
    setShowRef(false);
    setShowDirections(false);
    setShowNavPopover(false);
    setShowReviewScreen(false);
    setInSectionBreak(Boolean(ps.inSectionBreak));
    setBreakSeconds(ps.breakSeconds ?? SECTION_BREAK_MINUTES * 60);
    setPendingNextSectionIdx(ps.pendingNextSectionIdx ?? null);
    setActiveStage({
      sectionIndex: ps.sectionIndex,
      stageNumber: ps.stageNumber,
      plan: modPlan,
    });
    setRemainingSeconds(ps.remainingSeconds > 0 ? ps.remainingSeconds : modPlan.minutes * 60);
  };

  const openPastAttempt = (attempt: TestAttempt) => {
    if (attempt.status === 'incomplete') {
      resumeSavedAttempt(attempt);
      return;
    }
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

  // Desktop keyboard controls, Bluebook style. Typing inside the SPR box or a
  // note editor is never intercepted.
  useEffect(() => {
    if (!activeStage || inSectionBreak || showReviewScreen || finishedAttempt) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const question = activeStage.plan.questions[currentIndex];
      if (!question) return;
      const key = event.key.toLowerCase();

      const letterAt = ['a', 'b', 'c', 'd'].indexOf(key);
      const digitAt = ['1', '2', '3', '4'].indexOf(key);
      const choiceAt = letterAt >= 0 ? letterAt : digitAt;
      if (choiceAt >= 0 && question.format === 'multiple_choice' && question.choices?.[choiceAt]) {
        event.preventDefault();
        const choiceId = question.choices[choiceAt].id;
        setResponses((prev) => ({ ...prev, [question.id]: choiceId }));
        return;
      }

      if (key === 'm') {
        event.preventDefault();
        setFlagged((prev) => ({ ...prev, [question.id]: !prev[question.id] }));
        return;
      }
      if (key === 'arrowleft') {
        event.preventDefault();
        setCurrentIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key === 'arrowright' || key === 'enter' || event.key === ' ') {
        if (event.key === 'Enter' && !(responses[question.id] ?? '').trim()) return;
        event.preventDefault();
        if (currentIndex + 1 < activeStage.plan.questions.length) {
          setCurrentIndex((i) => i + 1);
        } else {
          setShowReviewScreen(true);
        }
        return;
      }
      if (key === 'escape') {
        setShowNavPopover(false);
        setShowDirections(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeStage,
    inSectionBreak,
    showReviewScreen,
    finishedAttempt,
    currentIndex,
    responses,
  ]);

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
                  title="Open the math reference sheet"
                >
                  <span className="bb-tool-icon">𝑥²</span>
                  <span className="bb-tool-label">Reference</span>
                </button>
              </>
            ) : null}
            <button
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
              <div className="bb-directions-shortcuts">
                <strong>Keyboard Shortcuts:</strong>{' '}
                <span>
                  <code>A</code>–<code>D</code> or <code>1</code>–<code>4</code> select answer ·{' '}
                  <code>←</code> / <code>→</code> move · <code>Space</code> or <code>Enter</code>{' '}
                  next · <code>M</code> mark for review · <code>Esc</code> close panel
                </span>
              </div>
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

        {/* Reference sheet draggable floating window (Math only) */}
        {isMathSection && showRef ? (
          <div
            ref={refModalRef}
            className={`bb-floating-modal bb-ref-window${isDraggingRef ? ' is-dragging' : ''}`}
            style={{
              left: `${refPos.x}px`,
              top: `${refPos.y}px`,
              right: 'auto',
            }}
            data-testid="reference-sheet-modal"
          >
            <div
              className="bb-floating-head bb-ref-drag-handle"
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest('button')) return;
                e.preventDefault();
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  /* synthetic pointers have no capturable id; dragging still works */
                }
                refDragOffset.current = {
                  dx: e.clientX - refPos.x,
                  dy: e.clientY - refPos.y,
                };
                refDraggingFlag.current = true;
                setIsDraggingRef(true);
              }}
              onPointerMove={(e) => {
                if (!refDraggingFlag.current) return;
                const modalW = refModalRef.current?.offsetWidth ?? 680;
                const modalH = refModalRef.current?.offsetHeight ?? 360;
                const nextX = Math.max(
                  8,
                  Math.min(window.innerWidth - Math.min(modalW, 240), e.clientX - refDragOffset.current.dx)
                );
                const nextY = Math.max(
                  8,
                  Math.min(window.innerHeight - Math.min(modalH, 80), e.clientY - refDragOffset.current.dy)
                );
                setRefPos({ x: nextX, y: nextY });
              }}
              onPointerUp={(e) => {
                if (refDraggingFlag.current) {
                  try {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  } catch {
                    /* ignore */
                  }
                  refDraggingFlag.current = false;
                  setIsDraggingRef(false);
                }
              }}
              onLostPointerCapture={() => {
                refDraggingFlag.current = false;
                setIsDraggingRef(false);
              }}
              onPointerCancel={() => setIsDraggingRef(false)}
            >
              <strong>Reference Sheet</strong>
              <span className="bb-calc-drag-dots" aria-hidden="true" title="Drag to move">
                ⋮⋮⋮
              </span>
              <button
                type="button"
                onClick={() => setShowRef(false)}
                aria-label="Close reference sheet"
              >
                ✕
              </button>
            </div>
            <div className="bb-floating-body">
              <MathReferenceSheet assessment={assessment} />
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
                Your progress, selected answers, highlights, and remaining timer will be saved so
                you can <strong>resume right where you left off</strong> under{' '}
                <strong>Past simulations</strong> on the Full test page. Scores and answer
                explanations stay locked until you complete all modules.
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
          <div className="row-between">
            <div className="row">
              <h1>Full-Length Adaptive Practice Test</h1>
              <InfoTip label="Blueprint & scoring">
                <div className="stack" style={{ gap: 8 }}>
                  <div>
                    <strong>98 total questions · 134 minutes</strong> (90 operational scored + 8
                    unscored experimental items, with a 10-minute break between sections).
                  </div>
                  <div>
                    <strong>Section 1 — Reading &amp; Writing (54 items · 64 min):</strong> two
                    32-minute adaptive modules of 27 questions across Craft &amp; Structure,
                    Information &amp; Ideas, Standard English Conventions, and Expression of Ideas.
                  </div>
                  <div>
                    <strong>Section 2 — Math (44 items · 70 min):</strong> two 35-minute adaptive
                    modules of 22 questions (~75% MC / ~25% SPR) in ascending difficulty.
                  </div>
                  <div>
                    <strong>Fresh-item mode:</strong> draws unseen questions first ({unseenPool.rw}{' '}
                    R&amp;W and {unseenPool.math} Math unseen available).
                  </div>
                </div>
              </InfoTip>
            </div>
            <Badge tone="info">98 Qs · 134 min</Badge>
          </div>
          <p className="muted">
            Full-screen Bluebook simulation for {assessment}. Modules are scored on submission.
          </p>

          <div style={{ marginTop: 14 }}>
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

          <div className="row-between" style={{ marginTop: 16 }}>
            <span className="muted">
              {unseenPool.rw} R&amp;W · {unseenPool.math} Math unseen items ready
            </span>
            <Button icon="play" onClick={startFullSimulation}>
              Launch Full-Screen Bluebook Test
            </Button>
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
                        <td>
                          {attempt.status === 'incomplete'
                            ? 'In progress'
                            : attempt.rwEstimate ?? '—'}
                        </td>
                        <td>
                          {attempt.status === 'incomplete'
                            ? 'In progress'
                            : attempt.mathEstimate ?? '—'}
                        </td>
                        <td>
                          {attempt.status === 'incomplete'
                            ? 'Complete to score'
                            : attempt.totalEstimate ?? '—'}
                        </td>
                        <td>{formatClock(attempt.durationSeconds)}</td>
                        <td>
                          <Badge tone={attempt.status === 'incomplete' ? 'warn' : 'good'}>
                            {attempt.status === 'incomplete' ? 'Saved · In progress' : 'Completed'}
                          </Badge>
                        </td>
                        <td>
                          <Button
                            size="sm"
                            variant={attempt.status === 'incomplete' ? 'primary' : 'outline'}
                            onClick={() => openPastAttempt(attempt)}
                          >
                            {attempt.status === 'incomplete' ? 'Resume' : 'Review'}
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
                    Score: <strong>{m.operationalCorrect ?? m.correct}</strong> /{' '}
                    {m.operationalTotal ?? m.total} (
                    {(m.operationalTotal ?? m.total) > 0
                      ? Math.round(
                          ((m.operationalCorrect ?? m.correct) / (m.operationalTotal ?? m.total)) * 100
                        )
                      : 0}
                    %)
                  </p>
                  {m.operationalTotal && m.operationalTotal !== m.total ? (
                    <div className="muted">
                      {m.correct} of {m.total} correct including {m.total - m.operationalTotal}{' '}
                      unscored experimental item{m.total - m.operationalTotal === 1 ? '' : 's'}
                    </div>
                  ) : null}
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
