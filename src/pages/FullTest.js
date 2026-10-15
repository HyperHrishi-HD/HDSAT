import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { CalculatorPanel, MathReferenceSheet } from '../components/MathTools';
import { QuestionView } from '../components/QuestionView';
import { Alert, Badge, Button, Card, Select, Stat, Toggle } from '../components/ui';
import { buildTestPlan, formatClock, routeModule, summarizeTest, } from '../lib/examEngine';
import { checkAnswer } from '../lib/grading';
import { newEventId } from '../lib/storage';
import { useApp } from '../lib/store';
export function FullTestPage() {
    const app = useApp();
    const [assessment, setAssessment] = useState(app.settings.assessment);
    const [excludeReleased, setExcludeReleased] = useState(false);
    const [itemCap, setItemCap] = useState(8);
    const [testPlan, setTestPlan] = useState(null);
    const [activeStage, setActiveStage] = useState(null);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [responses, setResponses] = useState({});
    const [eliminated, setEliminated] = useState({});
    const [flagged, setFlagged] = useState({});
    const [remainingSeconds, setRemainingSeconds] = useState(0);
    const [completedModules, setCompletedModules] = useState([]);
    const [finishedAttempt, setFinishedAttempt] = useState(null);
    const [reviewQuestionId, setReviewQuestionId] = useState(null);
    const [showCalc, setShowCalc] = useState(false);
    const [showRef, setShowRef] = useState(false);
    const [hideClock, setHideClock] = useState(false);
    const sessionStartRef = useRef(Date.now());
    const clientSessionIdRef = useRef(newEventId());
    const previewPlan = useMemo(() => buildTestPlan(app.questions, {
        assessment,
        excludeReleasedPracticeSet: excludeReleased,
        itemCap,
        seed: 'preview',
    }), [app.questions, assessment, excludeReleased, itemCap]);
    useEffect(() => {
        if (!activeStage)
            return;
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
        if (!firstMod || firstMod.questions.length === 0)
            return;
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
        if (!activeStage || !testPlan)
            return;
        const mod = activeStage.plan;
        const moduleResponses = [];
        let correctCount = 0;
        for (const q of mod.questions) {
            const given = responses[q.id] ?? null;
            const isCorrect = checkAnswer(q, given);
            if (isCorrect)
                correctCount += 1;
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
        const modResult = {
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
        const attempt = {
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
    return (_jsxs("div", { children: [!activeStage && !finishedAttempt ? (_jsxs(Card, { children: [_jsx("h1", { children: "Multistage Adaptive Practice Test" }), _jsxs("p", { children: ["Simulates the two-stage Digital ", assessment, " structure: Reading and Writing (Module 1 \u2192 adaptively routed Module 2) followed by Math (Module 1 \u2192 adaptively routed Module 2)."] }), _jsxs("div", { className: "card-grid", style: { marginTop: 14 }, children: [_jsx(Select, { label: "Assessment", value: assessment, onChange: (v) => setAssessment(v), options: [
                                    { value: 'SAT', label: 'Digital SAT' },
                                    { value: 'PSAT/NMSQT', label: 'PSAT/NMSQT' },
                                    { value: 'PSAT 10', label: 'PSAT 10' },
                                    { value: 'PSAT 8/9', label: 'PSAT 8/9' },
                                ] }), _jsx(Select, { label: "Target Items per Module", value: String(itemCap), onChange: (v) => setItemCap(Number(v)), options: [
                                    { value: '6', label: '6 items per module (Compact Adaptive)' },
                                    { value: '8', label: '8 items per module (Balanced Adaptive)' },
                                    { value: '27', label: 'Full Blueprint Target (scales to available bank)' },
                                ] })] }), _jsx(Toggle, { checked: excludeReleased, onChange: setExcludeReleased, label: "Exclude Benchmark Simulation Set items", hint: "Leave unchecked to include HDSAT Benchmark Form A items in this full simulation." }), previewPlan.warnings.length > 0 ? (_jsx("div", { style: { margin: '12px 0' }, children: _jsx(Alert, { tone: "info", children: _jsxs("div", { children: [_jsx("strong", { children: "Dataset Coverage & Scaling Notice:" }), _jsx("ul", { style: { margin: '6px 0 0', paddingLeft: 18 }, children: previewPlan.warnings.map((w, i) => (_jsx("li", { children: w }, i))) })] }) }) })) : null, _jsx("div", { className: "grid-2", style: { marginTop: 12 }, children: previewPlan.sections.map((sec) => (_jsxs("div", { className: "muted-block", children: [_jsx("strong", { children: sec.section }), _jsxs("div", { className: "muted", style: { marginTop: 4 }, children: ["Module 1 (Baseline): ", sec.module1.questions.length, " items \u00B7 ", sec.module1.minutes, " min"] }), _jsxs("div", { className: "muted", children: ["Module 2 (Adaptive Upper / Lower): ", sec.upper.questions.length, " / ", sec.lower.questions.length, " items \u00B7", ' ', sec.upper.minutes, " min"] })] }, sec.section))) }), _jsxs("div", { className: "row-between", style: { marginTop: 16 }, children: [_jsx("span", { className: "muted", children: "Routing threshold: \u226560% accuracy in Module 1 routes to the Higher-Difficulty Module 2." }), _jsx(Button, { onClick: startFullSimulation, children: "Begin Adaptive Simulation" })] })] })) : null, activeStage && currentQuestion ? (_jsxs("div", { children: [_jsxs("div", { className: "test-bar", children: [_jsxs("div", { children: [_jsxs("strong", { children: [activeStage.plan.section, " \u00B7", ' ', activeStage.stageNumber === 1
                                                ? 'Module 1 (Routing Baseline)'
                                                : `Module 2 (${activeStage.plan.tier === 'upper' ? 'Higher-Difficulty Tier' : 'Lower-Difficulty Tier'})`] }), _jsxs("div", { className: "muted", children: ["Question ", currentIndex + 1, " of ", activeStage.plan.questions.length] })] }), _jsxs("div", { className: "row", children: [!hideClock ? (_jsx("span", { className: `timer${remainingSeconds < 120 ? ' is-low' : ''}`, children: formatClock(remainingSeconds) })) : (_jsx("span", { className: "muted", children: "Timer hidden" })), _jsx(Button, { size: "sm", variant: "subtle", onClick: () => setHideClock((v) => !v), children: hideClock ? 'Show clock' : 'Hide clock' }), _jsx(Button, { size: "sm", variant: "subtle", onClick: () => setShowCalc((v) => !v), children: showCalc ? 'Hide Calculator' : 'Calculator' }), _jsx(Button, { size: "sm", variant: "subtle", onClick: () => setShowRef((v) => !v), children: showRef ? 'Hide Reference' : 'Reference' }), _jsx(Button, { size: "sm", variant: "primary", onClick: () => submitCurrentModule(false), children: "Submit Module" })] })] }), showCalc ? _jsx(CalculatorPanel, {}) : null, showRef ? _jsx(MathReferenceSheet, {}) : null, _jsxs(Card, { children: [_jsx("div", { className: "navigator", style: { marginBottom: 14 }, children: activeStage.plan.questions.map((q, idx) => (_jsx("button", { type: "button", className: `nav-dot${responses[q.id] ? ' is-answered' : ''}${idx === currentIndex ? ' is-current' : ''}${flagged[q.id] ? ' is-flagged' : ''}`, onClick: () => setCurrentIndex(idx), children: idx + 1 }, q.id))) }), _jsx(QuestionView, { question: currentQuestion, index: currentIndex, total: activeStage.plan.questions.length, response: responses[currentQuestion.id] ?? null, onResponseChange: (val) => setResponses((prev) => ({
                                    ...prev,
                                    [currentQuestion.id]: val,
                                })), eliminated: eliminated[currentQuestion.id] ?? [], onToggleEliminate: (choiceId) => setEliminated((prev) => {
                                    const list = prev[currentQuestion.id] ?? [];
                                    const next = list.includes(choiceId) ? list.filter((c) => c !== choiceId) : [...list, choiceId];
                                    return { ...prev, [currentQuestion.id]: next };
                                }), flagged: Boolean(flagged[currentQuestion.id]), onToggleFlag: () => setFlagged((prev) => ({
                                    ...prev,
                                    [currentQuestion.id]: !prev[currentQuestion.id],
                                })), showMeta: false }), _jsxs("div", { className: "row-between", style: { marginTop: 14 }, children: [_jsx(Button, { variant: "outline", disabled: currentIndex === 0, onClick: () => setCurrentIndex((i) => Math.max(0, i - 1)), children: "Previous" }), currentIndex + 1 < activeStage.plan.questions.length ? (_jsx(Button, { variant: "primary", onClick: () => setCurrentIndex((i) => i + 1), children: "Next" })) : (_jsx(Button, { variant: "primary", onClick: () => submitCurrentModule(false), children: "Finish & Submit Module" }))] })] })] })) : null, finishedAttempt ? (_jsxs("div", { children: [_jsxs(Card, { children: [_jsxs("div", { className: "row-between", children: [_jsxs("div", { children: [_jsxs("h1", { children: ["Adaptive Simulation Report (", finishedAttempt.assessment, ")"] }), _jsx("p", { className: "muted", children: "Estimated practice score range based on raw module accuracy and adaptive Stage-2 tier routing. Not an official College Board scaled score." })] }), _jsx(Button, { onClick: () => setFinishedAttempt(null), children: "Start New Simulation" })] }), _jsxs("div", { className: "card-grid", style: { marginTop: 12 }, children: [_jsx(Stat, { label: "Estimated Total (400\u20131600)", value: finishedAttempt.totalEstimate ?? '—', hint: "Practice estimate" }), _jsx(Stat, { label: "Reading & Writing (200\u2013800)", value: finishedAttempt.rwEstimate ?? '—' }), _jsx(Stat, { label: "Math (200\u2013800)", value: finishedAttempt.mathEstimate ?? '—' }), _jsx(Stat, { label: "Total Time", value: formatClock(finishedAttempt.durationSeconds) })] }), _jsx("h3", { style: { marginTop: 16 }, children: "Module Routing & Breakdown" }), _jsx("div", { className: "grid-2", style: { marginTop: 8 }, children: finishedAttempt.modules.map((m) => (_jsxs("div", { className: "muted-block", children: [_jsxs("div", { className: "row-between", children: [_jsx("strong", { children: m.section }), _jsx(Badge, { tone: m.tier === 'upper' ? 'good' : m.tier === 'lower' ? 'warn' : 'info', children: m.tier === 'module1'
                                                        ? 'Module 1 (Baseline)'
                                                        : m.tier === 'upper'
                                                            ? 'Module 2 (Routed Upper)'
                                                            : 'Module 2 (Routed Lower)' })] }), _jsxs("p", { style: { marginTop: 6 }, children: ["Score: ", _jsx("strong", { children: m.correct }), " / ", m.total, " (", m.total > 0 ? Math.round((m.correct / m.total) * 100) : 0, "%)"] }), _jsx("div", { className: "row", style: { marginTop: 8 }, children: m.responses.map((r, idx) => (_jsx("button", { type: "button", className: `nav-dot ${r.isCorrect ? 'is-answered' : 'is-flagged'}`, onClick: () => setReviewQuestionId(r.questionId), title: `Review ${r.questionId}`, children: idx + 1 }, r.questionId))) })] }, m.moduleId))) })] }), reviewQuestionId ? ((() => {
                        const q = app.questions.find((item) => item.id === reviewQuestionId);
                        if (!q)
                            return null;
                        const given = responses[q.id] ?? null;
                        const isCorrect = checkAnswer(q, given);
                        return (_jsxs(Card, { children: [_jsxs("div", { className: "row-between", style: { marginBottom: 10 }, children: [_jsxs("h3", { children: ["Item Review \u00B7 ", q.id] }), _jsx(Button, { size: "sm", variant: "outline", onClick: () => setReviewQuestionId(null), children: "Close review" })] }), _jsx(QuestionView, { question: q, index: 0, total: 1, response: given, onResponseChange: () => { }, disabled: true, feedback: {
                                        isCorrect,
                                        correctAnswer: q.correct_answer,
                                        explanation: q.explanation,
                                        distractorRationales: q.distractor_rationales,
                                    } })] }));
                    })()) : null] })) : null] }));
}
