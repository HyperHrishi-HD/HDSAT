#!/usr/bin/env node
/**
 * Make the official College Board pool present for a dev/build checkout.
 *
 * The normalized pool is deliberately gitignored question content, so it must
 * never be committed. This command is the reproducible build-time step:
 *
 *   - an existing, valid public/collegeBoardBank.json is accepted immediately;
 *   - otherwise the public API is harvested and normalized locally;
 *   - a missing network, Python runtime, or incomplete harvest fails loudly.
 *
 * Run automatically by `npm run dev` and `npm run build` (predev/prebuild).
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(ROOT, 'public', 'collegeBoardBank.json');
const HARVEST = join(ROOT, 'tools', '.collegeboard', 'cb_sat_bank.json');
const HARVEST_REPORT = join(ROOT, 'tools', '.collegeboard', 'harvest_report.json');
const SOURCE_ID = 'collegeboard-sat';
const MIN_QUESTIONS = 3000;

function fail(message) {
  console.error(`\n[collegeboard] ERROR: ${message}`);
  console.error(
    '[collegeboard] The official bank is required. Fix access to the public ' +
      'College Board API (or restore a valid local cache) and rerun the command.'
  );
  process.exit(1);
}

function validate(path) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`could not parse ${path}: ${error.message}`);
  }
  const questions = parsed?.questions;
  if (!Array.isArray(questions) || questions.length < MIN_QUESTIONS) {
    fail(
      `${path} must contain at least ${MIN_QUESTIONS} official questions; ` +
        `found ${Array.isArray(questions) ? questions.length : 'no question array'}.`
    );
  }
  const ids = new Set();
  for (const question of questions) {
    if (!question || question.source_id !== SOURCE_ID || !question.id) {
      fail(`${path} contains an invalid official question row.`);
    }
    if (ids.has(question.id)) fail(`${path} contains duplicate question id ${question.id}.`);
    ids.add(question.id);
  }
  const source = (parsed.sources ?? []).find((item) => item?.source_id === SOURCE_ID);
  if (!source) fail(`${path} has no ${SOURCE_ID} source registration.`);
  if (Number(source.record_count) !== questions.length) {
    fail(
      `${path} source record_count ${source.record_count} does not match ${questions.length} rows.`
    );
  }
  return parsed;
}

function pythonCommand() {
  const candidates =
    process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { cwd: ROOT, stdio: 'ignore' });
    if (probe.status === 0) return candidate;
  }
  fail('Python 3 was not found; it is required to generate the official bank.');
}

function run(command, args) {
  console.log(`[collegeboard] ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} exited with status ${result.status}.`);
}

if (existsSync(OUTPUT)) {
  const parsed = validate(OUTPUT);
  console.log(
    `[collegeboard] Official bank ready: ${parsed.questions.length} questions at public/collegeBoardBank.json`
  );
  process.exit(0);
}

const python = pythonCommand();
console.log(
  '[collegeboard] Official bank is absent; harvesting the public College Board question bank...'
);
run(python, ['tools/collegeboard_harvest.py', '--workers', '6']);
if (existsSync(HARVEST_REPORT)) {
  try {
    const report = JSON.parse(readFileSync(HARVEST_REPORT, 'utf8'));
    const failures = report?.content_failures ?? [];
    const downloaded = Number(report?.content_downloaded ?? 0);
    if (failures.length > 0) {
      fail(`harvest completed with ${failures.length} content failure(s).`);
    }
    if (downloaded < MIN_QUESTIONS) {
      fail(`harvest produced only ${downloaded} complete questions.`);
    }
  } catch (error) {
    if (error?.message?.startsWith('harvest completed')) throw error;
    fail(`could not read ${HARVEST_REPORT}: ${error.message}`);
  }
}
if (!existsSync(HARVEST)) fail(`harvester did not write ${HARVEST}.`);
run(python, ['tools/collegeboard_normalize.py']);
const parsed = validate(OUTPUT);
console.log(
  `[collegeboard] Generated official bank: ${parsed.questions.length} questions at public/collegeBoardBank.json`
);
