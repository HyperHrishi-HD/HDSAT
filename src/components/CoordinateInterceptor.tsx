import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { GameShell } from './GameShell';
import { FigureView, StimulusView } from './FigureView';
import { DesmosPane } from './MathTools';
import { MathText } from './MathText';
import { ReferenceWindow } from './ReferenceWindow';
import { PaneSwitch, SplitWorkbench, useSplitPane } from './SplitWorkbench';
import { Badge, Button, Card, Icon, Stat } from './ui';
import {
  buildInterceptWave,
  makeRng,
  targetPosition,
  targetsOnAim,
  type InterceptTarget,
  type InterceptWave,
} from '../lib/arcadeGames';
import { useCanvasFit } from '../lib/canvasFit';
import { buildFamilyHistory, preferFreshFamilies } from '../lib/examEngine';
import { newEventId } from '../lib/storage';
import { useApp } from '../lib/store';
import type { Question } from '../lib/types';

/**
 * Coordinate Interceptor — the Arcade's space-shooter take on y = mx + b.
 *
 * The board is a true Cartesian plane: one unit is 75px on *both* axes, so a
 * slope of 1 draws at exactly 45° and the beam you aim is the same curve the
 * hit test checks. Early waves are straight lines with every coordinate printed
 * and the targets marked LOCK; later waves hide labels, add silver ships that
 * nudge around their point on the curve, and from wave five alternate into
 * parabolas, which need the second firing mode.
 *
 * Aim by dragging on the plane, with the sliders, with WASD / arrows, or with
 * the touch sliders. Space swaps linear and quadratic; Enter fires.
 */

const RUN_SECONDS = 75;
const VIEW_W = 900;
const VIEW_H = 480;
const UNIT = 75; // pixels per unit on both axes
const X_LIMIT = 6; // x runs -6..6
const BEST_KEY = 'hdsat.interceptor.best.v1';
const LAST_KEY = 'hdsat.interceptor.last.v1';

export function pulsesFor(wave: number): number {
  if (wave <= 4) return 3;
  return 2;
}

export function toleranceFor(wave: number): number {
  if (wave <= 4) return 0.24; // ≈18px either side
  if (wave <= 7) return 0.2;
  return 0.17;
}

/** Waves that still mark the targets already on your aim. */
const LOCK_UNTIL = 4;

/**
 * LOCK is a teaching aid, so it exists for the first four straight waves *and*
 * for the first parabola waves. The parabolas start at wave 5, and turning the
 * mark off exactly when the harder mode arrives meant a quadratic shot had no
 * feedback at all; waves 5 and 7 keep it, and from wave 8 the curve is on you.
 * The mark follows the *aim*, so switching to quadratic during an early wave
 * still marks the targets the curve passes through.
 */
export function locksEnabled(wave: number, kind: 'line' | 'parabola' = 'line'): boolean {
  if (wave <= LOCK_UNTIL) return true;
  return kind === 'parabola' && wave <= LOCK_UNTIL + 3;
}

/** How many coordinate labels are hidden: never the two outermost. */
export function hiddenLabelsFor(wave: number, count: number, kind: 'line' | 'parabola' = 'line'): number {
  // A curve needs three printed points to be solvable, so parabola waves keep
  // every coordinate on the board.
  if (kind === 'parabola') return 0;
  if (wave <= 2 || count <= 2) return 0;
  if (wave <= 4) return Math.min(1, count - 2);
  if (wave <= 6) return Math.min(2, count - 2);
  return Math.max(0, count - 2);
}

function loadNumber(key: string): number {
  try {
    return Number(localStorage.getItem(key) ?? '0') || 0;
  } catch {
    return 0;
  }
}

function saveNumber(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* device storage unavailable; the run still scores */
  }
}

const SLOPE_MIN = -3;
const SLOPE_MAX = 3;
const STEP_M = 0.1;
const STEP_B = 0.1;
const B_MIN = -3.2;
const B_MAX = 3.2;

const A_MIN = -1;
const A_MAX = 1;
const STEP_A = 0.05;
const H_MIN = -4;
const H_MAX = 4;
const STEP_H = 0.25;
const K_MIN = -4;
const K_MAX = 4;
const STEP_K = 0.1;

export const toX = (x: number) => (x + X_LIMIT) * UNIT;
export const toY = (y: number) => VIEW_H / 2 - y * UNIT;
const fromX = (px: number) => px / UNIT - X_LIMIT;
const fromY = (py: number) => (VIEW_H / 2 - py) / UNIT;

type Aim =
  | { mode: 'linear'; m: number; b: number }
  | { mode: 'quadratic'; a: number; h: number; k: number };

