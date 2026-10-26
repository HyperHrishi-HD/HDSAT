import { useState } from 'react';
import { FigureView, StimulusView } from './FigureView';
import { DesmosPane } from './MathTools';
import { MathText } from './MathText';
import { ReferenceWindow } from './ReferenceWindow';
import { PaneSwitch, SplitWorkbench, useSplitPane } from './SplitWorkbench';
import { Badge, Button } from './ui';
import { checkSpr, type RuneItem } from '../lib/arcadeGames';
import type { Question } from '../lib/types';

/**
 * The rune gate's question panel.
 *
 * Math items get a Desmos pane and the reference sheet, both opt-in: the panel
 * opens with the question alone, and the student presses the button when they
 * want the tool. The card has a fixed height so opening either one changes the
 * question pane's width, never the panel's place over the room.
 */
export function RuneQuestionCard({
  item,
  question,
  feedback,
  sprInput,
  onSprChange,
  onAnswer,
  assessment,
}: {
  item: RuneItem;
  question: Question;
  feedback: { ok: boolean; text: string } | null;
  sprInput: string;
  onSprChange: (value: string) => void;
  onAnswer: (ok: boolean) => void;
  assessment?: string;
}) {
  const [calcOpen, setCalcOpen] = useState(false);
  // Desmos is a heavy iframe: mount it on first use, never for a Reading rune
  // and never behind a closed pane.
  const [calcMounted, setCalcMounted] = useState(false);
  const [refOpen, setRefOpen] = useState(false);
  const split = useSplitPane('hdsat.split.vault', {
    ratio: 48,
    side: 'right',
    minRatio: 30,
    maxRatio: 70,
  });
  const isMath = item.section === 'Math';
  const locked = Boolean(feedback?.ok);

  return (
    <div className="vault-question" role="dialog" aria-label="Rune question">
      <div className="vault-question-card">
        <div className="row-between" style={{ marginBottom: 8 }}>
          <div className="row">
            <Badge tone={isMath ? 'info' : 'warn'}>{item.section}</Badge>
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              {item.skill}
            </span>
          </div>
          <div className="row vault-question-tools">
            {isMath ? (
              <>
                <Button
                  size="sm"
                  variant={calcOpen ? 'primary' : 'subtle'}
                  onClick={() => {
                    setCalcMounted(true);
                    setCalcOpen((open) => !open);
                  }}
                  title="Open the Desmos calculator beside this question"
                >
                  Desmos
                </Button>
                <PaneSwitch side={split.side} onClick={split.toggleSide} />
                <Button
                  size="sm"
                  variant={refOpen ? 'primary' : 'subtle'}
                  onClick={() => setRefOpen((open) => !open)}
                  title="Open the math reference sheet"
                >
                  Reference
                </Button>
              </>
            ) : null}
            <span className="muted" style={{ fontSize: '0.78rem' }}>
              {item.format === 'spr' ? 'Typed answer' : 'Multiple choice'}
            </span>
          </div>
        </div>

        <SplitWorkbench
          className="vault-workbench"
          side={split.side}
          ratio={split.ratio}
          minRatio={split.minRatio}
          maxRatio={split.maxRatio}
          onRatioChange={split.setRatio}
          toolVisible={isMath && calcOpen}
          toolKind="calc"
          tool={isMath && calcMounted ? <DesmosPane /> : null}
          main={
            <div className="vault-question-body">
              <FigureView question={question} />
              {item.stimulus ? (
                <div className="stimulus">
                  <StimulusView stimulus={item.stimulus} />
                </div>
              ) : null}
              <div className="prompt">
                <MathText text={item.prompt} />
              </div>

              {feedback ? (
                <div className={`feedback ${feedback.ok ? 'is-correct' : 'is-incorrect'}`}>
                  <MathText text={feedback.text} />
                </div>
              ) : null}

              {item.format === 'multiple_choice' && item.choices ? (
                <div className="vault-choices">
                  {item.choices.map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
                      className="rush-option"
                      disabled={locked}
                      onClick={() => onAnswer(choice.id === item.correctId)}
                    >
                      <strong>{choice.id}.</strong> <MathText text={choice.text} />
                    </button>
                  ))}
                </div>
              ) : (
                <form
                  className="row vault-spr"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onAnswer(checkSpr(item, sprInput));
                  }}
                >
                  <input
                    type="text"
                    inputMode="text"
                    value={sprInput}
                    disabled={locked}
                    onChange={(event) => onSprChange(event.target.value)}
                    placeholder="Type your answer"
                    aria-label="Your answer"
                  />
                  <Button type="submit" disabled={!sprInput.trim() || locked}>
                    Submit
                  </Button>
                </form>
              )}
            </div>
          }
        />

        {isMath && refOpen ? (
          <ReferenceWindow assessment={assessment} onClose={() => setRefOpen(false)} />
        ) : null}
      </div>
    </div>
  );
}
