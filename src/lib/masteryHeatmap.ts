import type { Assessment, Difficulty, Question, QuestionProgress } from './types';

/**
 * Dashboard mastery heatmap vocabulary.
 *
 * The bank has accumulated a few legacy skill labels over time (for example
 * `Command of Evidence (Textual)` and `Command of Evidence (Quantitative)`).
 * The heatmap presents the 29 SAT skill groups once, under their domain, while
 * still aggregating every matching legacy row. A question is counted at its
 * current difficulty from the same progress record Domain Mastery uses.
 */
export interface HeatmapCell {
  attempts: number;
  correct: number;
}

export interface HeatmapSkill {
  domain: string;
  section: 'Reading and Writing' | 'Math';
  skill: string;
}

export interface HeatmapDomain {
  domain: string;
  section: 'Reading and Writing' | 'Math';
  skills: HeatmapSkill[];
}

const DOMAIN_DEFINITIONS: {
  domain: string;
  section: HeatmapDomain['section'];
  skills: string[];
}[] = [
  {
    domain: 'Craft and Structure',
    section: 'Reading and Writing',
    skills: ['Words in Context', 'Text Structure and Purpose', 'Cross-Text Connections'],
  },
  {
    domain: 'Information and Ideas',
    section: 'Reading and Writing',
    skills: ['Central Ideas and Details', 'Command of Evidence', 'Inferences'],
  },
  {
    domain: 'Standard English Conventions',
    section: 'Reading and Writing',
    skills: ['Boundaries', 'Form, Structure, and Sense'],
  },
  {
    domain: 'Expression of Ideas',
    section: 'Reading and Writing',
    skills: ['Transitions', 'Rhetorical Synthesis'],
  },
  {
    domain: 'Algebra',
    section: 'Math',
    skills: [
      'Linear equations in one variable',
      'Linear functions',
      'Systems of two linear equations',
      'Linear inequalities',
    ],
  },
  {
    domain: 'Advanced Math',
    section: 'Math',
    skills: [
      'Equivalent expressions',
      'Nonlinear functions',
      'Nonlinear equations',
      'Exponential growth and decay',
      'Quadratic functions and factoring',
      'Operations with exponents',
    ],
  },
  {
    domain: 'Problem-Solving and Data Analysis',
    section: 'Math',
    skills: [
      'Percentages',
      'One-variable data and center',
      'Probability',
      'Inference from samples',
      'Unit rates and conversions',
    ],
  },
  {
    domain: 'Geometry and Trigonometry',
    section: 'Math',
    skills: [
      'Area and volume',
      'Lines, angles, and triangles',
      'Right triangles and trigonometry',
      'Circles',
    ],
  },
];

export const HEATMAP_DOMAINS: HeatmapDomain[] = DOMAIN_DEFINITIONS.map((entry) => ({
  ...entry,
  skills: entry.skills.map((skill) => ({ domain: entry.domain, section: entry.section, skill })),
}));

export const HEATMAP_SKILLS: HeatmapSkill[] = HEATMAP_DOMAINS.flatMap((domain) => domain.skills);

export const HEATMAP_DIFFICULTIES: Difficulty[] = ['Easy', 'Medium', 'Hard'];

const NORMALIZED = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

const SKILL_ALIASES: Record<string, string> = {
  'command of evidence (textual)': 'Command of Evidence',
  'command of evidence (quantitative)': 'Command of Evidence',
  'linear functions: slope and intercepts': 'Linear functions',
  'systems of two linear equations in two variables': 'Systems of two linear equations',
  'linear inequalities in one or two variables': 'Linear inequalities',
  'absolute value equations and inequalities': 'Linear equations in one variable',
  'quadratic functions': 'Quadratic functions and factoring',
  'quadratic functions: vertex and symmetry': 'Quadratic functions and factoring',
  'factoring quadratics and zeros': 'Quadratic functions and factoring',
  'polynomial functions and zeros': 'Quadratic functions and factoring',
  'function composition and evaluation': 'Nonlinear functions',
  'nonlinear equations in one variable and systems of equations in two variables':
    'Nonlinear equations',
  'operations with exponents': 'Operations with exponents',
  'one-variable data: distributions and measures of center and spread':
    'One-variable data and center',
  'mean, median and mode': 'One-variable data and center',
  'inference from sample statistics and margin of error': 'Inference from samples',
  'probability and conditional probability': 'Probability',
  'right triangles and trigonometric ratios': 'Right triangles and trigonometry',
  'right triangles': 'Right triangles and trigonometry',
  'circles: area and circumference': 'Circles',
  'circles: equations in standard form': 'Circles',
  'volume and surface area': 'Area and volume',
  'lines and angles': 'Lines, angles, and triangles',
};

