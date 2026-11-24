import { existsSync, readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import bankJson from '../data/questionBank.json';
import { buildPracticeSession, buildTestPlan, filterQuestions } from './examEngine';
import { isServableCollegeBoardQuestion } from './questionSources';
import type { QuestionBank } from './types';
import { StimulusView } from '../components/FigureView';
import { MathText, sanitizeHtml } from '../components/MathText';

const officialPath = 'public/collegeBoardBank.json';
const integrationEnabled =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.COLLEGE_BOARD_INTEGRATION === '1';
const curated = bankJson as unknown as QuestionBank;
let official: QuestionBank;

function combinedQuestions() {
  return [
    ...curated.questions,
    ...official.questions.filter(isServableCollegeBoardQuestion),
  ];
}

describe.skipIf(!integrationEnabled)('official College Board integration', () => {
  beforeAll(() => {
    if (!existsSync(officialPath)) throw new Error(`missing ${officialPath}`);
    official = JSON.parse(readFileSync(officialPath, 'utf8')) as QuestionBank;
  });

  it('normalizes a unique, servable, practice-test-aware pool', () => {
    expect(official.questions.length).toBe(3663);
    expect(new Set(official.questions.map((q) => q.id)).size).toBe(official.questions.length);
    expect(official.questions.some((q) => q.in_practice_test)).toBe(true);
    expect(official.questions.every((q) => q.source_id === 'collegeboard-sat')).toBe(true);
    expect(JSON.stringify(official.questions)).not.toContain('<mfenced');
    expect(official.questions.some((q) => q.format === 'spr')).toBe(true);
  });

  it('builds full tests with official rows and excludes overlap/unusable rows', () => {
    const plan = buildTestPlan(combinedQuestions(), { assessment: 'SAT', seed: 'cb:full-test' });
    let officialCount = 0;
    for (const section of plan.sections) {
      for (const module of [section.module1, section.upper, section.lower]) {
        expect(module.questions).toHaveLength(section.section === 'Math' ? 22 : 27);
        for (const q of module.questions) {
          expect(q.in_practice_test).not.toBe(true);
          expect(q.unusable).not.toBe(true);
          if (q.source_id === 'collegeboard-sat') officialCount += 1;
        }
      }
    }
    expect(officialCount).toBeGreaterThan(100);
  });

  it('keeps pre-integration v1 resume plans byte-for-byte curated', () => {
    const combinedV1 = buildTestPlan(combinedQuestions(), {
      assessment: 'SAT',
      seed: 'cb:v1-resume',
      algorithm: 1,
    });
    const curatedV1 = buildTestPlan(curated.questions, {
      assessment: 'SAT',
      seed: 'cb:v1-resume',
      algorithm: 1,
    });
    expect(combinedV1.sections.flatMap((s) => s.module1.questions.map((q) => q.id))).toEqual(
      curatedV1.sections.flatMap((s) => s.module1.questions.map((q) => q.id))
    );
  });

  it('exposes official questions as a selectable practice dataset', () => {
    const all = filterQuestions(combinedQuestions(), {});
    const officialOnly = filterQuestions(official!.questions, {
      sourceId: 'collegeboard-sat',
    });
    expect(officialOnly).toHaveLength(official!.questions.length);
    expect(officialOnly.every((q) => q.source_id === 'collegeboard-sat')).toBe(true);
    expect(all.filter((q) => q.source_id === 'collegeboard-sat')).toHaveLength(1644);
    expect(all.some((q) => q.source_id !== 'collegeboard-sat')).toBe(true);

    const blended = buildPracticeSession(
      combinedQuestions(),
      { section: 'all' },
      { count: 40, seed: 'cb:blend' }
    );
    expect(new Set(blended.map((q) => q.source_id)).size).toBeGreaterThan(1);

    const session = buildPracticeSession(
      official!.questions,
      { section: 'Math', sourceId: 'collegeboard-sat' },
      { count: 20, seed: 'cb:practice' }
    );
    expect(session).toHaveLength(20);
    expect(session.every((q) => q.source_id === 'collegeboard-sat')).toBe(true);
    expect(session.every((q) => !q.unusable)).toBe(true);
  });

  it('removes official overlap and unusable rows from filters and assembly eligibility', () => {
    const practice = official!.questions.find((q) => q.in_practice_test)!;
    const clean = official!.questions.find((q) => !q.in_practice_test && !q.unusable)!;
    expect(isServableCollegeBoardQuestion(practice)).toBe(false);
    expect(isServableCollegeBoardQuestion(clean)).toBe(true);
    expect(filterQuestions(official!.questions, {})).not.toContainEqual(practice);
    // The Bank catalogue opts in so every item is browsable; practice draws
    // keep the reservation because they do not pass this flag.
    expect(
      filterQuestions(official!.questions, { includePracticeTestOverlap: true })
    ).toContainEqual(practice);
  });

  it('renders official HTML, MathML, SVG and tables without flattening them', () => {
    const rw = official.questions.find(
      (q) => !q.in_practice_test && q.section === 'Reading and Writing' && q.stimulus?.includes('<p')
    )!;
    const math = official.questions.find(
      (q) => !q.in_practice_test && q.section === 'Math' && q.prompt.includes('<math')
    )!;
    const graphic = official.questions.find(
      (q) => !q.in_practice_test && (q.stimulus?.includes('<svg') || q.prompt.includes('<svg'))
    )!;
    const stimulusHtml = renderToStaticMarkup(<StimulusView stimulus={rw.stimulus} />);
    expect(stimulusHtml).toContain('stimulus-html');
    expect(stimulusHtml).toContain('<p');

    const promptHtml = renderToStaticMarkup(<MathText text={math.prompt} />);
    expect(promptHtml).toContain('rich-html');
    expect(promptHtml).toContain('<math');
    expect(promptHtml).toContain('<mi>');

    const graphicSource = `${graphic.prompt}\n${graphic.stimulus ?? ''}`;
    const graphicHtml = renderToStaticMarkup(
      <MathText text={graphicSource} />
    );
    expect(graphicHtml).toContain('<svg');
  });

  it('sanitizes executable markup while keeping semantic math and figures', () => {
    const clean = sanitizeHtml(
      '<p onclick="alert(1)">Keep <math><mi>x</mi></math></p>' +
        '<script>alert(2)</script><svg onload="alert(3)"><circle /></svg>' +
        '<a href="javascript:alert(4)">bad</a>'
    );
    expect(clean).toContain('<math>');
    expect(clean).toContain('<svg');
    expect(clean).not.toContain('script');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('onload');
    expect(clean).not.toContain('javascript:');
  });
});
