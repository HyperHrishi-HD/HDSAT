import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { CalculatorPanel } from '../components/MathTools';
import { MathText } from '../components/MathText';
import { Badge, Button, Card, Stat } from '../components/ui';
import { newEventId } from '../lib/storage';
import { useApp } from '../lib/store';
const DESMOS_LAB_LESSONS = [
    {
        id: 'DL-1',
        title: 'Lesson 1: Solving a Nonlinear System by Intersection',
        topic: 'Systems of Equations',
        f1: 'x^2 - 4x + 3',
        f2: '2x - 2',
        prompt: 'Plot $f(x) = x^2 - 4x + 3$ and $g(x) = 2x - 2$ in the graphing calculator below. What is the larger $x$-coordinate where the two graphs intersect?',
        expectedAnswer: '5',
        hint: 'Set x^2 - 4x + 3 = 2x - 2, or inspect x = 1 and x = 5 on the calculator probe.',
        explanation: 'At $x = 5$, $f(5) = 25 - 20 + 3 = 8$ and $g(5) = 10 - 2 = 8$. The two intersections are $(1, 0)$ and $(5, 8)$, so the larger $x$-coordinate is $5$.',
    },
    {
        id: 'DL-2',
        title: 'Lesson 2: Finding the Maximum of a Quadratic Trajectory',
        topic: 'Quadratic Vertex',
        f1: '-2x^2 + 12x - 10',
        f2: '8',
        prompt: 'For the parabola $f(x) = -2x^2 + 12x - 10$, use the graph or vertex probe to find the maximum value of $f(x)$.',
        expectedAnswer: '8',
        hint: 'The vertex occurs at x = -b/(2a) = -12 / (2 * -2) = 3. Inspect f(3).',
        explanation: 'The axis of symmetry is $x = 3$. Evaluating $f(3) = -2(9) + 12(3) - 10 = -18 + 36 - 10 = 8$.',
    },
    {
        id: 'DL-3',
        title: 'Lesson 3: Counting Real Solutions via Tangency',
        topic: 'Discriminant & Tangency',
        f1: 'x^2 - 6x + 9',
        f2: '0',
        prompt: 'Inspect the graph of $f(x) = x^2 - 6x + 9$. At what $x$-value does the parabola touch the $x$-axis ($y = 0$)?',
        expectedAnswer: '3',
        hint: 'Factor (x - 3)^2 = 0 or inspect x = 3 in the calculator.',
        explanation: 'Because $x^2 - 6x + 9 = (x - 3)^2$, the vertex $(3, 0)$ lies directly on the $x$-axis.',
    },
];
const EQUATION_SPRINT_ITEMS = [
    { id: 'ES-1', prompt: 'Solve for $x$: $4x - 7 = 21$', answer: '7', options: ['5', '6', '7', '8'] },
    { id: 'ES-2', prompt: 'If $3(x + 2) = 27$, what is $x$?', answer: '7', options: ['6', '7', '8', '9'] },
    { id: 'ES-3', prompt: 'Positive root of $x^2 - 9 = 0$:', answer: '3', options: ['0', '3', '6', '9'] },
    { id: 'ES-4', prompt: 'Slope of the line $6x - 2y = 10$:', answer: '3', options: ['-3', '2', '3', '5'] },
    { id: 'ES-5', prompt: 'If $2^x = 32$, what is $x$?', answer: '5', options: ['4', '5', '6', '16'] },
    { id: 'ES-6', prompt: 'Vertex $x$-coordinate of $y = x^2 - 8x + 15$:', answer: '4', options: ['2', '4', '8', '15'] },
];
const TRANSITION_MATCH_ITEMS = [
    {
        id: 'TM-1',
        sentence: 'High-altitude observatories enjoy low atmospheric water vapor; _____, their remote mountain peaks complicate equipment transport.',
        answer: 'however',
        options: ['however', 'for example', 'consequently', 'similarly'],
    },
    {
        id: 'TM-2',
        sentence: 'Urban street trees shade asphalt surfaces during heat waves; _____, neighborhoods with dense canopy cover record lower afternoon air temperatures.',
        answer: 'consequently',
        options: ['consequently', 'nevertheless', 'meanwhile', 'alternatively'],
    },
    {
        id: 'TM-3',
        sentence: 'Several archival inventories listed the 1894 score as lost; _____, musicologists recently located a complete autographed copy in Vienna.',
        answer: 'nevertheless',
        options: ['nevertheless', 'therefore', 'furthermore', 'specifically'],
    },
    {
        id: 'TM-4',
        sentence: 'Bivalve mollusks filter suspended particles from estuarine water; oysters in Chesapeake Bay, _____, can clarify puluhan liters per day.',
        answer: 'for instance',
        options: ['for instance', 'by contrast', 'subsequently', 'instead'],
    },
];
export function ArcadePage() {
    const app = useApp();
    const [mode, setMode] = useState('desmos');
    // Desmos Lab state
    const [lessonIdx, setLessonIdx] = useState(0);
    const [labAnswer, setLabAnswer] = useState('');
    const [labFeedback, setLabFeedback] = useState(null);
    // Mini-game state
    const [gameIndex, setGameIndex] = useState(0);
    const [gameScore, setGameScore] = useState(0);
    const [gameDone, setGameDone] = useState(false);
    const [gameNote, setGameNote] = useState(null);
    const activeLesson = DESMOS_LAB_LESSONS[lessonIdx];
    const handleCheckLab = () => {
        const clean = labAnswer.trim();
        const ok = clean === activeLesson.expectedAnswer;
        setLabFeedback({
            ok,
            text: ok ? `Correct! ${activeLesson.explanation}` : `Hint: ${activeLesson.hint}`,
        });
    };
    const resetMiniGame = (nextMode) => {
        setMode(nextMode);
        setGameIndex(0);
        setGameScore(0);
        setGameDone(false);
        setGameNote(null);
    };
    const handleSprintPick = async (choice) => {
        const item = EQUATION_SPRINT_ITEMS[gameIndex];
        const isCorrect = choice === item.answer;
        const nextScore = gameScore + (isCorrect ? 1 : 0);
        setGameScore(nextScore);
        setGameNote(isCorrect ? 'Correct!' : `Answer was ${item.answer}`);
        if (gameIndex + 1 >= EQUATION_SPRINT_ITEMS.length) {
            setGameDone(true);
            await app.actions.completeSession({
                activityType: 'mini_game',
                sessionId: newEventId(),
                questions: EQUATION_SPRINT_ITEMS.length,
                correct: nextScore,
                timeSpentSeconds: 30,
            });
        }
        else {
            setGameIndex((i) => i + 1);
        }
    };
    const handleTransitionPick = async (choice) => {
        const item = TRANSITION_MATCH_ITEMS[gameIndex];
        const isCorrect = choice === item.answer;
        const nextScore = gameScore + (isCorrect ? 1 : 0);
        setGameScore(nextScore);
        setGameNote(isCorrect ? 'Correct logical transition!' : `Expected "${item.answer}"`);
        if (gameIndex + 1 >= TRANSITION_MATCH_ITEMS.length) {
            setGameDone(true);
            await app.actions.completeSession({
                activityType: 'mini_game',
                sessionId: newEventId(),
                questions: TRANSITION_MATCH_ITEMS.length,
                correct: nextScore,
                timeSpentSeconds: 30,
            });
        }
        else {
            setGameIndex((i) => i + 1);
        }
    };
    const vocabItems = app.flashcards.filter((c) => c.deck === 'vocabulary').slice(0, 6);
    const handleVocabPick = async (pickedBack) => {
        const card = vocabItems[gameIndex];
        const isCorrect = pickedBack === card.back;
        const nextScore = gameScore + (isCorrect ? 1 : 0);
        setGameScore(nextScore);
        setGameNote(isCorrect ? 'Matched!' : `Definition: ${card.back}`);
        if (gameIndex + 1 >= vocabItems.length) {
            setGameDone(true);
            await app.actions.completeSession({
                activityType: 'mini_game',
                sessionId: newEventId(),
                questions: vocabItems.length,
                correct: nextScore,
                timeSpentSeconds: 30,
            });
        }
        else {
            setGameIndex((i) => i + 1);
        }
    };
    return (_jsxs("div", { children: [_jsx(Card, { children: _jsxs("div", { className: "row-between", children: [_jsxs("div", { children: [_jsx("h1", { children: "Desmos Lab & SAT Skill Mini-Games" }), _jsx("p", { className: "muted", children: "Interactive graphing calculator lessons and focused SAT skill games that reinforce algebraic fluency, rhetorical transitions, and vocabulary in context." })] }), _jsxs("div", { className: "row", children: [_jsx(Button, { variant: mode === 'desmos' ? 'primary' : 'outline', size: "sm", onClick: () => resetMiniGame('desmos'), children: "Desmos Lab" }), _jsx(Button, { variant: mode === 'sprint' ? 'primary' : 'outline', size: "sm", onClick: () => resetMiniGame('sprint'), children: "Equation Sprint" }), _jsx(Button, { variant: mode === 'transitions' ? 'primary' : 'outline', size: "sm", onClick: () => resetMiniGame('transitions'), children: "Transition Match" }), _jsx(Button, { variant: mode === 'vocab' ? 'primary' : 'outline', size: "sm", onClick: () => resetMiniGame('vocab'), children: "Vocab Precision" })] })] }) }), mode === 'desmos' ? (_jsxs("div", { children: [_jsxs(Card, { children: [_jsxs("div", { className: "row-between", style: { marginBottom: 10 }, children: [_jsxs("div", { children: [_jsx(Badge, { tone: "info", children: activeLesson.topic }), _jsx("h2", { style: { marginTop: 6 }, children: activeLesson.title })] }), _jsx("div", { className: "row", children: DESMOS_LAB_LESSONS.map((l, idx) => (_jsxs(Button, { size: "sm", variant: idx === lessonIdx ? 'primary' : 'outline', onClick: () => {
                                                setLessonIdx(idx);
                                                setLabAnswer('');
                                                setLabFeedback(null);
                                            }, children: ["Lesson ", idx + 1] }, l.id))) })] }), _jsx("p", { children: _jsx(MathText, { text: activeLesson.prompt }) }), _jsxs("div", { className: "row", style: { marginTop: 12 }, children: [_jsx("input", { type: "text", value: labAnswer, onChange: (e) => setLabAnswer(e.target.value), placeholder: "Enter numeric value" }), _jsx(Button, { onClick: handleCheckLab, children: "Verify Result" })] }), labFeedback ? (_jsx("div", { className: `feedback ${labFeedback.ok ? 'is-correct' : 'is-incorrect'}`, style: { marginTop: 12 }, children: _jsx(MathText, { text: labFeedback.text }) })) : null] }), _jsx(CalculatorPanel, { defaultFunctions: [activeLesson.f1, activeLesson.f2] }, activeLesson.id)] })) : null, mode === 'sprint' ? (_jsxs(Card, { children: [_jsxs("div", { className: "row-between", children: [_jsx("h2", { children: "Equation Sprint" }), _jsxs(Badge, { tone: "info", children: ["Score: ", gameScore, " / ", EQUATION_SPRINT_ITEMS.length] })] }), gameNote ? _jsx("p", { className: "muted", children: gameNote }) : null, !gameDone ? (_jsxs("div", { style: { marginTop: 14 }, children: [_jsx("div", { className: "prompt", children: _jsx(MathText, { text: EQUATION_SPRINT_ITEMS[gameIndex].prompt }) }), _jsx("div", { className: "card-grid", style: { marginTop: 12 }, children: EQUATION_SPRINT_ITEMS[gameIndex].options.map((opt) => (_jsx("button", { type: "button", className: "rush-option", onClick: () => handleSprintPick(opt), children: _jsx(MathText, { text: `$${opt}$` }) }, opt))) })] })) : (_jsxs("div", { style: { marginTop: 14 }, children: [_jsx(Stat, { label: "Final Sprint Score", value: `${gameScore} / ${EQUATION_SPRINT_ITEMS.length}` }), _jsx("div", { style: { marginTop: 12 }, children: _jsx(Button, { onClick: () => resetMiniGame('sprint'), children: "Play Again" }) })] }))] })) : null, mode === 'transitions' ? (_jsxs(Card, { children: [_jsxs("div", { className: "row-between", children: [_jsx("h2", { children: "Rhetorical Transition Match" }), _jsxs(Badge, { tone: "info", children: ["Score: ", gameScore, " / ", TRANSITION_MATCH_ITEMS.length] })] }), gameNote ? _jsx("p", { className: "muted", children: gameNote }) : null, !gameDone ? (_jsxs("div", { style: { marginTop: 14 }, children: [_jsx("div", { className: "stimulus", children: TRANSITION_MATCH_ITEMS[gameIndex].sentence }), _jsx("div", { className: "card-grid", children: TRANSITION_MATCH_ITEMS[gameIndex].options.map((opt) => (_jsx("button", { type: "button", className: "rush-option", onClick: () => handleTransitionPick(opt), children: _jsx("strong", { children: opt }) }, opt))) })] })) : (_jsxs("div", { style: { marginTop: 14 }, children: [_jsx(Stat, { label: "Final Transition Score", value: `${gameScore} / ${TRANSITION_MATCH_ITEMS.length}` }), _jsx("div", { style: { marginTop: 12 }, children: _jsx(Button, { onClick: () => resetMiniGame('transitions'), children: "Play Again" }) })] }))] })) : null, mode === 'vocab' ? (_jsxs(Card, { children: [_jsxs("div", { className: "row-between", children: [_jsx("h2", { children: "Vocabulary Precision Match" }), _jsxs(Badge, { tone: "info", children: ["Score: ", gameScore, " / ", vocabItems.length] })] }), gameNote ? _jsx("p", { className: "muted", children: gameNote }) : null, !gameDone && vocabItems[gameIndex] ? (_jsxs("div", { style: { marginTop: 14 }, children: [_jsxs("div", { className: "prompt", children: ["Select the precise definition for: ", vocabItems[gameIndex].front] }), _jsx("div", { className: "stack", style: { marginTop: 10 }, children: vocabItems.slice(0, 4).map((choiceCard) => (_jsx("button", { type: "button", className: "rush-option", onClick: () => handleVocabPick(choiceCard.back), children: choiceCard.back }, choiceCard.id))) })] })) : (_jsxs("div", { style: { marginTop: 14 }, children: [_jsx(Stat, { label: "Final Vocab Score", value: `${gameScore} / ${vocabItems.length}` }), _jsx("div", { style: { marginTop: 12 }, children: _jsx(Button, { onClick: () => resetMiniGame('vocab'), children: "Play Again" }) })] }))] })) : null] }));
}
