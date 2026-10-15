import { useState } from 'react';
import { CalculatorPanel } from '../components/MathTools';
import { MathText } from '../components/MathText';
import { Badge, Button, Card, Stat } from '../components/ui';
import { newEventId } from '../lib/storage';
import { useApp } from '../lib/store';

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
      'Plot $f(x) = x^2 - 4x + 3$ and $g(x) = 2x - 2$ in the graphing calculator below. What is the larger $x$-coordinate where the two graphs intersect?',
    expectedAnswer: '5',
    hint: 'Set x^2 - 4x + 3 = 2x - 2, or inspect x = 1 and x = 5 on the calculator probe.',
    explanation: 'At $x = 5$, $f(5) = 25 - 20 + 3 = 8$ and $g(5) = 10 - 2 = 8$. The two intersections are $(1, 0)$ and $(5, 8)$, so the larger $x$-coordinate is $5$.',
  },
  {
    id: 'DL-2',
    title: 'Lesson 2: Finding the Maximum of a Quadratic Trajectory',
    topic: 'Quadratic Vertex',
    f1: '-2x^2 + 12x - 10',
    f2: '8',
    prompt:
      'For the parabola $f(x) = -2x^2 + 12x - 10$, use the graph or vertex probe to find the maximum value of $f(x)$.',
    expectedAnswer: '8',
    hint: 'The vertex occurs at x = -b/(2a) = -12 / (2 * -2) = 3. Inspect f(3).',
    explanation: 'The axis of symmetry is $x = 3$. Evaluating $f(3) = -2(9) + 12(3) - 10 = -18 + 36 - 10 = 8$.',
  },
  {
    id: 'DL-3',
    title: 'Lesson 3: Counting Real Solutions via Tangency',
    topic: 'Discriminant & Tangency',
    f1: 'x^2 - 6x + 9',
    f2: '0',
    prompt:
      'Inspect the graph of $f(x) = x^2 - 6x + 9$. At what $x$-value does the parabola touch the $x$-axis ($y = 0$)?',
    expectedAnswer: '3',
    hint: 'Factor (x - 3)^2 = 0 or inspect x = 3 in the calculator.',
    explanation: 'Because $x^2 - 6x + 9 = (x - 3)^2$, the vertex $(3, 0)$ lies directly on the $x$-axis.',
  },
];

const EQUATION_SPRINT_ITEMS = [
  { id: 'ES-1', prompt: 'Solve for $x$: $4x - 7 = 21$', answer: '7', options: ['5', '6', '7', '8'] },
  { id: 'ES-2', prompt: 'If $3(x + 2) = 27$, what is $x$?', answer: '7', options: ['6', '7', '8', '9'] },
  { id: 'ES-3', prompt: 'Positive root of $x^2 - 9 = 0$:', answer: '3', options: ['0', '3', '6', '9'] },
  { id: 'ES-4', prompt: 'Slope of the line $6x - 2y = 10$:', answer: '3', options: ['-3', '2', '3', '5'] },
  { id: 'ES-5', prompt: 'If $2^x = 32$, what is $x$?', answer: '5', options: ['4', '5', '6', '16'] },
  { id: 'ES-6', prompt: 'Vertex $x$-coordinate of $y = x^2 - 8x + 15$:', answer: '4', options: ['2', '4', '8', '15'] },
];

const TRANSITION_MATCH_ITEMS = [
  {
    id: 'TM-1',
    sentence:
      'High-altitude observatories enjoy low atmospheric water vapor; _____, their remote mountain peaks complicate equipment transport.',
    answer: 'however',
    options: ['however', 'for example', 'consequently', 'similarly'],
  },
  {
    id: 'TM-2',
    sentence:
      'Urban street trees shade asphalt surfaces during heat waves; _____, neighborhoods with dense canopy cover record lower afternoon air temperatures.',
    answer: 'consequently',
    options: ['consequently', 'nevertheless', 'meanwhile', 'alternatively'],
  },
  {
    id: 'TM-3',
    sentence:
      'Several archival inventories listed the 1894 score as lost; _____, musicologists recently located a complete autographed copy in Vienna.',
    answer: 'nevertheless',
    options: ['nevertheless', 'therefore', 'furthermore', 'specifically'],
  },
  {
    id: 'TM-4',
    sentence:
      'Bivalve mollusks filter suspended particles from estuarine water; oysters in Chesapeake Bay, _____, can clarify puluhan liters per day.',
    answer: 'for instance',
    options: ['for instance', 'by contrast', 'subsequently', 'instead'],
  },
];

