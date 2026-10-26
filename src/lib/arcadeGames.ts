import {
  buildFamilyHistory,
  preferFreshFamilies,
  questionFamilyKeys,
  seededShuffle,
} from './examEngine';
import type { Question, QuestionProgress } from './types';

/**
 * Shared, pure helpers for the Arcade's 2D games.
 *
 * Everything here is deterministic from a seed so a run can be rebuilt from
 * its seed (useful in tests) while two students starting at the same moment
 * still get different rooms and conversations. No React, no DOM: the games
 * own their rendering, this file owns the data.
 */

export interface ArcadeChoice {
  id: string;
  text: string;
}

export interface ChatItem {
  key: string;
  questionId: string;
  skill: string;
  difficulty: string;
  stimulus: string | null;
  prompt: string;
  choices: ArcadeChoice[];
  correctId: string;
  /** Plain-language explanation, spoken by the character after a miss. */
  explanation: string;
}

export interface RuneItem {
  key: string;
  questionId: string;
  section: 'Reading and Writing' | 'Math';
  skill: string;
  format: 'multiple_choice' | 'spr';
  stimulus: string | null;
  prompt: string;
  choices: ArcadeChoice[] | null;
  correctId: string;
  answer: string;
  acceptable: string[];
  explanation: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Torch {
  x: number;
  y: number;
}

/** A walkable slab. `ground` slabs are the floor; the rest are ledges. */
export interface Platform extends Rect {
  id: string;
  /** `ledge` is served by a rope; `step` is a jumpable platform in a route. */
  kind: 'ground' | 'ledge' | 'step';
}

/** A pushable stone crate. Solid once at rest; can be stood on. */
export interface Crate extends Rect {
  id: string;
  vy: number;
}

/**
 * A door is the moving part of the vault. A `bridge` becomes walkable when its
 * lever is pulled (it is raised and useless until then); a `portcullis` is the
 * opposite — it blocks the corridor until the lever lifts it.
 */
export interface Door extends Rect {
  id: string;
  kind: 'bridge' | 'portcullis';
  leverId: string;
  /** True when pulling the lever makes the door solid. */
  solidWhenPulled: boolean;
}

export interface Lever {
  id: string;
  x: number;
  y: number;
  doorId: string;
}

/** A climbable vertical: a rung ladder or a knotted rope. Same physics. */
export interface Ladder extends Rect {
  id: string;
  kind: 'ladder' | 'rope';
}

/** A barrier taller than a standing jump. Its top is walkable. */
export interface Wall extends Rect {
  id: string;
}

export type HazardKind = 'spikes' | 'trap';

/** Ground-level danger: iron spikes or a bear trap. */
export interface Hazard extends Rect {
  id: string;
  kind: HazardKind;
}

/** A snake that chases the player along its stretch of floor. */
export interface Snake {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  from: number;
  to: number;
  dir: 1 | -1;
  speed: number;
}

export interface Room {
  stage: number;
  width: number;
  height: number;
  groundY: number;
  platforms: Platform[];
  crates: Crate[];
  doors: Door[];
  levers: Lever[];
  torches: Torch[];
  ladders: Ladder[];
  walls: Wall[];
  hazards: Hazard[];
  snakes: Snake[];
  spawn: { x: number; y: number };
  gate: Rect;
}

/** A lever counts as thrown once the player is this close to its handle. */
export const LEVER_REACH = 46;

export function leverPulled(leverId: string, pulled: Iterable<string>): boolean {
  for (const id of pulled) if (id === leverId) return true;
  return false;
}

/** Whether a door currently stops the player (walkable bridge / closed bars). */
export function doorSolid(door: Door, pulled: Iterable<string>): boolean {
  const on = leverPulled(door.leverId, pulled);
  return door.solidWhenPulled ? on : !on;
}

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/** Small deterministic generator (mulberry32) for layout decisions. */
export function makeRng(seed: string): () => number {
  let state = hash(seed) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function choiceList(question: Question): ArcadeChoice[] | null {
  if (question.format !== 'multiple_choice' || !question.choices) return null;
  return question.choices.map((c) => ({ id: c.id, text: c.text }));
}

/* --------------------------------------------------------------------------
 Coordinate Interceptor: waves that can actually be cleared
-------------------------------------------------------------------------- */

export interface TargetDrift {
  ampX: number;
  ampY: number;
  speedX: number;
  speedY: number;
  phaseX: number;
  phaseY: number;
}

export interface InterceptTarget {
  id: string;
  x: number;
  y: number;
  /** Game state: set once the target has been intercepted. */
  hit?: boolean;
  /** An asteroid sits still; a silver ship nudges around its point on the curve. */
  kind?: 'asteroid' | 'ship';
  drift?: TargetDrift;
}

/**
 * A wave is one curve, never a scatter of points: a straight line early, a
 * parabola from wave five on so the second firing mode has something to shoot
 * at. The three coefficients are exported flat so the renderer and the hit test
 * read the same numbers.
 */
export interface InterceptWave {
  /** The wave number this design belongs to. */
  stage: number;
  /** 'line' for y = mx + b, 'parabola' for y = a(x - h)^2 + k. */
  kind: 'line' | 'parabola';
  m: number;
  b: number;
  a: number;
  h: number;
  k: number;
  targets: InterceptTarget[];
}

/** Where a target actually is right now (ships drift, asteroids do not). */
export function targetPosition(
  target: InterceptTarget,
  time: number
): { x: number; y: number } {
  const drift = target.drift;
  if (!drift) return { x: target.x, y: target.y };
  return {
    x: target.x + Math.sin(time * drift.speedX + drift.phaseX) * drift.ampX,
    y: target.y + Math.sin(time * drift.speedY + drift.phaseY) * drift.ampY,
  };
}

/** y for a wave's own curve, used by both the drawing and the hit test. */
export function waveY(wave: InterceptWave, x: number): number {
  return wave.kind === 'line' ? wave.m * x + wave.b : wave.a * (x - wave.h) ** 2 + wave.k;
}

/** Slopes a whole-number coordinate grid can express cleanly. */
const WAVE_SLOPES = [1, -1, 2, -2, 0.5, -0.5, 1.5, -1.5];
export const WAVE_X_LIMIT = 5;
export const WAVE_Y_LIMIT = 3;

/**
 * One wave of asteroids, all lying on the same line.
 *
 * The old waves scattered points at random, which made a wave impossible to
 * clear with three pulses. A wave is now generated *from* a line: pick a slope
 * and intercept with nice numbers, then place targets on integer coordinates
 * along it. The player's job is to recover the line from the printed
 * coordinates — the exact skill "which point lies on the line" tests — and a
 * clear is always one line away.
 */
/** Parabola presets whose integer points all fit on the board. */
const WAVE_PARABOLAS = [
  { a: -0.25, h: -1, k: 2 },
  { a: -0.25, h: 1, k: 2 },
  { a: 0.25, h: 0, k: -2 },
  { a: 0.25, h: -1, k: -1 },
  { a: -0.25, h: 0, k: 1 },
];

/** The wave a run's first silver ship appears in: three or four, never one. */
export function firstShipWave(seed: string): number {
  return 3 + (hash(`${seed}:ships`) % 2);
}

function makeShip(id: string, x: number, y: number, seed: string): InterceptTarget {
  const rng = makeRng(`${seed}:ship:${id}`);
  return {
    id,
    x,
    y,
    kind: 'ship',
    drift: {
      // Small, slow nudges around the point on the curve: enough that a shot
      // has to be timed, small enough that the ship never wanders off screen.
      ampX: 0.18 + rng() * 0.16,
      ampY: 0.34 + rng() * 0.2,
      speedX: 0.65 + rng() * 0.45,
      speedY: 0.8 + rng() * 0.6,
      phaseX: rng() * Math.PI * 2,
      phaseY: rng() * Math.PI * 2,
    },
  };
}

export function buildInterceptWave(
  wave: number,
  seed = 'intercept',
  rng: () => number = makeRng(`${seed}:wave:${wave}`)
): InterceptWave {
  const parabola = wave >= 5 && wave % 2 === 1;

  if (parabola) {
    const preset = WAVE_PARABOLAS[Math.floor(rng() * WAVE_PARABOLAS.length)];
    const xs: number[] = [];
    for (let x = preset.h - 4; x <= preset.h + 4; x += 2) {
      if (Math.abs(x) > WAVE_X_LIMIT) continue;
      const y = preset.a * (x - preset.h) ** 2 + preset.k;
      if (Math.abs(y) > WAVE_Y_LIMIT) continue;
      xs.push(x);
    }
    const targets: InterceptTarget[] = xs.map((x) => {
      const y = preset.a * (x - preset.h) ** 2 + preset.k;
      return { id: `${x},${y}`, x, y };
    });
    if (wave >= firstShipWave(seed) && targets.length > 2) {
      const anchor = targets[Math.floor(targets.length / 2)];
      const ship = makeShip(`ship-${anchor.x},${anchor.y}`, anchor.x, anchor.y, `${seed}:${wave}`);
      targets[Math.floor(targets.length / 2)] = ship;
    }
    return {
      stage: wave,
      kind: 'parabola',
      m: 0,
      b: 0,
      a: preset.a,
      h: preset.h,
      k: preset.k,
      targets,
    };
  }

  const wanted = Math.min(2 + Math.floor((wave + 1) / 2), 5);

  const candidates = (m: number, b: number) => {
    const xs: number[] = [];
    for (let x = -WAVE_X_LIMIT; x <= WAVE_X_LIMIT; x += 1) {
      const y = m * x + b;
      if (!Number.isInteger(y) || Math.abs(y) > WAVE_Y_LIMIT) continue;
      if (Math.abs(y) + Math.abs(x) < 2) continue; // not the lazy centre point
      xs.push(x);
    }
    return xs;
  };

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const m = WAVE_SLOPES[Math.floor(rng() * WAVE_SLOPES.length)];
    const b = Math.round((rng() * 2 - 1) * 2);
    const xs = candidates(m, b);
    if (xs.length < 2) continue;
    const picked = seededShuffle(xs, `${seed}:wave:${wave}:${m}:${b}`)
      .slice(0, Math.min(wanted, xs.length))
      .sort((a, b2) => a - b2);
    const targets: InterceptTarget[] = picked.map((x) => {
      const y = m * x + b;
      return { id: `${x},${y}`, x, y };
    });
    if (wave >= firstShipWave(seed) && targets.length > 2) {
      const index = 1 + Math.floor(rng() * (targets.length - 2));
      const anchor = targets[index];
      targets[index] = makeShip(
        `ship-${anchor.x},${anchor.y}`,
        anchor.x,
        anchor.y,
        `${seed}:${wave}`
      );
    }
    return { stage: wave, kind: 'line', m, b, a: 0, h: 0, k: 0, targets };
  }

  // Defensive fallback: a two-target wave on y = x, which always exists.
  return {
    stage: wave,
    kind: 'line',
    m: 1,
    b: 0,
    a: 0,
    h: 0,
    k: 0,
    targets: [
      { id: '-3,-3', x: -3, y: -3 },
      { id: '3,3', x: 3, y: 3 },
    ],
  };
}

/** Targets within `tolerance` game units of the line y = mx + b. */
export function targetsOnLine(
  targets: InterceptTarget[],
  m: number,
  b: number,
  tolerance: number
): InterceptTarget[] {
  return targets.filter((t) => Math.abs(m * t.x + b - t.y) <= tolerance);
}

/**
 * Targets under the current aim — a line or a parabola, at time `time` so a
 * nudging ship is judged where it is drawn, not where it started. The beam and
 * the hit test share this function, which is what stops the old drift between
 * the dashed line and what it actually hit.
 */
export function targetsOnAim(
  targets: InterceptTarget[],
  aim:
    | { mode: 'linear'; m: number; b: number }
    | { mode: 'quadratic'; a: number; h: number; k: number },
  tolerance: number,
  time = 0
): InterceptTarget[] {
  return targets.filter((target) => {
    const at = targetPosition(target, time);
    const expected =
      aim.mode === 'linear'
        ? aim.m * at.x + aim.b
        : aim.a * (at.x - aim.h) ** 2 + aim.k;
    return Math.abs(expected - at.y) <= tolerance;
  });
}

/* --------------------------------------------------------------------------
 Table Talk pools
-------------------------------------------------------------------------- */

/**
 * Conversation pool: Reading & Writing, four-way multiple choice only, text
 * passages first (a conversation reads better when the student has something
 * to react to).
 */
/**
 * One item per family, in draw order. A conversation (or a vault run) that
 * asked two variants of the same template would feel broken even when the
 * generated numbers differ, so the pool never contains a family twice.
 */
function uniqueFamilies(pool: Question[]): Question[] {
  const usedKeys = new Set<string>();
  const out: Question[] = [];
  for (const q of pool) {
    const keys = questionFamilyKeys(q);
    if (keys.some((key) => usedKeys.has(key))) continue;
    for (const key of keys) usedKeys.add(key);
    out.push(q);
  }
  return out;
}

export function buildChatPool(
  questions: Question[],
  seed: string,
  limit = 40,
  progress: Record<string, QuestionProgress> = {}
): ChatItem[] {
  const eligible = questions.filter(
    (q) =>
      q.section === 'Reading and Writing' &&
      q.format === 'multiple_choice' &&
      !q.figure_metadata &&
      Boolean(q.choices) &&
      (q.choices as ArcadeChoice[]).length === 4
  );
  const history = buildFamilyHistory(questions, progress);
  const withText = seededShuffle(
    eligible.filter((q) => Boolean(q.stimulus && q.stimulus.trim().length > 40)),
    `${seed}:text`
  );
  const withoutText = seededShuffle(
    eligible.filter((q) => !q.stimulus || q.stimulus.trim().length <= 40),
    `${seed}:prompt`
  );
  const ordered = uniqueFamilies(
    preferFreshFamilies([...withText, ...withoutText], history)
  );
  return ordered.slice(0, limit).map((q) => ({
    key: `chat-${q.id}`,
    questionId: q.id,
    skill: q.skill,
    difficulty: q.difficulty,
    stimulus: q.stimulus ?? null,
    prompt: q.prompt,
    choices: q.choices as ArcadeChoice[],
    correctId: q.correct_answer,
    explanation: q.explanation,
  }));
}

/**
 * Rune-vault pool: an even split of Reading & Writing and Math, mixing
 * multiple choice with student-produced responses so the rooms alternate
 * between choosing and typing.
 */
export function buildRunePool(
  questions: Question[],
  seed: string,
  perSection = 30,
  progress: Record<string, QuestionProgress> = {}
): RuneItem[] {
  const history = buildFamilyHistory(questions, progress);
  const pick = (section: 'Reading and Writing' | 'Math') =>
    uniqueFamilies(
      preferFreshFamilies(
        seededShuffle(
          questions.filter(
            (q) =>
              q.section === section &&
              (q.format === 'spr' ? q.acceptable_answers.length > 0 || q.correct_answer : Boolean(q.choices))
          ),
          `${seed}:${section}`
        ),
        history
      )
    ).slice(0, perSection);

  const rw = pick('Reading and Writing');
  const math = pick('Math');
  const mixed: Question[] = [];
  const longest = Math.max(rw.length, math.length);
  for (let i = 0; i < longest; i += 1) {
    if (rw[i]) mixed.push(rw[i]);
    if (math[i]) mixed.push(math[i]);
  }

  return mixed.map((q) => ({
    key: `rune-${q.id}`,
    questionId: q.id,
    section: q.section,
    skill: q.skill,
    format: q.format,
    stimulus: q.stimulus ?? null,
    prompt: q.prompt,
    choices: choiceList(q),
    correctId: q.correct_answer,
    answer: q.correct_answer,
    acceptable: q.acceptable_answers ?? [],
    explanation: q.explanation,
  }));
}

/* --------------------------------------------------------------------------
 Answer checking
-------------------------------------------------------------------------- */

/** Normalises a typed numeric answer: "1,200" and " 1200 " both become "1200". */
export function normaliseSpr(value: string): string {
  return value
    .trim()
    .replace(/[$,\s]/g, '')
    .replace(/^\+/, '')
    .toLowerCase();
}

export function checkSpr(item: RuneItem, value: string): boolean {
  const given = normaliseSpr(value);
  if (!given) return false;
  const accepted = [item.answer, ...item.acceptable].map(normaliseSpr).filter(Boolean);
  return accepted.includes(given);
}

/* --------------------------------------------------------------------------
 The Rune Vault: procedural rooms
-------------------------------------------------------------------------- */

/**
 * The vault is a schedule with a dice roll inside it, not a dice roll dressed
 * as a schedule. Each mechanic has the room it first appears in, and every room
 * is built out of blocks that start on solid ground: a pit always has a run-up,
 * a lever always stands on floor, a rope always reaches past the ledge it
 * serves, and a wall is always climbable.
 *
 * Room one is not an empty corridor any more. The first descent already has a
 * chasm, a rope up to a ledge and a crate that gets you over a wall. Spikes,
 * machinery, bear traps and snakes join one at a time after that, and by the
 * tenth room everything is mixed.
 */
type BlockKind =
  | 'flat'
  | 'pit'
  | 'machine'
  | 'climb'
  | 'wall'
  | 'spikes'
  | 'trap'
  | 'snake'
  | 'route'
  | 'highroute';

const VAULT_GROUND_Y = 400;
const VAULT_HEIGHT = 460;
const VAULT_SPAWN_X = 56;
const WALL_HEIGHT = 112;

/** The room each mechanic first appears in. */
const BLOCK_FROM: Record<Exclude<BlockKind, 'flat'>, number> = {
  pit: 1,
  climb: 1,
  wall: 1,
  spikes: 2,
  route: 2,
  machine: 3,
  highroute: 3,
  trap: 4,
  snake: 5,
};

/** What this room actually contains, for the live hint under the title. */
export function describeRoom(room: Room): string {
  const parts: string[] = [];
  if (room.hazards.some((h) => h.kind === 'spikes')) parts.push('spikes');
  if (room.hazards.some((h) => h.kind === 'trap')) parts.push('bear traps');
  if (room.doors.some((d) => d.kind === 'bridge')) parts.push('drawbridge');
  if (room.doors.some((d) => d.kind === 'portcullis')) parts.push('portcullis');
  if (room.walls.length > 0) parts.push('stone walls');
  if (room.ladders.some((l) => l.kind === 'rope')) parts.push('ropes');
  if (room.ladders.some((l) => l.kind === 'ladder')) parts.push('ladders');
  if (room.crates.length > 0) parts.push(room.crates.length > 1 ? 'crates' : 'crate');
  if (room.snakes.length > 0) parts.push(room.snakes.length > 1 ? 'snakes' : 'a snake');
  if (room.platforms.some((p) => p.kind === 'ledge')) parts.push('ledges');
  if (room.platforms.some((p) => p.kind === 'step')) parts.push('platforms');
  return parts.join(' · ');
}

export function generateRoom(stage: number, seed: string): Room {
  const rng = makeRng(`${seed}:room:${stage}`);
  const groundY = VAULT_GROUND_Y;

  const ground: Platform[] = [];
  const crates: Crate[] = [];
  const doors: Door[] = [];
  const levers: Lever[] = [];
  const ladders: Ladder[] = [];
  const walls: Wall[] = [];
  const hazards: Hazard[] = [];
  const snakes: Snake[] = [];

  const slab = (x: number, w: number) => {
    if (w <= 0) return;
    ground.push({
      id: `ground-${ground.length}`,
      kind: 'ground',
      x: Math.round(x),
      y: groundY,
      w: Math.round(w),
      h: 60,
    });
  };

  const addCrate = (x: number) => {
    if (x < 60) return;
    if (crates.some((other) => Math.abs(other.x - x) < 44)) return;
    if (levers.some((lever) => Math.abs(lever.x - x) < 60)) return;
    crates.push({
      id: `crate-${crates.length}`,
      x: Math.round(x),
      y: groundY - 40,
      w: 40,
      h: 40,
      vy: 0,
    });
  };

  // --- what this room is made of -----------------------------------------
  const unlocked = (Object.keys(BLOCK_FROM) as Exclude<BlockKind, 'flat'>[]).filter(
    (kind) => stage >= BLOCK_FROM[kind]
  );
  const newest = unlocked.reduce((best, kind) =>
    BLOCK_FROM[kind] > BLOCK_FROM[best] ? kind : best
  );
  const rest = seededShuffle(
    unlocked.filter((kind) => kind !== newest),
    `${seed}:order:${stage}`
  );
  // Rooms grow denser as the descent goes on: five pieces from the first room,
  // one more every two rooms, capped so a single room never becomes a slog.
  const want = Math.min(5 + Math.floor(stage / 2), 12);
  const blocks: BlockKind[] = [newest, ...rest].slice(0, want);
  // Pad with plain ground, never with a mechanic that is not unlocked yet.
  while (blocks.length < want) blocks.push(rng() < 0.5 ? 'flat' : 'pit');

  let cursor = 0;
  slab(cursor, 320);
  cursor += 320;

  for (const kind of blocks) {
    switch (kind) {
      case 'flat': {
        const w = 190 + Math.round(rng() * 80);
        slab(cursor, w);
        cursor += w;
        break;
      }
      case 'pit': {
        slab(cursor, 190);
        cursor += 190;
        // 96–122px is a comfortable hop: the jump carries about 170px.
        cursor += 96 + Math.round(rng() * 26);
        break;
      }
      case 'climb': {
        // A rope over a chasm. The ledge it serves is a bridge: the gap below
        // is wider than any jump, so the rope has a reason to exist and the
        // room cannot be walked through without it.
        const approach = 230;
        const gap = 205;
        const landing = 90;
        slab(cursor, approach);
        slab(cursor + approach + gap, landing);
        const ladderX = cursor + 120;
        const ledgeY = groundY - 236;
        // The climb ends with the feet on the ledge's top edge, so the rope's
        // top is the ledge surface — not ten pixels above it, which left the
        // player hanging over a lip they could not stand on.
        ladders.push({
          id: `ladder-${ladders.length}`,
          kind: rng() < 0.5 ? 'ladder' : 'rope',
          x: ladderX,
          y: ledgeY,
          w: 16,
          h: groundY - ledgeY,
        });
        // The ledge reaches back under the whole climb band and carries on past
        // the far edge of the chasm, so both the climb and the landing have
        // floor under them.
        const ledgeEnd = cursor + approach + gap + 44;
        ground.push({
          id: `ledge-${ground.length}`,
          kind: 'ledge',
          x: ladderX - 30,
          y: ledgeY,
          w: ledgeEnd - (ladderX - 30),
          h: 16,
        });
        cursor += approach + gap + landing;
        break;
      }
      case 'route': {
        // A stepping-stone route over a spike strip: the ground is passable
        // only with a running jump, and the platforms are the safe line.
        const w = 430;
        slab(cursor, w);
        hazards.push({
          id: `spikes-${hazards.length}`,
          kind: 'spikes',
          x: cursor + 132,
          y: groundY - 14,
          w: 148,
          h: 14,
        });
        const steps = [
          { dx: 40, top: 74, w: 100 },
          { dx: 170, top: 128, w: 96 },
          { dx: 300, top: 78, w: 104 },
        ];
        for (const step of steps) {
          ground.push({
            id: `step-${ground.length}`,
            kind: 'step',
            x: cursor + step.dx,
            y: groundY - step.top,
            w: step.w,
            h: 12,
          });
        }
        // From the fourth room the strip is patrolled as well: the safe line
        // stays safe, the ground route costs more than a jump.
        if (stage >= 4) {
          hazards.push({
            id: `trap-${hazards.length}`,
            kind: 'trap',
            x: cursor + 312,
            y: groundY - 12,
            w: 30,
            h: 12,
          });
        }
        cursor += w;
        break;
      }
      case 'highroute': {
        // A climb that is the only way across: a spike bed wider than any jump,
        // reached up a rope, crossed on a broken ledge. The first shelf carries
        // the climb; the second is a hop away and carries on past the spikes,
        // so the ladder has a job rather than standing in a corridor for show.
        const w = 548;
        slab(cursor, w);
        const ladderX = cursor + 84;
        const ledgeY = groundY - 214;
        ladders.push({
          id: `ladder-${ladders.length}`,
          kind: rng() < 0.5 ? 'rope' : 'ladder',
          x: ladderX,
          y: ledgeY,
          w: 16,
          h: groundY - ledgeY,
        });
        hazards.push({
          id: `spikes-${hazards.length}`,
          kind: 'spikes',
          x: cursor + 168,
          y: groundY - 14,
          w: 300,
          h: 14,
        });
        const firstEnd = ladderX + 190;
        ground.push({
          id: `step-${ground.length}`,
          kind: 'step',
          x: ladderX - 34,
          y: ledgeY,
          w: firstEnd - (ladderX - 34),
          h: 14,
        });
        const secondStart = firstEnd + 84;
        ground.push({
          id: `step-${ground.length}`,
          kind: 'step',
          x: secondStart,
          y: ledgeY,
          w: cursor + w - 46 - secondStart,
          h: 14,
        });
        cursor += w;
        break;
      }
      case 'wall': {
        const w = 330;
        slab(cursor, w);
        const wallX = cursor + 220;
        walls.push({
          id: `wall-${walls.length}`,
          x: wallX,
          y: groundY - WALL_HEIGHT,
          w: 16,
          h: WALL_HEIGHT,
        });
        if (rng() < 0.5) {
          // A rope on the near face. It tops out well above the wall — ten
          // pixels was not enough room to step across — so the climb clears the
          // cap and a step right puts you on the top.
          ladders.push({
            id: `ladder-${ladders.length}`,
            kind: 'rope',
            x: wallX - 34,
            y: groundY - WALL_HEIGHT - 30,
            w: 16,
            h: WALL_HEIGHT + 30,
          });
        } else {
          // No rope: a crate is the step. Two from room four, side by side, so
          // the player can practise shoving a row.
          addCrate(wallX - 196);
          if (stage >= 4) addCrate(wallX - 150);
        }
        cursor += w;
        break;
      }
      case 'spikes': {
        const w = 252;
        slab(cursor, w);
        hazards.push({
          id: `spikes-${hazards.length}`,
          kind: 'spikes',
          x: cursor + 118,
          y: groundY - 14,
          w: 52,
          h: 14,
        });
        cursor += w;
        break;
      }
      case 'trap': {
        const w = 244;
        slab(cursor, w);
        hazards.push({
          id: `trap-${hazards.length}`,
          kind: 'trap',
          x: cursor + 128,
          y: groundY - 12,
          w: 30,
          h: 12,
        });
        cursor += w;
        break;
      }
      case 'snake': {
        // From the seventh room the floor is long enough for two of them, and
        // they get faster with every descent after that — never faster than a
        // walk, so the chase is always something the player can break away
        // from.
        const count = stage >= 7 ? 2 : 1;
        const w = count === 2 ? 420 : 320;
        slab(cursor, w);
        const band = w / count;
        for (let index = 0; index < count; index += 1) {
          const from = cursor + 24 + index * band;
          snakes.push({
            id: `snake-${snakes.length}`,
            x: from + 30,
            y: groundY - 18,
            w: 46,
            h: 16,
            from,
            to: from + band - 40,
            dir: 1,
            speed: 62 + Math.round(rng() * 18) + Math.min(stage * 4, 56),
          });
        }
        cursor += w;
        break;
      }
      case 'machine': {
        const w = 240;
        slab(cursor, w);
        const gapX = cursor + w;
        const leverId = `lever-${levers.length}`;
        const doorId = `door-${doors.length}`;
        const bridge = rng() < 0.55;
        if (bridge) {
          const gap = 202 + Math.round(rng() * 20);
          doors.push({
            id: doorId,
            kind: 'bridge',
            x: gapX - 4,
            y: groundY,
            w: gap + 8,
            h: 12,
            leverId,
            solidWhenPulled: true,
          });
          levers.push({ id: leverId, x: gapX - 92, y: groundY - 26, doorId });
          cursor = gapX + gap;
        } else {
          const gap = 118 + Math.round(rng() * 16);
          const after = gapX + gap;
          slab(after, 240);
          doors.push({
            id: doorId,
            kind: 'portcullis',
            x: after + 152,
            y: groundY - 118,
            w: 16,
            h: 118,
            leverId,
            solidWhenPulled: false,
          });
          levers.push({ id: leverId, x: gapX - 92, y: groundY - 26, doorId });
          cursor = after + 240;
        }
        break;
      }
      default:
        break;
    }
  }

  // --- the gate approach -------------------------------------------------
  slab(cursor, 260);
  cursor += 260;
  const width = cursor;
  const gate: Rect = { x: width - 118, y: groundY - 96, w: 54, h: 96 };

  // --- torches ------------------------------------------------------------
  const torches: Torch[] = [];
  let torchX = 96;
  while (torchX < gate.x - 40) {
    torches.push({ x: torchX + Math.round((rng() - 0.5) * 28), y: 168 + Math.round(rng() * 36) });
    torchX += 236;
  }
  torches.push({ x: gate.x - 26, y: 232 });

  return {
    stage,
    width,
    height: VAULT_HEIGHT,
    groundY,
    platforms: ground,
    crates,
    doors,
    levers,
    torches,
    ladders,
    walls,
    hazards,
    snakes,
    spawn: { x: VAULT_SPAWN_X, y: groundY - 44 },
    gate,
  };
}
