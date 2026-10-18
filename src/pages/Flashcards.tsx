import { useMemo, useState } from 'react';
import { MathText } from '../components/MathText';
import { Badge, Button, Card, EmptyState, Select, Stat } from '../components/ui';
import { isDue } from '../lib/sm2';
import { useApp } from '../lib/store';

type DeckId = 'vocabulary' | 'math_formula';

const DECKS: Record<DeckId, { label: string; blurb: string }> = {
  vocabulary: {
    label: 'Vocabulary',
    blurb: 'SAT high-utility and elevated vocabulary, spaced with SM-2. Every word is a separate card with its part of speech and definition — no math here.',
  },
  math_formula: {
    label: 'Math Formulas & Identities',
    blurb: 'SAT formulas, algebra identities, geometry, trigonometry and statistics — each card renders its expression in KaTeX. No vocabulary here.',
  },
};

export function FlashcardsPage() {
  const app = useApp();
  const [activeDeck, setActiveDeck] = useState<DeckId>('vocabulary');
  const [queueMode, setQueueMode] = useState<'due' | 'all'>('due');
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [revealed, setRevealed] = useState<boolean>(false);

  const cardsOfDeck = useMemo(
    () => app.flashcards.filter((card) => card.deck === activeDeck),
    [app.flashcards, activeDeck]
  );
  const otherDeck: DeckId = activeDeck === 'vocabulary' ? 'math_formula' : 'vocabulary';

  const filteredCards = useMemo(() => {
    return cardsOfDeck.filter((card) => {
      if (queueMode === 'due') {
        return isDue(app.flashcardProgress[card.id]);
      }
      return true;
    });
  }, [cardsOfDeck, app.flashcardProgress, queueMode]);

  const currentCard = filteredCards[currentIndex] ?? filteredCards[0] ?? null;

  const stats = useMemo(() => {
    let mastered = 0;
    let learning = 0;
    let due = 0;
    cardsOfDeck.forEach((c) => {
      const prog = app.flashcardProgress[c.id];
      if (!prog || isDue(prog)) due += 1;
      if (prog?.stage === 'mastered') mastered += 1;
      else if (prog?.stage === 'learning' || prog?.stage === 'review') learning += 1;
    });
    return { mastered, learning, due, total: cardsOfDeck.length };
  }, [cardsOfDeck, app.flashcardProgress]);

  const deckCounts = useMemo(() => {
    const counts: Record<DeckId, number> = { vocabulary: 0, math_formula: 0 };
    app.flashcards.forEach((c) => {
      if (c.deck === 'vocabulary' || c.deck === 'math_formula') counts[c.deck] += 1;
    });
    return counts;
  }, [app.flashcards]);

  const switchDeck = (deck: DeckId) => {
    setActiveDeck(deck);
    setCurrentIndex(0);
    setRevealed(false);
  };

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
            <h1>Flashcards — Spaced Repetition (SM-2)</h1>
            <p className="muted">
              Two fully separate decks. Reviewing due cards schedules intervals with the SM-2 algorithm and awards daily
              HDCoins.
            </p>
          </div>
          <div className="row">
            <Button
              variant={activeDeck === 'vocabulary' ? 'primary' : 'outline'}
              onClick={() => switchDeck('vocabulary')}
            >
              Vocabulary ({deckCounts.vocabulary.toLocaleString()})
            </Button>
            <Button
              variant={activeDeck === 'math_formula' ? 'primary' : 'outline'}
              onClick={() => switchDeck('math_formula')}
            >
              Math Formulas ({deckCounts.math_formula})
            </Button>
          </div>
        </div>

        <p className="muted" style={{ marginTop: 8 }}>
          {DECKS[activeDeck].blurb}
        </p>

        <div className="row" style={{ marginTop: 8 }}>
          <Select
            label="Study Queue"
            value={queueMode}
            onChange={(v) => {
              setQueueMode(v as 'due' | 'all');
              setCurrentIndex(0);
              setRevealed(false);
            }}
            options={[
              { value: 'due', label: `Due Now (${stats.due.toLocaleString()})` },
              { value: 'all', label: `Browse All (${stats.total.toLocaleString()})` },
            ]}
          />
        </div>

        <div className="card-grid" style={{ marginTop: 12 }}>
          <Stat label="Due for Review" value={stats.due.toLocaleString()} />
          <Stat label="In Progress" value={stats.learning.toLocaleString()} />
          <Stat label="Mastered (14+ day interval)" value={stats.mastered.toLocaleString()} />
          <Stat label="This Deck Size" value={stats.total.toLocaleString()} />
        </div>
      </Card>

      {!currentCard ? (
        <Card>
          <EmptyState
            title="All due cards in this deck are complete!"
            body={
              queueMode === 'due'
                ? `You have cleared your ${
                    DECKS[activeDeck].label
                  } spaced-repetition queue. Switch to 'Browse All' to review ahead, or switch to the ${
                    DECKS[otherDeck].label
                  } deck.`
                : 'This deck is empty in the current build.'
            }
            action={
              queueMode === 'due' ? (
                <Button onClick={() => setQueueMode('all')} variant="outline">
                  Browse All Cards
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Card>
          <div className="row-between" style={{ marginBottom: 12 }}>
            <div className="row">
              <Badge tone="info">{DECKS[activeDeck].label}</Badge>
              {currentCard.tags.slice(0, 3).map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
            <span className="muted">
              Card {Math.min(currentIndex + 1, filteredCards.length).toLocaleString()} of{' '}
              {filteredCards.length.toLocaleString()} · Stage:{' '}
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
