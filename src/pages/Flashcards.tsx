import { useMemo, useState } from 'react';
import { MathText } from '../components/MathText';
import { Badge, Button, Card, EmptyState, Select, Stat } from '../components/ui';
import { isDue } from '../lib/sm2';
import { useApp } from '../lib/store';

export function FlashcardsPage() {
  const app = useApp();
  const [deckFilter, setDeckFilter] = useState<'all' | 'vocabulary' | 'math_formula'>('all');
  const [queueMode, setQueueMode] = useState<'due' | 'all'>('due');
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [revealed, setRevealed] = useState<boolean>(false);

  const filteredCards = useMemo(() => {
    return app.flashcards.filter((card) => {
      if (deckFilter !== 'all' && card.deck !== deckFilter) return false;
      if (queueMode === 'due') {
        return isDue(app.flashcardProgress[card.id]);
      }
      return true;
    });
  }, [app.flashcards, app.flashcardProgress, deckFilter, queueMode]);

  const currentCard = filteredCards[currentIndex] ?? filteredCards[0] ?? null;

  const stats = useMemo(() => {
    let mastered = 0;
    let learning = 0;
    let due = 0;
    app.flashcards.forEach((c) => {
      const prog = app.flashcardProgress[c.id];
      if (!prog || isDue(prog)) due += 1;
      if (prog?.stage === 'mastered') mastered += 1;
      else if (prog?.stage === 'learning' || prog?.stage === 'review') learning += 1;
    });
    return { mastered, learning, due, total: app.flashcards.length };
  }, [app.flashcards, app.flashcardProgress]);

  const handleGrade = async (quality: number) => {
    if (!currentCard) return;
    await app.actions.reviewFlashcard(currentCard.id, quality);
    setRevealed(false);
    setCurrentIndex((i) => (i + 1 >= Math.max(1, filteredCards.length - 1) ? 0 : i));
  };

  return (
    <div>
      <Card>
        <div className="row-between">
          <div>
            <h1>Vocabulary &amp; Math Formula Flashcards (SM-2)</h1>
            <p className="muted">
              Spaced-repetition study deck. Reviewing due cards schedules intervals with the SM-2 algorithm and awards
              daily HDCoins.
            </p>
          </div>
          <div className="row">
            <Select
              label="Deck"
              value={deckFilter}
              onChange={(v) => {
                setDeckFilter(v as 'all' | 'vocabulary' | 'math_formula');
                setCurrentIndex(0);
                setRevealed(false);
              }}
              options={[
                { value: 'all', label: 'All Cards (46)' },
                { value: 'vocabulary', label: 'SAT High-Utility Vocabulary (24)' },
                { value: 'math_formula', label: 'SAT Math Formulas & Identities (22)' },
              ]}
            />
            <Select
              label="Study Queue"
              value={queueMode}
              onChange={(v) => {
                setQueueMode(v as 'due' | 'all');
                setCurrentIndex(0);
                setRevealed(false);
              }}
              options={[
                { value: 'due', label: `Due Now (${stats.due})` },
                { value: 'all', label: `Browse All (${stats.total})` },
              ]}
            />
          </div>
        </div>

        <div className="card-grid" style={{ marginTop: 12 }}>
          <Stat label="Due for Review" value={stats.due} />
          <Stat label="In Progress" value={stats.learning} />
          <Stat label="Mastered (14+ day interval)" value={stats.mastered} />
          <Stat label="Total Deck Size" value={stats.total} />
        </div>
      </Card>

      {!currentCard ? (
        <Card>
          <EmptyState
            title="All due cards in this deck are complete!"
            body="You have cleared your immediate spaced-repetition queue. Switch to 'Browse All' to review ahead."
            action={
              <Button onClick={() => setQueueMode('all')} variant="outline">
                Browse All Cards
              </Button>
            }
          />
        </Card>
      ) : (
        <Card>
          <div className="row-between" style={{ marginBottom: 12 }}>
            <div className="row">
              <Badge tone="info">
                {currentCard.deck === 'math_formula' ? 'Math Formula' : 'Vocabulary'}
              </Badge>
              {currentCard.tags.map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
            <span className="muted">
              Card {Math.min(currentIndex + 1, filteredCards.length)} of {filteredCards.length} · Stage:{' '}
              <strong>{app.flashcardProgress[currentCard.id]?.stage ?? 'new'}</strong>
            </span>
          </div>

          <div
            className="flashcard"
            onClick={() => setRevealed((r) => !r)}
            style={{ cursor: 'pointer' }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setRevealed((r) => !r);
              }
            }}
          >
            <div className="front">{currentCard.front}</div>
            {revealed ? (
              <div className="back">
                {currentCard.latex ? (
                  <div style={{ margin: '10px 0', fontSize: '1.15rem' }}>
                    <MathText text={`$$${currentCard.latex}$$`} />
                  </div>
                ) : null}
                <p>{currentCard.back}</p>
              </div>
            ) : (
              <p className="muted">Click card or press Reveal to check definition / formula</p>
            )}
          </div>

          {!revealed ? (
            <div className="row-between" style={{ marginTop: 14 }}>
              <Button
                variant="outline"
                disabled={filteredCards.length <= 1}
                onClick={() => setCurrentIndex((i) => (i - 1 + filteredCards.length) % filteredCards.length)}
              >
                Previous
              </Button>
              <Button onClick={() => setRevealed(true)}>Reveal Answer</Button>
              <Button
                variant="outline"
                disabled={filteredCards.length <= 1}
                onClick={() => setCurrentIndex((i) => (i + 1) % filteredCards.length)}
              >
                Skip
              </Button>
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <p className="muted" style={{ textAlign: 'center', marginBottom: 8 }}>
                Rate your recall quality to schedule the next review:
              </p>
              <div className="quality-row">
                <Button variant="danger" onClick={() => handleGrade(1)}>
                  Again (1d)
                </Button>
                <Button variant="outline" onClick={() => handleGrade(3)}>
                  Hard (short)
                </Button>
                <Button variant="primary" onClick={() => handleGrade(4)}>
                  Good (standard)
                </Button>
                <Button variant="subtle" onClick={() => handleGrade(5)}>
                  Easy (boost)
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
