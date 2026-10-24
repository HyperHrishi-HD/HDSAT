/**
 * The store sells themes only. Emblems are earned from achievements, so the
 * catalogue, the client purchase path and the purchase RPC must all agree that
 * an emblem cannot be bought.
 */
import { describe, expect, it } from 'vitest';
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
} from './catalog';

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
