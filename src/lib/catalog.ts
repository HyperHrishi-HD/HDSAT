import type { Achievement, StoreItem } from './types';

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-steps', name: 'First Steps', description: 'Complete your first practice question.', icon: 'footprints', rewardCoins: 5 },
  { id: 'ten-questions', name: 'Warmed Up', description: 'Answer 10 questions.', icon: 'flame', rewardCoins: 10 },
  { id: 'fifty-questions', name: 'Grinder', description: 'Answer 50 questions.', icon: 'hammer', rewardCoins: 25 },
  { id: 'perfect-module', name: 'Flawless Module', description: 'Score 100% on any test module.', icon: 'target', rewardCoins: 30 },
  { id: 'streak-3', name: 'Three Day Streak', description: 'Practise on three consecutive days.', icon: 'calendar-check', rewardCoins: 10 },
  { id: 'streak-7', name: 'Week Streak', description: 'Practise on seven consecutive days.', icon: 'calendar-heart', rewardCoins: 25 },
  { id: 'flashcard-10', name: 'Card Shark', description: 'Review 10 flashcards.', icon: 'layers', rewardCoins: 10 },
  { id: 'flashcard-50', name: 'Deck Master', description: 'Review 50 flashcards.', icon: 'library', rewardCoins: 25 },
  { id: 'first-test', name: 'Test Pilot', description: 'Complete a full adaptive practice test.', icon: 'clipboard-check', rewardCoins: 25 },
  { id: 'rush-10', name: 'Rush Hour', description: 'Score 10 correct answers across Practice Rush sessions.', icon: 'zap', rewardCoins: 20 },
  { id: 'coin-100', name: 'Coin Collector', description: 'Hold 100 HDCoins at once.', icon: 'coins', rewardCoins: 15 },
  { id: 'mastery-5', name: 'Mastery', description: 'Master 5 questions with two consecutive correct answers.', icon: 'award', rewardCoins: 40 },
];

export function achievementById(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/**
 * Normalize legacy database achievement IDs so any previously unlocked DB
 * rows map cleanly onto the canonical client IDs.
 */
export const LEGACY_ACHIEVEMENT_MAP: Record<string, string> = {
  first_question: 'first-steps',
  unique_25: 'ten-questions',
  unique_50: 'fifty-questions',
  unique_100: 'fifty-questions',
  first_rush: 'rush-10',
  first_simulation: 'first-test',
  flashcard_10: 'flashcard-10',
  streak_7: 'streak-7',
};

export function normalizeAchievementIds(ids: string[]): string[] {
  const out = new Set<string>();
  for (const raw of ids) {
    const mapped = LEGACY_ACHIEVEMENT_MAP[raw] ?? raw;
    if (ACHIEVEMENTS.some((a) => a.id === mapped)) {
      out.add(mapped);
    }
  }
  return Array.from(out);
}

/**
 * Cosmetic catalogue. Prices climb in unlock order — starter themes, emblems,
 * and gradual exponential prestige themes — so the shop reads as a ladder:
 * 20 → 50 → 100 → 150 → 200 → 300 → 400 → 600 → 1000 → 1800 → 3500 HDCoins.
 * The same numbers live in the `purchase_cosmetic_item` RPC
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
  { id: 'slate-mono', name: 'Slate Mono Theme', description: 'Crisp architectural monochrome slate palette.', cost: 600, slot: 'theme' },
  { id: 'teal-current', name: 'Teal Current Theme', description: 'Deep oceanic teal and cool cyan study palette.', cost: 1000, slot: 'theme' },
  { id: 'rose-quartz', name: 'Rose Quartz Theme', description: 'Refined editorial crimson-rose prestige palette.', cost: 1800, slot: 'theme' },
  { id: 'royal-obsidian', name: 'Royal Obsidian Theme', description: 'High-tier indigo-obsidian mastery accent palette.', cost: 3500, slot: 'theme' },
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