interface Star {
  x: number;
  y: number;
  r: number;
  depth: number;
  phase: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  hue: number;
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  life: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/** A stable, slightly irregular rock outline per target. */
function asteroidShape(id: string): number[] {
  const seed = hash(id);
  const points: number[] = [];
  for (let i = 0; i < 9; i += 1) {
    const jitter = ((seed >> (i * 3)) & 7) / 7;
    points.push(0.76 + jitter * 0.34);
  }
  return points;
}

export function CoordinateInterceptor() {
  const app = useApp();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const seedRef = useRef(`intercept:${Date.now()}`);

  const [mode, setMode] = useState<'linear' | 'quadratic'>('linear');
  const [m, setM] = useState(0.5);
  const [b, setB] = useState(0);
  const [a, setA] = useState(-0.25);
  const [h, setH] = useState(0);
  const [k, setK] = useState(0);
  const [wave, setWave] = useState<InterceptWave>(() => buildInterceptWave(1, seedRef.current));
  const [pulses, setPulses] = useState(pulsesFor(1));
  const [score, setScore] = useState(0);
  const [best, setBest] = useState<number>(() => loadNumber(BEST_KEY));
  const [last, setLast] = useState<number>(() => loadNumber(LAST_KEY));
  const [hits, setHits] = useState(0);
  const [shots, setShots] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(RUN_SECONDS);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // The break is a real pause: the clock stops, the room stops, and the only
  // thing moving is the question.
  const [breakQuestion, setBreakQuestion] = useState<Question | null>(null);
  const [breakPick, setBreakPick] = useState<string | null>(null);
  const [breakScore, setBreakScore] = useState<'right' | 'wrong' | null>(null);
  const [pendingWave, setPendingWave] = useState(1);

  const sessionRef = useRef<string>(newEventId());
  const scoreRef = useRef(0);
  const hitsRef = useRef(0);
  const shotsRef = useRef(0);
  const runCompleteRef = useRef(false);
  const startedRef = useRef(0);
  const nextBreakRef = useRef(3);
  const breakUsedRef = useRef<Set<string>>(new Set());
  const paused = breakQuestion !== null;

  // Render state lives in refs so the animation loop never has to be rebuilt
  // when the aim changes.
  const aimRef = useRef<Aim>({ mode: 'linear', m: 0.5, b: 0 });
  const waveRef = useRef<InterceptWave>(wave);
  const lockRef = useRef<InterceptTarget[]>([]);
  const beamRef = useRef<{ at: number; aim: Aim; hit: boolean } | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const floatsRef = useRef<FloatText[]>([]);
  const starsRef = useRef<Star[]>([]);
  const shakeRef = useRef(0);
  const timeRef = useRef(0);
  const dragRef = useRef<{ anchorY: number } | null>(null);

  const waveNumber = wave.stage;
  const tolerance = toleranceFor(waveNumber);

  const aim: Aim = useMemo(
    () =>
      mode === 'linear'
        ? { mode: 'linear', m, b }
        : { mode: 'quadratic', a, h, k },
    [mode, m, b, a, h, k]
  );
  const aimMemo = aim;

  useEffect(() => {
    aimRef.current = aimMemo;
    // LOCK is training wheels: it is switched off once the labels start
    // thinning out, so late waves make you trust the arithmetic.
    lockRef.current = locksEnabled(waveNumber, wave.kind)
      ? targetsOnAim(wave.targets.filter((t) => !t.hit), aimMemo, tolerance, timeRef.current)
      : [];
  }, [aimMemo, tolerance, wave, waveNumber]);

  useEffect(() => {
    waveRef.current = wave;
  }, [wave]);

  const live = useMemo(() => wave.targets.filter((t) => !t.hit).length, [wave]);
  const locks = useMemo(
    () =>
      locksEnabled(waveNumber, wave.kind)
        ? targetsOnAim(wave.targets.filter((t) => !t.hit), aimMemo, tolerance, timeRef.current)
            .length
        : 0,
    [wave, aimMemo, tolerance, waveNumber]
  );

  // Late waves hide the middle labels; the two outermost always stay printed.
  const hiddenIds = useMemo(() => {
    const sorted = [...wave.targets].sort((p, q) => p.x - q.x);
    const hide = hiddenLabelsFor(waveNumber, sorted.length, wave.kind);
    if (hide <= 0) return new Set<string>();
    const middle = sorted.slice(1, sorted.length - 1);
    return new Set(middle.slice(0, hide).map((t) => t.id));
  }, [wave, waveNumber]);
  const hiddenRef = useRef<Set<string>>(hiddenIds);
  useEffect(() => {
    hiddenRef.current = hiddenIds;
  }, [hiddenIds]);

  const endRun = useCallback(async () => {
    if (runCompleteRef.current) return;
    runCompleteRef.current = true;
    setRunning(false);
    setFinished(true);
    setBreakQuestion(null);
    const finalScore = scoreRef.current;
    setLast(finalScore);
    saveNumber(LAST_KEY, finalScore);
    setBest((previous) => {
      const next = Math.max(previous, finalScore);
      saveNumber(BEST_KEY, next);
      return next;
    });
    const timeSpent = Math.max(1, Math.round((Date.now() - startedRef.current) / 1000));
    if (shotsRef.current > 0) {
      await app.actions.completeSession({
        activityType: 'mini_game',
        sessionId: sessionRef.current,
        // One beam can intercept several targets, so the item count has to
        // cover the interceptions too: hits can never exceed items.
        questions: Math.max(3, shotsRef.current, hitsRef.current),
        correct: hitsRef.current,
        timeSpentSeconds: timeSpent,
      });
    }
  }, [app.actions]);

  // The clock only runs while the board is live; a math break freezes it.
  useEffect(() => {
    if (!running || paused) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          void endRun();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running, paused, endRun]);

  const loadWave = useCallback((waveData: InterceptWave) => {
    setWave(waveData);
    setPulses(pulsesFor(waveData.stage));
  }, []);

  const openBreak = useCallback(
    (nextWave: number) => {
      const pool = app.questions.filter(
        (question) =>
          question.section === 'Math' &&
          question.format === 'multiple_choice' &&
          Array.isArray(question.choices) &&
          question.choices.length === 4 &&
          !breakUsedRef.current.has(question.id)
      );
      if (pool.length === 0) return false;
      // A break is still a study mode: draw from the same family-spaced pool as
      // practice and the vault instead of a flat random pick, which could serve
      // a near-duplicate of something answered an hour ago.
      const ranked = preferFreshFamilies(pool, buildFamilyHistory(app.questions, app.progress));
      const window = ranked.slice(0, Math.min(12, ranked.length));
      const picked = window[Math.floor(Math.random() * window.length)];
      breakUsedRef.current.add(picked.id);
      setBreakQuestion(picked);
      setBreakPick(null);
      setBreakScore(null);
      setPendingWave(nextWave);
      setMessage(null);
      return true;
    },
    [app.questions, app.progress]
  );

  const start = () => {
    seedRef.current = `intercept:${Date.now()}`;
    sessionRef.current = newEventId();
    runCompleteRef.current = false;
    scoreRef.current = 0;
    hitsRef.current = 0;
    shotsRef.current = 0;
    startedRef.current = Date.now();
    particlesRef.current = [];
    floatsRef.current = [];
    beamRef.current = null;
    shakeRef.current = 0;
    breakUsedRef.current = new Set();
    // First break lands after two to five cleared waves.
    nextBreakRef.current = 3 + Math.floor(Math.random() * 4);
    const first = buildInterceptWave(1, seedRef.current);
    setMode('linear');
    setM(0.5);
    setB(0);
    setA(-0.25);
    setH(0);
    setK(0);
    setWave(first);
    setPulses(pulsesFor(1));
    setScore(0);
    setHits(0);
    setShots(0);
    setSecondsLeft(RUN_SECONDS);
    setMessage(null);
    setBreakQuestion(null);
    setBreakPick(null);
    setBreakScore(null);
    setFinished(false);
    setRunning(true);
  };

  const nextWaveNumber = (current: InterceptWave) => current.stage + 1;

  const afterWave = useCallback(
    (nextWave: number) => {
      // The threshold only moves when a break is actually taken; re-rolling it
      // on every wave would push it forward faster than the wave count and the
      // break would never arrive.
      if (nextWave >= nextBreakRef.current && openBreak(nextWave)) return;
      const data = buildInterceptWave(nextWave, seedRef.current);
      loadWave(data);
    },
    [loadWave, openBreak]
  );

  const resumeFromBreak = () => {
    const nextWave = pendingWave;
    nextBreakRef.current = nextWave + 2 + Math.floor(Math.random() * 4);
    setBreakQuestion(null);
    setBreakPick(null);
    setBreakScore(null);
    const data = buildInterceptWave(nextWave, seedRef.current);
    loadWave(data);
  };

  const answerBreak = (question: Question, choiceId: string) => {
    if (breakPick) return;
    setBreakPick(choiceId);
    const right = choiceId === question.correct_answer;
    setBreakScore(right ? 'right' : 'wrong');
    if (right) {
      scoreRef.current += 15;
      setScore(scoreRef.current);
    }
  };

  const burst = (x: number, y: number, hue: number, count: number) => {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 3.2;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        max: 1,
        hue,
      });
    }
  };

  const fire = useCallback(() => {
    if (!running || paused || pulses <= 0) return;
    const current = waveRef.current;
    const remaining = current.targets.filter((t) => !t.hit);
    if (remaining.length === 0) return;
    const aimNow = aimRef.current;
    const struck = targetsOnAim(remaining, aimNow, tolerance, timeRef.current);
    const nextShots = shotsRef.current + 1;
    shotsRef.current = nextShots;
    setShots(nextShots);
    beamRef.current = { at: performance.now(), aim: aimNow, hit: struck.length > 0 };

    if (struck.length === 0) {
      setPulses((p) => p - 1);
      shakeRef.current = 6;
      setMessage('Missed — read the curve, then fire again.');
      return;
    }

    const now = timeRef.current;
    for (const target of struck) {
      const at = targetPosition(target, now);
      burst(at.x, at.y, target.kind === 'ship' ? 205 : 150, 20);
    }
    shakeRef.current = struck.length > 1 ? 5 : 3;

    const nextTargets = current.targets.map((t) =>
      struck.some((s) => s.id === t.id) ? { ...t, hit: true } : t
    );
    const cleared = nextTargets.every((t) => t.hit);
    const gained = struck.length * 10 + (cleared ? 15 : 0) + struck.filter((t) => t.kind === 'ship').length * 10;
    const nextScore = scoreRef.current + gained;
    const nextHits = hitsRef.current + struck.length;
    scoreRef.current = nextScore;
    hitsRef.current = nextHits;
    setScore(nextScore);
    setHits(nextHits);
    setWave({ ...current, targets: nextTargets });
    floatsRef.current.push({
      x: struck[0].x,
      y: struck[0].y + 0.4,
      text: `+${gained}`,
      life: 1,
    });

    if (cleared) {
      setMessage(`Wave cleared — +${gained} points.`);
      const next = nextWaveNumber(current);
      window.setTimeout(() => afterWave(next), 620);
      return;
    }

    setPulses((p) => p - 1);
    setMessage(
      `Intercepted ${struck.length} of ${remaining.length} — the same curve works, tune one value.`
    );
    if (pulses - 1 <= 0) {
      const next = nextWaveNumber(current);
      window.setTimeout(() => {
        afterWave(next);
        setMessage('Out of pulses — fresh wave, fresh coordinates.');
      }, 700);
    }
  }, [running, paused, pulses, tolerance, afterWave]);

  const toggleMode = useCallback(() => {
    setMode((value) => (value === 'linear' ? 'quadratic' : 'linear'));
  }, []);

  // Keyboard aiming, while a run is live: W/S (or ↑/↓) tilt the line or open
  // the parabola, A/D (or ←/→) slide it, Q/E — or Shift with ←/→ — raise the
  // parabola's vertex, space swaps modes and Enter fires. Ignored inside fields
  // and on focused buttons, so it can never steal a keystroke from an answer box
  // or a tool window.
  useEffect(() => {
    if (!running || paused) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'BUTTON' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      // Shift + ←/→ changes the parabola's width, the same job Q/E does, so the
      // hand can stay on the arrow cluster.
      if (
        mode === 'quadratic' &&
        event.shiftKey &&
        (key === 'arrowleft' || key === 'arrowright')
      ) {
        event.preventDefault();
        setA((value) =>
          clamp(
            Number((value + (key === 'arrowright' ? STEP_A : -STEP_A)).toFixed(2)),
            A_MIN,
            A_MAX
          )
        );
        return;
      }
      if (key === 'arrowleft' || key === 'a') {
        // Left/right tilt the line; on a parabola they slide the vertex.
        event.preventDefault();
        if (mode === 'linear') {
          setM((value) => clamp(Number((value - STEP_M).toFixed(2)), SLOPE_MIN, SLOPE_MAX));
        } else {
          setH((value) => clamp(Number((value - STEP_H).toFixed(2)), H_MIN, H_MAX));
        }
      } else if (key === 'arrowright' || key === 'd') {
        event.preventDefault();
        if (mode === 'linear') {
          setM((value) => clamp(Number((value + STEP_M).toFixed(2)), SLOPE_MIN, SLOPE_MAX));
        } else {
          setH((value) => clamp(Number((value + STEP_H).toFixed(2)), H_MIN, H_MAX));
        }
      } else if (key === 'arrowup' || key === 'w') {
        // Up/down raise and lower the intercept, which is the motion a player
        // expects from those keys; on a parabola they raise and lower k.
        event.preventDefault();
        if (mode === 'linear') {
          setB((value) => clamp(Number((value + STEP_B).toFixed(2)), B_MIN, B_MAX));
        } else {
          setK((value) => clamp(Number((value + STEP_K).toFixed(2)), K_MIN, K_MAX));
        }
      } else if (key === 'arrowdown' || key === 's') {
        event.preventDefault();
        if (mode === 'linear') {
          setB((value) => clamp(Number((value - STEP_B).toFixed(2)), B_MIN, B_MAX));
        } else {
          setK((value) => clamp(Number((value - STEP_K).toFixed(2)), K_MIN, K_MAX));
        }
      } else if (key === 'q' || key === 'e') {
        event.preventDefault();
        setA((value) =>
          clamp(
            Number((value + (key === 'e' ? STEP_A : -STEP_A)).toFixed(2)),
            A_MIN,
            A_MAX
          )
        );
      } else if (event.key === ' ') {
        event.preventDefault();
        toggleMode();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        fire();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, paused, fire, mode, toggleMode]);

  // The board fills whatever box it has — inline, and edge to edge in full
  // screen — while keeping the plane square. It also re-measures when a break
  // closes, because the board was unmounted while the question was up.
  useCanvasFit(canvasRef, boardRef, VIEW_W, VIEW_H, running && !paused);

  // Drag aiming: a line drawn from the ship's anchor through the finger.
  const pointerToGame = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * VIEW_W;
    const py = ((event.clientY - rect.top) / rect.height) * VIEW_H;
    return { x: fromX(px), y: fromY(py) };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!running || paused) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { anchorY: b - X_LIMIT * m };
    aimAt(event);
  };

  const aimAt = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const point = pointerToGame(event);
    if (!drag || !point) return;
    if (mode !== 'linear') return; // drag is a straight-line gesture
    const run = point.x + X_LIMIT;
    if (run < 0.35) return;
    const nextM = clamp((point.y - drag.anchorY) / run, SLOPE_MIN, SLOPE_MAX);
    const snappedM = Number(nextM.toFixed(2));
    setM(snappedM);
    setB(clamp(Number((drag.anchorY + X_LIMIT * snappedM).toFixed(2)), B_MIN, B_MAX));
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    aimAt(event);
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  // One animation loop for the whole run: stars drift, targets nudge on their
  // own axes, the beam decays, particles fall, the screen shakes.
  useEffect(() => {
    if (!running || paused) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (starsRef.current.length === 0) {
      const rng = makeRng(`${seedRef.current}:stars`);
      const stars: Star[] = [];
      for (let i = 0; i < 140; i += 1) {
        stars.push({
          x: rng() * VIEW_W,
          y: rng() * VIEW_H,
          r: rng() * 1.4 + 0.3,
          depth: 0.25 + rng() * 0.75,
          phase: rng() * Math.PI * 2,
        });
      }
      starsRef.current = stars;
    }

    let raf = 0;
    let last = performance.now();

    const draw = (now: number) => {
      const dt = Math.min(0.04, Math.max(0.001, (now - last) / 1000));
      last = now;
      timeRef.current += dt;
      const time = timeRef.current;
      const aimNow = aimRef.current;
      const current = waveRef.current;

      const shake = shakeRef.current;
      shakeRef.current = Math.max(0, shake - dt * 26);

      ctx.clearRect(0, 0, VIEW_W, VIEW_H);
      const space = ctx.createLinearGradient(0, 0, VIEW_W, VIEW_H);
      space.addColorStop(0, '#040a18');
      space.addColorStop(0.5, '#071427');
      space.addColorStop(1, '#040711');
      ctx.fillStyle = space;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);

      const nebula = ctx.createRadialGradient(
        VIEW_W * 0.22,
        VIEW_H * 0.28,
        20,
        VIEW_W * 0.22,
        VIEW_H * 0.28,
        VIEW_W * 0.55
      );
      nebula.addColorStop(0, 'rgba(56,110,190,0.20)');
      nebula.addColorStop(1, 'rgba(56,110,190,0)');
      ctx.fillStyle = nebula;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      const violet = ctx.createRadialGradient(
        VIEW_W * 0.78,
        VIEW_H * 0.72,
        20,
        VIEW_W * 0.78,
        VIEW_H * 0.72,
        VIEW_W * 0.4
      );
      violet.addColorStop(0, 'rgba(130,60,170,0.16)');
      violet.addColorStop(1, 'rgba(130,60,170,0)');
      ctx.fillStyle = violet;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);

      ctx.save();
      if (shake > 0) {
        ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
      }

      for (const star of starsRef.current) {
        const x = (star.x + time * 8 * star.depth) % VIEW_W;
        const twinkle = 0.45 + Math.sin(time * 1.6 + star.phase) * 0.35;
        ctx.fillStyle = `rgba(190,220,255,${twinkle * star.depth})`;
        ctx.beginPath();
        ctx.arc(x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Coordinate grid, one line per unit on both axes.
      ctx.lineWidth = 1;
      for (let x = -X_LIMIT; x <= X_LIMIT; x += 1) {
        ctx.strokeStyle = x === 0 ? 'rgba(120,190,255,0.28)' : 'rgba(110,170,230,0.09)';
        ctx.beginPath();
        ctx.moveTo(toX(x), 0);
        ctx.lineTo(toX(x), VIEW_H);
        ctx.stroke();
      }
      for (let y = -3; y <= 3; y += 1) {
        ctx.strokeStyle = y === 0 ? 'rgba(120,190,255,0.28)' : 'rgba(110,170,230,0.09)';
        ctx.beginPath();
        ctx.moveTo(0, toY(y));
        ctx.lineTo(VIEW_W, toY(y));
        ctx.stroke();
      }

      ctx.fillStyle = 'rgba(150,200,240,0.45)';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let x = -X_LIMIT + 1; x < X_LIMIT; x += 1) {
        ctx.fillText(String(x), toX(x), toY(0) + 6);
      }
      ctx.textAlign = 'right';
      for (let y = -3; y <= 3; y += 1) {
        if (y === 0) continue;
        ctx.fillText(String(y), toX(0) - 6, toY(y) - 5);
      }

      // The aim curve, drawn exactly where the hit test reads it.
      const trace = () => {
        ctx.beginPath();
        if (aimNow.mode === 'linear') {
          ctx.moveTo(toX(-X_LIMIT), toY(aimNow.b - X_LIMIT * aimNow.m));
          ctx.lineTo(toX(X_LIMIT), toY(aimNow.b + X_LIMIT * aimNow.m));
          return;
        }
        for (let x = -X_LIMIT; x <= X_LIMIT + 0.001; x += 0.2) {
          const px = toX(x);
          const py = toY(aimNow.a * (x - aimNow.h) ** 2 + aimNow.k);
          if (x === -X_LIMIT) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
      };

      ctx.strokeStyle = 'rgba(70,190,255,0.16)';
      ctx.lineWidth = 10;
      trace();
      ctx.stroke();

      const aimGradient = ctx.createLinearGradient(0, 0, VIEW_W, VIEW_H);
      aimGradient.addColorStop(0, 'rgba(90,200,255,0.85)');
      aimGradient.addColorStop(1, 'rgba(140,120,255,0.65)');
      ctx.strokeStyle = aimGradient;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([7, 9]);
      ctx.lineDashOffset = -time * 26;
      trace();
      ctx.stroke();
      ctx.setLineDash([]);

      // Ship: pinned to the left edge of the plane on a line, at the vertex of
      // a parabola, tilted along the curve.
      const shipX = aimNow.mode === 'linear' ? toX(-X_LIMIT) : toX(aimNow.h);
      const shipY =
        aimNow.mode === 'linear' ? toY(aimNow.b - X_LIMIT * aimNow.m) : toY(aimNow.k);
      const shipTilt = aimNow.mode === 'linear' ? Math.atan(-aimNow.m) : 0;
      ctx.save();
      ctx.translate(shipX + 8, shipY);
      ctx.rotate(shipTilt);
      const shipGlow = ctx.createRadialGradient(0, 0, 2, 0, 0, 44);
      shipGlow.addColorStop(0, 'rgba(90,200,255,0.32)');
      shipGlow.addColorStop(1, 'rgba(90,200,255,0)');
      ctx.fillStyle = shipGlow;
      ctx.fillRect(-42, -42, 92, 84);
      ctx.fillStyle = '#b9e6ff';
      ctx.beginPath();
      ctx.moveTo(15, 0);
      ctx.lineTo(-9, -8);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-9, 8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(120,210,255,0.85)';
      ctx.beginPath();
      ctx.moveTo(-9, -3);
      ctx.lineTo(-21 - Math.random() * 8, 0);
      ctx.lineTo(-9, 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      const lockedIds = new Set(
        locksEnabled(waveNumber, current.kind)
          ? targetsOnAim(
              current.targets.filter((t) => !t.hit),
              aimNow,
              tolerance,
              time
            ).map((t) => t.id)
          : []
      );

      // Asteroid and ship targets.
      for (const target of current.targets) {
        const at = targetPosition(target, time);
        const cx = toX(at.x);
        const cy = toY(at.y);
        const isLocked = !target.hit && lockedIds.has(target.id);

        if (target.kind === 'ship') {
          const bob = Math.sin(time * 2 + hash(target.id) % 7) * 1.5;
          ctx.save();
          ctx.translate(cx, cy + bob);
          if (!target.hit) {
            const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, 52);
            halo.addColorStop(
              0,
              isLocked ? 'rgba(120,255,180,0.4)' : 'rgba(200,220,245,0.32)'
            );
            halo.addColorStop(1, 'rgba(200,220,245,0)');
            ctx.fillStyle = halo;
            ctx.fillRect(-56, -56, 112, 112);
          }
          // Silver saucer: a bright hull, a shadowed underside, a glass dome.
          const hull = ctx.createLinearGradient(0, -12, 0, 12);
          hull.addColorStop(0, target.hit ? '#5f6a75' : '#f4f8fc');
          hull.addColorStop(0.55, target.hit ? '#49525b' : '#c9d6e3');
          hull.addColorStop(1, target.hit ? '#343b43' : '#8fa2b5');
          ctx.fillStyle = hull;
          ctx.beginPath();
          ctx.ellipse(0, 2, 22, 8, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = target.hit ? 'rgba(140,200,170,0.5)' : 'rgba(255,255,255,0.85)';
          ctx.beginPath();
          ctx.ellipse(-4, -1, 10, 3.6, -0.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = target.hit ? '#3d6a55' : '#9fe8ff';
          ctx.beginPath();
          ctx.ellipse(0, -5, 8, 6, 0, Math.PI, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = target.hit
            ? 'rgba(80,200,140,0.7)'
            : isLocked
              ? 'rgba(120,255,180,0.95)'
              : 'rgba(215,235,255,0.9)';
          ctx.lineWidth = isLocked ? 2.6 : 1.4;
          ctx.beginPath();
          ctx.ellipse(0, 2, 22, 8, 0, 0, Math.PI * 2);
          ctx.stroke();
          if (!target.hit) {
            const flick = 5 + Math.sin(time * 18 + cx) * 3;
            ctx.fillStyle = 'rgba(255,190,110,0.85)';
            ctx.beginPath();
            ctx.moveTo(-18, 4);
            ctx.lineTo(-18 - flick, 7);
            ctx.lineTo(-18, 9);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(18, 4);
            ctx.lineTo(18 + flick, 7);
            ctx.lineTo(18, 9);
            ctx.closePath();
            ctx.fill();
          }
          ctx.restore();
        } else {
          const radius = 16;
          const shape = asteroidShape(target.id);
          const spin = time * 0.35 + (hash(target.id) % 100);

          ctx.save();
          ctx.translate(cx, cy);
          if (!target.hit) {
            const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, 44);
            halo.addColorStop(
              0,
              isLocked ? 'rgba(120,255,180,0.45)' : 'rgba(255,90,110,0.32)'
            );
            halo.addColorStop(1, 'rgba(255,90,110,0)');
            ctx.fillStyle = halo;
            ctx.fillRect(-48, -48, 96, 96);
          }
          ctx.rotate(spin);
          ctx.beginPath();
          for (let i = 0; i < shape.length; i += 1) {
            const angle = (i / shape.length) * Math.PI * 2;
            const px = Math.cos(angle) * radius * shape[i];
            const py = Math.sin(angle) * radius * shape[i];
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          const rock = ctx.createLinearGradient(-radius, -radius, radius, radius);
          if (target.hit) {
            rock.addColorStop(0, '#1c3a2c');
            rock.addColorStop(1, '#0f221b');
          } else {
            rock.addColorStop(0, '#5a3b46');
            rock.addColorStop(1, '#2a1a22');
          }
          ctx.fillStyle = rock;
          ctx.fill();
          ctx.strokeStyle = target.hit
            ? 'rgba(80,200,140,0.75)'
            : isLocked
              ? 'rgba(120,255,180,0.95)'
              : 'rgba(255,120,120,0.85)';
          ctx.lineWidth = isLocked ? 2.6 : 1.8;
          ctx.stroke();

          ctx.fillStyle = target.hit ? 'rgba(70,150,110,0.3)' : 'rgba(20,10,16,0.4)';
          ctx.beginPath();
          ctx.arc(-4, -3, 3.4, 0, Math.PI * 2);
          ctx.arc(5, 4, 2.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // Coordinate label: always upright, always readable. Late waves hold
        // the middle labels back — a hit always reveals its own coordinates.
        const hidden = !target.hit && hiddenRef.current.has(target.id);
        const labelY = cy + 32 > VIEW_H - 8 ? cy - 30 : cy + 32;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = target.hit ? 'rgba(160,230,190,0.85)' : 'rgba(255,220,225,0.95)';
        ctx.font = '600 12px ui-monospace, monospace';
        if (hidden) {
          ctx.fillStyle = 'rgba(180,190,210,0.8)';
          ctx.fillText('(?, ?)', cx, labelY);
        } else {
          // The label is the anchor point, not the drifting position: a ship
          // that prints its live coordinates would make the wave impossible
          // to solve as a line.
          ctx.fillText(`(${target.x}, ${target.y})`, cx, labelY);
        }
        if (isLocked) {
          ctx.fillStyle = 'rgba(120,255,180,0.95)';
          ctx.font = '700 9px ui-monospace, monospace';
          ctx.fillText('LOCK', cx, labelY > cy ? cy - 28 : cy + 44);
        }
      }

      // Beam: a bright pulse along the fired curve.
      const beam = beamRef.current;
      if (beam) {
        const age = (now - beam.at) / 1000;
        if (age > 0.34) {
          beamRef.current = null;
        } else {
          const fade = 1 - age / 0.34;
          const traceBeam = () => {
            ctx.beginPath();
            if (beam.aim.mode === 'linear') {
              ctx.moveTo(toX(-X_LIMIT), toY(beam.aim.b - X_LIMIT * beam.aim.m));
              ctx.lineTo(toX(X_LIMIT), toY(beam.aim.b + X_LIMIT * beam.aim.m));
              return;
            }
            for (let x = -X_LIMIT; x <= X_LIMIT + 0.001; x += 0.2) {
              const px = toX(x);
              const py = toY(beam.aim.a * (x - beam.aim.h) ** 2 + beam.aim.k);
              if (x === -X_LIMIT) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
          };
          ctx.strokeStyle = beam.hit
            ? `rgba(120,255,180,${fade})`
            : `rgba(255,150,90,${fade})`;
          ctx.lineWidth = 2 + fade * 4;
          ctx.shadowColor = beam.hit ? 'rgba(120,255,180,0.9)' : 'rgba(255,150,90,0.9)';
          ctx.shadowBlur = 18 * fade;
          traceBeam();
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }

      // Particles.
      for (let i = particlesRef.current.length - 1; i >= 0; i -= 1) {
        const particle = particlesRef.current[i];
        particle.life -= dt * 1.4;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vx *= 0.97;
        particle.vy *= 0.97;
        if (particle.life <= 0) {
          particlesRef.current.splice(i, 1);
          continue;
        }
        ctx.fillStyle = `hsla(${particle.hue}, 90%, 68%, ${particle.life})`;
        ctx.beginPath();
        ctx.arc(toX(particle.x), toY(particle.y), 1.4 + particle.life * 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Floating score.
      for (let i = floatsRef.current.length - 1; i >= 0; i -= 1) {
        const float = floatsRef.current[i];
        float.life -= dt * 0.9;
        float.y += dt * 0.8;
        if (float.life <= 0) {
          floatsRef.current.splice(i, 1);
          continue;
        }
        ctx.fillStyle = `rgba(180,255,210,${float.life})`;
        ctx.font = '700 16px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(float.text, toX(float.x), toY(float.y));
      }

      ctx.fillStyle = 'rgba(120,190,255,0.03)';
      for (let y = 0; y < VIEW_H; y += 4) ctx.fillRect(0, y, VIEW_W, 1);

      ctx.restore();
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [running, paused, tolerance, waveNumber]);

  if (!running && !finished) {
    return (
      <Card>
        <div className="row-between">
          <div className="row">
            <h2 style={{ margin: 0 }}>Coordinate Interceptor</h2>
            <Badge tone="info">2D skill game</Badge>
          </div>
          <Badge tone="neutral">{RUN_SECONDS}s run</Badge>
        </div>
        <p className="muted">
          Every wave sits on one curve. Early waves are straight lines{' '}
          <strong>y = mx + b</strong>; read the slope between two asteroid coordinates, set the
          intercept, and fire. From wave five the odd wave is a parabola{' '}
          <strong>y = a(x − h)² + k</strong>: press <strong>space</strong> to swap firing modes, then
          match a, h and k. While you are learning, every target already on your aim is marked{' '}
          <strong>LOCK</strong> — including the first parabola waves; from wave eight the mark is
          gone. Silver ships nudge around their point on the curve, so a shot has to be timed. Drag
          on the plane, use the sliders, or WASD / arrows, and press Enter to fire.
        </p>
        <div className="card-grid" style={{ margin: '12px 0' }}>
          <Stat label="High score" value={best} hint={last > 0 ? `Last run ${last}` : 'No runs yet'} />
          <Stat label="Firing modes" value="2" hint="Linear and quadratic — space swaps" />
          <Stat label="Math breaks" value="Every 2–5 waves" hint="The clock pauses while you answer" />
          <Stat label="Reward" value="5–100 HDCoins" hint="Scales with interceptions and accuracy" />
        </div>
        <Button onClick={start}>
          <Icon name="play" size={14} /> Start run
        </Button>
      </Card>
    );
  }

  if (finished) {
    return (
      <Card>
        <div className="row-between">
          <h2 style={{ margin: 0 }}>Run complete</h2>
          <Badge tone={hits > 0 ? 'good' : 'neutral'}>{hits} intercepted</Badge>
        </div>
        <div className="card-grid" style={{ margin: '12px 0' }}>
          <Stat label="Score" value={score} hint={score >= best ? 'New high score' : `Best ${best}`} />
          <Stat label="Targets hit" value={hits} />
          <Stat label="Shots fired" value={shots} />
          <Stat
            label="Accuracy"
            value={shots > 0 ? `${Math.round((hits / shots) * 100)}%` : '—'}
          />
        </div>
        <p className="muted">
          {hits >= 3
            ? 'Nice run — the HDCoins for this run are already on your balance.'
            : 'Intercept at least three targets to earn the mini-game reward.'}
        </p>
        <div className="row">
          <Button onClick={start}>Play again</Button>
          <Button
            variant="outline"
            onClick={() => {
              setFinished(false);
              setMessage(null);
            }}
          >
            Back to arena briefing
          </Button>
        </div>
      </Card>
    );
  }

  const currentWaveNumber = wave.stage;

  return (
    <Card>
      <div className="row-between" style={{ marginBottom: 10 }}>
        <div className="row">
          <h2 style={{ margin: 0 }}>Coordinate Interceptor</h2>
          <Badge tone={secondsLeft <= 10 ? 'warn' : 'info'}>
            {paused ? 'paused' : `${secondsLeft}s`}
          </Badge>
          <Badge tone="good">{score} pts</Badge>
          <Badge tone="neutral">Wave {currentWaveNumber}</Badge>
          {wave.kind === 'parabola' ? <Badge tone="warn">Parabola</Badge> : null}
        </div>
        <Button size="sm" variant="outline" onClick={() => void endRun()}>
          End run
        </Button>
      </div>

      <GameShell
        title="Coordinate Interceptor"
        hint={`Wave ${currentWaveNumber} · ${pulses} pulse${pulses === 1 ? '' : 's'} · ${
          locksEnabled(waveNumber, wave.kind)
            ? `${locks}/${live} on curve`
            : `${live} target${live === 1 ? '' : 's'}`
        } · ${mode === 'linear' ? 'linear' : 'quadratic'}`}
      >
        {breakQuestion ? (
          <MathBreak
            question={breakQuestion}
            pick={breakPick}
            verdict={breakScore}
            assessment={app.settings.assessment}
            onPick={(choiceId) => answerBreak(breakQuestion, choiceId)}
            onContinue={resumeFromBreak}
          />
        ) : (
          <>
            <div className="interceptor-board" ref={boardRef}>
              {/* The canvas is the game, but its state has to be readable without
                  seeing pixels: same information, as text. */}
              <p className="sr-only" aria-live="polite">
                Wave {currentWaveNumber}. Targets{' '}
                {wave.targets
                  .filter((t) => !t.hit)
                  .map((t) => `(${t.x}, ${t.y})`)
                  .join(', ')}
                . Current {mode === 'linear' ? 'line' : 'curve'}{' '}
                {mode === 'linear'
                  ? `y = ${m.toFixed(1)}x ${b < 0 ? '−' : '+'} ${Math.abs(b).toFixed(1)}`
                  : `y = ${a.toFixed(2)}(x ${h < 0 ? '+' : '−'} ${Math.abs(h).toFixed(2)})² ${
                      k < 0 ? '−' : '+'
                    } ${Math.abs(k).toFixed(2)}`}
                , {locksEnabled(waveNumber, wave.kind) ? `${locks} of ${live} on the curve.` : ''}
              </p>
              <canvas
                ref={canvasRef}
                width={VIEW_W}
                height={VIEW_H}
                tabIndex={0}
                aria-label="Coordinate plane with asteroid and ship targets. Drag to aim the beam, use the sliders, or arrow keys plus Enter to fire. Space swaps linear and quadratic modes."
                className="interceptor-canvas"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onPointerLeave={endDrag}
              />
            </div>

            <div className="interceptor-controls">
              <Button
                size="sm"
                variant={mode === 'quadratic' ? 'primary' : 'subtle'}
                onClick={toggleMode}
                title="Swap between y = mx + b and y = a(x − h)² + k (space)"
              >
                {mode === 'linear' ? 'Linear  y = mx + b' : 'Quadratic  y = a(x − h)² + k'}
                <span className="interceptor-key-hint">space</span>
              </Button>

              {mode === 'linear' ? (
                <>
                  <label className="field">
                    <span className="field-label">
                      Slope m = <strong>{m.toFixed(1)}</strong>
                      <span className="interceptor-key-hint"> A/D · ←/→</span>
                    </span>
                    <input
                      type="range"
                      min={SLOPE_MIN}
                      max={SLOPE_MAX}
                      step={STEP_M}
                      value={m}
                      onChange={(e) => setM(Number(e.target.value))}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">
                      Intercept b = <strong>{b.toFixed(1)}</strong>
                      <span className="interceptor-key-hint"> W/S · ↑/↓</span>
                    </span>
                    <input
                      type="range"
                      min={B_MIN}
                      max={B_MAX}
                      step={STEP_B}
                      value={b}
                      onChange={(e) => setB(Number(e.target.value))}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="field">
                    <span className="field-label">
                      a = <strong>{a.toFixed(2)}</strong>
                      <span className="interceptor-key-hint"> Q/E · ⇧←/→</span>
                    </span>
                    <input
                      type="range"
                      min={A_MIN}
                      max={A_MAX}
                      step={STEP_A}
                      value={a}
                      onChange={(e) => setA(Number(e.target.value))}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">
                      h = <strong>{h.toFixed(2)}</strong>
                      <span className="interceptor-key-hint"> A/D · ←/→</span>
                    </span>
                    <input
                      type="range"
                      min={H_MIN}
                      max={H_MAX}
                      step={STEP_H}
                      value={h}
                      onChange={(e) => setH(Number(e.target.value))}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">
                      k = <strong>{k.toFixed(2)}</strong>
                      <span className="interceptor-key-hint"> W/S · ↑/↓</span>
                    </span>
                    <input
                      type="range"
                      min={K_MIN}
                      max={K_MAX}
                      step={STEP_K}
                      value={k}
                      onChange={(e) => setK(Number(e.target.value))}
                    />
                  </label>
                </>
              )}

              <div className="interceptor-fire">
                <Button onClick={fire} disabled={pulses <= 0 || live === 0}>
                  <Icon name="play" size={12} /> Fire ({pulses} pulse{pulses === 1 ? '' : 's'})
                  <span className="interceptor-key-hint">enter</span>
                </Button>
                <span className="muted">
                  {live} target{live === 1 ? '' : 's'} left · best {best}
                </span>
              </div>
            </div>
          </>
        )}
      </GameShell>

      {message ? (
        <p className="muted" style={{ marginBottom: 0, marginTop: 10 }}>
          {message}
        </p>
      ) : null}
    </Card>
  );
}

/**
 * The math break: a real pause between waves.
 *
 * It reuses the rune panel's tools — Desmos in a resizable side pane, the
 * reference sheet in a draggable window — because a student who has learned one
 * of those windows should not have to learn a second one mid-game.
 */
function MathBreak({
  question,
  pick,
  verdict,
  assessment,
  onPick,
  onContinue,
}: {
  question: Question;
  pick: string | null;
  verdict: 'right' | 'wrong' | null;
  assessment?: string;
  onPick: (choiceId: string) => void;
  onContinue: () => void;
}) {
  const [calcOpen, setCalcOpen] = useState(false);
  const [calcMounted, setCalcMounted] = useState(false);
  const [refOpen, setRefOpen] = useState(false);
  const split = useSplitPane('hdsat.split.interceptor', {
    ratio: 50,
    side: 'right',
    minRatio: 30,
    maxRatio: 70,
  });
  const choices = question.choices ?? [];

  return (
    <div className="interceptor-break" role="dialog" aria-label="Math break question">
      <div className="interceptor-break-card">
        <div className="row-between" style={{ marginBottom: 6 }}>
          <div className="row">
            <Badge tone="info">Math break</Badge>
            <span className="muted" style={{ fontSize: '0.78rem' }}>
              clock paused · {question.skill}
            </span>
          </div>
          <div className="row vault-question-tools">
            <Button
              size="sm"
              variant={calcOpen ? 'primary' : 'subtle'}
              onClick={() => {
                setCalcMounted(true);
                setCalcOpen((open) => !open);
              }}
            >
              Desmos
            </Button>
            <PaneSwitch side={split.side} onClick={split.toggleSide} />
            <Button
              size="sm"
              variant={refOpen ? 'primary' : 'subtle'}
              onClick={() => setRefOpen((open) => !open)}
            >
              Reference
            </Button>
          </div>
        </div>

        <SplitWorkbench
          className="vault-workbench"
          side={split.side}
          ratio={split.ratio}
          minRatio={split.minRatio}
          maxRatio={split.maxRatio}
          onRatioChange={split.setRatio}
          toolVisible={calcOpen}
          toolKind="calc"
          tool={calcMounted ? <DesmosPane /> : null}
          main={
            <div className="vault-question-body">
              <FigureView question={question} />
              {question.stimulus ? (
                <div className="stimulus">
                  <StimulusView stimulus={question.stimulus} />
                </div>
              ) : null}
              <div className="prompt">
                <MathText text={question.prompt} />
              </div>

              {verdict ? (
                <div className={`feedback ${verdict === 'right' ? 'is-correct' : 'is-incorrect'}`}>
                  <MathText
                    text={
                      verdict === 'right'
                        ? 'Right — +15 points. Back to the board.'
                        : `The answer is ${question.correct_answer}. ${question.explanation}`
                    }
                  />
                </div>
              ) : null}

              <div className="vault-choices">
                {choices.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    className={`rush-option${
                      pick === choice.id
                        ? choice.id === question.correct_answer
                          ? ' is-correct'
                          : ' is-wrong'
                        : ''
                    }`}
                    disabled={Boolean(pick)}
                    onClick={() => onPick(choice.id)}
                  >
                    <strong>{choice.id}.</strong> <MathText text={choice.text} />
                  </button>
                ))}
              </div>
            </div>
          }
        />

        <div className="row-between" style={{ marginTop: 8 }}>
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            The run clock is frozen until you continue.
          </span>
          <Button size="sm" onClick={onContinue}>
            {pick ? 'Back to the board' : 'Skip this break'}
          </Button>
        </div>

        {refOpen ? (
          <ReferenceWindow assessment={assessment} onClose={() => setRefOpen(false)} />
        ) : null}
      </div>
    </div>
  );
}
