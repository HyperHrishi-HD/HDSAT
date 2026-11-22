import type { Achievement, DatasetSource, Emblem, EmblemIcon, StoreItem } from './types';

/**
 * The achievement ladder, ordered from the first question to the long-haul
 * ones. Each row pays its `rewardCoins` once, the moment it unlocks; the
 * "+N" badge on the Rewards page is that bonus, not a level or a multiplier.
 *
 * The order is also the difficulty order, so the page reads as a ladder and
 * never needs re-sorting. `supabase/migrations/20261104000100_achievement_ladder.sql`
 * grants the same ids with the same coin amounts; change both together.
 */
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-steps', name: 'First Steps', description: 'Complete your first practice question.', icon: 'footprints', rewardCoins: 5 },
  { id: 'ten-questions', name: 'Warmed Up', description: 'Answer 10 questions.', icon: 'flame', rewardCoins: 10 },
  { id: 'fifty-questions', name: 'Grinder', description: 'Answer 50 questions.', icon: 'hammer', rewardCoins: 25 },
  { id: 'perfect-module', name: 'Flawless Module', description: 'Score 100% on any test module.', icon: 'target', rewardCoins: 30 },
  { id: 'streak-3', name: 'Three Day Streak', description: 'Practice on three consecutive days.', icon: 'calendar-check', rewardCoins: 10 },
  { id: 'streak-7', name: 'Week Streak', description: 'Practice on seven consecutive days.', icon: 'calendar-heart', rewardCoins: 25 },
  { id: 'flashcard-10', name: 'Card Shark', description: 'Review 10 flashcards.', icon: 'layers', rewardCoins: 10 },
  { id: 'flashcard-50', name: 'Deck Master', description: 'Review 50 flashcards.', icon: 'library', rewardCoins: 25 },
  { id: 'first-test', name: 'Test Pilot', description: 'Complete a full adaptive practice test.', icon: 'clipboard-check', rewardCoins: 25 },
  { id: 'rush-10', name: 'Rush Hour', description: 'Answer 10 Practice Rush questions correctly.', icon: 'zap', rewardCoins: 20 },
  { id: 'coin-100', name: 'Coin Collector', description: 'Hold 100 HDCoins at once.', icon: 'coins', rewardCoins: 15 },
  { id: 'mastery-5', name: 'Mastery', description: 'Master 5 questions with two consecutive correct answers.', icon: 'award', rewardCoins: 40 },
  { id: 'hundred-questions', name: 'Century', description: 'Answer 100 questions.', icon: 'graph', rewardCoins: 50 },
  { id: 'accurate-50', name: 'Sharpshooter', description: 'Answer 50 questions correctly.', icon: 'trophy', rewardCoins: 40 },
  { id: 'distinct-100', name: 'Wide Net', description: 'Answer 100 different questions.', icon: 'compass', rewardCoins: 60 },
  { id: 'streak-14', name: 'Fortnight', description: 'Practice on fourteen consecutive days.', icon: 'sun', rewardCoins: 60 },
  { id: 'tests-5', name: 'Simulator', description: 'Complete 5 full adaptive practice tests.', icon: 'test', rewardCoins: 80 },
  { id: 'flashcards-200', name: 'Card Archive', description: 'Review 200 flashcards.', icon: 'bookmark', rewardCoins: 80 },
  { id: 'mastery-25', name: 'Deep Mastery', description: 'Master 25 questions.', icon: 'gem', rewardCoins: 100 },
  { id: 'rush-100', name: 'Rush Veteran', description: 'Answer 100 Practice Rush questions correctly.', icon: 'bolt', rewardCoins: 100 },
  { id: 'coin-1000', name: 'Vault Keeper', description: 'Hold 1,000 HDCoins at once.', icon: 'key', rewardCoins: 100 },
  { id: 'lifetime-2500', name: 'Earned It', description: 'Earn 2,500 HDCoins across your lifetime.', icon: 'medal', rewardCoins: 150 },
  { id: 'accurate-500', name: 'Dead Eye', description: 'Answer 500 questions correctly.', icon: 'shield', rewardCoins: 150 },
  { id: 'five-hundred-questions', name: 'Marathon', description: 'Answer 500 questions.', icon: 'mountain', rewardCoins: 200 },
  { id: 'distinct-500', name: 'Cartographer', description: 'Answer 500 different questions.', icon: 'orbit', rewardCoins: 200 },
  { id: 'mastery-100', name: 'Scholar', description: 'Master 100 questions.', icon: 'crown', rewardCoins: 250 },
  { id: 'tests-15', name: 'Trial Runner', description: 'Complete 15 full adaptive practice tests.', icon: 'rocket', rewardCoins: 250 },
  { id: 'streak-30', name: 'Month of Study', description: 'Practice on thirty consecutive days.', icon: 'sprout', rewardCoins: 250 },
  { id: 'thousand-questions', name: 'Thousand Club', description: 'Answer 1,000 questions.', icon: 'cairn', rewardCoins: 300 },
  { id: 'streak-100', name: 'Unbroken', description: 'Practice on one hundred consecutive days.', icon: 'spark', rewardCoins: 400 },
  { id: 'lifetime-10000', name: 'Fortune', description: 'Earn 10,000 HDCoins across your lifetime.', icon: 'vault', rewardCoins: 500 },
];

