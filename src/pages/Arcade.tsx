import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StimulusView } from '../components/FigureView';
import { DesmosPane } from '../components/MathTools';
import { PaneSwitch, SplitWorkbench, useSplitPane } from '../components/SplitWorkbench';
import { MathText } from '../components/MathText';
import { Badge, Button, Card, InfoTip, Stat } from '../components/ui';
import { seededShuffle } from '../lib/examEngine';
import { newEventId } from '../lib/storage';
import { useApp } from '../lib/store';

/* ---------------------------------------------------------------------------
 Arcade games: timed, streak-multiplied quiz runs drawn fresh from the live
 question bank and vocabulary deck. Personal best scores persist locally.
--------------------------------------------------------------------------- */

type GameId = 'sprint' | 'transitions' | 'vocab';

interface GameQuestion {
  key: string;
  prompt: string;
  stimulus?: string;
  options: string[];
  correct: string;
}

interface BestScores {
  sprint: number;
  transitions: number;
  vocab: number;
}

const BEST_KEY = 'hdsat.arcade.best.v1';
const GAME_SECONDS = 75;
const MAX_COMBO = 5;

function loadBest(): BestScores {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (raw) return { sprint: 0, transitions: 0, vocab: 0, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable - bests simply do not persist */
  }
  return { sprint: 0, transitions: 0, vocab: 0 };
}

function buildSprintPool(questions: ReturnType<typeof useApp>['questions'], seed: string): GameQuestion[] {
  const pool = questions.filter(
    (q) =>
      q.format === 'multiple_choice' &&
      q.choices &&
      q.choices.length === 4 &&
      !q.figure_metadata
  );
  return seededShuffle(pool, seed)
    .slice(0, 60)
    .map((q) => {
      const opts = seededShuffle(q.choices as { id: string; text: string }[], seed + q.id);
      const correctText = (q.choices as { id: string; text: string }[]).find(
        (c) => c.id === q.correct_answer
      )?.text;
      return {
        key: `sprint-${q.id}-${seed}`,
        prompt: q.prompt,
        stimulus: q.stimulus ?? undefined,
        options: opts.map((o) => o.text),
        correct: correctText ?? opts[0].text,
      };
    });
}

function buildTransitionsPool(questions: ReturnType<typeof useApp>['questions'], seed: string): GameQuestion[] {
  const pool = questions.filter(
    (q) =>
      q.skill === 'Transitions' &&
      q.format === 'multiple_choice' &&
      q.choices &&
      (q.choices as unknown[]).length >= 3
  );
  return seededShuffle(pool, seed)
    .slice(0, 40)
    .map((q) => {
      const choices = q.choices as { id: string; text: string }[];
      const correctText = choices.find((c) => c.id === q.correct_answer)?.text ?? '';
      const options = seededShuffle(choices, seed + q.id).map((c) => c.text);
      return {
        key: `tr-${q.id}-${seed}`,
        prompt: 'Which transition completes the text as written?',
        stimulus: q.stimulus ?? undefined,
        options,
        correct: correctText,
      };
    });
}

function buildVocabPool(cards: ReturnType<typeof useApp>['flashcards'], seed: string): GameQuestion[] {
  const deck = cards.filter((c) => c.deck === 'vocabulary');
  if (deck.length < 4) return [];
  const picked = seededShuffle(deck, seed).slice(0, 60);
  return picked.map((card, i) => {
    const distractors: string[] = [];
    const seenDefs = new Set<string>([card.back]);
    for (let j = 1; distractors.length < 3 && j < deck.length; j += 1) {
      const cand = deck[(i * 977 + j * 131) % deck.length];
      if (cand.id !== card.id && !seenDefs.has(cand.back)) {
        seenDefs.add(cand.back);
        distractors.push(cand.back);
      }
    }
    return {
      key: `vb-${card.id}-${seed}`,
      prompt: `What does “${card.front}” mean?`,
      stimulus: undefined,
      options: seededShuffle([card.back, ...distractors], seed + card.id),
      correct: card.back,
    };
  });
}

interface DesmosChallenge {
  id: string;
  title: string;
  topic: string;
  f1: string;
  f2: string;
  prompt: string;
  expectedAnswer: string;
  hint: string;
  explanation: string;
}

