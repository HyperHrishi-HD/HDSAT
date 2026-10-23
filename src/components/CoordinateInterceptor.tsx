import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, Icon, Stat } from './ui';
import { newEventId } from '../lib/storage';
import { useApp } from '../lib/store';

/**
 * Coordinate Interceptor — the Arcade's interactive 2D game.
 *
 * The whole game is built from SAT coordinate geometry: you aim a line
 * y = mx + b through targets sitting on the Cartesian plane. Every wave is a
 * small system of "does this point lie on the line" checks, so the reflex being
 * trained is the one the Math section actually rewards. It runs on a plain
 * canvas, awards HDCoins through the same capped session reward the rest of the
 * Arcade uses, and never touches practice or test state.
 */

const RUN_SECONDS = 60;
const PULSES_PER_WAVE = 3;
const HIT_TOLERANCE = 0.55;
const COLS = 12; // x from -6..6
const ROWS = 8; // y from -4..4
const STEP_M = 0.1;
const STEP_B = 0.25;

interface Target {
  id: string;
  x: number;
  y: number;
  hit: boolean;
}

function buildWave(waveNumber: number): Target[] {
  const count = Math.min(3 + Math.floor(waveNumber / 2), 6);
  const targets: Target[] = [];
  const used = new Set<string>();
  let guard = 0;
  while (targets.length < count && guard < 200) {
    guard += 1;
    const x = Math.round((Math.random() * 2 - 1) * 5);
    const y = Math.round((Math.random() * 2 - 1) * 3);
    if (y === 0 && x === 0) continue;
    const key = `${x},${y}`;
    if (used.has(key)) continue;
    used.add(key);
    targets.push({ id: key, x, y, hit: false });
  }
  return targets;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function CoordinateInterceptor() {
  const app = useApp();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [m, setM] = useState(0.5);
  const [b, setB] = useState(0);
  const [wave, setWave] = useState(1);
  const [targets, setTargets] = useState<Target[]>(() => buildWave(1));
  const [pulses, setPulses] = useState(PULSES_PER_WAVE);
  const [score, setScore] = useState(0);
  const [hits, setHits] = useState(0);
  const [shots, setShots] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(RUN_SECONDS);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [flash, setFlash] = useState<{ at: number; hitCount: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const sessionRef = useRef<string>(newEventId());
  const scoreRef = useRef(0);
  const hitsRef = useRef(0);
  const shotsRef = useRef(0);
  const runCompleteRef = useRef(false);
  const startedRef = useRef(0);

  const live = useMemo(() => targets.filter((t) => !t.hit).length, [targets]);

  const endRun = useCallback(async () => {
    if (runCompleteRef.current) return;
    runCompleteRef.current = true;
    setRunning(false);
    setFinished(true);
    const timeSpent = Math.max(1, Math.round((Date.now() - startedRef.current) / 1000));
    if (shotsRef.current > 0) {
      await app.actions.completeSession({
        activityType: 'mini_game',
        sessionId: sessionRef.current,
        questions: Math.max(3, shotsRef.current),
        correct: hitsRef.current,
        timeSpentSeconds: timeSpent,
      });
    }
  }, [app.actions]);

  useEffect(() => {
    if (!running) return;
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
  }, [running, endRun]);

  const start = () => {
    sessionRef.current = newEventId();
    runCompleteRef.current = false;
    scoreRef.current = 0;
    hitsRef.current = 0;
    shotsRef.current = 0;
    startedRef.current = Date.now();
    setM(0.5);
    setB(0);
    setWave(1);
    setTargets(buildWave(1));
    setPulses(PULSES_PER_WAVE);
    setScore(0);
    setHits(0);
    setShots(0);
    setSecondsLeft(RUN_SECONDS);
    setFlash(null);
    setMessage(null);
    setFinished(false);
    setRunning(true);
  };

  const nextWave = useCallback(
    (nextWaveNumber: number) => {
      setWave(nextWaveNumber);
      setTargets(buildWave(nextWaveNumber));
      setPulses(PULSES_PER_WAVE);
    },
    []
  );

  const fire = useCallback(() => {
    if (!running || pulses <= 0) return;
    const remaining = targets.filter((t) => !t.hit);
    if (remaining.length === 0) return;
    const struck = remaining.filter((t) => Math.abs(m * t.x + b - t.y) <= HIT_TOLERANCE);
    const nextShots = shotsRef.current + 1;
    shotsRef.current = nextShots;
    setShots(nextShots);

    if (struck.length === 0) {
      setPulses((p) => p - 1);
      setFlash({ at: Date.now(), hitCount: 0 });
      setMessage('Missed — adjust the slope or intercept and fire again.');
      return;
    }

    const nextTargets = targets.map((t) =>
      struck.some((s) => s.id === t.id) ? { ...t, hit: true } : t
    );
    const cleared = nextTargets.every((t) => t.hit);
    const gained = struck.length * 10 + (cleared ? 15 : 0);
    const nextScore = scoreRef.current + gained;
    const nextHits = hitsRef.current + struck.length;
    scoreRef.current = nextScore;
    hitsRef.current = nextHits;
    setScore(nextScore);
    setHits(nextHits);
    setTargets(nextTargets);
    setPulses((p) => (cleared ? p : p - 1));
    setFlash({ at: Date.now(), hitCount: struck.length });
    setMessage(
      cleared
        ? `Wave cleared! +${gained} points.`
        : `Intercepted ${struck.length} target${struck.length === 1 ? '' : 's'} · +${gained}`
    );

    if (cleared) {
      window.setTimeout(() => {
        nextWave(wave + 1);
      }, 550);
    } else if (pulses - 1 <= 0) {
      window.setTimeout(() => {
        nextWave(wave + 1);
        setMessage('Out of pulses — next wave.');
      }, 550);
    }
  }, [running, pulses, targets, m, b, wave, nextWave]);

  // Keyboard aiming: arrows tune the line, space/enter fires while the board
  // has focus. Scoped to the board so it can never hijack page navigation.
  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    const onKey = (event: KeyboardEvent) => {
      if (!running) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setB((value) => clamp(Number((value - STEP_B).toFixed(2)), -ROWS / 2, ROWS / 2));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setB((value) => clamp(Number((value + STEP_B).toFixed(2)), -ROWS / 2, ROWS / 2));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setM((value) => clamp(Number((value + STEP_M).toFixed(2)), -2.5, 2.5));
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setM((value) => clamp(Number((value - STEP_M).toFixed(2)), -2.5, 2.5));
      } else if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        fire();
      }
    };
    node.addEventListener('keydown', onKey);
    return () => node.removeEventListener('keydown', onKey);
  }, [running, fire]);

  // Draw the board whenever the line, the targets or the flash change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    const toX = (x: number) => ((x + COLS / 2) / COLS) * width;
    const toY = (y: number) => height - ((y + ROWS / 2) / ROWS) * height;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    for (let x = -COLS / 2; x <= COLS / 2; x += 1) {
      ctx.beginPath();
      ctx.moveTo(toX(x), 0);
      ctx.lineTo(toX(x), height);
      ctx.stroke();
    }
    for (let y = -ROWS / 2; y <= ROWS / 2; y += 1) {
      ctx.beginPath();
      ctx.moveTo(0, toY(y));
      ctx.lineTo(width, toY(y));
      ctx.stroke();
    }

    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, toY(0));
    ctx.lineTo(width, toY(0));
    ctx.moveTo(toX(0), 0);
    ctx.lineTo(toX(0), height);
    ctx.stroke();

    // The player's line, across the whole visible domain.
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    let started = false;
    for (let px = 0; px <= width; px += 2) {
      const x = (px / width) * COLS - COLS / 2;
      const y = m * x + b;
      const py = toY(y);
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();

    targets.forEach((target) => {
      ctx.beginPath();
      ctx.arc(toX(target.x), toY(target.y), 13, 0, Math.PI * 2);
      ctx.fillStyle = target.hit ? '#dcfce7' : '#fee2e2';
      ctx.fill();
      ctx.strokeStyle = target.hit ? '#16a34a' : '#dc2626';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#0f172a';
      ctx.font = '11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${target.x},${target.y}`, toX(target.x), toY(target.y));
    });

    if (flash && Date.now() - flash.at < 420) {
      ctx.strokeStyle = flash.hitCount > 0 ? '#16a34a' : '#f97316';
      ctx.lineWidth = 5;
      ctx.beginPath();
      for (let px = 0; px <= width; px += 2) {
        const x = (px / width) * COLS - COLS / 2;
        const py = toY(m * x + b);
        if (px === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }, [m, b, targets, flash]);

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
          Tune a line <strong>y = mx + b</strong> until it passes through every red target on the
          plane, then fire. Each wave adds targets and moves the coordinates. Arrow keys nudge the
          intercept and slope; Space fires.
        </p>
        <div className="card-grid" style={{ margin: '12px 0' }}>
          <Stat label="Points per target" value="10" hint="+15 bonus for a cleared wave" />
          <Stat label="Pulses per wave" value={PULSES_PER_WAVE} hint="Misses cost a pulse" />
          <Stat label="Run length" value={`${RUN_SECONDS}s`} />
          <Stat label="Reward" value="Up to 4 HDCoins" hint="3+ interceptions, 5 rewarded runs/day" />
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
          <Stat label="Score" value={score} />
          <Stat label="Targets hit" value={hits} />
          <Stat label="Shots fired" value={shots} />
          <Stat
            label="Accuracy"
            value={shots > 0 ? `${Math.round((hits / shots) * 100)}%` : '—'}
          />
        </div>
        <p className="muted">
          {hits >= 3
            ? 'Nice run — any reward for this game has been added to your HDCoins.'
            : 'Intercept at least three targets in a run to earn the mini-game reward.'}
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

  return (
    <Card>
      <div className="row-between" style={{ marginBottom: 10 }}>
        <div className="row">
          <h2 style={{ margin: 0 }}>Coordinate Interceptor</h2>
          <Badge tone={secondsLeft <= 10 ? 'warn' : 'info'}>{secondsLeft}s</Badge>
          <Badge tone="good">{score} pts</Badge>
          <Badge tone="neutral">Wave {wave}</Badge>
        </div>
        <Button size="sm" variant="outline" onClick={() => void endRun()}>
          End run
        </Button>
      </div>

      <canvas
        ref={canvasRef}
        width={720}
        height={420}
        tabIndex={0}
        aria-label="Coordinate plane with targets. Use the sliders or arrow keys to aim the line and space to fire."
        className="interceptor-canvas"
      />

      <div className="interceptor-controls">
        <label className="field">
          <span className="field-label">
            Slope m = <strong>{m.toFixed(1)}</strong>
          </span>
          <input
            type="range"
            min={-2.5}
            max={2.5}
            step={STEP_M}
            value={m}
            onChange={(e) => setM(Number(e.target.value))}
          />
        </label>
        <label className="field">
          <span className="field-label">
            Intercept b = <strong>{b.toFixed(2)}</strong>
          </span>
          <input
            type="range"
            min={-4}
            max={4}
            step={STEP_B}
            value={b}
            onChange={(e) => setB(Number(e.target.value))}
          />
        </label>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Button onClick={fire} disabled={pulses <= 0 || live === 0}>
            Fire ({pulses} pulse{pulses === 1 ? '' : 's'})
          </Button>
          <span className="muted">
            {live} target{live === 1 ? '' : 's'} left
          </span>
        </div>
      </div>

      {message ? (
        <p className="muted" style={{ marginBottom: 0 }}>
          {message}
        </p>
      ) : null}
    </Card>
  );
}
