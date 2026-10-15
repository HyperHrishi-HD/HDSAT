import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, ProgressBar, Select, Stat } from '../components/ui';
import { useApp } from '../lib/store';
const ASSESSMENTS = [
    { value: 'SAT', label: 'Digital SAT' },
    { value: 'PSAT/NMSQT', label: 'PSAT/NMSQT' },
    { value: 'PSAT 10', label: 'PSAT 10' },
    { value: 'PSAT 8/9', label: 'PSAT 8/9' },
];
export function DashboardPage() {
    const app = useApp();
    const domainBreakdown = useMemo(() => {
        const map = new Map();
        app.questions.forEach((q) => {
            if (!q.assessments.includes(app.settings.assessment))
                return;
            const entry = map.get(q.domain) ?? {
                domain: q.domain,
                section: q.section,
                total: 0,
                attempted: 0,
                correct: 0,
            };
            entry.total += 1;
            const prog = app.progress[q.id];
            if (prog && prog.attemptCount > 0) {
                entry.attempted += 1;
                if (prog.lastIsCorrect)
                    entry.correct += 1;
            }
            map.set(q.domain, entry);
        });
        return Array.from(map.values());
    }, [app.questions, app.progress, app.settings.assessment]);
    const incorrectCount = useMemo(() => Object.values(app.progress).filter((p) => p.lastIsCorrect === false).length, [app.progress]);
    const maxDailyQuestions = useMemo(() => Math.max(5, ...app.dailyActivity.map((d) => d.questionsCompleted)), [app.dailyActivity]);
    const todayActivity = app.dailyActivity[app.dailyActivity.length - 1];
    const latestTest = app.testAttempts[0] ?? null;
    return (_jsxs("div", { children: [_jsxs(Card, { children: [_jsxs("div", { className: "row-between", children: [_jsxs("div", { children: [_jsx("h1", { children: "HDSAT Preparation Dashboard" }), _jsxs("p", { children: ["Minimalist, adaptive Digital ", app.settings.assessment, " preparation. Every statistic below reflects your recorded attempts."] })] }), _jsx("div", { style: { minWidth: 210 }, children: _jsx(Select, { label: "Target assessment", value: app.settings.assessment, onChange: (val) => app.actions.updateSettings({ assessment: val }), options: ASSESSMENTS }) })] }), _jsxs("div", { className: "row", style: { marginTop: 8 }, children: [_jsx(Link, { to: "/practice", className: "btn btn-primary", children: "Start custom practice" }), _jsx(Link, { to: "/test", className: "btn btn-outline", children: "Adaptive full simulation" }), _jsxs(Link, { to: "/bank", className: "btn btn-outline", children: ["Browse question bank (", app.questions.length, ")"] }), _jsxs(Link, { to: "/flashcards", className: "btn btn-outline", children: ["Review flashcards (", app.totals.dueCards, " due)"] }), incorrectCount > 0 ? (_jsxs(Link, { to: "/practice?mode=incorrect", className: "btn btn-subtle", children: ["Retry ", incorrectCount, " missed item", incorrectCount === 1 ? '' : 's'] })) : null] })] }), _jsxs("div", { className: "card-grid", style: { marginBottom: 16 }, children: [_jsx(Card, { children: _jsx(Stat, { label: "Questions Answered", value: app.totals.attempts, hint: `${app.totals.uniqueQuestions} of ${app.questions.length} unique bank items` }) }), _jsx(Card, { children: _jsx(Stat, { label: "Overall Accuracy", value: app.totals.attempts > 0 ? `${Math.round(app.totals.accuracy * 100)}%` : '—', hint: app.totals.attempts > 0
                                ? `${app.totals.correct} correct · ${app.totals.mastered} mastered`
                                : 'Complete your first question to compute accuracy' }) }), _jsx(Card, { children: _jsx(Stat, { label: "Study Streak", value: `${app.currentStreak} day${app.currentStreak === 1 ? '' : 's'}`, hint: `Best streak: ${app.bestStreak} day${app.bestStreak === 1 ? '' : 's'}` }) }), _jsx(Card, { children: _jsx(Stat, { label: "HDCoins Balance", value: app.hdCoins, hint: `${todayActivity?.coinsEarned ?? 0} earned today · ${app.achievements.length} achievements` }) })] }), _jsxs("div", { className: "grid-2", children: [_jsxs(Card, { children: [_jsxs("div", { className: "row-between", style: { marginBottom: 8 }, children: [_jsxs("h3", { children: ["Domain Mastery (", app.settings.assessment, ")"] }), _jsxs(Badge, { tone: "info", children: [app.questions.filter((q) => q.assessments.includes(app.settings.assessment)).length, " items"] })] }), _jsx("div", { className: "stack", children: domainBreakdown.map((item) => {
                                    const pct = item.total > 0 ? Math.round((item.correct / item.total) * 100) : 0;
                                    return (_jsxs("div", { className: "stack", style: { gap: 4 }, children: [_jsxs("div", { className: "row-between", style: { fontSize: '0.86rem' }, children: [_jsxs("span", { children: [_jsx("strong", { children: item.domain }), ' ', _jsxs("span", { className: "muted", children: ["(", item.section === 'Math' ? 'Math' : 'R&W', ")"] })] }), _jsxs("span", { className: "muted", children: [item.correct, "/", item.total, " correct (", pct, "%)"] })] }), _jsx(ProgressBar, { value: item.correct, max: item.total })] }, item.domain));
                                }) })] }), _jsxs("div", { className: "stack", children: [_jsxs(Card, { children: [_jsxs("div", { className: "row-between", style: { marginBottom: 10 }, children: [_jsxs("div", { children: [_jsx("h3", { children: "14-Day Activity" }), _jsxs("p", { className: "muted", children: ["Today: ", todayActivity?.questionsCompleted ?? 0, " questions \u00B7", ' ', todayActivity?.flashcardsReviewed ?? 0, " flashcards"] })] }), _jsx(Badge, { tone: (todayActivity?.questionsCompleted ?? 0) >= 3 ? 'good' : 'neutral', children: (todayActivity?.questionsCompleted ?? 0) >= 3 ? 'Daily goal met' : 'Goal: 3+ questions/day' })] }), _jsx("div", { className: "sparkline", "aria-label": "14-day question activity chart", children: app.dailyActivity.map((day) => {
                                            const heightPct = day.questionsCompleted > 0
                                                ? Math.max(12, Math.round((day.questionsCompleted / maxDailyQuestions) * 100))
                                                : 4;
                                            return (_jsx("span", { "data-empty": day.questionsCompleted === 0 ? 'true' : 'false', style: { height: `${heightPct}%` }, title: `${day.date}: ${day.questionsCompleted} questions (${day.correctQuestions} correct)` }, day.date));
                                        }) }), _jsxs("div", { className: "chart-axis", children: [_jsx("span", { children: app.dailyActivity[0]?.date ?? '' }), _jsxs("span", { children: ["Today (", todayActivity?.date ?? '', ")"] })] })] }), _jsxs(Card, { children: [_jsxs("div", { className: "row-between", style: { marginBottom: 8 }, children: [_jsx("h3", { children: "Recent Adaptive Simulations" }), _jsx(Link, { to: "/test", className: "btn btn-outline btn-sm", children: "New simulation" })] }), latestTest ? (_jsx("div", { className: "stack", children: app.testAttempts.slice(0, 3).map((attempt) => (_jsxs("div", { className: "muted-block row-between", children: [_jsxs("div", { children: [_jsx("strong", { children: attempt.assessment }), _jsx("div", { className: "muted", children: attempt.createdAt.slice(0, 10) })] }), _jsxs("div", { className: "row", children: [attempt.totalEstimate ? (_jsxs(Badge, { tone: "info", children: ["Est. ", attempt.totalEstimate] })) : null, _jsxs("span", { className: "muted", children: [attempt.modules.reduce((a, m) => a + m.correct, 0), "/", attempt.modules.reduce((a, m) => a + m.total, 0), " raw"] })] })] }, attempt.id))) })) : (_jsx("p", { className: "muted", children: "No completed simulations yet. Take a timed, multistage adaptive test to see your module routing and estimated score breakdown." }))] }), _jsx(Card, { children: _jsxs("div", { className: "row-between", children: [_jsxs("div", { children: [_jsx("h3", { children: "Saved Questions & Review" }), _jsxs("p", { className: "muted", children: [app.saved.length, " bookmarked item", app.saved.length === 1 ? '' : 's', " \u00B7 ", incorrectCount, " currently missed"] })] }), _jsxs("div", { className: "row", children: [_jsx(Link, { to: "/bank?saved=1", className: "btn btn-outline btn-sm", children: "View saved" }), _jsx(Link, { to: "/arcade", className: "btn btn-outline btn-sm", children: "Desmos Lab & Mini-Games" })] })] }) })] })] })] }));
}
