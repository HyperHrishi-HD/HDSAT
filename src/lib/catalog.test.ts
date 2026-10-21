/**
 * The store ladder: prices climb in unlock order, every emblem has its own
 * glyph (icon only, never text), and the server RPC charges exactly the price
 * the client displays.
 */
import { describe, expect, it } from 'vitest';
import priceLadderSql from '../../supabase/migrations/20261020000100_cosmetic_price_ladder.sql?raw';
import { STORE_ITEMS, emblemFor, itemById } from './catalog';

describe('cosmetic price ladder', () => {
  it('climbs in unlock order with no repeated price', () => {
    const costs = STORE_ITEMS.map((item) => item.cost);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    expect(new Set(costs).size).toBe(costs.length);
    expect(costs[0]).toBe(20);
    expect(costs[costs.length - 1]).toBeGreaterThanOrEqual(400);
  });

  it('charges exactly what the client shows (server catalogue parity)', () => {
    for (const item of STORE_ITEMS) {
      const match = priceLadderSql.match(new RegExp(`WHEN '${item.id}' THEN v_price := (\\d+)`));
      expect(match, `missing server price for ${item.id}`).toBeTruthy();
      expect(Number(match![1]), item.id).toBe(item.cost);
    }
    // No stray branch (the old function had ' plum-ink' with a leading space).
    expect(priceLadderSql).not.toMatch(/WHEN ' /);
  });
});

describe('emblem glyphs', () => {
  it('gives every emblem its own icon and leaves themes without one', () => {
    const emblems = STORE_ITEMS.filter((item) => item.id.startsWith('badge-'));
    expect(emblems.length).toBeGreaterThan(1);
    expect(emblems.every((item) => Boolean(item.icon))).toBe(true);
    expect(new Set(emblems.map((item) => item.icon)).size).toBe(emblems.length);
    expect(STORE_ITEMS.filter((item) => item.slot === 'theme').every((item) => !item.icon)).toBe(true);
  });

  it('resolves an equipped emblem by id', () => {
    expect(emblemFor('badge-grapher')?.icon).toBe('graph');
    expect(emblemFor('badge-navigator')?.icon).toBe('compass');
    expect(emblemFor('badge-centurion')?.icon).toBe('crown');
    expect(emblemFor('oxford-navy')).toBeNull();
    expect(emblemFor(null)).toBeNull();
    expect(emblemFor('not-an-item')).toBeNull();
    expect(itemById('badge-centurion')?.cost).toBe(400);
  });
});
