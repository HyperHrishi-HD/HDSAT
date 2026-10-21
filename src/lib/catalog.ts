import type { Achievement, StoreItem } from './types';

export const ACHIEVEMENTS: Achievement[] = [
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

/**
 * Cosmetic catalogue. Prices climb in unlock order — themes first, then
 * emblems — so the shop reads as a ladder: 20 → 50 → 100 → 150 → 200 → 300 →
 * 400 HDCoins. The same numbers live in the `purchase_cosmetic_item` RPC
 * (supabase/migrations/20261020000100_cosmetic_price_ladder.sql); change both
 * together or the client and server disagree.
 */
export const STORE_ITEMS: StoreItem[] = [
  { id: 'oxford-navy', name: 'Oxford Navy Theme', description: 'Deep academic navy accent palette.', cost: 20, slot: 'theme' },
  { id: 'forest-sage', name: 'Forest Sage Theme', description: 'Calm botanical green accent palette.', cost: 50, slot: 'theme' },
  { id: 'warm-amber', name: 'Warm Amber Theme', description: 'High-contrast warm amber study accent.', cost: 100, slot: 'theme' },
  { id: 'plum-ink', name: 'Plum Ink Theme', description: 'Editorial plum ink accent palette.', cost: 150, slot: 'theme' },
  {
    id: 'badge-navigator',
    name: 'Adaptive Navigator Emblem',
    description: 'Profile emblem celebrating adaptive test routing.',
    cost: 200,
    slot: 'flair',
    icon: 'compass',
  },
  {
    id: 'badge-grapher',
    name: 'Desmos Tactician Emblem',
    description: 'Profile emblem for graphing calculator mastery.',
    cost: 300,
    slot: 'flair',
    icon: 'graph',
  },
  {
    id: 'badge-centurion',
    name: 'Centurion Scholar Emblem',
    description: 'Prestigious emblem for dedicated SAT scholars.',
    cost: 400,
    slot: 'utility',
    icon: 'crown',
  },
];

export function itemById(id: string): StoreItem | undefined {
  return STORE_ITEMS.find((item) => item.id === id);
}

/** The emblem glyph for an owned item, or null when it is a theme. */
export function emblemFor(itemId: string | null | undefined): StoreItem | null {
  if (!itemId) return null;
  const item = itemById(itemId);
  return item?.icon ? item : null;
}
