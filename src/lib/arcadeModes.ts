import type { Difficulty, Question, Section } from './types';

/**
 * The eight quick drills added to Skill Mini-Games.
 *
 * They deliberately share the existing question view and scoring loop: a mode
 * is a filter, a clock and a promise, not another bespoke screen. A student can
 * learn one set of controls and play all of them.
 */

export type SkillGameId =
  | 'slope'
  | 'data'
  | 'grammar'
  | 'evidence'
  | 'boundaries'
  | 'words'
  | 'algebra'
  | 'boss';

export interface SkillGameMode {
  id: SkillGameId;
  name: string;
  blurb: string;
  icon: 'graph' | 'compass' | 'spark' | 'library' | 'clipboard-check' | 'bank' | 'zap' | 'crown';
  seconds: number;
  section?: Section;
  domain?: string;
  skillIncludes?: string;
  difficulty?: Difficulty;
}

export const SKILL_GAME_MODES: SkillGameMode[] = [
  {
    id: 'slope',
    name: 'Slope Sprint',
    blurb: 'Read the line and pick the slope before the clock wins.',
    icon: 'graph',
    seconds: 60,
    section: 'Math',
    domain: 'Algebra',
  },
  {
    id: 'data',
    name: 'Data Dash',
    blurb: 'Tables, charts and samples under a short clock.',
    icon: 'compass',
    seconds: 60,
    section: 'Math',
    domain: 'Problem-Solving and Data Analysis',
  },
  {
    id: 'grammar',
    name: 'Grammar Gauntlet',
    blurb: 'Standard English conventions, one clean choice at a time.',
    icon: 'clipboard-check',
    seconds: 60,
    section: 'Reading and Writing',
    domain: 'Standard English Conventions',
  },
  {
    id: 'evidence',
    name: 'Evidence Ladder',
    blurb: 'Find the sentence that actually earns the claim.',
    icon: 'library',
    seconds: 60,
    section: 'Reading and Writing',
    domain: 'Information and Ideas',
  },
  {
    id: 'boundaries',
    name: 'Boundary Blitz',
    blurb: 'Clauses, commas and sentence boundaries at speed.',
    icon: 'spark',
    seconds: 45,
    section: 'Reading and Writing',
    skillIncludes: 'Boundaries',
  },
  {
    id: 'words',
    name: 'Word Current',
    blurb: 'Words in context, with the passage still in view.',
    icon: 'bank',
    seconds: 45,
    section: 'Reading and Writing',
    skillIncludes: 'Words in Context',
  },
  {
    id: 'algebra',
    name: 'Algebra Engine',
    blurb: 'Longer algebra run for building a reliable rhythm.',
    icon: 'zap',
    seconds: 90,
    section: 'Math',
    domain: 'Algebra',
  },
  {
    id: 'boss',
    name: 'Boss Rush',
    blurb: 'Hard mixed items. No warm-up, no easy draw.',
    icon: 'crown',
    seconds: 90,
    difficulty: 'Hard',
  },
];

export function skillGameById(id: SkillGameId): SkillGameMode {
  return SKILL_GAME_MODES.find((mode) => mode.id === id) ?? SKILL_GAME_MODES[0];
}

export function matchesSkillGame(question: Question, mode: SkillGameMode): boolean {
  if (mode.section && question.section !== mode.section) return false;
  if (mode.domain && question.domain !== mode.domain) return false;
  if (mode.skillIncludes && !question.skill.toLowerCase().includes(mode.skillIncludes.toLowerCase())) {
    return false;
  }
  if (mode.difficulty && question.difficulty !== mode.difficulty) return false;
  return true;
}
