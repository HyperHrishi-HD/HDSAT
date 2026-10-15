import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Badge, Button, Card, Stat } from '../components/ui';
import { ACHIEVEMENTS, STORE_ITEMS } from '../lib/catalog';
import { DAILY_FLASHCARD_COIN_CAP, DAILY_QUESTION_COIN_CAP } from '../lib/storage';
import { useApp } from '../lib/store';
export function RewardsPage() {
    const app = useApp();
    const [feedback, setFeedback] = useState(null);
    const today = app.dailyActivity[app.dailyActivity.length - 1];
    const handleBuy = async (itemId, cost, name) => {
        const res = await app.actions.purchase(itemId, cost);
        if (res.ok) {
            setFeedback({ ok: true, text: `Unlocked ${name}!` });
        }
        else {
            setFeedback({ ok: false, text: res.reason ?? 'Could not complete purchase.' });
        }
    };
    return (_jsxs("div", { children: [_jsxs(Card, { children: [_jsxs("div", { className: "row-between", children: [_jsxs("div", { children: [_jsx("h1", { children: "HDCoins Economy, Streaks & Achievements" }), _jsx("p", { className: "muted", children: "Fair, duplicate-resistant rewards earned through verified practice questions, spaced-repetition reviews, and adaptive simulations." })] }), _jsxs(Badge, { tone: "good", children: [app.hdCoins, " HDCoins available"] })] }), _jsxs("div", { className: "card-grid", style: { marginTop: 12 }, children: [_jsx(Stat, { label: "HDCoins Balance", value: app.hdCoins, hint: `${today?.coinsEarned ?? 0} earned today` }), _jsx(Stat, { label: "Current Streak", value: `${app.currentStreak} days`, hint: `Best: ${app.bestStreak} days` }), _jsx(Stat, { label: "Unlocked Achievements", value: `${app.achievements.length} / ${ACHIEVEMENTS.length}` }), _jsx(Stat, { label: "Owned Cosmetics", value: app.ownedItems.length })] })] }), feedback ? (_jsx(Card, { children: _jsx("p", { style: { color: feedback.ok ? 'var(--good)' : 'var(--bad)', margin: 0 }, children: _jsx("strong", { children: feedback.text }) }) })) : null, _jsxs("div", { className: "grid-2", children: [_jsxs(Card, { children: [_jsx("h2", { children: "HDCoins Reward Store" }), _jsx("p", { className: "muted", children: "Unlock profile emblems and study palette accents using your earned HDCoins." }), _jsx("div", { className: "stack", style: { marginTop: 12 }, children: STORE_ITEMS.map((item) => {
                                    const owned = app.ownedItems.includes(item.id);
                                    const canAfford = app.hdCoins >= item.cost;
                                    return (_jsxs("div", { className: "muted-block row-between", children: [_jsxs("div", { children: [_jsxs("div", { className: "row", children: [_jsx("strong", { children: item.name }), _jsx(Badge, { children: item.slot })] }), _jsx("div", { className: "muted", style: { marginTop: 4 }, children: item.description })] }), _jsx("div", { children: owned ? (_jsx(Badge, { tone: "good", children: "Owned" })) : (_jsxs(Button, { size: "sm", disabled: !canAfford, onClick: () => handleBuy(item.id, item.cost, item.name), children: ["Unlock (", item.cost, " HDCoins)"] })) })] }, item.id));
                                }) })] }), _jsxs("div", { className: "stack", children: [_jsxs(Card, { children: [_jsx("h2", { children: "Earning Rules & Anti-Farming Caps" }), _jsxs("ul", { className: "muted", style: { paddingLeft: 18, lineHeight: 1.6 }, children: [_jsxs("li", { children: [_jsx("strong", { children: "First attempt on a question:" }), " +1 HDCoin (never awarded twice for the same question ID)."] }), _jsxs("li", { children: [_jsx("strong", { children: "First correct solution on a question:" }), " +1 additional HDCoin."] }), _jsxs("li", { children: [_jsx("strong", { children: "Daily question reward cap:" }), " ", DAILY_QUESTION_COIN_CAP, " HDCoins/day."] }), _jsxs("li", { children: [_jsx("strong", { children: "Spaced-repetition due flashcard review:" }), " +1 HDCoin per due card (up to", ' ', DAILY_FLASHCARD_COIN_CAP, " HDCoins/day)."] }), _jsxs("li", { children: [_jsx("strong", { children: "Daily qualifying streak milestone:" }), " +5 HDCoins once per day when you complete \u22653 questions, \u22655 flashcards, or a Practice Rush."] }), _jsxs("li", { children: [_jsx("strong", { children: "Full adaptive simulation completion:" }), " +25 HDCoins (capped at 2 per day in cloud mode)."] })] })] }), _jsxs(Card, { children: [_jsx("h2", { children: "Scholar Achievements" }), _jsx("div", { className: "stack", style: { marginTop: 10 }, children: ACHIEVEMENTS.map((ach) => {
                                            const earned = app.achievements.includes(ach.id);
                                            return (_jsxs("div", { className: "muted-block row-between", children: [_jsxs("div", { children: [_jsx("strong", { children: ach.name }), _jsx("div", { className: "muted", children: ach.description })] }), _jsx(Badge, { tone: earned ? 'good' : 'neutral', children: earned ? 'Unlocked' : 'Locked' })] }, ach.id));
                                        }) })] })] })] })] }));
}
