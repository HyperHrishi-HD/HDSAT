import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalculatorPanel, MathReferenceSheet } from '../components/MathTools';
import { MathText } from '../components/MathText';
import { QuestionView } from '../components/QuestionView';
import { Badge, Button, Card, EmptyState, Select, Stat, Toggle } from '../components/ui';
import { buildPracticeSession, filterQuestions, formatClock } from '../lib/examEngine';
import { checkAnswer } from '../lib/grading';
import { newEventId } from '../lib/storage';
import { useApp } from '../lib/store';
export function PracticePage() {
    const app = useApp();
    const [searchParams] = useSearchParams();
    const [tab, setTab] = useState(() => (searchParams.get('tab') === 'rush' ? 'rush' : 'custom'));
    // Custom practice configuration
    const [assessment, setAssessment] = useState(app.settings.assessment);
    const [section, setSection] = useState('all');
    const [domain, setDomain] = useState('all');
    const [difficulty, setDifficulty] = useState('all');
    const [sourceId, setSourceId] = useState('all');
    const [count, setCount] = useState(10);
    const [onlyIncorrect, setOnlyIncorrect] = useState(searchParams.get('mode') === 'incorrect');
    const [onlySaved, setOnlySaved] = useState(searchParams.get('mode') === 'saved');
    const [excludeCorrect, setExcludeCorrect] = useState(app.settings.excludePreviouslyCorrect);
    const [excludeReleased, setExcludeReleased] = useState(app.settings.excludeReleasedPracticeSet);
    const [timedPerQuestion, setTimedPerQuestion] = useState(false);
    // Active Custom Session
    const [sessionId, setSessionId] = useState(null);
    const [sessionQuestions, setSessionQuestions] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [responses, setResponses] = useState({});
    const [eliminated, setEliminated] = useState({});
    const [flagged, setFlagged] = useState({});
    const [feedbackMap, setFeedbackMap] = useState({});
    const [sessionDone, setSessionDone] = useState(false);
    const [showCalc, setShowCalc] = useState(false);
    const [showRef, setShowRef] = useState(false);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const questionStartRef = useRef(Date.now());
    // Practice Rush State
    const [rushDuration, setRushDuration] = useState(180);
    const [rushSection, setRushSection] = useState('all');
    const [rushActive, setRushActive] = useState(false);
    const [rushFinished, setRushFinished] = useState(false);
    const [rushRemaining, setRushRemaining] = useState(180);
    const [rushQuestions, setRushQuestions] = useState([]);
    const [rushIndex, setRushIndex] = useState(0);
    const [rushCorrect, setRushCorrect] = useState(0);
    const [rushAttempted, setRushAttempted] = useState(0);
    const [rushStreak, setRushStreak] = useState(0);
    const [rushBestStreak, setRushBestStreak] = useState(0);
    const [rushInput, setRushInput] = useState('');
    const [rushLastFeedback, setRushLastFeedback] = useState(null);
    const rushSessionIdRef = useRef(newEventId());
    const domains = useMemo(() => {
        const set = new Set();
        app.questions.forEach((q) => {
            if (section === 'all' || q.section === section)
                set.add(q.domain);
        });
        return Array.from(set);
    }, [app.questions, section]);
    const matchingPool = useMemo(() => filterQuestions(app.questions, {
        assessment,
        section,
        domain,
        difficulty,
        sourceId,
        onlyIncorrect,
        onlySaved,
        excludePreviouslyCorrect: excludeCorrect,
        excludeReleasedPracticeSet: excludeReleased,
    }, app.progress, app.saved), [
        app.questions,
        app.progress,
        app.saved,
        assessment,
        section,
        domain,
        difficulty,
        sourceId,
        onlyIncorrect,
        onlySaved,
        excludeCorrect,
        excludeReleased,
    ]);
    // Elapsed timer for active custom session
    useEffect(() => {
        if (!sessionId || sessionDone)
            return;
        const timer = window.setInterval(() => {
            setElapsedSeconds((s) => s + 1);
        }, 1000);
        return () => window.clearInterval(timer);
    }, [sessionId, sessionDone]);
    // Countdown timer for Practice Rush
    useEffect(() => {
        if (!rushActive)
            return;
        const timer = window.setInterval(() => {
            setRushRemaining((prev) => {
                if (prev <= 1) {
                    window.clearInterval(timer);
                    setRushActive(false);
                    setRushFinished(true);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => window.clearInterval(timer);
    }, [rushActive]);
    useEffect(() => {
        if (rushFinished && rushAttempted >= 3) {
            app.actions.completeSession({
                activityType: 'practice_rush',
                sessionId: rushSessionIdRef.current,
                questions: rushAttempted,
                correct: rushCorrect,
                timeSpentSeconds: rushDuration - rushRemaining,
            });
        }
    }, [rushFinished]); // eslint-disable-line react-hooks/exhaustive-deps
    const startCustomSession = () => {
        const chosen = buildPracticeSession(app.questions, {
            assessment,
            section,
            domain,
            difficulty,
            sourceId,
            onlyIncorrect,
            onlySaved,
            excludePreviouslyCorrect: excludeCorrect,
            excludeReleasedPracticeSet: excludeReleased,
        }, {
            count: Math.min(count, Math.max(1, matchingPool.length)),
            progress: app.progress,
            savedIds: app.saved,
            seed: `custom:${Date.now()}`,
        });
        if (chosen.length === 0)
            return;
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
        if (!currentQuestion)
            return;
        const resp = responses[currentQuestion.id] ?? '';
        if (!resp.trim())
            return;
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
        const pool = buildPracticeSession(app.questions, {
            assessment,
            section: rushSection,
            excludeReleasedPracticeSet: excludeReleased,
        }, {
            count: 60,
            progress: app.progress,
            savedIds: app.saved,
            seed: `rush:${Date.now()}`,
        });
        if (pool.length === 0)
            return;
        rushSessionIdRef.current = newEventId();
        setRushQuestions(pool);
        setRushIndex(0);
        setRushCorrect(0);
        setRushAttempted(0);
        setRushStreak(0);
        setRushBestStreak(0);
        setRushInput('');
        setRushLastFeedback(null);
        setRushRemaining(rushDuration);
        setRushFinished(false);
        setRushActive(true);
    };
    const submitRushAnswer = async (value) => {
        const q = rushQuestions[rushIndex % rushQuestions.length];
        if (!q || !rushActive)
            return;
        const isCorrect = checkAnswer(q, value);
        setRushAttempted((n) => n + 1);
        if (isCorrect) {
            setRushCorrect((n) => n + 1);
            setRushStreak((s) => {
                const next = s + 1;
                setRushBestStreak((b) => Math.max(b, next));
                return next;
            });
        }
        else {
            setRushStreak(0);
        }
        setRushLastFeedback({ correct: isCorrect, key: q.correct_answer });
        await app.actions.submitAttempt(q, value, {
            mode: 'rush',
            timeSpentSeconds: 5,
            sessionId: rushSessionIdRef.current,
        });
        setRushInput('');
        if (rushIndex + 1 >= rushQuestions.length) {
            setRushActive(false);
            setRushFinished(true);
        }
        else {
            setRushIndex((i) => i + 1);
        }
    };
    // Deterministic Rule-Based Study Coach Diagnostics
    const studyCoachPlan = useMemo(() => {
        const domainStats = [];
        const byDomain = new Map();
        app.questions.forEach((q) => {
            if (!q.assessments.includes(assessment))
                return;
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
                if (!p || p.attemptCount === 0)
                    unseen += 1;
                else {
                    attempted += 1;
                    if (p.lastIsCorrect)
                        correct += 1;
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
            if (a.attempted === 0 && b.attempted === 0)
                return b.unseen - a.unseen;
            if (a.attempted === 0)
                return 1;
            if (b.attempted === 0)
                return -1;
            return a.accuracy - b.accuracy;
        });
        return weakest;
    }, [app.questions, app.progress, assessment]);
    return (_jsxs("div", { children: [_jsx(Card, { children: _jsxs("div", { className: "row-between", children: [_jsxs("div", { children: [_jsx("h1", { children: "Practice & Skill Drills" }), _jsx("p", { children: "Targeted domain practice, fast-paced Practice Rush, and deterministic diagnostic coaching." })] }), _jsxs("div", { className: "row", children: [_jsx(Button, { variant: tab === 'custom' ? 'primary' : 'outline', size: "sm", onClick: () => setTab('custom'), children: "Custom Practice" }), _jsx(Button, { variant: tab === 'rush' ? 'primary' : 'outline', size: "sm", onClick: () => setTab('rush'), children: "Practice Rush" }), _jsx(Button, { variant: tab === 'assistant' ? 'primary' : 'outline', size: "sm", onClick: () => setTab('assistant'), children: "Study Coach" })] })] }) }), tab === 'custom' && !sessionId ? (_jsxs(Card, { children: [_jsx("h2", { children: "Configure Custom Practice Session" }), _jsx("p", { className: "muted", children: "Filter the question bank by assessment, section, domain, difficulty, source, and personal history." }), _jsxs("div", { className: "card-grid", style: { marginTop: 12 }, children: [_jsx(Select, { label: "Assessment", value: assessment, onChange: (v) => setAssessment(v), options: [
                                    { value: 'SAT', label: 'Digital SAT' },
                                    { value: 'PSAT/NMSQT', label: 'PSAT/NMSQT' },
                                    { value: 'PSAT 10', label: 'PSAT 10' },
                                    { value: 'PSAT 8/9', label: 'PSAT 8/9' },
                                ] }), _jsx(Select, { label: "Section", value: section, onChange: (v) => {
                                    setSection(v);
                                    setDomain('all');
                                }, options: [
                                    { value: 'all', label: 'Both Sections (Mixed)' },
                                    { value: 'Reading and Writing', label: 'Reading and Writing' },
                                    { value: 'Math', label: 'Math' },
                                ] }), _jsx(Select, { label: "Domain", value: domain, onChange: setDomain, options: [
                                    { value: 'all', label: 'All Domains' },
                                    ...domains.map((d) => ({ value: d, label: d })),
                                ] }), _jsx(Select, { label: "Difficulty", value: difficulty, onChange: (v) => setDifficulty(v), options: [
                                    { value: 'all', label: 'All Difficulties' },
                                    { value: 'Easy', label: 'Easy' },
                                    { value: 'Medium', label: 'Medium' },
                                    { value: 'Hard', label: 'Hard' },
                                ] }), _jsx(Select, { label: "Dataset Source", value: sourceId, onChange: setSourceId, options: [
                                    { value: 'all', label: 'All Licensed Sources' },
                                    ...app.sources.map((s) => ({ value: s.source_id, label: s.name })),
                                ] }), _jsx(Select, { label: "Session Length", value: String(count), onChange: (v) => setCount(Number(v)), options: [
                                    { value: '5', label: '5 questions' },
                                    { value: '10', label: '10 questions' },
                                    { value: '15', label: '15 questions' },
                                    { value: '25', label: '25 questions' },
                                ] })] }), _jsxs("div", { className: "grid-2", style: { marginTop: 8 }, children: [_jsxs("div", { children: [_jsx(Toggle, { checked: excludeCorrect, onChange: (val) => {
                                            setExcludeCorrect(val);
                                            app.actions.updateSettings({ excludePreviouslyCorrect: val });
                                        }, label: "Exclude previously correct questions", hint: "Only serve unseen or previously missed items." }), _jsx(Toggle, { checked: excludeReleased, onChange: (val) => {
                                            setExcludeReleased(val);
                                            app.actions.updateSettings({ excludeReleasedPracticeSet: val });
                                        }, label: "Exclude Benchmark Simulation Set items", hint: "Reserve designated full-length practice-set items so simulations stay fresh." })] }), _jsxs("div", { children: [_jsx(Toggle, { checked: onlyIncorrect, onChange: setOnlyIncorrect, label: "Incorrect-only drill", hint: "Focus strictly on questions your last attempt missed." }), _jsx(Toggle, { checked: onlySaved, onChange: setOnlySaved, label: "Saved questions only", hint: "Practice items you bookmarked in the Question Bank." }), _jsx(Toggle, { checked: timedPerQuestion, onChange: setTimedPerQuestion, label: "Track pace with session timer", hint: "Displays elapsed time and awards timed-session bonus HDCoins." })] })] }), _jsxs("div", { className: "row-between", style: { marginTop: 14 }, children: [_jsxs("span", { className: "muted", children: [_jsx("strong", { children: matchingPool.length }), " licensed question", matchingPool.length === 1 ? '' : 's', " match your filters."] }), _jsxs(Button, { onClick: startCustomSession, disabled: matchingPool.length === 0, children: ["Start session (", Math.min(count, matchingPool.length), " items)"] })] })] })) : null, tab === 'custom' && sessionId && !sessionDone && currentQuestion ? (_jsxs("div", { children: [_jsxs("div", { className: "test-bar", children: [_jsxs("div", { children: [_jsxs("strong", { children: ["Custom Practice \u00B7 ", assessment] }), _jsxs("div", { className: "muted", children: ["Item ", currentIndex + 1, " of ", sessionQuestions.length] })] }), _jsxs("div", { className: "row", children: [timedPerQuestion ? _jsx("span", { className: "timer", children: formatClock(elapsedSeconds) }) : null, _jsx(Button, { size: "sm", variant: "subtle", onClick: () => setShowCalc((v) => !v), children: showCalc ? 'Hide Calculator' : 'Calculator' }), _jsx(Button, { size: "sm", variant: "subtle", onClick: () => setShowRef((v) => !v), children: showRef ? 'Hide Reference' : 'Reference Sheet' }), _jsx(Button, { size: "sm", variant: "subtle", onClick: () => app.actions.toggleSaved(currentQuestion.id), children: app.saved.includes(currentQuestion.id) ? 'Saved ★' : 'Save ☆' }), _jsx(Button, { size: "sm", variant: "danger", onClick: finishCustomSession, children: "End session" })] })] }), showCalc ? _jsx(CalculatorPanel, {}) : null, showRef ? _jsx(MathReferenceSheet, {}) : null, _jsxs(Card, { children: [_jsx("div", { className: "navigator", style: { marginBottom: 12 }, children: sessionQuestions.map((q, idx) => {
                                    const fb = feedbackMap[q.id];
                                    const isCurr = idx === currentIndex;
                                    return (_jsx("button", { type: "button", className: `nav-dot${responses[q.id] ? ' is-answered' : ''}${isCurr ? ' is-current' : ''}${flagged[q.id] ? ' is-flagged' : ''}`, onClick: () => {
                                            setCurrentIndex(idx);
                                            questionStartRef.current = Date.now();
                                        }, title: fb ? (fb.isCorrect ? 'Correct' : 'Incorrect') : `Question ${idx + 1}`, children: idx + 1 }, q.id));
                                }) }), _jsx(QuestionView, { question: currentQuestion, index: currentIndex, total: sessionQuestions.length, response: responses[currentQuestion.id] ?? null, onResponseChange: (val) => setResponses((prev) => ({
                                    ...prev,
                                    [currentQuestion.id]: val,
                                })), eliminated: eliminated[currentQuestion.id] ?? [], onToggleEliminate: (choiceId) => setEliminated((prev) => {
                                    const list = prev[currentQuestion.id] ?? [];
                                    const next = list.includes(choiceId) ? list.filter((c) => c !== choiceId) : [...list, choiceId];
                                    return { ...prev, [currentQuestion.id]: next };
                                }), flagged: Boolean(flagged[currentQuestion.id]), onToggleFlag: () => setFlagged((prev) => ({ ...prev, [currentQuestion.id]: !prev[currentQuestion.id] })), feedback: feedbackMap[currentQuestion.id] ?? null, onSubmit: handleSubmitCurrent, disabled: Boolean(feedbackMap[currentQuestion.id]) }), _jsxs("div", { className: "row-between", style: { marginTop: 14 }, children: [_jsx(Button, { variant: "outline", disabled: currentIndex === 0, onClick: () => {
                                            setCurrentIndex((i) => Math.max(0, i - 1));
                                            questionStartRef.current = Date.now();
                                        }, children: "Previous" }), currentIndex + 1 < sessionQuestions.length ? (_jsx(Button, { variant: "primary", onClick: () => {
                                            setCurrentIndex((i) => i + 1);
                                            questionStartRef.current = Date.now();
                                        }, children: "Next question" })) : (_jsx(Button, { variant: "primary", onClick: finishCustomSession, children: "View session summary" }))] })] })] })) : null, tab === 'custom' && sessionId && sessionDone ? (_jsxs(Card, { children: [_jsxs("div", { className: "row-between", children: [_jsxs("div", { children: [_jsx("h2", { children: "Practice Session Complete" }), _jsxs("p", { className: "muted", children: ["Elapsed time: ", formatClock(elapsedSeconds), " \u00B7 Answered ", Object.keys(feedbackMap).length, " of", ' ', sessionQuestions.length, " questions"] })] }), _jsxs("div", { className: "row", children: [_jsx(Button, { onClick: () => setSessionId(null), variant: "outline", children: "Configure new session" }), _jsx(Button, { onClick: startCustomSession, children: "Practice another set" })] })] }), _jsxs("div", { className: "card-grid", style: { marginTop: 12 }, children: [_jsx(Stat, { label: "Correct", value: `${Object.values(feedbackMap).filter((f) => f.isCorrect).length} / ${sessionQuestions.length}` }), _jsx(Stat, { label: "Accuracy", value: Object.keys(feedbackMap).length > 0
                                    ? `${Math.round((Object.values(feedbackMap).filter((f) => f.isCorrect).length /
                                        Object.keys(feedbackMap).length) *
                                        100)}%`
                                    : '0%' }), _jsx(Stat, { label: "Total Time", value: formatClock(elapsedSeconds) })] })] })) : null, tab === 'rush' ? (_jsxs(Card, { children: [_jsxs("div", { className: "row-between", children: [_jsxs("div", { children: [_jsx("h2", { children: "Practice Rush" }), _jsx("p", { className: "muted", children: "High-tempo SAT skill sprint. Answer as many questions accurately as you can before the clock expires." })] }), rushActive ? _jsxs(Badge, { tone: "warn", children: [formatClock(rushRemaining), " remaining"] }) : null] }), !rushActive && !rushFinished ? (_jsxs("div", { style: { marginTop: 12 }, children: [_jsxs("div", { className: "card-grid", children: [_jsx(Select, { label: "Duration", value: String(rushDuration), onChange: (v) => setRushDuration(Number(v)), options: [
                                            { value: '60', label: '1 Minute Blitz (60s)' },
                                            { value: '180', label: '3 Minute Standard (180s)' },
                                            { value: '300', label: '5 Minute Endurance (300s)' },
                                        ] }), _jsx(Select, { label: "Section Focus", value: rushSection, onChange: (v) => setRushSection(v), options: [
                                            { value: 'all', label: 'Mixed (Reading & Writing + Math)' },
                                            { value: 'Reading and Writing', label: 'Reading and Writing Only' },
                                            { value: 'Math', label: 'Math Only' },
                                        ] })] }), _jsx(Button, { onClick: startRush, children: "Launch Practice Rush" })] })) : null, rushActive && rushQuestions[rushIndex % rushQuestions.length] ? (_jsxs("div", { style: { marginTop: 14 }, children: [_jsx("div", { className: "timer-bar", children: _jsx("div", { className: "timer-bar-fill", style: { width: `${Math.max(0, (rushRemaining / rushDuration) * 100)}%` } }) }), _jsxs("div", { className: "row-between", style: { marginBottom: 12 }, children: [_jsxs("div", { className: "row", children: [_jsxs(Badge, { tone: "good", children: [rushCorrect, " correct"] }), _jsxs(Badge, { children: [rushAttempted, " attempted"] }), _jsxs(Badge, { tone: "info", children: ["Streak: ", rushStreak] })] }), _jsx(Button, { size: "sm", variant: "outline", onClick: () => {
                                            setRushActive(false);
                                            setRushFinished(true);
                                        }, children: "End Rush" })] }), rushLastFeedback ? (_jsxs("p", { className: "muted", children: ["Previous item:", ' ', _jsx("strong", { style: { color: rushLastFeedback.correct ? 'var(--good)' : 'var(--bad)' }, children: rushLastFeedback.correct ? 'Correct!' : `Incorrect (Key: ${rushLastFeedback.key})` })] })) : null, (() => {
                                const q = rushQuestions[rushIndex % rushQuestions.length];
                                return (_jsxs("div", { className: "question", children: [_jsxs("div", { className: "row-between", style: { marginBottom: 8 }, children: [_jsx(Badge, { tone: "info", children: q.section }), _jsx(Badge, { children: q.domain })] }), q.stimulus ? (_jsx("div", { className: "stimulus", children: _jsx(MathText, { text: q.stimulus }) })) : null, _jsx("div", { className: "prompt", children: _jsx(MathText, { text: q.prompt }) }), q.format === 'multiple_choice' && q.choices ? (_jsx("div", { children: q.choices.map((c) => (_jsxs("button", { type: "button", className: "rush-option", onClick: () => submitRushAnswer(c.id), children: [_jsxs("strong", { children: [c.id, "."] }), " ", _jsx(MathText, { text: c.text })] }, c.id))) })) : (_jsxs("form", { className: "row", onSubmit: (e) => {
                                                e.preventDefault();
                                                if (rushInput.trim())
                                                    submitRushAnswer(rushInput.trim());
                                            }, children: [_jsx("input", { type: "text", value: rushInput, onChange: (e) => setRushInput(e.target.value), placeholder: "Enter numeric response" }), _jsx(Button, { type: "submit", children: "Submit" })] }))] }));
                            })()] })) : null, rushFinished ? (_jsxs("div", { style: { marginTop: 14 }, children: [_jsx("h3", { children: "Practice Rush Summary" }), _jsxs("div", { className: "card-grid", style: { margin: '12px 0' }, children: [_jsx(Stat, { label: "Score", value: `${rushCorrect} / ${rushAttempted}` }), _jsx(Stat, { label: "Accuracy", value: rushAttempted > 0 ? `${Math.round((rushCorrect / rushAttempted) * 100)}%` : '0%' }), _jsx(Stat, { label: "Best Streak", value: rushBestStreak })] }), _jsxs("div", { className: "row", children: [_jsx(Button, { onClick: startRush, children: "Play Again" }), _jsx(Button, { variant: "outline", onClick: () => setRushFinished(false), children: "Change Rush Settings" })] })] })) : null] })) : null, tab === 'assistant' ? (_jsxs(Card, { children: [_jsx("h2", { children: "Deterministic Study Coach" }), _jsx("p", { className: "muted", children: "Rule-based diagnostic engine that inspects your actual attempt history, domain accuracy, and spaced-repetition queue\u2014without generating synthetic questions or unverified advice." }), studyCoachPlan.length === 0 ? (_jsx(EmptyState, { title: "No domains found", body: "Select an assessment to view domain diagnostics." })) : (_jsx("div", { className: "stack", style: { marginTop: 12 }, children: studyCoachPlan.map((d, idx) => {
                            const statusLabel = d.attempted === 0
                                ? 'Unexplored domain — start with 5 foundational items'
                                : d.accuracy < 0.6
                                    ? 'Priority focus — accuracy below 60% routing threshold'
                                    : d.accuracy < 0.85
                                        ? 'Developing — drill Medium/Hard items to lock in upper-module routing'
                                        : 'Strong mastery — maintain with periodic spaced review';
                            return (_jsxs("div", { className: "muted-block row-between", children: [_jsxs("div", { children: [_jsxs("strong", { children: [idx + 1, ". ", d.domain, " (", d.section, ")"] }), _jsx("div", { className: "muted", children: d.attempted > 0
                                                    ? `${d.correct}/${d.attempted} correct (${Math.round(d.accuracy * 100)}%) · ${d.unseen} unseen`
                                                    : `${d.unseen} unseen items available` }), _jsx("div", { style: { fontSize: '0.84rem', marginTop: 4 }, children: statusLabel })] }), _jsxs(Button, { size: "sm", onClick: () => {
                                            setSection(d.section);
                                            setDomain(d.domain);
                                            setOnlyIncorrect(false);
                                            setOnlySaved(false);
                                            setTab('custom');
                                        }, children: ["Drill ", d.domain] })] }, d.domain));
                        }) }))] })) : null] }));
}