const DESMOS_LAB_LESSONS: DesmosChallenge[] = [
  {
    id: 'DL-1',
    title: 'Lesson 1: Solving a Nonlinear System by Intersection',
    topic: 'Systems of Equations',
    f1: 'x^2 - 4x + 3',
    f2: '2x - 2',
    prompt:
      'Plot $f(x) = x^2 - 4x + 3$ and $g(x) = 2x - 2$ in the graphing calculator below. Which is the larger $x$-coordinate where the two graphs intersect?',
    expectedAnswer: '3',
    hint: 'Set x^2 - 4x + 3 = 2x - 2, or graph both functions in Desmos and read the intersection points.',
    explanation: 'Solving gives $(x-1)(x-3)=0$, so the intersections are $(1,0)$ and $(3,4)$; the larger $x$-coordinate is $3$.'
      .replace('$(3,4)$', '$(3, 4)$'),
  },
  {
    id: 'DL-2',
    title: 'Lesson 2: Finding the Maximum of a Quadratic Trajectory',
    topic: 'Quadratic Vertex',
    f1: '-2x^2 + 12x - 10',
    f2: '8',
    prompt:
      'For the parabola $f(x) = -2x^2 + 12x - 10$, graph the function in Desmos and find the maximum value of $f(x)$.',
    expectedAnswer: '8',
    hint: 'The vertex occurs at x = -b/(2a) = -12 / (2 * -2) = 3. Check f(3).',
    explanation: 'The axis of symmetry is $x = 3$. Evaluating: $f(3) = -2(9) + 12(3) - 10 = -18 + 36 - 10 = 8$.',
  },
  {
    id: 'DL-3',
    title: 'Lesson 3: Counting Real Solutions via Tangency',
    topic: 'Discriminant & Tangency',
    f1: 'x^2 - 6x + 9',
    f2: '0',
    prompt:
      'Inspect the graph of $f(x) = x^2 - 6x + 9$. At which $x$-value does the parabola touch the $x$-axis?',
    expectedAnswer: '3',
    hint: 'Factor (x - 3)^2 = 0, or graph it in Desmos and look for where the curve touches the x-axis.',
    explanation: 'Because $x^2 - 6x + 9 = (x - 3)^2$, the vertex $(3, 0)$ lies exactly on the $x$-axis.',
  },
];

