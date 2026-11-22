// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ARCADE_PROGRESS_KEY,
  arcadeDifficultyBand,
  arcadeLevel,
  markArcadeQuestion,
  takeArcadeQuestions,
} from './arcadeProgress';
import { SKILL_GAME_MODES, matchesSkillGame, skillGameById } from './arcadeModes';
import type { Question } from './types';

function question(
  id: string,
  section: 'Math' | 'Reading and Writing',
  domain: string,
  skill: string,
  difficulty: 'Easy' | 'Medium' | 'Hard'
): Question {
  return { id, section, domain, skill, difficulty } as Question;
}

describe('skill mini-game modes', () => {
  it('ships eight distinct quick drills with clear filters and sensible clocks', () => {
    expect(SKILL_GAME_MODES).toHaveLength(8);
    expect(new Set(SKILL_GAME_MODES.map((mode) => mode.id)).size).toBe(8);
    for (const mode of SKILL_GAME_MODES) {
      expect(mode.name.length).toBeGreaterThan(3);
      expect(mode.blurb.length).toBeGreaterThan(20);
      expect(mode.seconds).toBeGreaterThanOrEqual(45);
      expect(mode.seconds).toBeLessThanOrEqual(90);
      expect(Boolean(mode.section || mode.domain || mode.skillIncludes || mode.difficulty)).toBe(true);
    }
    expect(skillGameById('boss').difficulty).toBe('Hard');
  });

  it('never leaks a Reading item into a Math drill', () => {
    const slope = skillGameById('slope');
    expect(matchesSkillGame(question('m1', 'Math', 'Algebra', 'Linear equations', 'Medium'), slope)).toBe(true);
    expect(matchesSkillGame(question('r1', 'Reading and Writing', 'Algebra', 'Linear equations', 'Medium'), slope)).toBe(false);
    expect(matchesSkillGame(question('m2', 'Math', 'Geometry and Trigonometry', 'Circles', 'Medium'), slope)).toBe(false);
  });

  it('keeps Boss Rush hard-only and words/boundaries skill-scoped', () => {
    const boss = skillGameById('boss');
    expect(matchesSkillGame(question('h1', 'Math', 'Algebra', 'Linear equations', 'Hard'), boss)).toBe(true);
    expect(matchesSkillGame(question('e1', 'Math', 'Algebra', 'Linear equations', 'Easy'), boss)).toBe(false);

    const words = skillGameById('words');
    expect(matchesSkillGame(question('w1', 'Reading and Writing', 'Craft and Structure', 'Words in Context', 'Medium'), words)).toBe(true);
    expect(matchesSkillGame(question('w2', 'Reading and Writing', 'Craft and Structure', 'Text Structure', 'Medium'), words)).toBe(false);
  });
});

describe('persistent arcade question progression', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('never serves a seen question before the unseen pool is exhausted', () => {
    const pool = [
      question('a', 'Math', 'Algebra', 'Linear equations', 'Easy'),
      question('b', 'Math', 'Algebra', 'Linear equations', 'Medium'),
      question('c', 'Math', 'Algebra', 'Linear equations', 'Hard'),
    ];
    markArcadeQuestion('slope', 'a', true);
    const picked = takeArcadeQuestions('slope', pool, 2, 'seed');
    expect(picked.map((item) => item.id)).not.toContain('a');
    expect(new Set(picked.map((item) => item.id)).size).toBe(2);
  });

  it('only raises a tier on first-try correct answers, never on a repeat', () => {
    expect(arcadeLevel('grammar')).toBe(1);
    expect(markArcadeQuestion('grammar', 'q1', true).level).toBe(1);
    expect(markArcadeQuestion('grammar', 'q2', true).level).toBe(2);
    // A repeat cannot add another point, even when it is answered correctly.
    const repeat = markArcadeQuestion('grammar', 'q2', true);
    expect(repeat.newQuestion).toBe(false);
    expect(repeat.level).toBe(2);
    // A wrong first try marks the item seen but adds no level point.
    const missed = markArcadeQuestion('grammar', 'q3', false);
    expect(missed.newQuestion).toBe(true);
    expect(missed.level).toBe(2);
  });

  it('moves the difficulty band up instead of resetting on a new run', () => {
    expect(arcadeDifficultyBand(1)).toEqual(['Easy', 'Medium']);
    expect(arcadeDifficultyBand(3)).toEqual(['Medium', 'Hard']);
    expect(arcadeDifficultyBand(8)).toEqual(['Hard']);
    markArcadeQuestion('algebra', 'band-check', true);
    expect(localStorage.getItem(ARCADE_PROGRESS_KEY)).not.toBeNull();
  });
});
