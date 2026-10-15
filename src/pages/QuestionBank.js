import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QuestionView } from '../components/QuestionView';
import { Badge, Button, Card, EmptyState, Field, Select, Toggle } from '../components/ui';
import { filterQuestions } from '../lib/examEngine';
import { useApp } from '../lib/store';
export function QuestionBankPage() {
    const app = useApp();
    const [searchParams] = useSearchParams();
    const [assessment, setAssessment] = useState('all');
    const [section, setSection] = useState('all');
    const [domain, setDomain] = useState('all');
    const [difficulty, setDifficulty] = useState('all');
    const [sourceId, setSourceId] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [onlySaved, setOnlySaved] = useState(searchParams.get('saved') === '1');
    const [excludeReleased, setExcludeReleased] = useState(app.settings.excludeReleasedPracticeSet);
    const [excludeCorrect, setExcludeCorrect] = useState(false);
    const [selectedQuestionId, setSelectedQuestionId] = useState(null);
    const [responses, setResponses] = useState({});
    const [eliminated, setEliminated] = useState({});
    const [feedbackMap, setFeedbackMap] = useState({});
    const domains = useMemo(() => {
        const s = new Set();
        app.questions.forEach((q) => {
            if (section === 'all' || q.section === section)
                s.add(q.domain);
        });
        return Array.from(s);
    }, [app.questions, section]);
    const filteredQuestions = useMemo(() => {
        const base = filterQuestions(app.questions, {
            assessment: assessment === 'all' ? undefined : assessment,
            section,
            domain,
            difficulty,
            sourceId,
            onlySaved,
            excludePreviouslyCorrect: excludeCorrect,
            excludeReleasedPracticeSet: excludeReleased,
        }, app.progress, app.saved);
        const qLower = search.trim().toLowerCase();
        return base.filter((q) => {
            if (statusFilter !== 'all') {
                const st = app.progress[q.id]?.status ?? 'unseen';
                if (st !== statusFilter)
                    return false;
            }
            if (!qLower)
                return true;
            return (q.id.toLowerCase().includes(qLower) ||
                q.domain.toLowerCase().includes(qLower) ||
                q.skill.toLowerCase().includes(qLower) ||
                q.prompt.toLowerCase().includes(qLower) ||
                (q.stimulus ?? '').toLowerCase().includes(qLower));
        });
    }, [
        app.questions,
        app.progress,
        app.saved,
        assessment,
        section,
        domain,
        difficulty,
        sourceId,
        statusFilter,
        search,
        onlySaved,
        excludeCorrect,
        excludeReleased,
    ]);
    const activeQuestion = useMemo(() => {
        if (!selectedQuestionId)
            return filteredQuestions[0] ?? null;
        return filteredQuestions.find((q) => q.id === selectedQuestionId) ?? filteredQuestions[0] ?? null;
    }, [filteredQuestions, selectedQuestionId]);
    const handleCheck = async (q) => {
        const given = responses[q.id] ?? '';
        if (!given.trim())
            return;
        const res = await app.actions.submitAttempt(q, given, {
            mode: 'review',
            timeSpentSeconds: 15,
        });
        setFeedbackMap((prev) => ({
            ...prev,
            [q.id]: {
                isCorrect: res.isCorrect,
                correctAnswer: q.correct_answer,
                explanation: q.explanation,
                distractorRationales: q.distractor_rationales,
            },
        }));
    };
    return (_jsxs("div", { children: [_jsxs(Card, { children: [_jsxs("div", { className: "row-between", children: [_jsxs("div", { children: [_jsx("h1", { children: "Question Bank" }), _jsx("p", { className: "muted", children: app.licensingNote })] }), _jsxs(Badge, { tone: "info", children: ["Showing ", filteredQuestions.length, " of ", app.questions.length, " items"] })] }), _jsxs("div", { className: "card-grid", style: { marginTop: 12 }, children: [_jsx(Field, { label: "Search ID, skill, or text", children: _jsx("input", { type: "text", value: search, onChange: (e) => setSearch(e.target.value), placeholder: "e.g. RW-INF-001, quadratic, inference..." }) }), _jsx(Select, { label: "Assessment", value: assessment, onChange: setAssessment, options: [
                                    { value: 'all', label: 'All Assessments' },
                                    { value: 'SAT', label: 'Digital SAT' },
                                    { value: 'PSAT/NMSQT', label: 'PSAT/NMSQT' },
                                    { value: 'PSAT 10', label: 'PSAT 10' },
                                    { value: 'PSAT 8/9', label: 'PSAT 8/9' },
                                ] }), _jsx(Select, { label: "Section", value: section, onChange: (v) => {
                                    setSection(v);
                                    setDomain('all');
                                }, options: [
                                    { value: 'all', label: 'All Sections' },
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
                                ] }), _jsx(Select, { label: "Mastery Status", value: statusFilter, onChange: setStatusFilter, options: [
                                    { value: 'all', label: 'Any Status' },
                                    { value: 'unseen', label: 'Unseen' },
                                    { value: 'incorrect', label: 'Incorrect' },
                                    { value: 'correct', label: 'Correct' },
                                    { value: 'mastered', label: 'Mastered (2+ in a row)' },
                                ] }), _jsx(Select, { label: "Dataset Source", value: sourceId, onChange: setSourceId, options: [
                                    { value: 'all', label: 'All Sources' },
                                    ...app.sources.map((s) => ({ value: s.source_id, label: `${s.name} (${s.record_count})` })),
                                ] })] }), _jsxs("div", { className: "row", style: { gap: 20 }, children: [_jsx(Toggle, { checked: onlySaved, onChange: setOnlySaved, label: "Saved only" }), _jsx(Toggle, { checked: excludeCorrect, onChange: setExcludeCorrect, label: "Hide previously correct" }), _jsx(Toggle, { checked: excludeReleased, onChange: setExcludeReleased, label: "Exclude Benchmark Simulation Set" })] })] }), filteredQuestions.length === 0 ? (_jsx(Card, { children: _jsx(EmptyState, { title: "No matching questions", body: "Adjust your search query or filters to view items in the HDSAT Question Bank.", action: _jsx(Button, { variant: "outline", onClick: () => {
                            setAssessment('all');
                            setSection('all');
                            setDomain('all');
                            setDifficulty('all');
                            setSourceId('all');
                            setStatusFilter('all');
                            setSearch('');
                            setOnlySaved(false);
                            setExcludeCorrect(false);
                            setExcludeReleased(false);
                        }, children: "Reset all filters" }) }) })) : (_jsxs("div", { className: "grid-2", children: [_jsxs(Card, { children: [_jsxs("h3", { children: ["Catalog (", filteredQuestions.length, ")"] }), _jsx("div", { style: { maxHeight: 580, overflowY: 'auto', marginTop: 8 }, children: _jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "ID" }), _jsx("th", { children: "Domain / Skill" }), _jsx("th", { children: "Diff" }), _jsx("th", { children: "Status" })] }) }), _jsx("tbody", { children: filteredQuestions.map((q) => {
                                                const st = app.progress[q.id]?.status ?? 'unseen';
                                                const isSaved = app.saved.includes(q.id);
                                                const isSelected = activeQuestion?.id === q.id;
                                                return (_jsxs("tr", { style: {
                                                        cursor: 'pointer',
                                                        background: isSelected ? 'var(--surface-2)' : undefined,
                                                    }, onClick: () => setSelectedQuestionId(q.id), children: [_jsxs("td", { className: "mono", children: [_jsx("strong", { children: q.id }), " ", isSaved ? '★' : ''] }), _jsxs("td", { children: [_jsx("div", { children: q.domain }), _jsx("div", { className: "muted", children: q.skill })] }), _jsx("td", { children: _jsx(Badge, { tone: q.difficulty === 'Hard' ? 'bad' : q.difficulty === 'Medium' ? 'warn' : 'good', children: q.difficulty }) }), _jsx("td", { children: _jsx(Badge, { tone: st === 'mastered' || st === 'correct'
                                                                    ? 'good'
                                                                    : st === 'incorrect'
                                                                        ? 'bad'
                                                                        : 'neutral', children: st }) })] }, q.id));
                                            }) })] }) })] }), _jsx("div", { children: activeQuestion ? (_jsxs("div", { children: [_jsxs("div", { className: "row-between", style: { marginBottom: 8 }, children: [_jsxs("div", { className: "row", children: [_jsx("strong", { className: "mono", children: activeQuestion.id }), _jsx(Badge, { children: activeQuestion.assessments.join(', ') })] }), _jsxs("div", { className: "row", children: [_jsx(Button, { size: "sm", variant: "outline", onClick: () => app.actions.toggleSaved(activeQuestion.id), children: app.saved.includes(activeQuestion.id) ? 'Saved ★' : 'Bookmark ☆' }), feedbackMap[activeQuestion.id] ? (_jsx(Button, { size: "sm", variant: "ghost", onClick: () => {
                                                        setFeedbackMap((prev) => {
                                                            const copy = { ...prev };
                                                            delete copy[activeQuestion.id];
                                                            return copy;
                                                        });
                                                        setResponses((prev) => ({ ...prev, [activeQuestion.id]: '' }));
                                                    }, children: "Retry item" })) : null] })] }), _jsx(QuestionView, { question: activeQuestion, index: filteredQuestions.findIndex((q) => q.id === activeQuestion.id), total: filteredQuestions.length, response: responses[activeQuestion.id] ?? null, onResponseChange: (val) => setResponses((prev) => ({
                                        ...prev,
                                        [activeQuestion.id]: val,
                                    })), eliminated: eliminated[activeQuestion.id] ?? [], onToggleEliminate: (choiceId) => setEliminated((prev) => {
                                        const list = prev[activeQuestion.id] ?? [];
                                        const next = list.includes(choiceId)
                                            ? list.filter((c) => c !== choiceId)
                                            : [...list, choiceId];
                                        return { ...prev, [activeQuestion.id]: next };
                                    }), feedback: feedbackMap[activeQuestion.id] ?? null, onSubmit: () => handleCheck(activeQuestion), disabled: Boolean(feedbackMap[activeQuestion.id]) })] })) : null })] })), _jsxs(Card, { children: [_jsx("h3", { children: "Dataset Provenance & Licensing Registry" }), _jsx("div", { className: "grid-2", style: { marginTop: 8 }, children: app.sources.map((src) => (_jsxs("div", { className: "muted-block", children: [_jsxs("div", { className: "row-between", children: [_jsx("strong", { children: src.name }), _jsx(Badge, { tone: "info", children: src.license })] }), _jsx("p", { className: "muted", style: { marginTop: 6 }, children: src.provenance_summary }), _jsxs("div", { className: "muted", children: ["Source ID: ", _jsx("code", { children: src.source_id }), " \u00B7 ", src.record_count, " verified items \u00B7", ' ', src.is_official_college_board ? 'Official' : 'Independent Open-Licensed Bank'] })] }, src.source_id))) })] })] }));
}
