import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DesmosPane } from '../components/MathTools';
import { ReferenceWindow } from '../components/ReferenceWindow';
import { PaneSwitch, SplitWorkbench, useSplitPane } from '../components/SplitWorkbench';
import { QuestionView, type Feedback } from '../components/QuestionView';
import { Badge, Button, Card, EmptyState, InfoTip, MultiSelect, Select, Stat, Toggle } from '../components/ui';
import { datasetLabel } from '../lib/catalog';
import { buildPracticeSession, filterQuestions, formatClock } from '../lib/examEngine';
import { poolReadiness } from '../lib/review';
import { clearPracticeSession, loadPracticeSession, savePracticeSession } from '../lib/session';
import { newEventId } from '../lib/storage';
import { typicalSeconds } from '../lib/timing';
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
  // "Other…" is a direct picker: the chosen items ARE the session, so it is the
  // only length option that bypasses the count and the review schedule.
  const [countOther, setCountOther] = useState<boolean>(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [pickerDomain, setPickerDomain] = useState<string>('all');
  const [pickerSkill, setPickerSkill] = useState<string>('all');
  const [pickerDifficulty, setPickerDifficulty] = useState<Difficulty | 'all'>('all');
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
  const [timings, setTimings] = useState<Record<string, number>>({});
  const [readyNotice, setReadyNotice] = useState<string | null>(null);
  const questionStartRef = useRef<number>(Date.now());
  const resumedRef = useRef(false);
  const wantsResume = searchParams.get('resume') === '1';

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

  const pickerDomainOptions = useMemo(() => {
    const set = new Set<string>();
    matchingPool.forEach((q) => set.add(q.domain));
    return Array.from(set);
  }, [matchingPool]);

  const pickerSkillOptions = useMemo(() => {
    const set = new Set<string>();
    matchingPool.forEach((q) => {
      if (pickerDomain === 'all' || q.domain === pickerDomain) set.add(q.skill);
    });
    return Array.from(set);
  }, [matchingPool, pickerDomain]);

  const pickerMatches = useMemo(
    () =>
      matchingPool.filter(
        (q) =>
          (pickerDomain === 'all' || q.domain === pickerDomain) &&
          (pickerSkill === 'all' || q.skill === pickerSkill) &&
          (pickerDifficulty === 'all' || q.difficulty === pickerDifficulty)
      ),
    [matchingPool, pickerDomain, pickerSkill, pickerDifficulty]
  );

  // Practice may draw unseen items plus items whose review date has arrived.
  // Anything else waits, unless the student hand-picked the drill.
  const allowScheduled = onlySaved || onlyIncorrect;
  const readiness = useMemo(
    () => poolReadiness(matchingPool, app.progress),
    [matchingPool, app.progress]
  );
  const readyCount = allowScheduled ? matchingPool.length : readiness.ready;

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
    if (countOther) {
      const byId = new Map(app.questions.map((q) => [q.id, q]));
      const pickedQuestions = picked
        .map((id) => byId.get(id))
        .filter((q): q is Question => Boolean(q));
      if (pickedQuestions.length === 0) {
        setReadyNotice('Pick at least one question, or choose a session length instead.');
        return;
      }
      const sessionKey = newEventId();
      setReadyNotice(null);
      setSessionId(sessionKey);
      setSessionQuestions(pickedQuestions);
      setCurrentIndex(0);
      setResponses({});
      setEliminated({});
      setFlagged({});
      setFeedbackMap({});
      setTimings({});
      setSessionDone(false);
      setElapsedSeconds(0);
      questionStartRef.current = Date.now();
      savePracticeSession({
        version: 1,
        sessionId: sessionKey,
        questionIds: pickedQuestions.map((q) => q.id),
        index: 0,
        responses: {},
        flagged: {},
        feedback: {},
        elapsedSeconds: 0,
        assessment,
        startedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
      return;
    }
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
        count: Math.min(count, Math.max(1, readyCount)),
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
            <Select
              label="Session Length"
              value={countOther ? 'other' : String(count)}
              onChange={(v) => {
                if (v === 'other') {
                  setCountOther(true);
                  return;
                }
                setCountOther(false);
                setCount(Number(v));
              }}
              options={[
                { value: '5', label: '5 questions' },
                { value: '10', label: '10 questions' },
                { value: '15', label: '15 questions' },
                { value: '22', label: '22 questions' },
                { value: '25', label: '25 questions' },
                { value: '27', label: '27 questions' },
                { value: 'other', label: 'Other…' },
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
              <Toggle
                checked={onlySaved}
                onChange={setOnlySaved}
                label="Saved questions only"
              />
              <Toggle
                checked={timedPerQuestion}
                onChange={setTimedPerQuestion}
                label="Session timer"
              />
            </div>
          </div>

          {countOther ? (
            <div className="picker-block">
              <div className="row-between">
                <h3 style={{ margin: 0 }}>Pick questions</h3>
                <Badge tone={picked.length > 0 ? 'good' : 'info'}>{picked.length} selected</Badge>
              </div>
              <div className="card-grid" style={{ marginTop: 10 }}>
                <Select
                  label="Domain"
                  value={pickerDomain}
                  onChange={(v) => {
                    setPickerDomain(v);
                    setPickerSkill('all');
                  }}
                  options={[
                    { value: 'all', label: 'All domains' },
                    ...pickerDomainOptions.map((d) => ({ value: d, label: d })),
                  ]}
                />
                <Select
                  label="Skill"
                  value={pickerSkill}
                  onChange={setPickerSkill}
                  options={[
                    { value: 'all', label: 'All skills' },
                    ...pickerSkillOptions.map((s) => ({ value: s, label: s })),
                  ]}
                />
                <Select
                  label="Difficulty"
                  value={pickerDifficulty}
                  onChange={(v) => setPickerDifficulty(v as Difficulty | 'all')}
                  options={[
                    { value: 'all', label: 'Any difficulty' },
                    { value: 'Easy', label: 'Easy' },
                    { value: 'Medium', label: 'Medium' },
                    { value: 'Hard', label: 'Hard' },
                  ]}
                />
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setPicked((prev) =>
                      Array.from(new Set([...prev, ...pickerMatches.slice(0, 60).map((q) => q.id)]))
                    )
                  }
                  disabled={pickerMatches.length === 0}
                >
                  Add all shown
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPicked([])}
                  disabled={picked.length === 0}
                >
                  Clear
                </Button>
                <span className="muted">
                  {pickerMatches.length} shown{pickerMatches.length > 80 ? ' · first 80 listed' : ''}
                </span>
              </div>
              <div className="picker-list">
                {pickerMatches.slice(0, 80).map((q) => {
                  const on = picked.includes(q.id);
                  return (
                    <label key={q.id} className={`picker-row${on ? ' is-picked' : ''}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setPicked((prev) =>
                            on ? prev.filter((id) => id !== q.id) : [...prev, q.id]
                          )
                        }
                      />
                      <span className="picker-meta">
                        {q.section === 'Math' ? 'Math' : 'R&W'} · {q.difficulty}
                      </span>
                      <span className="picker-prompt">{q.prompt}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="row-between" style={{ marginTop: 14 }}>
            <span className="muted">
              {countOther
                ? `${picked.length} picked · ${pickerMatches.length} shown`
                : matchingPool.length === 0
                ? 'No questions match these filters yet.'
                : `${Math.min(count, readyCount)} ready${
                    !allowScheduled && readiness.due > 0 ? ` · ${readiness.due} due for review` : ''
                  }`}
            </span>
            <Button
              icon="play"
              onClick={startCustomSession}
              disabled={countOther ? picked.length === 0 : readyCount === 0}
            >
              Start session
            </Button>
          </div>
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

          {readyNotice ? (
            <p className="muted" style={{ margin: '0 0 8px' }}>
              {readyNotice}
            </p>
          ) : null}

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
          <h2>Study Coach</h2>
          <p className="muted">Picks your next drill from your own history.</p>

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
