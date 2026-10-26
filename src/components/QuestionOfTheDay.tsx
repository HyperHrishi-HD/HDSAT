import { useMemo, useState } from 'react';
import { FigureView, StimulusView } from './FigureView';
import { FloatingToolWindow } from './FloatingToolWindow';
import { DesmosFrame } from './MathTools';
import { MathText } from './MathText';
import { ReferenceWindow } from './ReferenceWindow';
import { Badge, Button, Card } from './ui';
import {
  dailyHardQuestion,
  isQuestionOfTheDayExpanded,
  isQuestionOfTheDaySolved,
  markQuestionOfTheDaySolved,
  setQuestionOfTheDayExpanded,
} from '../lib/daily';
import { useApp } from '../lib/store';

/**
 * One Hard item per calendar day, the same one everywhere it appears.
 *
 * `compact` is the Dashboard: a single-line strip that expands in place, so the
 * question never pushes the rest of the page down. `full` is the Arcade card.
 */
export function QuestionOfTheDay({
  variant = 'full',
  onDismiss,
}: {
  variant?: 'full' | 'compact';
  onDismiss?: () => void;
}) {
  const app = useApp();
  // The pick is cached per date inside dailyHardQuestion, so progress changing
  // as the student answers cannot swap the card out from under them.
  const question = useMemo(
    () => dailyHardQuestion(app.questions, app.settings.assessment, undefined, app.progress),
    [app.questions, app.settings.assessment, app.progress]
  );
  const [response, setResponse] = useState('');
  const [feedback, setFeedback] = useState<{ correct: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(() => isQuestionOfTheDayExpanded());
  const [calcOpen, setCalcOpen] = useState(false);
  const [refOpen, setRefOpen] = useState(false);

  if (!question) return null;
  const isMath = question.section === 'Math';

  const solved = isQuestionOfTheDaySolved() || Boolean(feedback);

  const submit = async () => {
    const value = response.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      const result = await app.actions.submitAttempt(question, value, { mode: 'practice' });
      setFeedback({ correct: result.isCorrect });
      markQuestionOfTheDaySolved();
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <>
      {/* A Math item gets the same two tools as the rest of the workspace, and
          neither is open until the student asks for it. */}
      {isMath ? (
        <div className="row qotd-tools" style={{ gap: 6, marginBottom: 8 }}>
          <Button
            size="sm"
            variant={calcOpen ? 'primary' : 'subtle'}
            onClick={() => setCalcOpen((open) => !open)}
            title="Open the Desmos calculator beside this question"
          >
            Desmos
          </Button>
          <Button
            size="sm"
            variant={refOpen ? 'primary' : 'subtle'}
            onClick={() => setRefOpen((open) => !open)}
            title="Open the math reference sheet"
          >
            Reference
          </Button>
        </div>
      ) : null}

      <FigureView question={question} />
      {question.stimulus ? (
        <div className="stimulus">
          <StimulusView stimulus={question.stimulus} />
        </div>
      ) : null}
      <div className="prompt">
        <MathText text={question.prompt} />
      </div>

      {question.format === 'multiple_choice' && question.choices ? (
        <div>
          {question.choices.map((choice) => {
            const chosen = response === choice.id;
            const isKey = choice.id === question.correct_answer;
            const mark = feedback ? (isKey ? ' ✓' : chosen ? ' ✗' : '') : '';
            return (
              <button
                key={choice.id}
                type="button"
                className="rush-option"
                disabled={solved || busy}
                onClick={() => setResponse(choice.id)}
                style={
                  feedback && isKey
                    ? { borderColor: 'var(--good)' }
                    : feedback && chosen
                    ? { borderColor: 'var(--bad)' }
                    : chosen
                    ? { borderColor: 'var(--accent)' }
                    : undefined
                }
              >
                <strong>{choice.id}.</strong> <MathText text={choice.text} />
                {mark}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="row">
          <input
            type="text"
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            placeholder="Enter your answer"
            disabled={solved}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
        </div>
      )}

      {!feedback ? (
        <div className="row" style={{ marginTop: 10 }}>
          <Button onClick={() => void submit()} disabled={busy || !response.trim()}>
            {busy ? 'Checking…' : 'Submit answer'}
          </Button>
        </div>
      ) : (
        <div className={`feedback ${feedback.correct ? 'is-correct' : 'is-incorrect'}`}>
          <strong>{feedback.correct ? 'Correct.' : 'Not quite.'}</strong>{' '}
          <MathText text={question.explanation ?? ''} />
        </div>
      )}

      {solved && isQuestionOfTheDaySolved() && !feedback ? (
        <p className="muted" style={{ marginBottom: 0 }}>
          A new question arrives tomorrow.
        </p>
      ) : null}

      {isMath && calcOpen ? (
        <FloatingToolWindow
          title="Desmos Graphing Calculator"
          onClose={() => setCalcOpen(false)}
          storageKey="hdsat.window.qotd-calc"
          defaultWidth={520}
          defaultHeight={500}
          placement="bottom"
          minWidth={280}
          minHeight={260}
          bodyClassName="bb-calc-window-body"
          testId="qotd-calculator-window"
        >
          <DesmosFrame />
        </FloatingToolWindow>
      ) : null}

      {isMath && refOpen ? (
        <ReferenceWindow
          assessment={app.settings.assessment}
          onClose={() => setRefOpen(false)}
        />
      ) : null}
    </>
  );

  if (variant === 'compact') {
    const scope = `${question.section === 'Math' ? 'Math' : 'R&W'} · ${question.domain}`;
    return (
      <Card className={`qotd-card qotd-strip${expanded ? ' is-open' : ''}`}>
        <div className="qotd-strip-row">
          <button
            type="button"
            className="qotd-strip-main"
            aria-expanded={expanded}
            onClick={() =>
              setExpanded((open) => {
                setQuestionOfTheDayExpanded(!open);
                return !open;
              })
            }
          >
            <Badge tone="warn">Daily</Badge>
            <strong>Question of the Day</strong>
            <span className="qotd-strip-scope">{scope}</span>
            {solved ? <Badge tone="good">Solved</Badge> : null}
            <span className="qotd-strip-toggle">{expanded ? 'Close' : 'Open'}</span>
          </button>
          {onDismiss ? (
            <button
              type="button"
              className="link-button qotd-strip-hide"
              aria-label="Hide the Question of the Day on the Dashboard"
              title="Hide on Dashboard (it stays in the Arcade)"
              onClick={onDismiss}
            >
              Hide
            </button>
          ) : null}
        </div>
        {expanded ? <div className="qotd-strip-body">{body}</div> : null}
      </Card>
    );
  }

  return (
    <Card className="qotd-card">
      <div className="row-between" style={{ marginBottom: 8 }}>
        <div className="row">
          <Badge tone="warn">Hard</Badge>
          <h3 style={{ margin: 0 }}>Question of the Day</h3>
        </div>
        <Badge tone="info">
          {question.section === 'Math' ? 'Math' : 'R&W'} · {question.domain}
        </Badge>
      </div>
      {body}
    </Card>
  );
}
