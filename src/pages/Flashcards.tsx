import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MathText } from '../components/MathText';
import { Badge, Button, Card, EmptyState, InfoTip, Select, Stat } from '../components/ui';
import { isDue } from '../lib/sm2';
import { useApp } from '../lib/store';
import type { Flashcard } from '../lib/types';

type DeckId = Flashcard['deck'];

const DECKS: Record<DeckId, { label: string; blurb: string }> = {
  vocabulary: {
    label: 'Vocabulary',
    blurb: 'High-utility SAT vocabulary, one word per card with its part of speech and definition.',
  },
  math_formula: {
    label: 'Math Formulas & Identities',
    blurb: 'SAT formulas, identities, geometry, trigonometry and statistics, rendered in KaTeX.',
  },
  nawl: {
    label: 'Academic Vocabulary (NAWL)',
    blurb: 'The New Academic Word List: high-frequency words for university reading, with WordNet definitions.',
  },
  ngsl: {
    label: 'Core Vocabulary (NGSL)',
    blurb: 'New General Service List words beyond the first 500, with parts of speech and WordNet definitions.',
  },
  official_context: {
    label: 'Words from Real Questions',
    blurb: 'Vocabulary questions drawn from released College Board Words-in-Context items, with the official answer and explanation.',
  },
};

