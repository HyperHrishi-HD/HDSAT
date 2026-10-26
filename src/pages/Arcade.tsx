import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StimulusView } from '../components/FigureView';
import { DesmosPane } from '../components/MathTools';
import { PaneSwitch, SplitWorkbench, useSplitPane } from '../components/SplitWorkbench';
import { MathText } from '../components/MathText';
import { CoordinateInterceptor } from '../components/CoordinateInterceptor';
import { ChatQuest } from '../components/ChatQuest';
import { RuneVault } from '../components/RuneVault';
import { DailyQuests } from '../components/DailyQuests';
import { PracticeRush } from '../components/PracticeRush';
import { QuestionOfTheDay } from '../components/QuestionOfTheDay';
import { Badge, Button, Card, Icon, InfoTip, Stat } from '../components/ui';
import { seededShuffle } from '../lib/examEngine';
import { newEventId } from '../lib/storage';
import { useApp } from '../lib/store';

/* ---------------------------------------------------------------------------
 Arcade: three rooms, one reward economy.

   1. Interactive Arena — the Coordinate Interceptor 2D game, plus the daily
      Hard Question of the Day and the three daily quests.
   2. Skill Mini-Games   — an options menu (Desmos Lab, Equation Sprint,
      Transition Match, Vocab Precision) that is configured before it starts,
      the same way Custom Practice is.
   3. Practice Rush      — the timed high-score sprint, moved here from Practice
      because it is a game with a personal best, not a drill.
--------------------------------------------------------------------------- */

type TabId = 'arena' | 'minigames' | 'rush';
type GameId = 'sprint' | 'transitions' | 'vocab';
type MiniGameId = GameId | 'lab';
type ArenaGameId = 'interceptor' | 'talk' | 'vault';

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
    explanation:
      'Solving gives $(x-1)(x-3)=0$, so the intersections are $(1,0)$ and $(3,4)$; the larger $x$-coordinate is $3$.',
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

const MINI_GAMES: {
  id: MiniGameId;
  name: string;
  blurb: string;
  icon: 'calculator' | 'bolt' | 'spark' | 'flashcards';
  best?: keyof BestScores;
}[] = [
  {
    id: 'lab',
    name: 'Desmos Lab',
    blurb: 'Three guided graphing investigations with a live Desmos calculator.',
    icon: 'calculator',
  },
  {
    id: 'sprint',
    name: 'Equation Sprint',
    blurb: 'Speed-solve bank items in 75 seconds.',
    icon: 'bolt',
    best: 'sprint',
  },
  {
    id: 'transitions',
    name: 'Transition Match',
    blurb: 'Rhetorical transitions from real stimulus texts.',
    icon: 'spark',
    best: 'transitions',
  },
  {
    id: 'vocab',
    name: 'Vocab Precision',
    blurb: 'Vocabulary deck, four-way definitions.',
    icon: 'flashcards',
    best: 'vocab',
  },
];