export function canonicalHeatmapSkill(domain: string, skill: string): string | null {
  const normalizedSkill = NORMALIZED(skill);
  const domainEntry = HEATMAP_DOMAINS.find((entry) => NORMALIZED(entry.domain) === NORMALIZED(domain));
  if (!domainEntry) return null;
  if (domainEntry.skills.some((entry) => NORMALIZED(entry.skill) === normalizedSkill)) {
    return domainEntry.skills.find((entry) => NORMALIZED(entry.skill) === normalizedSkill)!.skill;
  }
  const alias = SKILL_ALIASES[normalizedSkill];
  if (alias && domainEntry.skills.some((entry) => entry.skill === alias)) return alias;
  return null;
}

export interface MasteryHeatmapRow extends HeatmapSkill {
  cells: Record<Difficulty, HeatmapCell>;
}

export interface MasteryHeatmapDomain extends Omit<HeatmapDomain, 'skills'> {
  rows: MasteryHeatmapRow[];
}

/**
 * Aggregate the all-time progress counters by skill and difficulty. `progress`
 * is the same map Domain Mastery uses; no source separation is applied because
 * the local progress record does not carry a verified-pool flag.
 */
export function buildMasteryHeatmap(
  questions: Question[],
  progress: Record<string, QuestionProgress>,
  assessment: Assessment | string
): MasteryHeatmapDomain[] {
  const rows = new Map<string, MasteryHeatmapRow>();
  for (const domain of HEATMAP_DOMAINS) {
    for (const skill of domain.skills) {
      rows.set(`${domain.domain}|${skill.skill}`, {
        ...skill,
        cells: {
          Easy: { attempts: 0, correct: 0 },
          Medium: { attempts: 0, correct: 0 },
          Hard: { attempts: 0, correct: 0 },
        },
      });
    }
  }

  for (const question of questions) {
    if (!question.assessments.includes(String(assessment))) continue;
    const canonical = canonicalHeatmapSkill(question.domain, question.skill);
    if (!canonical) continue;
    const row = rows.get(`${question.domain}|${canonical}`);
    if (!row) continue;
    const cell = row.cells[question.difficulty];
    if (!cell) continue;
    const record = progress[question.id];
    cell.attempts += record?.attemptCount ?? 0;
    cell.correct += record?.correctCount ?? 0;
  }

  return HEATMAP_DOMAINS.map((domain) => ({
    domain: domain.domain,
    section: domain.section,
    rows: domain.skills.map((skill) => rows.get(`${domain.domain}|${skill.skill}`)!),
  }));
}

export function heatmapAccuracy(cell: HeatmapCell): number | null {
  if (cell.attempts <= 0) return null;
  return Math.round((Math.max(0, Math.min(cell.correct, cell.attempts)) / cell.attempts) * 100);
}

export interface MasteryRadarAxis {
  domain: string;
  section: 'Reading and Writing' | 'Math';
  attempts: number;
  correct: number;
  accuracy: number | null;
}

/**
 * Collapse the per-skill heatmap rows into one accuracy value per domain, the
 * shape the dashboard radar plots. `difficulty: 'all'` keeps every attempt;
 * a single difficulty slices the same records the old three columns showed.
 */
export function buildMasteryRadar(
  domains: MasteryHeatmapDomain[],
  difficulty: Difficulty | 'all' = 'all'
): MasteryRadarAxis[] {
  return domains.map((domain) => {
    let attempts = 0;
    let correct = 0;
    for (const row of domain.rows) {
      const cells =
        difficulty === 'all'
          ? HEATMAP_DIFFICULTIES.map((entry) => row.cells[entry])
          : [row.cells[difficulty]];
      for (const cell of cells) {
        if (!cell) continue;
        attempts += cell.attempts;
        correct += Math.max(0, Math.min(cell.correct, cell.attempts));
      }
    }
    return {
      domain: domain.domain,
      section: domain.section,
      attempts,
      correct,
      accuracy: attempts > 0 ? Math.round((correct / attempts) * 100) : null,
    };
  });
}