export function achievementById(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/**
 * How many rungs the Rewards page names before anything is earned. A sheet of
 * thirty-one locked rows says nothing to a new student, so the page opens with
 * the first ten and the ladder grows as it is climbed.
 */
export const ACHIEVEMENT_PREVIEW = 10;

/**
 * The achievements the Rewards page may name.
 *
 * It shows the first `preview` rungs plus one more for every badge already
 * earned, so each unlock reveals exactly the next locked step. An earned badge
 * is always named even when its rung sits past the window — the database can
 * grant one out of order — because a badge a student actually holds must never
 * stay hidden.
 */
export function visibleAchievements(
  earnedIds: string[],
  preview = ACHIEVEMENT_PREVIEW
): Achievement[] {
  const earned = new Set(earnedIds);
  const unlocked = ACHIEVEMENTS.filter((achievement) => earned.has(achievement.id)).length;
  const shown = Math.max(0, preview) + unlocked;
  return ACHIEVEMENTS.filter(
    (achievement, index) => index < shown || earned.has(achievement.id)
  );
}

/**
 * Every dataset keeps its own label, licence and attribution. Official College
 * Board items are never merged into the HDSAT original bank: they carry their
 * own source row, their own filter and their own attribution on each item.
 */
export function datasetLabel(source: DatasetSource): string {
  return `${source.is_official_college_board ? 'Official' : 'HDSAT'} · ${source.name}`;
}

/**
 * Normalize legacy database achievement IDs so any previously unlocked DB
 * rows map cleanly onto the canonical client IDs.
 */
export const LEGACY_ACHIEVEMENT_MAP: Record<string, string> = {
  first_question: 'first-steps',
  unique_25: 'ten-questions',
  unique_50: 'fifty-questions',
  unique_100: 'distinct-100',
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
 * Cosmetic catalogue: themes only. Emblems are earned from achievements and can
 * never be bought, so the store has one job.
 *
 * Prices climb in unlock order (20 → 50 → 100 → 150 → 600 → 1000 → 1800 →
 * 3500 HDCoins). The same numbers live in the `purchase_cosmetic_item` RPC
 * (supabase/migrations/20261025000200_emblems_earned.sql); change both together
 * or the client and server disagree.
 */
export const STORE_ITEMS: StoreItem[] = [
  { id: 'oxford-navy', name: 'Oxford Navy Theme', description: 'Deep academic navy accent palette.', cost: 20, slot: 'theme' },
  { id: 'forest-sage', name: 'Forest Sage Theme', description: 'Calm botanical green accent palette.', cost: 50, slot: 'theme' },
  { id: 'warm-amber', name: 'Warm Amber Theme', description: 'High-contrast warm amber study accent.', cost: 100, slot: 'theme' },
  { id: 'plum-ink', name: 'Plum Ink Theme', description: 'Editorial plum ink accent palette.', cost: 150, slot: 'theme' },
  { id: 'slate-mono', name: 'Slate Mono Theme', description: 'Crisp architectural monochrome slate palette.', cost: 600, slot: 'theme' },
  { id: 'teal-current', name: 'Teal Current Theme', description: 'Deep oceanic teal and cool cyan study palette.', cost: 1000, slot: 'theme' },
  { id: 'rose-quartz', name: 'Rose Quartz Theme', description: 'Refined editorial crimson-rose prestige palette.', cost: 1800, slot: 'theme' },
  { id: 'royal-obsidian', name: 'Royal Obsidian Theme', description: 'High-tier indigo-obsidian mastery accent palette.', cost: 3500, slot: 'theme' },
];

/**
 * Emblems that were sold before the economy split. They stay wearable for the
 * students who bought them, but they are no longer in the store and never will
 * be again; new emblems come from achievements only.
 */
export const LEGACY_EMBLEMS: Record<string, { name: string; icon: EmblemIcon }> = {
  'badge-navigator': { name: 'Adaptive Navigator', icon: 'compass' },
  'badge-grapher': { name: 'Desmos Tactician', icon: 'graph' },
  'badge-centurion': { name: 'Centurion Scholar', icon: 'crown' },
};

export function itemById(id: string): StoreItem | undefined {
  return STORE_ITEMS.find((item) => item.id === id);
}

/** The emblem an equipped flair id resolves to, or null for a theme / unknown id. */
export function emblemFor(flairId: string | null | undefined): Emblem | null {
  if (!flairId) return null;
  const achievement = achievementById(flairId);
  if (achievement) {
    return { id: achievement.id, name: achievement.name, icon: achievement.icon };
  }
  const legacy = LEGACY_EMBLEMS[flairId];
  if (legacy) return { id: flairId, name: legacy.name, icon: legacy.icon };
  return null;
}

/** Emblem ids a student has actually earned (equipment is checked against this). */
export function earnedEmblemIds(achievementIds: string[], ownedItems: string[]): string[] {
  const earned = new Set(achievementIds.filter((id) => Boolean(achievementById(id))));
  for (const item of ownedItems) {
    if (LEGACY_EMBLEMS[item]) earned.add(item);
  }
  return Array.from(earned);
}
