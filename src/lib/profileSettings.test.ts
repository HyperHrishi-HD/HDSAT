// @vitest-environment jsdom
/**
 * Profile migrations must not make the bank look smaller. Version 1 shipped
 * "exclude previously correct" on by default; a student who answered 75 items
 * correctly saw "9,949 matching" in Practice even though all 10,024 items were
 * still present. Version 2 makes the complete bank the default once, while
 * preserving a deliberate choice made after the migration.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEY, emptyProfile, loadProfile } from './storage';

beforeEach(() => {
  localStorage.clear();
});

describe('profile settings migration', () => {
  it('opens the complete bank for a version-1 profile and keeps later choices', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        settings: { assessment: 'SAT', excludePreviouslyCorrect: true },
      })
    );

    const migrated = loadProfile();
    expect(migrated.version).toBe(2);
    expect(migrated.settings.excludePreviouslyCorrect).toBe(false);
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(persisted.version).toBe(2);
    expect(persisted.settings.excludePreviouslyCorrect).toBe(false);

    const deliberate = { ...migrated, settings: { ...migrated.settings, excludePreviouslyCorrect: true } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(deliberate));
    expect(loadProfile().settings.excludePreviouslyCorrect).toBe(true);
  });

  it('starts new profiles with the complete bank', () => {
    expect(emptyProfile().settings.excludePreviouslyCorrect).toBe(false);
  });
});
