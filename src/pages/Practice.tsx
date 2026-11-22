import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MathText } from '../components/MathText';
import { DesmosPane } from '../components/MathTools';
import { ReferenceWindow } from '../components/ReferenceWindow';
import { PaneSwitch, SplitWorkbench, useSplitPane } from '../components/SplitWorkbench';
import { QuestionView, type Feedback } from '../components/QuestionView';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Icon,
  InfoTip,
  MultiSelect,
  Select,
  Stat,
  Toggle,
} from '../components/ui';
import { datasetLabel } from '../lib/catalog';
import { buildPracticeSession, filterQuestions, formatClock } from '../lib/examEngine';
import { poolReadiness } from '../lib/review';
import { clearPracticeSession, loadPracticeSession, savePracticeSession } from '../lib/session';
import { newEventId } from '../lib/storage';
import { typicalSeconds } from '../lib/timing';
import { useApp } from '../lib/store';

type Confidence = 'sure' | 'unsure' | 'guess';

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  sure: 'Sure',
  unsure: 'Unsure',
  guess: 'Guess',
};
import type { Assessment, Difficulty, Question, Section } from '../lib/types';

type TabMode = 'custom' | 'assistant';

export function PracticePage() {
  const app = useApp();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<TabMode>('custom');

  // Custom practice configuration. A recommended-session link carries its
  // domain into this screen, so "drill Advanced Math" opens with Advanced Math
  // already selected instead of asking the student to choose it again.
  const domainParam = searchParams.get('domain')?.trim() ?? '';
  const sectionParam = searchParams.get('section')?.trim() ?? '';
  const countParam = Number.parseInt(searchParams.get('count') ?? '', 10);
  const domainQuestion = domainParam
    ? app.questions.find((q) => q.domain === domainParam)
    : undefined;
  const sectionFromUrl: Section | 'all' =
    sectionParam === 'Math' || sectionParam === 'Reading and Writing'
      ? sectionParam
      : domainQuestion?.section ?? 'all';
  const [assessment, setAssessment] = useState<Assessment>(app.settings.assessment);
  const [section, setSection] = useState<Section | 'all'>(sectionFromUrl);
  const [domains, setDomains] = useState<string[]>(() =>
    domainParam ? [domainParam] : []
  );
  const [difficulties, setDifficulties] = useState<Difficulty[]>([]);
  const [sourceId, setSourceId] = useState<string>('all');
  // How many items this session draws, typed directly. There is no preset menu:
  // five fixed sizes never covered the session a student actually wanted.
  const [count, setCount] = useState<number>(() =>
    Number.isFinite(countParam) && countParam >= 1 && countParam <= 50
      ? countParam
      : 10
  );
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
  /**
   * Custom practice only: how sure the student was before checking. It is a
   * self-report kept for the session summary, not part of the attempt, so it
   * cannot affect grading, mastery or a synced record.
   */
  const [confidence, setConfidence] = useState<Record<string, Confidence>>({});
  const [showCalc, setShowCalc] = useState<boolean>(false);
  const split = useSplitPane('hdsat.split.practice', { ratio: 46, minRatio: 30, maxRatio: 70 });
  const [showRef, setShowRef] = useState<boolean>(false);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [timings, setTimings] = useState<Record<string, number>>({});
  const [readyNotice, setReadyNotice] = useState<string | null>(null);

  const resetCustomFilters = () => {
    setAssessment(app.settings.assessment);
    setSection('all');
    setDomains([]);
    setDifficulties([]);
    setSourceId('all');
    setOnlyIncorrect(false);
    setOnlySaved(false);
    setExcludeCorrect(false);
    setExcludeReleased(false);
  };
  const questionStartRef = useRef<number>(Date.now());
  const resumedRef = useRef(false);
  const wantsResume = searchParams.get('resume') === '1';

  useEffect(() => {
    if (!domainParam) {
      setDomains([]);
      return;
    }
    const match = app.questions.find((q) => q.domain === domainParam);
    setDomains([domainParam]);
    setSection(match?.section ?? 'all');
  }, [domainParam, app.questions]);

  useEffect(() => {
    if (Number.isFinite(countParam) && countParam >= 1 && countParam <= 50) {
      setCount(countParam);
    }
  }, [countParam]);

  useEffect(() => {
    if (domainParam) return;
    if (sectionParam === 'Math' || sectionParam === 'Reading and Writing') {
      setSection(sectionParam);
      setDomains([]);
    }
  }, [domainParam, sectionParam]);

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

  /** The length this session will ask for, after clamping to what is ready. */
  const [customMode, setCustomMode] = useState(false);
  const [customLength, setCustomLength] = useState('');
  const customCount = Number.parseInt(customLength, 10);
  const customValid = Number.isFinite(customCount) && customCount >= 1;
  const requestedCount = customMode ? (customValid ? customCount : 0) : count;

  // Practice may draw unseen items plus items whose review date has arrived.
  // Anything else waits, unless the student hand-picked the drill.
  const allowScheduled = onlySaved || onlyIncorrect;
  const readiness = useMemo(
    () => poolReadiness(matchingPool, app.progress),
    [matchingPool, app.progress]
  );
  const readyCount = allowScheduled ? matchingPool.length : readiness.ready;
  const showsWholeBank =
    app.questions.length > 0 && matchingPool.length === app.questions.length;

  // Restore a session that survived a refresh or a closed tab.
  useEffect(() => {
    if (!wantsResume || resumedRef.current) return;
    const snapshot = loadPracticeSession();
    if (!snapshot) return;
    const byId = new Map(app.questions.map((q) => [q.id, q]));
    const restored = snapshot.questionIds
      .map((id) => byId.get(id))
      .filter((q): q is Question => Boolean(q));
    if (restored.length === 0) {
      clearPracticeSession();
      return;
    }
    resumedRef.current = true;
    const known = new Set(restored.map((q) => q.id));
    const onlyKnown = <T,>(record: Record<string, T>) =>
      Object.fromEntries(Object.entries(record).filter(([id]) => known.has(id)));
    // Continue at the first unanswered item, which is what the Dashboard strip
    // promises; when everything is answered, keep the last position.
    const answered = new Set(
      Object.entries(snapshot.responses)
        .filter(([, value]) => Boolean(value && value.trim()))
        .map(([id]) => id)
    );
    const firstUnanswered = restored.findIndex((q) => !answered.has(q.id));
    const index =
      firstUnanswered >= 0
        ? firstUnanswered
        : Math.max(0, Math.min(snapshot.index, restored.length - 1));
    setAssessment(snapshot.assessment as Assessment);
    setSessionId(snapshot.sessionId || newEventId());
    setSessionQuestions(restored);
    setCurrentIndex(index);
    setResponses(onlyKnown(snapshot.responses));
    setFlagged(onlyKnown(snapshot.flagged));
    setFeedbackMap(onlyKnown(snapshot.feedback) as Record<string, Feedback>);
    setElapsedSeconds(snapshot.elapsedSeconds);
    setSessionDone(false);
    setReadyNotice(`Resumed at item ${index + 1} of ${restored.length}.`);
    questionStartRef.current = Date.now();
  }, [app.questions, wantsResume]);

  // Keep the resume snapshot current. Elapsed time is read from state here but
  // deliberately left out of the dependencies so the timer does not write
  // localStorage every second.
  useEffect(() => {
    if (!sessionId || sessionDone || sessionQuestions.length === 0) return;
    savePracticeSession({
      version: 1,
      sessionId,
      questionIds: sessionQuestions.map((q) => q.id),
      index: currentIndex,
      responses,
      flagged,
      feedback: feedbackMap,
      elapsedSeconds,
      assessment,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, sessionDone, sessionQuestions, currentIndex, responses, flagged, feedbackMap]);

  // Elapsed timer for active custom session
  useEffect(() => {
    if (!sessionId || sessionDone) return;
    const timer = window.setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sessionId, sessionDone]);

  const startCustomSession = () => {
    const now = new Date();
    // A typed length goes through the same builder as a preset one; it is the
    // number that differs, not the rules about unseen work and reviews.
    const wanted = Math.max(1, Math.round(requestedCount || 1));
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
        count: Math.min(wanted, Math.max(1, readyCount)),
        progress: app.progress,
        savedIds: app.saved,
        seed: `custom:${Date.now()}`,
        now,
        allowScheduled,
      }
    );
    if (chosen.length === 0) {
      setReadyNotice('Nothing is due right now. Unseen items and reviews appear as your schedule advances.');
      return;
    }
    const sessionKey = newEventId();
    setReadyNotice(null);
    setSessionId(sessionKey);
    setSessionQuestions(chosen);
    setCurrentIndex(0);
    setResponses({});
    setEliminated({});
    setFlagged({});
    setFeedbackMap({});
    setTimings({});
    setConfidence({});
    setSessionDone(false);
    setElapsedSeconds(0);
    questionStartRef.current = Date.now();
    savePracticeSession({
      version: 1,
      sessionId: sessionKey,
      questionIds: chosen.map((q) => q.id),
      index: 0,
      responses: {},
      flagged: {},
      feedback: {},
      elapsedSeconds: 0,
      assessment,
      startedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
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
    setTimings((prev) => ({ ...prev, [currentQuestion.id]: spent }));
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
    clearPracticeSession();
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
            <Badge tone="info">
              {showsWholeBank
                ? `${app.questions.length.toLocaleString()} items`
                : `${matchingPool.length.toLocaleString()} of ${app.questions.length.toLocaleString()} items`}
            </Badge>
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
              options={domainOptions.map((d) => ({ value: d, label: d }))}
            />
            <MultiSelect
              label="Difficulties"
              values={difficulties}
              onChange={(next) => setDifficulties(next as Difficulty[])}
              allLabel="All Difficulties"
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
                { value: 'all', label: 'All Sources' },
                ...app.sources.map((s) => ({ value: s.source_id, label: datasetLabel(s) })),
              ]}
            />
            {/* Five quick sizes and an "Other…" that is an empty box: the
                student types the number they want, nothing else. */}
            <Select
              label="Session length"
              value={customMode ? 'custom' : String(count)}
              onChange={(value) => {
                if (value === 'custom') {
                  setCustomMode(true);
                  return;
                }
                setCustomMode(false);
                setCount(Number(value));
              }}
              options={[
                // A deep link may request a count that is not one of the five
                // presets. Keep that number visible and selected rather than
                // silently letting the browser fall back to five.
                ...[5, 10, 15, 22, 27].includes(count)
                  ? []
                  : [{ value: String(count), label: `${count} questions` }],
                { value: '5', label: '5 questions' },
                { value: '10', label: '10 questions' },
                { value: '15', label: '15 questions' },
                { value: '22', label: '22 questions' },
                { value: '27', label: '27 questions' },
                { value: 'custom', label: 'Other…' },
              ]}
            />
            {customMode ? (
              <Field
                label="How many questions?"
                hint={`Enter a number from 1 to ${Math.max(1, readyCount)}.`}
              >
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={Math.max(1, readyCount)}
                  placeholder="Enter a number"
                  value={customLength}
                  onChange={(e) => setCustomLength(e.target.value)}
                  onBlur={() => {
                    const parsed = Number.parseInt(customLength, 10);
                    if (!Number.isFinite(parsed)) return;
                    setCustomLength(
                      String(Math.min(Math.max(1, parsed), Math.max(1, readyCount)))
                    );
                  }}
                />
              </Field>
            ) : null}
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
              />
              <Toggle
                checked={excludeReleased}
                onChange={(val) => {
                  setExcludeReleased(val);
                  app.actions.updateSettings({ excludeReleasedPracticeSet: val });
                }}
                label="Exclude Benchmark Simulation Set items"
              />
            </div>
            <div>
              <Toggle
                checked={onlyIncorrect}
                onChange={setOnlyIncorrect}
                label="Incorrect-only drill"
              />
              <Toggle checked={onlySaved} onChange={setOnlySaved} label="Saved questions only" />
              <Toggle
                checked={timedPerQuestion}
                onChange={setTimedPerQuestion}
                label="Session timer"
              />
            </div>
          </div>

          <div className="row-between" style={{ marginTop: 14 }}>
            <span className="muted">
              {matchingPool.length === 0
                ? 'No questions match these filters yet.'
                : `${Math.min(requestedCount, readyCount)} ready${
                    !allowScheduled && readiness.due > 0 ? ` · ${readiness.due} due for review` : ''
                  }`}
            </span>
            <Button
              icon="play"
              onClick={startCustomSession}
              disabled={readyCount === 0 || (customMode && !customValid)}
            >
              Start session
            </Button>
          </div>
          {matchingPool.length === 0 ? (
            <EmptyState
              title="No questions match those filters"
              body="Try a broader filter or a shorter session."
              action={
                <Button variant="outline" size="sm" onClick={resetCustomFilters}>
                  Reset filters
                </Button>
              }
            />
          ) : null}
          {readyNotice ? (
            <p className="muted" style={{ margin: '8px 0 0' }}>
              {readyNotice}
            </p>
          ) : null}
        </Card>
      ) : null}

      {tab === 'custom' && sessionId && !sessionDone && currentQuestion ? (
        <div>
          <div className="test-bar">
            <div>
              <strong>Custom Practice · {assessment}</strong>
              <div className="muted">
                Item {currentIndex + 1} of {sessionQuestions.length}
                {(app.progress[currentQuestion.id]?.attemptCount ?? 0) > 0 ? ' · review' : ''}
              </div>
            </div>
            <div className="row">
              {timedPerQuestion ? <span className="timer">{formatClock(elapsedSeconds)}</span> : null}
              {/* The Desmos calculator and the Math Reference Sheet belong to
                  Math only, exactly as in the real app; a Reading & Writing
                  item used to keep the Reference button. */}
              {currentQuestion.section === 'Math' ? (
                <>
                  <Button size="sm" variant="subtle" onClick={() => setShowCalc((v) => !v)}>
                    {showCalc ? 'Hide Calculator' : 'Calculator'}
                  </Button>
                  <Button size="sm" variant="subtle" onClick={() => setShowRef((v) => !v)}>
                    {showRef ? 'Hide Reference' : 'Reference Sheet'}
                  </Button>
                  <PaneSwitch side={split.side} onClick={split.toggleSide} />
                </>
              ) : null}
              <Button
                size="sm"
                variant="subtle"
                icon="bookmark"
                onClick={() => app.actions.toggleSaved(currentQuestion.id)}
              >
                {app.saved.includes(currentQuestion.id) ? 'Saved' : 'Save'}
              </Button>
              <Button size="sm" variant="danger" onClick={finishCustomSession}>
                End session
              </Button>
            </div>
          </div>

          {readyNotice ? (
            <p className="muted" style={{ margin: '0 0 8px' }}>
              {readyNotice}
            </p>
          ) : null}

          {showRef && currentQuestion.section === 'Math' ? (
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
              timeSpentSeconds={timings[currentQuestion.id]}
              typicalSeconds={typicalSeconds(
                app.timingSamples,
                currentQuestion.section,
                currentQuestion.difficulty
              )}
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
              beforeSubmit={
                <div className="confidence-pick" role="group" aria-label="How sure are you?">
                  <span className="confidence-label">Before you check</span>
                  {(['sure', 'unsure', 'guess'] as const).map((level) => (
                    <button
                      key={level}
                      type="button"
                      className={`confidence-btn${(confidence[currentQuestion.id] ?? 'unsure') === level ? ' is-active' : ''}`}
                      aria-pressed={(confidence[currentQuestion.id] ?? 'unsure') === level}
                      onClick={() =>
                        setConfidence((prev) => ({ ...prev, [currentQuestion.id]: level }))
                      }
                    >
                      {CONFIDENCE_LABEL[level]}
                    </button>
                  ))}
                </div>
              }
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
              <Button
                onClick={() => {
                  clearPracticeSession();
                  setSessionId(null);
                  setReadyNotice(null);
                }}
                variant="outline"
              >
                Configure new session
              </Button>
              <Button onClick={startCustomSession}>Practice another set</Button>
            </div>
          </div>

          {(() => {
            const answered = Object.keys(feedbackMap);
            const correct = answered.filter((id) => feedbackMap[id]?.isCorrect).length;
            const missed = sessionQuestions.filter(
              (q) => feedbackMap[q.id] && !feedbackMap[q.id].isCorrect
            );
            return (
              <>
                <div className="card-grid" style={{ marginTop: 12 }}>
                  <Stat
                    label="Correct"
                    value={`${correct} / ${sessionQuestions.length}`}
                    hint={`${answered.length} of ${sessionQuestions.length} answered`}
                  />
                  <Stat
                    label="Accuracy"
                    value={
                      answered.length > 0 ? `${Math.round((correct / answered.length) * 100)}%` : '0%'
                    }
                    hint={answered.length > 0 ? `of ${answered.length} answered` : undefined}
                  />
                  <Stat label="Total Time" value={formatClock(elapsedSeconds)} />
                </div>

                {missed.length > 0 ? (
                  <div className="calibration" style={{ marginTop: 12 }}>
                    <div className="row-between">
                      <strong>Items to review</strong>
                      <span className="muted">{missed.length} missed</span>
                    </div>
                    <div className="stack" style={{ marginTop: 8 }}>
                      {missed.map((q) => (
                        <div key={q.id} className="muted-block">
                          <div className="row" style={{ gap: 8 }}>
                            <Badge tone="neutral">{q.section}</Badge>
                            <span className="mono">{q.id}</span>
                          </div>
                          <p style={{ margin: '6px 0 0' }}>
                            <MathText text={q.prompt} />
                          </p>
                          <p className="muted" style={{ margin: '4px 0 0' }}>
                            Your answer: {responses[q.id] || '—'} · Key:{' '}
                            {feedbackMap[q.id]?.correctAnswer || '—'}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {sessionQuestions.some((q) => flagged[q.id]) ? (
                  <div className="calibration review-flagged" style={{ marginTop: 12 }}>
                    <div className="row-between">
                      <strong>Flagged for review</strong>
                      <span className="muted">
                        {sessionQuestions.filter((q) => flagged[q.id]).length} flagged in this session
                      </span>
                    </div>
                    <div className="stack" style={{ marginTop: 8 }}>
                      {sessionQuestions.map((q, index) => {
                        if (!flagged[q.id]) return null;
                        const itemFeedback = feedbackMap[q.id];
                        return (
                          <div key={`flagged-${q.id}`} className="muted-block flagged-row">
                            <div className="flagged-row-main">
                              <div className="row" style={{ gap: 8 }}>
                                <Badge tone="neutral">Item {index + 1}</Badge>
                                <span className="flagged-status">
                                  <Icon name="flag" size={12} />
                                  {itemFeedback
                                    ? itemFeedback.isCorrect
                                      ? 'Correct'
                                      : 'Incorrect'
                                    : 'Unanswered'}
                                </span>
                              </div>
                              <p style={{ margin: '6px 0 0' }}>
                                <MathText text={q.prompt} />
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSessionDone(false);
                                setCurrentIndex(index);
                                setReadyNotice(`Reviewing flagged item ${index + 1}.`);
                                window.scrollTo(0, 0);
                              }}
                            >
                              Review item
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </>
            );
          })()}

          {(() => {
            const answered = Object.keys(feedbackMap);
            if (answered.length === 0) return null;
            const rows = (['sure', 'unsure', 'guess'] as const).map((level) => {
              const ids = answered.filter((id) => (confidence[id] ?? 'unsure') === level);
              return {
                level,
                count: ids.length,
                right: ids.filter((id) => feedbackMap[id]?.isCorrect).length,
              };
            });
            if (rows.every((row) => row.count === 0)) return null;
            const sureWrong = rows[0].count - rows[0].right;
            return (
              <div className="calibration">
                <div className="row-between">
                  <strong>How your confidence landed</strong>
                  <span className="muted">Self-report, not graded</span>
                </div>
                <div className="calibration-rows">
                  {rows.map((row) => (
                    <div key={row.level} className="calibration-row">
                      <span>{CONFIDENCE_LABEL[row.level]}</span>
                      <span className="muted">
                        {row.count === 0 ? '—' : `${row.right} of ${row.count} right`}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="muted" style={{ margin: '8px 0 0' }}>
                  {sureWrong > 0
                    ? `${sureWrong} item${sureWrong === 1 ? '' : 's'} felt certain and was wrong — those are the ones worth another look.`
                    : 'Nothing you were sure of came back wrong this session.'}
                </p>
              </div>
            );
          })()}
        </Card>
      ) : null}

      {tab === 'assistant' ? (
        <Card>
          <h2>Study Coach</h2>

          {studyCoachPlan.length === 0 ? (
            <EmptyState title="No domains found" body="Select an assessment to view domain diagnostics." />
          ) : (
            <div className="stack" style={{ marginTop: 12 }}>
              {studyCoachPlan.map((d, idx) => {
                const statusLabel =
                  d.attempted === 0
                    ? 'Not started — begin with 5 items'
                    : d.accuracy < 0.6
                    ? 'Priority — under 60%'
                    : d.accuracy < 0.85
                    ? 'Developing — drill Medium/Hard'
                    : 'Strong — light review';
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