export function ArcadePage() {
  const app = useApp();
  const [mode, setMode] = useState<'desmos' | 'sprint' | 'transitions' | 'vocab'>('desmos');

  // Desmos Lab state
  const [lessonIdx, setLessonIdx] = useState(0);
  const [labAnswer, setLabAnswer] = useState('');
  const [labFeedback, setLabFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // Mini-game state
  const [gameIndex, setGameIndex] = useState(0);
  const [gameScore, setGameScore] = useState(0);
  const [gameDone, setGameDone] = useState(false);
  const [gameNote, setGameNote] = useState<string | null>(null);

  const activeLesson = DESMOS_LAB_LESSONS[lessonIdx];

  const handleCheckLab = () => {
    const clean = labAnswer.trim();
    const ok = clean === activeLesson.expectedAnswer;
    setLabFeedback({
      ok,
      text: ok ? `Correct! ${activeLesson.explanation}` : `Hint: ${activeLesson.hint}`,
    });
  };

  const resetMiniGame = (nextMode: typeof mode) => {
    setMode(nextMode);
    setGameIndex(0);
    setGameScore(0);
    setGameDone(false);
    setGameNote(null);
  };

  const handleSprintPick = async (choice: string) => {
    const item = EQUATION_SPRINT_ITEMS[gameIndex];
    const isCorrect = choice === item.answer;
    const nextScore = gameScore + (isCorrect ? 1 : 0);
    setGameScore(nextScore);
    setGameNote(isCorrect ? 'Correct!' : `Answer was ${item.answer}`);

    if (gameIndex + 1 >= EQUATION_SPRINT_ITEMS.length) {
      setGameDone(true);
      await app.actions.completeSession({
        activityType: 'mini_game',
        sessionId: newEventId(),
        questions: EQUATION_SPRINT_ITEMS.length,
        correct: nextScore,
        timeSpentSeconds: 30,
      });
    } else {
      setGameIndex((i) => i + 1);
    }
  };

  const handleTransitionPick = async (choice: string) => {
    const item = TRANSITION_MATCH_ITEMS[gameIndex];
    const isCorrect = choice === item.answer;
    const nextScore = gameScore + (isCorrect ? 1 : 0);
    setGameScore(nextScore);
    setGameNote(isCorrect ? 'Correct logical transition!' : `Expected "${item.answer}"`);

    if (gameIndex + 1 >= TRANSITION_MATCH_ITEMS.length) {
      setGameDone(true);
      await app.actions.completeSession({
        activityType: 'mini_game',
        sessionId: newEventId(),
        questions: TRANSITION_MATCH_ITEMS.length,
        correct: nextScore,
        timeSpentSeconds: 30,
      });
    } else {
      setGameIndex((i) => i + 1);
    }
  };

  const vocabItems = app.flashcards.filter((c) => c.deck === 'vocabulary').slice(0, 6);

  const handleVocabPick = async (pickedBack: string) => {
    const card = vocabItems[gameIndex];
    const isCorrect = pickedBack === card.back;
    const nextScore = gameScore + (isCorrect ? 1 : 0);
    setGameScore(nextScore);
    setGameNote(isCorrect ? 'Matched!' : `Definition: ${card.back}`);

    if (gameIndex + 1 >= vocabItems.length) {
      setGameDone(true);
      await app.actions.completeSession({
        activityType: 'mini_game',
        sessionId: newEventId(),
        questions: vocabItems.length,
        correct: nextScore,
        timeSpentSeconds: 30,
      });
    } else {
      setGameIndex((i) => i + 1);
    }
  };

  return (
    <div>
      <Card>
        <div className="row-between">
          <div>
            <h1>Desmos Lab &amp; SAT Skill Mini-Games</h1>
            <p className="muted">
              Interactive graphing calculator lessons and focused SAT skill games that reinforce algebraic fluency,
              rhetorical transitions, and vocabulary in context.
            </p>
          </div>
          <div className="row">
            <Button variant={mode === 'desmos' ? 'primary' : 'outline'} size="sm" onClick={() => resetMiniGame('desmos')}>
              Desmos Lab
            </Button>
            <Button variant={mode === 'sprint' ? 'primary' : 'outline'} size="sm" onClick={() => resetMiniGame('sprint')}>
              Equation Sprint
            </Button>
            <Button
              variant={mode === 'transitions' ? 'primary' : 'outline'}
              size="sm"
              onClick={() => resetMiniGame('transitions')}
            >
              Transition Match
            </Button>
            <Button variant={mode === 'vocab' ? 'primary' : 'outline'} size="sm" onClick={() => resetMiniGame('vocab')}>
              Vocab Precision
            </Button>
          </div>
        </div>
      </Card>

      {mode === 'desmos' ? (
        <div>
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

          <CalculatorPanel key={activeLesson.id} defaultFunctions={[activeLesson.f1, activeLesson.f2]} />
        </div>
      ) : null}

      {mode === 'sprint' ? (
        <Card>
          <div className="row-between">
            <h2>Equation Sprint</h2>
            <Badge tone="info">
              Score: {gameScore} / {EQUATION_SPRINT_ITEMS.length}
            </Badge>
          </div>
          {gameNote ? <p className="muted">{gameNote}</p> : null}

          {!gameDone ? (
            <div style={{ marginTop: 14 }}>
              <div className="prompt">
                <MathText text={EQUATION_SPRINT_ITEMS[gameIndex].prompt} />
              </div>
              <div className="card-grid" style={{ marginTop: 12 }}>
                {EQUATION_SPRINT_ITEMS[gameIndex].options.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    className="rush-option"
                    onClick={() => handleSprintPick(opt)}
                  >
                    <MathText text={`$${opt}$`} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <Stat label="Final Sprint Score" value={`${gameScore} / ${EQUATION_SPRINT_ITEMS.length}`} />
              <div style={{ marginTop: 12 }}>
                <Button onClick={() => resetMiniGame('sprint')}>Play Again</Button>
              </div>
            </div>
          )}
        </Card>
      ) : null}

      {mode === 'transitions' ? (
        <Card>
          <div className="row-between">
            <h2>Rhetorical Transition Match</h2>
            <Badge tone="info">
              Score: {gameScore} / {TRANSITION_MATCH_ITEMS.length}
            </Badge>
          </div>
          {gameNote ? <p className="muted">{gameNote}</p> : null}

          {!gameDone ? (
            <div style={{ marginTop: 14 }}>
              <div className="stimulus">{TRANSITION_MATCH_ITEMS[gameIndex].sentence}</div>
              <div className="card-grid">
                {TRANSITION_MATCH_ITEMS[gameIndex].options.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    className="rush-option"
                    onClick={() => handleTransitionPick(opt)}
                  >
                    <strong>{opt}</strong>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <Stat label="Final Transition Score" value={`${gameScore} / ${TRANSITION_MATCH_ITEMS.length}`} />
              <div style={{ marginTop: 12 }}>
                <Button onClick={() => resetMiniGame('transitions')}>Play Again</Button>
              </div>
            </div>
          )}
        </Card>
      ) : null}

      {mode === 'vocab' ? (
        <Card>
          <div className="row-between">
            <h2>Vocabulary Precision Match</h2>
            <Badge tone="info">
              Score: {gameScore} / {vocabItems.length}
            </Badge>
          </div>
          {gameNote ? <p className="muted">{gameNote}</p> : null}

          {!gameDone && vocabItems[gameIndex] ? (
            <div style={{ marginTop: 14 }}>
              <div className="prompt">Select the precise definition for: {vocabItems[gameIndex].front}</div>
              <div className="stack" style={{ marginTop: 10 }}>
                {vocabItems.slice(0, 4).map((choiceCard) => (
                  <button
                    key={choiceCard.id}
                    type="button"
                    className="rush-option"
                    onClick={() => handleVocabPick(choiceCard.back)}
                  >
                    {choiceCard.back}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <Stat label="Final Vocab Score" value={`${gameScore} / ${vocabItems.length}`} />
              <div style={{ marginTop: 12 }}>
                <Button onClick={() => resetMiniGame('vocab')}>Play Again</Button>
              </div>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}