export function ArcadePage() {
  const app = useApp();
  const [tab, setTab] = useState<TabId>('arena');
  const [arenaGame, setArenaGame] = useState<ArenaGameId>('interceptor');
  const [game, setGame] = useState<MiniGameId | null>(null);
  const [runSeed, setRunSeed] = useState<string>(() => `arc:${Date.now()}`);
  const [showCalc, setShowCalc] = useState(true);
  const split = useSplitPane('hdsat.split.arcade', { ratio: 46, minRatio: 30, maxRatio: 70 });
  const gameSplit = useSplitPane('hdsat.split.arcade.game', { ratio: 46, minRatio: 30, maxRatio: 70 });

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
  const scoreRef = useRef(0);
  const answeredRef = useRef(0);
  const correctRef = useRef(0);
  const sessionRef = useRef<string>(newEventId());

  const items: GameQuestion[] = useMemo(() => {
    if (game === 'sprint') return buildSprintPool(app.questions, runSeed);
    if (game === 'transitions') return buildTransitionsPool(app.questions, runSeed);
    if (game === 'vocab') return buildVocabPool(app.flashcards, runSeed);
    return [];
  }, [game, app.questions, app.flashcards, runSeed]);

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
      if (game && game !== 'lab') persistBest(game, finalScore);
      const timeSpent = Math.max(1, Math.round((Date.now() - startRef.current) / 1000));
      if (answeredCount > 0) {
        await app.actions.completeSession({
          activityType: 'mini_game',
          sessionId: sessionRef.current,
          questions: answeredCount,
          correct: corr,
          timeSpentSeconds: timeSpent,
        });
      }
    },
    [app.actions, game, persistBest]
  );

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

  const startGame = (next: MiniGameId) => {
    setGame(next);
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
    sessionRef.current = newEventId();
    if (next === 'lab') {
      setRunning(false);
      return;
    }
    startRef.current = Date.now();
    setRunning(true);
  };

  const openMenu = () => {
    setRunning(false);
    setGameDone(false);
    setGame(null);
    setLastFeedback(null);
  };

  const handleCheckLab = () => {
    const clean = labAnswer.trim();
    const ok = clean === activeLesson.expectedAnswer;
    setLabFeedback({
      ok,
      text: ok ? `Correct. ${activeLesson.explanation}` : `Hint: ${activeLesson.hint}`,
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
    setLastFeedback(
      isCorrect
        ? delta > 10
          ? `Correct, +${delta} (streak ×${nextCombo})`
          : 'Correct, +10'
        : `The answer was: ${items[gameIndex].correct}`
    );

    const isLast = gameIndex + 1 >= items.length;
    setGameIndex((i) => i + 1);
    if (isLast) {
      await endRun(nextScore, nextAnswered, nextCorrect);
    }
  };

  const current = items[gameIndex];
  const showRun = game !== null && game !== 'lab' && (running || gameDone);
  const isRecord = gameDone && gameScore > 0 && game && game !== 'lab' && gameScore >= best[game];

  const gameLabel =
    game === 'sprint'
      ? 'Equation Sprint'
      : game === 'transitions'
        ? 'Transition Match'
        : game === 'vocab'
          ? 'Vocab Precision'
          : 'Desmos Lab';

  return (
    <div>
      <Card>
        <div className="row-between">
          <div className="row">
            <h1>Arcade</h1>
            <InfoTip label="How the Arcade works">
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.55 }}>
                <li>Answers earn HDCoins; a finished run adds one session reward per category each day.</li>
                <li>Three quests per day, capped at 30 questions, then the games as long as you like.</li>
                <li>Daily Quests open the arena; the Hard Question of the Day closes it.</li>
              </ul>
            </InfoTip>
          </div>
          <div className="row">
            <Button
              variant={tab === 'arena' ? 'primary' : 'outline'}
              size="sm"
              icon="compass"
              onClick={() => setTab('arena')}
            >
              Interactive Arena
            </Button>
            <Button
              variant={tab === 'minigames' ? 'primary' : 'outline'}
              size="sm"
              icon="arcade"
              onClick={() => setTab('minigames')}
            >
              Skill Mini-Games
            </Button>
            <Button
              variant={tab === 'rush' ? 'primary' : 'outline'}
              size="sm"
              icon="bolt"
              onClick={() => setTab('rush')}
            >
              Practice Rush
            </Button>
          </div>
        </div>
      </Card>

      {tab === 'arena' ? (
        <div className="stack">
          <DailyQuests />

          <Card>
            <div className="row-between" style={{ marginBottom: 10 }}>
              <div className="row">
                <Icon name="arcade" size={16} />
                <h2 style={{ margin: 0 }}>Interactive games</h2>
              </div>
              <Badge tone="neutral">3 rooms</Badge>
            </div>
            <div className="arena-games">
              {[
                {
                  id: 'interceptor' as ArenaGameId,
                  name: 'Coordinate Interceptor',
                  blurb: 'Aim y = mx + b through drifting asteroids.',
                  icon: 'target' as const,
                  tag: 'Math',
                },
                {
                  id: 'talk' as ArenaGameId,
                  name: 'Table Talk',
                  blurb: 'Answer Hrishi’s reading cards by replying in chat.',
                  icon: 'chat' as const,
                  tag: 'Reading',
                },
                {
                  id: 'vault' as ArenaGameId,
                  name: 'The Rune Vault',
                  blurb: 'A side-view vault where each gate is a question.',
                  icon: 'castle' as const,
                  tag: 'Mixed',
                },
              ].map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`arena-tile${arenaGame === entry.id ? ' is-active' : ''}`}
                  aria-pressed={arenaGame === entry.id}
                  onClick={() => setArenaGame(entry.id)}
                >
                  <span className="arena-tile-icon">
                    <Icon name={entry.icon} size={18} />
                  </span>
                  <span className="arena-tile-body">
                    <strong>{entry.name}</strong>
                    <span className="muted">{entry.blurb}</span>
                  </span>
                  <Badge tone={arenaGame === entry.id ? 'good' : 'neutral'}>{entry.tag}</Badge>
                </button>
              ))}
            </div>
          </Card>

          {arenaGame === 'interceptor' ? <CoordinateInterceptor /> : null}
          {arenaGame === 'talk' ? <ChatQuest /> : null}
          {arenaGame === 'vault' ? <RuneVault /> : null}

          <QuestionOfTheDay />
        </div>
      ) : null}

      {tab === 'minigames' && !game ? (
        <Card>
          <div className="row-between" style={{ marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Choose a mini-game</h2>
            <Badge tone="info">{GAME_SECONDS}s runs</Badge>
          </div>
          <div className="card-grid">
            {MINI_GAMES.map((entry) => (
              <div key={entry.id} className="muted-block">
                <div className="row-between">
                  <strong>
                    <Icon name={entry.icon} size={14} /> {entry.name}
                  </strong>
                  {entry.best ? (
                    <Badge tone="neutral">Best {best[entry.best].toLocaleString()}</Badge>
                  ) : (
                    <Badge tone="neutral">3 lessons</Badge>
                  )}
                </div>
                <p className="muted" style={{ margin: '6px 0 10px' }}>
                  {entry.blurb}
                </p>
                <Button size="sm" onClick={() => startGame(entry.id)}>
                  {entry.id === 'lab' ? 'Open lab' : 'Set up & play'}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {tab === 'minigames' && game ? (
        <div className="stack">
          <div className="row-between">
            <h2 style={{ margin: 0 }}>{gameLabel}</h2>
            <div className="row">
              {showRun && !gameDone ? <Badge tone="info">{secondsLeft}s</Badge> : null}
              <Button size="sm" variant="outline" onClick={openMenu}>
                Change game
              </Button>
            </div>
          </div>

          {game === 'lab' ? (
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
                    <div
                      className={`feedback ${labFeedback.ok ? 'is-correct' : 'is-incorrect'}`}
                      style={{ marginTop: 12 }}
                    >
                      <MathText text={labFeedback.text} />
                    </div>
                  ) : null}
                </Card>
              }
            />
          ) : null}

          {game !== 'lab' && !running && !gameDone ? (
            <Card>
              <h2>Ready to play?</h2>
              <div className="row" style={{ marginTop: 12 }}>
                <Button onClick={() => startGame(game)}>Start {GAME_SECONDS}-second run</Button>
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
                {isRecord ? (
                  <Badge tone="good">New personal best</Badge>
                ) : (
                  <Badge tone="info">Best: {best[game as GameId].toLocaleString()}</Badge>
                )}
              </div>
              <div className="card-grid" style={{ margin: '12px 0' }}>
                <Stat label="Score" value={gameScore.toLocaleString()} />
                <Stat label="Answered" value={answered} />
                <Stat
                  label="Accuracy"
                  value={answered ? `${Math.round((correctCount / answered) * 100)}%` : '—'}
                />
                <Stat label="Best streak" value={`×${bestCombo}`} />
              </div>
              <div className="row">
                <Button onClick={() => game && startGame(game)}>Play again</Button>
                <Button variant="outline" onClick={openMenu}>
                  Back to game menu
                </Button>
              </div>
            </Card>
          ) : null}

          {showRun && running && current ? (
            <SplitWorkbench
              className="arcade-workbench"
              maxViewportHeight={720}
              side={gameSplit.side}
              ratio={gameSplit.ratio}
              minRatio={gameSplit.minRatio}
              maxRatio={gameSplit.maxRatio}
              onRatioChange={gameSplit.setRatio}
              toolVisible={game === 'sprint' && showCalc}
              toolKind="calc"
              tool={<DesmosPane />}
              main={
                <Card>
                  <div className="row-between" style={{ marginBottom: 8 }}>
                    <div className="row">
                      <span className={`timer${secondsLeft < 15 ? ' is-low' : ''}`}>
                        {String(secondsLeft).padStart(2, '0')}s
                      </span>
                      <Badge tone="info">Score {gameScore.toLocaleString()}</Badge>
                      {combo > 1 ? <Badge tone="good">Streak ×{combo}</Badge> : null}
                    </div>
                    <div className="row">
                      {game === 'sprint' ? (
                        <>
                          <Button size="sm" variant="subtle" onClick={() => setShowCalc((v) => !v)}>
                            {showCalc ? 'Hide Calculator' : 'Calculator'}
                          </Button>
                          <PaneSwitch side={gameSplit.side} onClick={gameSplit.toggleSide} />
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
                      <button
                        key={opt}
                        type="button"
                        className="rush-option"
                        onClick={() => void handlePick(opt)}
                      >
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
      ) : null}

      {tab === 'rush' ? <PracticeRush /> : null}
    </div>
  );
}
