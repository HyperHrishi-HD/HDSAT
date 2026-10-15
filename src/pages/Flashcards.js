import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { MathText } from '../components/MathText';
import { Badge, Button, Card, EmptyState, Select, Stat } from '../components/ui';
import { isDue } from '../lib/sm2';
import { useApp } from '../lib/store';
export function FlashcardsPage() {
    const app = useApp();
    const [deckFilter, setDeckFilter] = useState('all');
    const [queueMode, setQueueMode] = useState('due');
    const [currentIndex, setCurrentIndex] = useState(0);
    const [revealed, setRevealed] = useState(false);
    const filteredCards = useMemo(() => {
        return app.flashcards.filter((card) => {
            if (deckFilter !== 'all' && card.deck !== deckFilter)
                return false;
            if (queueMode === 'due') {
                return isDue(app.flashcardProgress[card.id]);
            }
            return true;
        });
    }, [app.flashcards, app.flashcardProgress, deckFilter, queueMode]);
    const currentCard = filteredCards[currentIndex] ?? filteredCards[0] ?? null;
    const stats = useMemo(() => {
        let mastered = 0;
        let learning = 0;
        let due = 0;
        app.flashcards.forEach((c) => {
            const prog = app.flashcardProgress[c.id];
            if (!prog || isDue(prog))
                due += 1;
            if (prog?.stage === 'mastered')
                mastered += 1;
            else if (prog?.stage === 'learning' || prog?.stage === 'review')
                learning += 1;
        });
        return { mastered, learning, due, total: app.flashcards.length };
    }, [app.flashcards, app.flashcardProgress]);
    const handleGrade = async (quality) => {
        if (!currentCard)
            return;
        await app.actions.reviewFlashcard(currentCard.id, quality);
        setRevealed(false);
        setCurrentIndex((i) => (i + 1 >= Math.max(1, filteredCards.length - 1) ? 0 : i));
    };
    return (_jsxs("div", { children: [_jsxs(Card, { children: [_jsxs("div", { className: "row-between", children: [_jsxs("div", { children: [_jsx("h1", { children: "Vocabulary & Math Formula Flashcards (SM-2)" }), _jsx("p", { className: "muted", children: "Spaced-repetition study deck. Reviewing due cards schedules intervals with the SM-2 algorithm and awards daily HDCoins." })] }), _jsxs("div", { className: "row", children: [_jsx(Select, { label: "Deck", value: deckFilter, onChange: (v) => {
                                            setDeckFilter(v);
                                            setCurrentIndex(0);
                                            setRevealed(false);
                                        }, options: [
                                            { value: 'all', label: 'All Cards (46)' },
                                            { value: 'vocabulary', label: 'SAT High-Utility Vocabulary (24)' },
                                            { value: 'math_formula', label: 'SAT Math Formulas & Identities (22)' },
                                        ] }), _jsx(Select, { label: "Study Queue", value: queueMode, onChange: (v) => {
                                            setQueueMode(v);
                                            setCurrentIndex(0);
                                            setRevealed(false);
                                        }, options: [
                                            { value: 'due', label: `Due Now (${stats.due})` },
                                            { value: 'all', label: `Browse All (${stats.total})` },
                                        ] })] })] }), _jsxs("div", { className: "card-grid", style: { marginTop: 12 }, children: [_jsx(Stat, { label: "Due for Review", value: stats.due }), _jsx(Stat, { label: "In Progress", value: stats.learning }), _jsx(Stat, { label: "Mastered (14+ day interval)", value: stats.mastered }), _jsx(Stat, { label: "Total Deck Size", value: stats.total })] })] }), !currentCard ? (_jsx(Card, { children: _jsx(EmptyState, { title: "All due cards in this deck are complete!", body: "You have cleared your immediate spaced-repetition queue. Switch to 'Browse All' to review ahead.", action: _jsx(Button, { onClick: () => setQueueMode('all'), variant: "outline", children: "Browse All Cards" }) }) })) : (_jsxs(Card, { children: [_jsxs("div", { className: "row-between", style: { marginBottom: 12 }, children: [_jsxs("div", { className: "row", children: [_jsx(Badge, { tone: "info", children: currentCard.deck === 'math_formula' ? 'Math Formula' : 'Vocabulary' }), currentCard.tags.map((t) => (_jsx(Badge, { children: t }, t)))] }), _jsxs("span", { className: "muted", children: ["Card ", Math.min(currentIndex + 1, filteredCards.length), " of ", filteredCards.length, " \u00B7 Stage:", ' ', _jsx("strong", { children: app.flashcardProgress[currentCard.id]?.stage ?? 'new' })] })] }), _jsxs("div", { className: "flashcard", onClick: () => setRevealed((r) => !r), style: { cursor: 'pointer' }, role: "button", tabIndex: 0, onKeyDown: (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setRevealed((r) => !r);
                            }
                        }, children: [_jsx("div", { className: "front", children: currentCard.front }), revealed ? (_jsxs("div", { className: "back", children: [currentCard.latex ? (_jsx("div", { style: { margin: '10px 0', fontSize: '1.15rem' }, children: _jsx(MathText, { text: `$$${currentCard.latex}$$` }) })) : null, _jsx("p", { children: currentCard.back })] })) : (_jsx("p", { className: "muted", children: "Click card or press Reveal to check definition / formula" }))] }), !revealed ? (_jsxs("div", { className: "row-between", style: { marginTop: 14 }, children: [_jsx(Button, { variant: "outline", disabled: filteredCards.length <= 1, onClick: () => setCurrentIndex((i) => (i - 1 + filteredCards.length) % filteredCards.length), children: "Previous" }), _jsx(Button, { onClick: () => setRevealed(true), children: "Reveal Answer" }), _jsx(Button, { variant: "outline", disabled: filteredCards.length <= 1, onClick: () => setCurrentIndex((i) => (i + 1) % filteredCards.length), children: "Skip" })] })) : (_jsxs("div", { style: { marginTop: 14 }, children: [_jsx("p", { className: "muted", style: { textAlign: 'center', marginBottom: 8 }, children: "Rate your recall quality to schedule the next review:" }), _jsxs("div", { className: "quality-row", children: [_jsx(Button, { variant: "danger", onClick: () => handleGrade(1), children: "Again (1d)" }), _jsx(Button, { variant: "outline", onClick: () => handleGrade(3), children: "Hard (short)" }), _jsx(Button, { variant: "primary", onClick: () => handleGrade(4), children: "Good (standard)" }), _jsx(Button, { variant: "subtle", onClick: () => handleGrade(5), children: "Easy (boost)" })] })] }))] }))] }));
}
