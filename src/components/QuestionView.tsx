import { useEffect, useState } from 'react';
import { FigureView, StimulusView } from './FigureView';
import { MathText } from './MathText';
import { ReportQuestion } from './ReportQuestion';
import { Badge, Button, Icon } from './ui';
import { paceComparison } from '../lib/timing';
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
  onNext,
  disabled = false,
  showMeta = true,
  timeSpentSeconds,
  typicalSeconds,
}: {
  question: Question;
  index: number;
  /** Omit to show the position without advertising the size of the working set. */
  total?: number;
  response: string | null;
  onResponseChange: (value: string) => void;
  eliminated?: string[];
  onToggleEliminate?: (choiceId: string) => void;
  flagged?: boolean;
  onToggleFlag?: () => void;
  feedback?: Feedback | null;
  onSubmit?: () => void;
  /** Called when the user presses Enter after feedback is already shown. */
  onNext?: () => void;
  disabled?: boolean;
  showMeta?: boolean;
  /** Time the student spent on this item, in seconds. */
  timeSpentSeconds?: number;
  /** Comparable typical time for this section and difficulty, in seconds. */
  typicalSeconds?: number;
}) {
  const [showRationales, setShowRationales] = useState(false);
  const eliminatedSet = new Set(eliminated ?? []);
  const pace =
    feedback && timeSpentSeconds && typicalSeconds
      ? paceComparison(timeSpentSeconds, typicalSeconds)
      : null;

  // Bluebook-style answer shortcuts + Enter to submit/advance, shared by
  // Practice, Rush and the bank.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isInputTarget = Boolean(
        target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable)
      );
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === 'Enter') {
        // Allow Enter from SPR input or anywhere on the question card (except textareas/buttons)
        if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON')) {
          return;
        }
        if (feedback && onNext) {
          event.preventDefault();
          onNext();
          return;
        }
        if (!disabled && !feedback && onSubmit && (response ?? '').trim().length > 0) {
          event.preventDefault();
          onSubmit();
          return;
        }
      }

      if (isInputTarget || disabled || question.format !== 'multiple_choice' || !question.choices) {
        return;
      }
      const key = event.key.toLowerCase();
      const letters = ['a', 'b', 'c', 'd'];
      const digits = ['1', '2', '3', '4'];
      const index = letters.includes(key) ? letters.indexOf(key) : digits.indexOf(key);
      if (index < 0) return;
      const choice = question.choices?.[index];
      if (!choice) return;
      event.preventDefault();
      onResponseChange(choice.id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [disabled, feedback, onNext, onResponseChange, onSubmit, question, response]);

  return (
    <article className="question">
      <header className="question-head">
        <div className="question-head-left">
          <span className="question-index">
            {total === undefined ? `Question ${index + 1}` : `Question ${index + 1} of ${total}`}
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
                    onClick={() => {
                      // Bluebook: choosing a crossed-out option selects it and
                      // lifts the cross-out; no undo click needed first.
                      onResponseChange(choice.id);
                      if (eliminatedSet.has(choice.id)) onToggleEliminate?.(choice.id);
                    }}
                    disabled={disabled}
                    aria-pressed={selected}
                  >
                    <span className="choice-id">{choice.id}</span>
                    <span className="choice-text">
                      <MathText text={choice.text} />
                    </span>
                  </button>
                  {onToggleEliminate ? (
                    <button
                      type="button"
                      className={`choice-eliminate${
                        eliminatedSet.has(choice.id) ? ' is-on' : ''
                      }`}
                      onClick={() => onToggleEliminate(choice.id)}
                      title={
                        eliminatedSet.has(choice.id)
                          ? `Restore option ${choice.id}`
                          : `Cross out option ${choice.id}`
                      }
                      aria-label={
                        eliminatedSet.has(choice.id)
                          ? `Restore option ${choice.id}`
                          : `Cross out option ${choice.id}`
                      }
                      aria-pressed={eliminatedSet.has(choice.id)}
                    >
                      <Icon name="strike" size={15} />
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
          <p className="field-hint">Fractions and equivalent decimals are both accepted.</p>
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
          {pace ? <p className="pace-note">{pace}</p> : null}
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
