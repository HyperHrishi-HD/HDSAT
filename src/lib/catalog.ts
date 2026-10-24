import type { Achievement, DatasetSource, Emblem, EmblemIcon, StoreItem } from './types';

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
  { id: 'rush-10', name: 'Rush Hour', description: 'Score 10 correct answers across Practice Rush sessions.', icon: 'zap', rewardCoins: 20 },
  { id: 'coin-100', name: 'Coin Collector', description: 'Hold 100 HDCoins at once.', icon: 'coins', rewardCoins: 15 },
  { id: 'mastery-5', name: 'Mastery', description: 'Master 5 questions with two consecutive correct answers.', icon: 'award', rewardCoins: 40 },
];

export function achievementById(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
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
