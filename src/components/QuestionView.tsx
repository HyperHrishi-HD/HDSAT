import { useState } from 'react';
import { FigureView, StimulusView } from './FigureView';
import { MathText } from './MathText';
import { ReportQuestion } from './ReportQuestion';
import { Badge, Button } from './ui';
import type { Question } from '../lib/types';

export interface Feedback {
  isCorrect: boolean;
  correctAnswer: string;
  explanation: string;
  distractorRationales?: Record<string, string>;
}

export function QuestionView({
  question,
  index,
  total,
  response,
  onResponseChange,
  eliminated,
  onToggleEliminate,
  flagged,
  onToggleFlag,
  feedback,
  onSubmit,
  disabled = false,
  showMeta = true,
}: {
  question: Question;
  index: number;
  total: number;
  response: string | null;
  onResponseChange: (value: string) => void;
  eliminated?: string[];
  onToggleEliminate?: (choiceId: string) => void;
  flagged?: boolean;
  onToggleFlag?: () => void;
  feedback?: Feedback | null;
  onSubmit?: () => void;
  disabled?: boolean;
  showMeta?: boolean;
}) {
  const [showRationales, setShowRationales] = useState(false);
  const eliminatedSet = new Set(eliminated ?? []);

  return (
    <article className="question">
      <header className="question-head">
        <div className="question-head-left">
          <span className="question-index">
            Question {index + 1} of {total}
          </span>
          {showMeta ? (
            <>
              <Badge tone="info">{question.section === 'Math' ? 'Math' : 'Reading & Writing'}</Badge>
              <Badge
                tone={
                  question.difficulty === 'Hard'
                    ? 'bad'
                    : question.difficulty === 'Medium'
                    ? 'warn'
                    : 'good'
                }
              >
                {question.difficulty}
              </Badge>
              <Badge>
                {question.format === 'spr' ? 'Student-produced response' : 'Multiple choice'}
              </Badge>
            </>
          ) : null}
        </div>
        {onToggleFlag ? (
          <button
            type="button"
            className={`flag-button${flagged ? ' is-flagged' : ''}`}
            onClick={onToggleFlag}
            aria-pressed={flagged}
          >
            {flagged ? 'Flagged for review' : 'Flag for review'}
          </button>
        ) : null}
      </header>

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
        <ul className="choices">
          {question.choices.map((choice) => {
            const selected = response === choice.id;
            const isKey = feedback && feedback.correctAnswer === choice.id;
            const isWrongPick = feedback && selected && !feedback.isCorrect;
            const rationale = feedback?.distractorRationales?.[choice.id];
            return (
              <li key={choice.id} className={eliminatedSet.has(choice.id) ? 'is-eliminated' : ''}>
                <div
                  className={`choice${selected ? ' is-selected' : ''}${isKey ? ' is-key' : ''}${
                    isWrongPick ? ' is-wrong' : ''
                  }`}
                >
                  <button
                    type="button"
                    className="choice-main"
                    onClick={() => onResponseChange(choice.id)}
                    disabled={disabled}
                    aria-pressed={selected}
                  >
                    <span className="choice-id">{choice.id}</span>
                    <MathText text={choice.text} />
                  </button>
                  {onToggleEliminate ? (
                    <button
                      type="button"
                      className="choice-eliminate"
                      onClick={() => onToggleEliminate(choice.id)}
                      title="Cross out this option"
                    >
                      {eliminatedSet.has(choice.id) ? 'restore' : 'cross out'}
                    </button>
                  ) : null}
                </div>
                {feedback && rationale && showRationales ? (
                  <p className="rationale">
                    <strong>{choice.id}:</strong> <MathText text={rationale} />
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="spr">
          <input
            type="text"
            inputMode="text"
            value={response ?? ''}
            onChange={(event) => onResponseChange(event.target.value)}
            placeholder="Type your answer"
            disabled={disabled}
            aria-label="Your answer"
          />
          <p className="field-hint">
            Fractions such as 3/4 and decimals such as 0.75 are both accepted when they are
            equivalent.
          </p>
        </div>
      )}

      {feedback ? (
        <div className={`feedback${feedback.isCorrect ? ' is-correct' : ' is-incorrect'}`}>
          <strong>
            {feedback.isCorrect ? 'Correct' : `Not quite. Correct answer: ${feedback.correctAnswer}`}
          </strong>
          <p>
            <MathText text={feedback.explanation} />
          </p>
          {feedback.distractorRationales &&
          Object.keys(feedback.distractorRationales).length > 0 ? (
            <button
              type="button"
              className="link-button"
              onClick={() => setShowRationales((value) => !value)}
            >
              {showRationales
                ? 'Hide option-by-option explanations'
                : 'Show option-by-option explanations'}
            </button>
          ) : null}
        </div>
      ) : null}

      {!feedback && onSubmit ? (
        <div className="question-actions">
          <Button onClick={onSubmit} disabled={disabled || !response}>
            Check answer
          </Button>
        </div>
      ) : null}

      <footer className="question-source">
        <span>
          {question.source_name} · {question.license}
          {question.is_released_practice_set ? ' · benchmark simulation set' : ''}
        </span>
        <span>
          {question.domain} · {question.skill} · <code>{question.id}</code>
        </span>
        <ReportQuestion questionId={question.id} />
      </footer>
    </article>
  );
}