const isDeckId = (value: string): value is DeckId => value in DECKS;
const BROWSE_PAGE = 120;

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
    isDeckId(deckParam)
      ? deckParam
      : sectionParam === 'Math' || MATH_DOMAINS.has(domainParam)
      ? 'math_formula'
      : 'vocabulary';

  const [activeDeck, setActiveDeck] = useState<DeckId>(initialDeck);
  const [queueMode, setQueueMode] = useState<'due' | 'all'>('due');
  const [browseView, setBrowseView] = useState<'list' | 'study'>('list');
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  // Browse All is collection-wide. A tile from another deck pins that card by
  // id while the active deck catches up, so the study card opens reliably.
  const [pinnedCardId, setPinnedCardId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<boolean>(false);
  const [browseSearch, setBrowseSearch] = useState('');
  const [browseLimit, setBrowseLimit] = useState(BROWSE_PAGE);
  // A fresh draw each time the deck or queue changes, and a manual reshuffle.
  // The order has to survive grading a card, so it lives in a memo keyed by a
  // seed rather than being drawn on every render.
  const [shuffleSeed, setShuffleSeed] = useState(0);

  const cardsOfDeck = useMemo(
    () => app.flashcards.filter((card) => card.deck === activeDeck),
    [app.flashcards, activeDeck]
  );
  useEffect(() => {
    setActiveDeck(initialDeck);
    setCurrentIndex(0);
    setPinnedCardId(null);
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

  const browsePool = useMemo(
    () => (queueMode === 'all' ? app.flashcards : filteredCards),
    [app.flashcards, filteredCards, queueMode]
  );
  const browseCards = useMemo(() => {
    const query = browseSearch.trim().toLowerCase();
    if (!query) return browsePool;
    return browsePool.filter((card) => {
      const searchable = [card.front, card.back, ...(card.tags ?? [])].join(' ').toLowerCase();
      return searchable.includes(query);
    });
  }, [browsePool, browseSearch]);
  // Rendering every one of the 5k generated cards at once makes the index
  // unusable on a phone (and the browser spends seconds laying out hidden
  // tiles). The count above is always the collection total; the index grows
  // in pages so every card remains reachable without freezing the page.
  const visibleBrowseCards = useMemo(
    () => browseCards.slice(0, browseLimit),
    [browseCards, browseLimit]
  );
  useEffect(() => {
    setBrowseLimit(BROWSE_PAGE);
  }, [activeDeck, browseSearch, queueMode]);

  const currentCard = useMemo(
    () =>
      (pinnedCardId ? filteredCards.find((card) => card.id === pinnedCardId) : null) ??
      filteredCards[currentIndex] ??
      filteredCards[0] ??
      null,
    [pinnedCardId, filteredCards, currentIndex]
  );
  const currentPosition = currentCard
    ? Math.max(0, filteredCards.findIndex((card) => card.id === currentCard.id))
    : 0;

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
    setPinnedCardId(null);
    setRevealed(false);
    setBrowseSearch('');
    if (queueMode === 'all') setBrowseView('list');
  };

  const reshuffle = () => {
    setShuffleSeed((seed) => seed + 1);
    setCurrentIndex(0);
    setPinnedCardId(null);
    setRevealed(false);
  };

  const openBrowseCard = (card: Flashcard) => {
    if (card.deck !== activeDeck) {
      setActiveDeck(card.deck);
      setShuffleSeed((seed) => seed + 1);
    }
    setQueueMode('all');
    setPinnedCardId(card.id);
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
    setPinnedCardId(null);
    if (queueMode === 'due') {
      setCurrentIndex(0);
    } else {
      setCurrentIndex((currentPosition + 1) % Math.max(1, filteredCards.length));
    }
  };

  const toggleQueue = (value: 'due' | 'all') => {
    setQueueMode(value);
    setShuffleSeed((seed) => seed + 1);
    setCurrentIndex(0);
    setPinnedCardId(null);
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
            <Select
              label="Deck"
              value={activeDeck}
              onChange={(value) => switchDeck(value as DeckId)}
              options={Object.entries(DECKS).map(([value, deck]) => ({
                value,
                label: deck.label,
              }))}
            />
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
                placeholder="Search all cards"
                aria-label="Search all flashcards"
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
                {browsePool.length.toLocaleString()} cards across every deck ·{' '}
                {browseCards.length.toLocaleString()} match
              </p>
            </div>
            <Badge tone="info">All decks</Badge>
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
              {visibleBrowseCards.map((card) => {
                const stage = app.flashcardProgress[card.id]?.stage ?? 'new';
                return (
                  <button
                    key={card.id}
                    type="button"
                    className="flashcard-tile"
                    onClick={() => openBrowseCard(card)}
                  >
                    <strong>{card.front}</strong>
                    <span>{DECKS[card.deck].label} · {card.tags?.slice(0, 1).join('') || 'card'}</span>
                    <div className="flashcard-tile-stage">
                      <span>{stage}</span>
                      <span>Open card</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {browseCards.length > visibleBrowseCards.length ? (
            <div className="flashcard-browse-more">
              <span className="muted">
                Showing {visibleBrowseCards.length.toLocaleString()} of{' '}
                {browseCards.length.toLocaleString()}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBrowseLimit((limit) => limit + BROWSE_PAGE)}
              >
                Show {Math.min(BROWSE_PAGE, browseCards.length - visibleBrowseCards.length)} more
              </Button>
            </div>
          ) : null}
        </Card>
      ) : !currentCard ? (
        <Card>
          <EmptyState
            title="Nothing due right now"
            body={
              queueMode === 'due'
                ? `You are caught up on ${DECKS[activeDeck].label}. Browse all cards or choose another deck above.`
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
                Card {Math.min(currentPosition + 1, filteredCards.length).toLocaleString()} of{' '}
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
                onClick={() => {
                  setPinnedCardId(null);
                  setCurrentIndex(
                    (currentPosition - 1 + filteredCards.length) % filteredCards.length
                  );
                }}
              >
                Previous
              </Button>
              <Button onClick={() => setRevealed(true)}>Reveal Answer</Button>
              <Button
                variant="outline"
                disabled={filteredCards.length <= 1}
                onClick={() => {
                  setPinnedCardId(null);
                  setCurrentIndex((currentPosition + 1) % filteredCards.length);
                }}
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
      <p className="muted flashcard-source-note">
        Vocabulary sources: NAWL and NGSL (CC BY-SA 4.0), Open English WordNet 2025
        (CC BY 4.0), Tatoeba examples (CC0 1.0), and released College Board
        Words-in-Context items. See{' '}
        <Link to="/credits">Credits &amp; licenses</Link> for attribution.
      </p>
    </div>
  );
}
