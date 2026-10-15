export const ACHIEVEMENTS = [
    { id: 'first-steps', name: 'First Steps', description: 'Complete your first practice question.', icon: 'footprints' },
    { id: 'ten-questions', name: 'Warmed Up', description: 'Answer 10 questions.', icon: 'flame' },
    { id: 'fifty-questions', name: 'Grinder', description: 'Answer 50 questions.', icon: 'hammer' },
    { id: 'perfect-module', name: 'Flawless Module', description: 'Score 100% on any test module.', icon: 'target' },
    { id: 'streak-3', name: 'Three Day Streak', description: 'Practise on three consecutive days.', icon: 'calendar-check' },
    { id: 'streak-7', name: 'Week Streak', description: 'Practise on seven consecutive days.', icon: 'calendar-heart' },
    { id: 'flashcard-10', name: 'Card Shark', description: 'Review 10 flashcards.', icon: 'layers' },
    { id: 'flashcard-50', name: 'Deck Master', description: 'Review 50 flashcards.', icon: 'library' },
    { id: 'first-test', name: 'Test Pilot', description: 'Complete a full adaptive practice test.', icon: 'clipboard-check' },
    { id: 'rush-10', name: 'Rush Hour', description: 'Score 10 correct answers across Practice Rush sessions.', icon: 'zap' },
    { id: 'coin-100', name: 'Coin Collector', description: 'Hold 100 HDCoins at once.', icon: 'coins' },
    { id: 'mastery-5', name: 'Mastery', description: 'Master 5 questions with two consecutive correct answers.', icon: 'award' },
];
export const STORE_ITEMS = [
    { id: 'oxford-navy', name: 'Oxford Navy Theme', description: 'Deep academic navy accent palette.', cost: 15, slot: 'theme' },
    { id: 'forest-sage', name: 'Forest Sage Theme', description: 'Calm botanical green accent palette.', cost: 20, slot: 'theme' },
    { id: 'warm-amber', name: 'Warm Amber Theme', description: 'High-contrast warm amber study accent.', cost: 20, slot: 'theme' },
    { id: 'plum-ink', name: 'Plum Ink Theme', description: 'Editorial plum ink accent palette.', cost: 25, slot: 'theme' },
    { id: 'badge-navigator', name: 'Adaptive Navigator Emblem', description: 'Profile emblem celebrating adaptive test routing.', cost: 15, slot: 'flair' },
    { id: 'badge-grapher', name: 'Desmos Tactician Emblem', description: 'Profile emblem for graphing calculator mastery.', cost: 20, slot: 'flair' },
    { id: 'badge-centurion', name: 'Centurion Scholar Emblem', description: 'Prestigious emblem for dedicated SAT scholars.', cost: 30, slot: 'utility' },
];
export function itemById(id) {
    return STORE_ITEMS.find((item) => item.id === id);
}
