import { questionFamilyKeys } from './examEngine';
import type { Difficulty, Question, Section } from './types';

/**
 * A read-only summary of the bundled bank, for the operator console.
 *
 * It answers the questions that actually decide whether the bank is healthy:
 * are the two sections balanced, is any item missing a key or an explanation,
 * and how much of the bank sits in a family with more than one member (the
 * near-duplicate debt that makes a student feel they have seen a question
 * before). Nothing here changes the bank; it only reports.
 */
export interface SectionHealth {
  section: Section;
  count: number;
  easy: number;
  medium: number;
  hard: number;
}

export interface ContentHealth {
  total: number;
  sections: SectionHealth[];
  /** Items short of the larger section; 0 when the two are within 5%. */
  parityGap: number;
  /** Family keys shared by two or more items. */
  duplicateFamilies: number;
  /** Items that sit in one of those families. */
  duplicateItems: number;
  largestFamily: number;
  missingExplanation: number;
  missingKey: number;
  missingPrompt: number;
  multipleChoiceWithoutChoices: number;
  withFigure: number;
  withStimulus: number;
}

const EMPTY_SECTION = (section: Section): SectionHealth => ({
  section,
  count: 0,
  easy: 0,
  medium: 0,
  hard: 0,
});

export function contentHealth(questions: Question[]): ContentHealth {
  const sections = new Map<Section, SectionHealth>([
    ['Reading and Writing', EMPTY_SECTION('Reading and Writing')],
    ['Math', EMPTY_SECTION('Math')],
  ]);
  const families = new Map<string, number>();
  let missingExplanation = 0;
  let missingKey = 0;
  let missingPrompt = 0;
  let multipleChoiceWithoutChoices = 0;
  let withFigure = 0;
  let withStimulus = 0;

  for (const question of questions) {
    const entry = sections.get(question.section) ?? EMPTY_SECTION(question.section);
    entry.count += 1;
    const band: Difficulty = question.difficulty;
    if (band === 'Easy') entry.easy += 1;
    else if (band === 'Hard') entry.hard += 1;
    else entry.medium += 1;
    sections.set(question.section, entry);

    for (const key of questionFamilyKeys(question)) {
      families.set(key, (families.get(key) ?? 0) + 1);
    }

    if (!question.explanation?.trim()) missingExplanation += 1;
    if (!question.correct_answer?.trim()) missingKey += 1;
    if (!question.prompt?.trim()) missingPrompt += 1;
    if (question.format === 'multiple_choice' && !(question.choices && question.choices.length >= 2)) {
      multipleChoiceWithoutChoices += 1;
    }
    if (question.figure_metadata) withFigure += 1;
    if (question.stimulus) withStimulus += 1;
  }

  let duplicateFamilies = 0;
  let duplicateItems = 0;
  let largestFamily = 0;
  for (const size of families.values()) {
    if (size > 1) {
      duplicateFamilies += 1;
      duplicateItems += size;
    }
    if (size > largestFamily) largestFamily = size;
  }

  const list = [...sections.values()].sort((a, b) => b.count - a.count);
  const counts = list.map((entry) => entry.count);
  const gap = counts.length > 1 ? counts[0] - counts[counts.length - 1] : 0;
  const parityGap = gap / Math.max(1, counts[0]) <= 0.05 ? 0 : gap;

  return {
    total: questions.length,
    sections: list,
    parityGap,
    duplicateFamilies,
    duplicateItems,
    largestFamily,
    missingExplanation,
    missingKey,
    missingPrompt,
    multipleChoiceWithoutChoices,
    withFigure,
    withStimulus,
  };
}
