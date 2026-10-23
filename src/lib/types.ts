// Shared domain types for HDSAT.

export type Section = 'Reading and Writing' | 'Math';
export type Difficulty = 'Easy' | 'Medium' | 'Hard';
export type QuestionFormat = 'multiple_choice' | 'spr';
export type Assessment = 'SAT' | 'PSAT/NMSQT' | 'PSAT 10' | 'PSAT 8/9';

export interface Choice {
  id: string;
  text: string;
}

export interface Question {
  id: string;
  external_id: string | null;
  assessments: string[];
  section: Section;
  domain: string;
  skill: string;
  difficulty: Difficulty;
  format: QuestionFormat;
  stimulus: string | null;
  prompt: string;
  choices: Choice[] | null;
  figure_metadata: unknown | null;
  source_id: string;
  source_name: string;
  license: string;
  attribution: string;
  is_released_practice_set: boolean;
  correct_answer: string;
  acceptable_answers: string[];
  explanation: string;
  distractor_rationales: Record<string, string>;
  choice_order_seed?: string | null;
}

export interface DatasetSource {
  source_id: string;
  name: string;
  license: string;
  license_url: string | null;
  provenance_summary: string;
  is_released_practice_set: boolean;
  is_official_college_board: boolean;
  record_count: number;
}

export interface QuestionBank {
  bank_version: string;
  generated_at: string;
  licensing_note: string;
  sources: DatasetSource[];
  questions: Question[];
}

export interface Flashcard {
  id: string;
  deck: 'vocabulary' | 'math_formula';
  front: string;
  back: string;
  latex?: string;
  tags: string[];
}

export interface StudyResource {
  id: string;
  title: string;
  provider: string;
  url: string;
  type: string;
  cost: string;
  description: string;
  tags: string[];
}

export type AttemptMode = 'practice' | 'rush' | 'test' | 'review' | 'game';

export interface LocalAttempt {
  eventId: string;
  questionId: string;
  response: string;
  isCorrect: boolean;
  mode: AttemptMode;
  difficulty: Difficulty;
  section: Section;
  timeSpentSeconds: number;
  createdAt: string;
  sessionId: string | null;
}

export type ProgressStatus = 'unseen' | 'incorrect' | 'correct' | 'mastered';

export interface QuestionProgress {
  questionId: string;
  attemptCount: number;
  correctCount: number;
  consecutiveCorrect: number;
  status: ProgressStatus;
  lastResponse: string;
  lastIsCorrect: boolean;
  lastAttemptedAt: string;
}

export interface DailyActivity {
  date: string;
  questionsCompleted: number;
  correctQuestions: number;
  learningMinutes: number;
  flashcardsReviewed: number;
  coinsEarned: number;
  sessionsCompleted: number;
}

export interface FlashcardProgress {
  cardId: string;
  stage: 'new' | 'learning' | 'review' | 'mastered';
  repetitions: number;
  intervalDays: number;
  easeFactor: number;
  lastQuality: number;
  nextDueAt: string;
  lastReviewedAt: string;
}

export interface TestModuleResult {
  moduleId: string;
  section: Section;
  tier: 'module1' | 'upper' | 'lower';
  correct: number;
  total: number;
  /** Scored (operational) subset; excludes the 2 embedded unscored items. */
  operationalCorrect?: number;
  operationalTotal?: number;
  timedOut: boolean;
  responses: { questionId: string; response: string | null; isCorrect: boolean }[];
}

export interface PausedTestState {
  seed: string;
  excludeReleased: boolean;
  sectionIndex: number;
  stageNumber: 1 | 2;
  tier: 'module1' | 'upper' | 'lower';
  currentIndex: number;
  remainingSeconds: number;
  inSectionBreak: boolean;
  breakSeconds: number;
  pendingNextSectionIdx: number | null;
  responses: Record<string, string>;
  eliminated: Record<string, string[]>;
  flagged: Record<string, boolean>;
  highlights?: Record<
    string,
    { id: string; color: 'yellow' | 'blue' | 'pink'; text: string; note: string }[]
  >;
  seenQuestionIds: string[];
}

export interface TestAttempt {
  id: string;
  assessment: string;
  /** Saved simulations are `completed`; tests left through Exit keep `incomplete`. */
  status?: 'completed' | 'incomplete';
  createdAt: string;
  modules: TestModuleResult[];
  rwEstimate: number | null;
  mathEstimate: number | null;
  totalEstimate: number | null;
  durationSeconds: number;
  pausedState?: PausedTestState;
}

export interface UserSettings {
  assessment: Assessment;
  excludePreviouslyCorrect: boolean;
  excludeReleasedPracticeSet: boolean;
  timerSound: boolean;
  activeTheme?: string | null;
  activeFlair?: string | null;
}

/**
 * One Practice Rush mode combination (duration + section + difficulty).
 * Best/last are points from the rush scoring curve, so the record is
 * comparable inside a combination but not across different durations.
 */
export interface RushScoreRecord {
  best: number;
  last: number;
  bestAt: string | null;
  lastAt: string | null;
  plays: number;
}

export interface LocalProfile {
  version: number;
  createdAt: string;
  hdCoins: number;
  currentStreak: number;
  bestStreak: number;
  lastActiveDate: string | null;
  dailyActivity: Record<string, DailyActivity>;
  achievements: string[];
  ownedItems: string[];
  attempts: LocalAttempt[];
  progress: Record<string, QuestionProgress>;
  saved: string[];
  flashcards: Record<string, FlashcardProgress>;
  testAttempts: TestAttempt[];
  /** Practice Rush personal bests, keyed by `rushSetupKey()` in lib/rush.ts. */
  rushScores: Record<string, RushScoreRecord>;
  settings: UserSettings;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  rewardCoins: number;
}

/** Emblem glyphs each cosmetic can render as in the top bar. */
export type EmblemIcon = 'compass' | 'graph' | 'crown';

export interface StoreItem {
  id: string;
  name: string;
  description: string;
  cost: number;
  slot: 'theme' | 'flair' | 'utility';
  /** Emblem items render this glyph (icon only, never a text label). */
  icon?: EmblemIcon;
}
