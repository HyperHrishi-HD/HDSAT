#!/usr/bin/env node
/**
 * Execute the College Board schema migration and local seed in a real
 * PostgreSQL engine through PGlite, twice, then compare every official row and
 * key with the generated public bank.
 *
 * PGlite is not a project dependency. Install it temporarily:
 *
 *   npm install --no-save --prefix .tmp-pglite @electric-sql/pglite@0.6.0
 *   PGLITE_MODULE=./.tmp-pglite/node_modules/@electric-sql/pglite/dist/index.js \\
 *     node tools/verify_collegeboard_sql_pglite.mjs
 *   rm -rf .tmp-pglite
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const pgliteModule = process.env.PGLITE_MODULE;
const pgliteSpecifier = pgliteModule
  ? pathToFileURL(path.resolve(pgliteModule)).href
  : '@electric-sql/pglite';
const { PGlite } = await import(pgliteSpecifier);

const bank = JSON.parse(fs.readFileSync('public/collegeBoardBank.json', 'utf8'));
const migrationSql = fs.readFileSync(
  'supabase/migrations/20261124000100_collegeboard_sat.sql',
  'utf8'
);
const seedSql = fs.readFileSync(
  'supabase/import/collegeboard/0100_collegeboard_sat.sql',
  'utf8'
);

const schema = `
CREATE TABLE public.dataset_sources (
  source_id text PRIMARY KEY,
  name text NOT NULL,
  license text NOT NULL,
  license_url text,
  provenance_summary text NOT NULL,
  is_released_practice_set boolean NOT NULL DEFAULT false,
  is_official_college_board boolean NOT NULL DEFAULT false,
  verified_at timestamptz NOT NULL DEFAULT NOW(),
  record_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE TABLE public.questions (
  id text PRIMARY KEY,
  external_id text UNIQUE,
  assessments text[] NOT NULL DEFAULT ARRAY['SAT']::TEXT[],
  section text NOT NULL,
  domain text NOT NULL,
  skill text NOT NULL,
  difficulty text NOT NULL,
  format text NOT NULL,
  stimulus text,
  prompt text NOT NULL,
  choices jsonb,
  figure_metadata jsonb,
  source_id text NOT NULL REFERENCES public.dataset_sources(source_id),
  source_name text NOT NULL,
  license text NOT NULL,
  attribution text NOT NULL,
  is_released_practice_set boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE TABLE public.question_keys (
  question_id text PRIMARY KEY REFERENCES public.questions(id) ON DELETE CASCADE,
  correct_answer text NOT NULL,
  acceptable_answers text[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  explanation text NOT NULL,
  distractor_rationales jsonb,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
`;

const questionColumns = [
  'id',
  'external_id',
  'assessments',
  'section',
  'domain',
  'skill',
  'difficulty',
  'format',
  'stimulus',
  'prompt',
  'choices',
  'figure_metadata',
  'source_id',
  'source_name',
  'license',
  'attribution',
  'is_released_practice_set',
  'in_practice_test',
  'unusable',
  'score_band',
  'status',
];
const keyColumns = [
  'question_id',
  'correct_answer',
  'acceptable_answers',
  'explanation',
  'distractor_rationales',
];

function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalized(value[key])])
    );
  }
  return value;
}

function equal(left, right) {
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

async function compare(db, label) {
  let rows = 0;
  for (const question of bank.questions) {
    const questionResult = await db.query(
      `SELECT ${questionColumns.join(', ')} FROM public.questions WHERE id = $1`,
      [question.id]
    );
    const keyResult = await db.query(
      `SELECT ${keyColumns.join(', ')} FROM public.question_keys WHERE question_id = $1`,
      [question.id]
    );
    if (questionResult.rows.length !== 1) {
      throw new Error(`${label}: missing question ${question.id}`);
    }
    if (keyResult.rows.length !== 1) {
      throw new Error(`${label}: missing key ${question.id}`);
    }
    const row = questionResult.rows[0];
    const key = keyResult.rows[0];
    for (const column of questionColumns) {
      const expected = column === 'status' ? 'active' : question[column];
      if (!equal(row[column], expected)) {
        throw new Error(
          `${label}: ${question.id}.${column} differs\nsql=${JSON.stringify(normalized(row[column]))}\nbank=${JSON.stringify(normalized(expected))}`
        );
      }
    }
    for (const column of keyColumns) {
      const expected = column === 'question_id' ? question.id : question[column];
      if (!equal(key[column], expected)) {
        throw new Error(
          `${label}: ${question.id} key ${column} differs\nsql=${JSON.stringify(normalized(key[column]))}\nbank=${JSON.stringify(normalized(expected))}`
        );
      }
    }
    rows += 1;
  }
  const counts = await db.query(
    `SELECT (SELECT count(*) FROM public.questions) AS questions,
            (SELECT count(*) FROM public.question_keys) AS keys,
            (SELECT count(*) FROM public.questions WHERE in_practice_test) AS overlap,
            (SELECT count(*) FROM public.questions WHERE unusable) AS unusable,
            (SELECT count(*) FROM public.dataset_sources WHERE source_id = 'collegeboard-sat') AS sources`
  );
  const c = counts.rows[0];
  if (Number(c.questions) !== bank.questions.length || Number(c.keys) !== bank.questions.length) {
    throw new Error(`${label}: unexpected table counts ${JSON.stringify(c)}`);
  }
  if (Number(c.sources) !== 1) throw new Error(`${label}: source row missing`);
  console.log(
    `${label}: ${rows} questions and ${rows} keys match the bank ` +
      `(${c.questions} questions, ${c.keys} keys, ${c.overlap} practice overlap, ${c.unusable} unusable)`
  );
}

const db = new PGlite();
await db.exec(schema);
await db.exec(migrationSql);
await db.exec(seedSql);
await compare(db, 'seed application 1');
await db.exec(seedSql);
await compare(db, 'seed application 2');
await db.close();
console.log('PASS actual PostgreSQL execution (PGlite): migration + seed twice');