export function ArcadePage() {
  const app = useApp();
  const [mode, setMode] = useState<'desmos' | GameId>('desmos');
  const [runSeed, setRunSeed] = useState<string>(() => `arc:${Date.now()}`);
  const [showCalc, setShowCalc] = useState(true);
  const split = useSplitPane('hdsat.split.arcade', { ratio: 46, minRatio: 30, maxRatio: 70 });

  // Desmos Lab state
  const [lessonIdx, setLessonIdx] = useState(0);
  const [labAnswer, setLabAnswer] = useState('');
  const [labFeedback, setLabFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // Shared game-run state
  const [gameIndex, setGameIndex] = useState(0);
  const [gameScore, setGameScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(GAME_SECONDS);
  const [running, setRunning] = useState(false);
  const [gameDone, setGameDone] = useState(false);
  const [lastFeedback, setLastFeedback] = useState<string | null>(null);
  const [best, setBest] = useState<BestScores>(() => loadBest());

  const startRef = useRef<number>(0);
  // Live values for the countdown ticker (avoids stale-closure state).
  const scoreRef = useRef(0);
  const answeredRef = useRef(0);
  const correctRef = useRef(0);

  const items: GameQuestion[] = useMemo(() => {
    if (mode === 'sprint') return buildSprintPool(app.questions, runSeed);
    if (mode === 'transitions') return buildTransitionsPool(app.questions, runSeed);
    if (mode === 'vocab') return buildVocabPool(app.flashcards, runSeed);
    return [];
  }, [mode, app.questions, app.flashcards, runSeed]);

  const activeLesson = DESMOS_LAB_LESSONS[lessonIdx];

  const persistBest = useCallback((key: GameId, score: number) => {
    setBest((prev) => {
      if (score <= prev[key]) return prev;
      const next = { ...prev, [key]: score };
      try {
        localStorage.setItem(BEST_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const endRun = useCallback(
    async (finalScore: number, answeredCount: number, corr: number) => {
      setGameDone(true);
      setRunning(false);
      persistBest(mode as GameId, finalScore);
      const timeSpent = Math.max(1, Math.round((Date.now() - startRef.current) / 1000));
      if (answeredCount > 0) {
        await app.actions.completeSession({
          activityType: 'mini_game',
          sessionId: newEventId(),
          questions: answeredCount,
          correct: corr,
          timeSpentSeconds: timeSpent,
        });
      }
    },
    [app.actions, mode, persistBest]
  );

  // Countdown ticker ending the run at 0.
  useEffect(() => {
    if (!running || gameDone) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          void endRun(scoreRef.current, answeredRef.current, correctRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running, gameDone, endRun]);

  const startGame = (nextMode: GameId) => {
    setMode(nextMode);
    setRunSeed(`arc:${Date.now()}`);
    setGameIndex(0);
    setGameScore(0);
    scoreRef.current = 0;
    setCombo(0);
    setBestCombo(0);
    setAnswered(0);
    answeredRef.current = 0;
    setCorrectCount(0);
    correctRef.current = 0;
    setSecondsLeft(GAME_SECONDS);
    setLastFeedback(null);
    setGameDone(false);
    startRef.current = Date.now();
    setRunning(true);
  };

  const resetTo = (nextMode: 'desmos' | GameId) => {
    setMode(nextMode);
    setRunning(false);
    setGameDone(false);
    setLastFeedback(null);
  };

  const handleCheckLab = () => {
    const clean = labAnswer.trim();
    const ok = clean === activeLesson.expectedAnswer;
    setLabFeedback({
      ok,
      text: ok ? `Correct! ${activeLesson.explanation}` : `Hint: ${activeLesson.hint}`,
    });
  };

  const handlePick = async (optionText: string) => {
    if (!running || gameDone || !items[gameIndex]) return;
    const isCorrect = optionText === items[gameIndex].correct;
    const nextAnswered = answeredRef.current + 1;
    const nextCorrect = correctRef.current + (isCorrect ? 1 : 0);
    const nextCombo = isCorrect ? Math.min(combo + 1, MAX_COMBO) : 0;
    const delta = isCorrect ? 10 * Math.max(1, nextCombo) : 0;
    const nextScore = scoreRef.current + delta;

    answeredRef.current = nextAnswered;
    correctRef.current = nextCorrect;
    scoreRef.current = nextScore;
    setAnswered(nextAnswered);
    setCorrectCount(nextCorrect);
    setCombo(nextCombo);
    setBestCombo((b) => Math.max(b, nextCombo));
    setGameScore(nextScore);
    setLastFeedback(isCorrect ? (delta > 10 ? `Correct! +${delta} (streak ×${nextCombo})` : 'Correct! +10') : `The answer was: ${items[gameIndex].correct}`);

    const isLast = gameIndex + 1 >= items.length;
    setGameIndex((i) => i + 1);
    if (isLast) {
      await endRun(nextScore, nextAnswered, nextCorrect);
    }
  };

  const current = items[gameIndex];
  const showRun = mode !== 'desmos' && (running || gameDone);
  const isRecord = gameDone && gameScore > 0 && gameScore >= best[mode as GameId];

  return (
    <div>
      <Card>
        <div className="row-between">
          <div className="row">
            <h1>Desmos Lab &amp; SAT Skill Mini-Games</h1>
            <InfoTip label="How Arcade works">
              Each run draws fresh randomized items from the live bank and vocabulary deck. Correct
              answers in a row raise a streak multiplier (up to ×{MAX_COMBO}); best scores are saved
              on this device.
            </InfoTip>
          </div>
          <div className="row">
            <Button
              variant={mode === 'desmos' ? 'primary' : 'outline'}
              size="sm"
              icon="calculator"
              onClick={() => resetTo('desmos')}
            >
              Desmos Lab
            </Button>
            <Button
              variant={mode === 'sprint' ? 'primary' : 'outline'}
              size="sm"
              icon="bolt"
              onClick={() => startGame('sprint')}
            >
              Equation Sprint
            </Button>
            <Button
              variant={mode === 'transitions' ? 'primary' : 'outline'}
              size="sm"
              icon="spark"
              onClick={() => startGame('transitions')}
            >
              Transition Match
            </Button>
            <Button
              variant={mode === 'vocab' ? 'primary' : 'outline'}
              size="sm"
              icon="flashcards"
              onClick={() => startGame('vocab')}
            >
              Vocab Precision
            </Button>
          </div>
        </div>
      </Card>

      {mode === 'desmos' ? (
        <SplitWorkbench
          className="arcade-workbench"
          maxViewportHeight={720}
          side={split.side}
          ratio={split.ratio}
          minRatio={split.minRatio}
          maxRatio={split.maxRatio}
          onRatioChange={split.setRatio}
          toolKind="calc"
          tool={<DesmosPane key={activeLesson.id} />}
          main={
          <Card>
            <div className="row-between" style={{ marginBottom: 10 }}>
              <div>
                <Badge tone="info">{activeLesson.topic}</Badge>
                <h2 style={{ marginTop: 6 }}>{activeLesson.title}</h2>
              </div>
              <div className="row">
                {DESMOS_LAB_LESSONS.map((l, idx) => (
                  <Button
                    key={l.id}
                    size="sm"
                    variant={idx === lessonIdx ? 'primary' : 'outline'}
                    onClick={() => {
                      setLessonIdx(idx);
                      setLabAnswer('');
                      setLabFeedback(null);
                    }}
                  >
                    Lesson {idx + 1}
                  </Button>
                ))}
                <PaneSwitch side={split.side} onClick={split.toggleSide} />
              </div>
            </div>

            <p>
              <MathText text={activeLesson.prompt} />
            </p>

            <div className="row" style={{ marginTop: 12 }}>
              <input
                type="text"
                value={labAnswer}
                onChange={(e) => setLabAnswer(e.target.value)}
                placeholder="Enter numeric value"
              />
              <Button onClick={handleCheckLab}>Verify Result</Button>
            </div>

            {labFeedback ? (
              <div className={`feedback ${labFeedback.ok ? 'is-correct' : 'is-incorrect'}`} style={{ marginTop: 12 }}>
                <MathText text={labFeedback.text} />
              </div>
            ) : null}
          </Card>
          }
        />
      ) : null}

      {showRun && !running && !gameDone ? null : null}

      {mode !== 'desmos' && !running && !gameDone ? (
        <Card>
          <h2>Ready to play?</h2>
          <p className="muted" style={{ margin: '12px 0' }}>
            <strong>Equation Sprint</strong> speed-solves dozens of fresh bank items ·{' '}
            <strong>Transition Match</strong> trains rhetorical transitions · <strong>Vocab Precision</strong> drills
            the entire vocabulary deck. Every run lasts {GAME_SECONDS} seconds.
          </p>
          <div className="row">
            <Button onClick={() => startGame(mode as GameId)}>Start {GAME_SECONDS}-second run</Button>
          </div>
          <div className="card-grid" style={{ marginTop: 14 }}>
            <Stat label="Equation Sprint best" value={best.sprint.toLocaleString()} />
            <Stat label="Transition Match best" value={best.transitions.toLocaleString()} />
            <Stat label="Vocab Precision best" value={best.vocab.toLocaleString()} />
          </div>
        </Card>
      ) : null}

      {showRun && gameDone ? (
        <Card>
          <div className="row-between">
            <h2>Run complete</h2>
            {isRecord ? <Badge tone="good">New personal best!</Badge> : <Badge tone="info">Best: {best[mode as GameId].toLocaleString()}</Badge>}
          </div>
          <div className="card-grid" style={{ margin: '12px 0' }}>
            <Stat label="Score" value={gameScore.toLocaleString()} />
            <Stat label="Answered" value={answered} />
            <Stat label="Accuracy" value={answered ? `${Math.round((correctCount / answered) * 100)}%` : '—'} />
            <Stat label="Best streak" value={`×${bestCombo}`} />
          </div>
          <div className="row">
            <Button onClick={() => startGame(mode as GameId)}>Play again</Button>
            <Button variant="outline" onClick={() => resetTo(mode as GameId)}>
              Back to briefing
            </Button>
          </div>
        </Card>
      ) : null}

      {showRun && running && current ? (
        <SplitWorkbench
          className="arcade-workbench"
          maxViewportHeight={720}
          side={split.side}
          ratio={split.ratio}
          minRatio={split.minRatio}
          maxRatio={split.maxRatio}
          onRatioChange={split.setRatio}
          toolVisible={mode === 'sprint' && showCalc}
          toolKind="calc"
          tool={<DesmosPane />}
          main={
        <Card>
          <div className="row-between" style={{ marginBottom: 8 }}>
            <h2>
              {mode === 'sprint' ? 'Equation Sprint' : mode === 'transitions' ? 'Transition Match' : 'Vocab Precision'}
            </h2>
            <div className="row">
              <span className={`timer${secondsLeft < 15 ? ' is-low' : ''}`}>{String(secondsLeft).padStart(2, '0')}s</span>
              <Badge tone="info">Score {gameScore.toLocaleString()}</Badge>
              {combo > 1 ? <Badge tone="good">Streak ×{combo}</Badge> : null}
              {mode === 'sprint' ? (
                <>
                  <Button size="sm" variant="subtle" onClick={() => setShowCalc((v) => !v)}>
                    {showCalc ? 'Hide Calculator' : 'Calculator'}
                  </Button>
                  <PaneSwitch side={split.side} onClick={split.toggleSide} />
                </>
              ) : null}
            </div>
          </div>

          {current.stimulus ? (
            <div className="stimulus">
              <StimulusView stimulus={current.stimulus} />
            </div>
          ) : null}
          <div className="prompt" style={{ marginTop: 8 }}>
            <MathText text={current.prompt} />
          </div>

          <div className="card-grid" style={{ marginTop: 12 }}>
            {current.options.map((opt) => (
              <button key={opt} type="button" className="rush-option" onClick={() => void handlePick(opt)}>
                <MathText text={opt} />
              </button>
            ))}
          </div>

          {lastFeedback ? (
            <p className="muted" style={{ marginTop: 10 }}>
              {lastFeedback}
            </p>
          ) : null}
        </Card>
          }
        />
      ) : null}
    </div>
  );
}
