/**
 * The store sells themes only. Emblems are earned from achievements, so the
 * catalogue, the client purchase path and the purchase RPC must all agree that
 * an emblem cannot be bought.
 */
import { describe, expect, it } from 'vitest';
import achievementSql from '../../supabase/migrations/20261104000100_achievement_ladder.sql?raw';
import economySql from '../../supabase/migrations/20261025000200_emblems_earned.sql?raw';
import {
  ACHIEVEMENTS,
  LEGACY_EMBLEMS,
  STORE_ITEMS,
  achievementById,
  earnedEmblemIds,
  emblemFor,
  itemById,
  normalizeAchievementIds,
  visibleAchievements,
} from './catalog';

describe('achievement ladder reveal', () => {
  it('opens with ten rungs and reveals one more per badge', () => {
    const all = ACHIEVEMENTS.length;
    expect(visibleAchievements([])).toHaveLength(10);
    expect(visibleAchievements([])[0].id).toBe(ACHIEVEMENTS[0].id);
    expect(visibleAchievements(['first-steps'])).toHaveLength(11);
    expect(visibleAchievements(['first-steps', 'ten-questions', 'streak-3'])).toHaveLength(13);
    // The last reveal cannot push past the end of the ladder.
    const everything = visibleAchievements(ACHIEVEMENTS.map((a) => a.id));
    expect(everything).toHaveLength(all);
    expect(everything[everything.length - 1].id).toBe(ACHIEVEMENTS[all - 1].id);
  });

  it('never hides a badge the student actually earned', () => {
    const late = ACHIEVEMENTS[ACHIEVEMENTS.length - 1];
    const shown = visibleAchievements([late.id]);
    expect(shown.some((a) => a.id === late.id)).toBe(true);
    // A grant past the window adds its own row and still reveals one more rung.
    expect(shown).toHaveLength(12);
    expect(shown.slice(0, 11)).toEqual(ACHIEVEMENTS.slice(0, 11));
    // Unknown / legacy ids are not achievements and reveal nothing on their own.
    expect(visibleAchievements(['badge-navigator'])).toHaveLength(10);
  });
});

describe('theme store', () => {
  it('sells themes only, climbing in unlock order with no repeated price', () => {
    expect(STORE_ITEMS.every((item) => item.slot === 'theme')).toBe(true);
    expect(STORE_ITEMS.every((item) => !item.icon)).toBe(true);
    expect(STORE_ITEMS.some((item) => item.id.startsWith('badge-'))).toBe(false);

    const costs = STORE_ITEMS.map((item) => item.cost);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    expect(new Set(costs).size).toBe(costs.length);
    expect(costs[0]).toBe(20);
    expect(costs[costs.length - 1]).toBe(3500);
  });

  it('charges exactly what the client shows (server catalogue parity)', () => {
    for (const item of STORE_ITEMS) {
      const match = economySql.match(new RegExp(`WHEN '${item.id}' THEN v_price := (\\d+)`));
      expect(match, `missing server price for ${item.id}`).toBeTruthy();
      expect(Number(match![1]), item.id).toBe(item.cost);
    }
    expect(economySql).not.toMatch(/WHEN ' /);
  });

  it('refuses emblem purchases on the server', () => {
    expect(economySql).toMatch(/p_item_type IS DISTINCT FROM 'accent_theme'/);
    expect(economySql).toContain('Emblems are earned through achievements and cannot be purchased');
    expect(economySql).not.toMatch(/WHEN 'badge-/);
  });

  it('assigns positive HDCoin rewards to every achievement and normalizes legacy DB IDs', () => {
    expect(ACHIEVEMENTS.every((a) => a.rewardCoins >= 5)).toBe(true);
    expect(achievementById('first-steps')?.rewardCoins).toBe(5);
    expect(achievementById('mastery-5')?.rewardCoins).toBe(40);
    expect(normalizeAchievementIds(['first_question', 'first_simulation', 'streak-7'])).toEqual([
      'first-steps',
      'first-test',
      'streak-7',
    ]);
  });
});

describe('earned emblems', () => {
  it('gives every achievement its own emblem glyph', () => {
    expect(ACHIEVEMENTS.every((a) => Boolean(a.icon))).toBe(true);
    expect(new Set(ACHIEVEMENTS.map((a) => a.icon)).size).toBe(ACHIEVEMENTS.length);
  });

  it('resolves an equipped achievement or a legacy purchase, never a theme', () => {
    expect(emblemFor('mastery-5')?.icon).toBe('award');
    expect(emblemFor('mastery-5')?.name).toBe('Mastery');
    expect(emblemFor('badge-grapher')?.icon).toBe('graph');
    expect(emblemFor('oxford-navy')).toBeNull();
    expect(emblemFor(null)).toBeNull();
    expect(emblemFor('not-an-item')).toBeNull();
    expect(itemById('badge-centurion')).toBeUndefined();
    expect(LEGACY_EMBLEMS['badge-centurion']?.icon).toBe('crown');
  });

  it('grants every rung of the ladder in the database too, at the same price', () => {
    for (const achievement of ACHIEVEMENTS) {
      const grant = achievementSql.match(
        new RegExp(`grant_achievement_with_reward\\(p_user_id, '${achievement.id}',[^;]*?, (\\d+), p_local_date\\)`)
      );
      expect(grant, `missing server grant for ${achievement.id}`).toBeTruthy();
      expect(Number(grant![1]), achievement.id).toBe(achievement.rewardCoins);
    }
  });

  it('keeps the session coin band identical on both sides', () => {
    // 5 + round(pow(roll, 2.6) * 45) is the client's low-biased 5-50 roll.
    expect(achievementSql).toContain('5 + ROUND(POWER(random(), 2.6) * 45)::INTEGER');
    expect(achievementSql).toContain('v_coverage := LEAST(1, v_questions::NUMERIC / 90)');
    expect(achievementSql).toContain('ROUND(25 * v_coverage * v_accuracy)::INTEGER');
  });

  it('only equips emblems the student has actually earned', () => {
    expect(earnedEmblemIds([], [])).toEqual([]);
    expect(earnedEmblemIds(['first-steps', 'not-a-real-achievement'], [])).toEqual([
      'first-steps',
    ]);
    expect(earnedEmblemIds(['streak-7'], ['badge-navigator', 'oxford-navy'])).toEqual([
      'streak-7',
      'badge-navigator',
    ]);
  });
});
