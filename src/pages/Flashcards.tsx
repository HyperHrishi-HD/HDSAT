import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MathText } from '../components/MathText';
import { Badge, Button, Card, EmptyState, InfoTip, Select, Stat } from '../components/ui';
import { isDue } from '../lib/sm2';
import { useApp } from '../lib/store';

type DeckId = 'vocabulary' | 'math_formula';

const DECKS: Record<DeckId, { label: string; blurb: string }> = {
  vocabulary: {
    label: 'Vocabulary',
    blurb: 'High-utility SAT vocabulary, one word per card with its part of speech and definition.',
  },
  math_formula: {
    label: 'Math Formulas & Identities',
    blurb: 'SAT formulas, identities, geometry, trigonometry and statistics, rendered in KaTeX.',
  },
};

/** Domains that belong to the Math deck when a cross-link supplies only a domain. */
const MATH_DOMAINS = new Set([
  'Algebra',
  'Advanced Math',
  'Problem-Solving and Data Analysis',
  'Geometry and Trigonometry',
]);

export function FlashcardsPage() {
  const app = useApp();
  const [searchParams] = useSearchParams();
  const domainParam = searchParams.get('domain')?.trim() ?? '';
  const sectionParam = searchParams.get('section')?.trim() ?? '';
  const deckParam = searchParams.get('deck')?.trim() ?? '';
  const initialDeck: DeckId =
    deckParam === 'math_formula' || deckParam === 'vocabulary'
      ? deckParam
      : sectionParam === 'Math' || MATH_DOMAINS.has(domainParam)
      ? 'math_formula'
      : 'vocabulary';

  const [activeDeck, setActiveDeck] = useState<DeckId>(initialDeck);
  const [queueMode, setQueueMode] = useState<'due' | 'all'>('due');
  const [browseView, setBrowseView] = useState<'list' | 'study'>('list');
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [revealed, setRevealed] = useState<boolean>(false);
  const [browseSearch, setBrowseSearch] = useState('');
  // A fresh draw each time the deck or queue changes, and a manual reshuffle.
  // The order has to survive grading a card, so it lives in a memo keyed by a
  // seed rather than being drawn on every render.
  const [shuffleSeed, setShuffleSeed] = useState(0);

  const cardsOfDeck = useMemo(
    () => app.flashcards.filter((card) => card.deck === activeDeck),
    [app.flashcards, activeDeck]
  );
  const otherDeck: DeckId = activeDeck === 'vocabulary' ? 'math_formula' : 'vocabulary';

  useEffect(() => {
    setActiveDeck(initialDeck);
    setCurrentIndex(0);
    setRevealed(false);
  }, [initialDeck]);

  /** Fisher-Yates, so every card is equally likely to be first. */
  const shuffledDeck = useMemo(() => {
    const copy = [...cardsOfDeck];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }, [cardsOfDeck, shuffleSeed]);

  const filteredCards = useMemo(() => {
    return shuffledDeck.filter((card) => {
      if (queueMode === 'due') {
        return isDue(app.flashcardProgress[card.id]);
      }
      return true;
    });
  }, [shuffledDeck, app.flashcardProgress, queueMode]);

  const browseCards = useMemo(() => {
    const query = browseSearch.trim().toLowerCase();
    if (!query) return filteredCards;
    return filteredCards.filter((card) => {
      const searchable = [card.front, card.back, ...(card.tags ?? [])].join(' ').toLowerCase();
      return searchable.includes(query);
    });
  }, [filteredCards, browseSearch]);

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

  const switchDeck = (deck: DeckId) => {
    setActiveDeck(deck);
    setShuffleSeed((seed) => seed + 1);
    setCurrentIndex(0);
    setRevealed(false);
    setBrowseSearch('');
    if (queueMode === 'all') setBrowseView('list');
  };

  const reshuffle = () => {
    setShuffleSeed((seed) => seed + 1);
    setCurrentIndex(0);
    setRevealed(false);
  };

  const openCard = (indexInFiltered: number) => {
    setCurrentIndex(indexInFiltered);
    setRevealed(false);
    setBrowseView('study');
    window.scrollTo(0, 0);
  };

  const handleGrade = async (quality: number) => {
    if (!currentCard) return;
    await app.actions.reviewFlashcard(currentCard.id, quality);
    setRevealed(false);
    // In the due queue the graded card usually leaves the list, so the next
    // card slides into the same position; in Browse All the list is stable and
    // the next one is one step ahead.
    if (queueMode === 'due') {
      setCurrentIndex(0);
    } else {
      setCurrentIndex((i) => (i + 1) % Math.max(1, filteredCards.length));
    }
  };

  const toggleQueue = (value: 'due' | 'all') => {
    setQueueMode(value);
    setShuffleSeed((seed) => seed + 1);
    setCurrentIndex(0);
    setRevealed(false);
    setBrowseSearch('');
    setBrowseView(value === 'all' ? 'list' : 'study');
  };

  return (
    <div>
      <Card>
        <div className="row-between">
          <div>
            <div className="row">
              <h1>Flashcards</h1>
              <InfoTip label="About decks">
                {DECKS[activeDeck].blurb} Due reviews earn HDCoins and mastered cards return after 14
                days.
              </InfoTip>
            </div>
          </div>
          <div className="row">
            <Button
              variant={activeDeck === 'vocabulary' ? 'primary' : 'outline'}
              icon="flashcards"
              onClick={() => switchDeck('vocabulary')}
            >
              Vocabulary
            </Button>
            <Button
              variant={activeDeck === 'math_formula' ? 'primary' : 'outline'}
              icon="reference"
              onClick={() => switchDeck('math_formula')}
            >
              Math Formulas
            </Button>
          </div>
        </div>

        <div className="report-cross-links" aria-label="Study the same material another way">
          <span className="muted">More ways to study:</span>
          <Link to={domainParam ? `/practice?domain=${encodeURIComponent(domainParam)}&count=10` : '/practice'}>
            Practice 10 questions
          </Link>
          <Link to={domainParam ? `/bank?domain=${encodeURIComponent(domainParam)}` : '/bank'}>
            Open the question bank
          </Link>
          <Link to="/arcade">Skill mini-games</Link>
        </div>

        <div className="flashcard-toolbar">
          <Select
            label="Study queue"
            value={queueMode}
            onChange={(value) => toggleQueue(value as 'due' | 'all')}
            options={[
              { value: 'due', label: 'Next due' },
              { value: 'all', label: 'Browse all' },
            ]}
          />
          {queueMode === 'all' ? (
            <div className="field" style={{ marginBottom: 0 }}>
              <span className="field-label">Find a card</span>
              <input
                type="search"
                value={browseSearch}
                onChange={(event) => setBrowseSearch(event.target.value)}
                placeholder="Search this deck"
                aria-label="Search all cards in this deck"
              />
            </div>
          ) : null}
          <Button variant="outline" size="sm" onClick={reshuffle} icon="refresh">
            Shuffle
          </Button>
        </div>

        <div className="card-grid" style={{ marginTop: 12 }}>
          <Stat label="Next up" value={stats.due.toLocaleString()} />
          <Stat label="In Progress" value={stats.learning.toLocaleString()} />
          <Stat label="Mastered" value={stats.mastered.toLocaleString()} />
        </div>
      </Card>

      {queueMode === 'all' && browseView === 'list' ? (
        <Card>
          <div className="flashcard-index-head">
            <div>
              <h2 style={{ margin: 0 }}>All cards</h2>
              <p className="muted" style={{ margin: '2px 0 0' }}>
                {browseCards.length.toLocaleString()} of {filteredCards.length.toLocaleString()} cards
                shown
              </p>
            </div>
            <Badge tone="info">{DECKS[activeDeck].label}</Badge>
          </div>

          {browseCards.length === 0 ? (
            <EmptyState
              title="No cards match that search"
              body="Try a shorter word or clear the search."
              action={
                <Button variant="outline" onClick={() => setBrowseSearch('')}>
                  Clear search
                </Button>
              }
            />
          ) : (
            <div className="flashcard-grid">
              {browseCards.map((card) => {
                const index = filteredCards.findIndex((item) => item.id === card.id);
                const stage = app.flashcardProgress[card.id]?.stage ?? 'new';
                return (
                  <button
                    key={card.id}
                    type="button"
                    className="flashcard-tile"
                    onClick={() => openCard(Math.max(0, index))}
                  >
                    <strong>{card.front}</strong>
                    <span>{card.tags?.slice(0, 2).join(' · ') || DECKS[activeDeck].label}</span>
                    <div className="flashcard-tile-stage">
                      <span>{stage}</span>
                      <span>Open card</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      ) : !currentCard ? (
        <Card>
          <EmptyState
            title="Nothing due right now"
            body={
              queueMode === 'due'
                ? `You are caught up on ${DECKS[activeDeck].label}. Browse all, or switch to ${DECKS[otherDeck].label}.`
                : 'This deck has no cards yet.'
            }
            action={
              queueMode === 'due' ? (
                <Button onClick={() => toggleQueue('all')} variant="outline">
                  Browse all cards
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
            <div className="row">
              {queueMode === 'all' ? (
                <Button variant="ghost" size="sm" onClick={() => setBrowseView('list')}>
                  All cards
                </Button>
              ) : null}
              <span className="muted">
                Card {Math.min(currentIndex + 1, filteredCards.length).toLocaleString()} of{' '}
                {filteredCards.length.toLocaleString()} · Stage:{' '}
                <strong>{app.flashcardProgress[currentCard.id]?.stage ?? 'new'}</strong>
              </span>
            </div>
          </div>

          <div
            key={currentCard.id}
            className={`flashcard${revealed ? ' is-revealed' : ''}`}
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
              <p className="muted">Click the card or press Reveal.</p>
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
              <div className="quality-row">
                <Button variant="danger" onClick={() => handleGrade(1)}>
                  Again (1d)
                </Button>
                <Button variant="outline" onClick={() => handleGrade(3)}>
                  Hard
                </Button>
                <Button variant="primary" onClick={() => handleGrade(4)}>
                  Good
                </Button>
                <Button variant="subtle" onClick={() => handleGrade(5)}>
                  Easy
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
