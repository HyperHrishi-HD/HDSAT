import { useMemo, useState } from 'react';
import { FigureView, StimulusView } from './FigureView';
import { MathText } from './MathText';
import { Badge, Button, Card } from './ui';
import { dailyHardQuestion, isQuestionOfTheDaySolved, markQuestionOfTheDaySolved } from '../lib/daily';
import { useApp } from '../lib/store';

/**
 * One Hard item per calendar day, the same one everywhere it appears. The
 * Dashboard copy can be dismissed for the day; the Arcade copy is permanent.
 */
export function QuestionOfTheDay({
  variant = 'full',
  onDismiss,
}: {
  variant?: 'full' | 'compact';
  onDismiss?: () => void;
}) {
  const app = useApp();
  const question = useMemo(
    () => dailyHardQuestion(app.questions, app.settings.assessment),
    [app.questions, app.settings.assessment]
  );
  const [response, setResponse] = useState('');
  const [feedback, setFeedback] = useState<{ correct: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!question) return null;

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

  return (
    <Card className="qotd-card">
      <div className="row-between" style={{ marginBottom: 8 }}>
        <div className="row">
          <Badge tone="warn">Hard</Badge>
          <h3 style={{ margin: 0 }}>Question of the Day</h3>
        </div>
        <div className="row">
          <Badge tone="info">
            {question.section === 'Math' ? 'Math' : 'R&W'} · {question.domain}
          </Badge>
          {variant === 'compact' && onDismiss ? (
            <button
              type="button"
              className="link-button"
              aria-label="Hide the Question of the Day on the Dashboard"
              title="Hide on Dashboard (it stays in the Arcade)"
              onClick={onDismiss}
            >
              Hide
            </button>
          ) : null}
        </div>
      </div>

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
          <span className="muted">Answering earns HDCoins like any practice item.</span>
        </div>
      ) : (
        <div className={`feedback ${feedback.correct ? 'is-correct' : 'is-incorrect'}`}>
          <strong>{feedback.correct ? 'Correct.' : 'Not quite.'}</strong>{' '}
          <MathText text={question.explanation ?? ''} />
        </div>
      )}

      {solved && isQuestionOfTheDaySolved() && !feedback ? (
        <p className="muted" style={{ marginBottom: 0 }}>
          You already solved today&apos;s question. A new one arrives tomorrow.
        </p>
      ) : null}
    </Card>
  );
}
