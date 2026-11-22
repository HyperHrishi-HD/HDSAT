import {
  useEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';

export interface WelcomeSlide {
  src: string;
  label: string;
  blurb: string;
}

/**
 * Real screens from across the app, kept in the order a new student would
 * discover them. Every image is a 1440x900 capture with the same light theme,
 * so the carousel reads as one product tour rather than a pile of screenshots.
 */
export const WELCOME_SLIDES: WelcomeSlide[] = [
  {
    src: '/welcome/screens/01-dashboard.webp',
    label: 'Dashboard',
    blurb: 'See streaks, domain mastery and recent work in one place.',
  },
  {
    src: '/welcome/screens/02-practice.webp',
    label: 'Practice & Skill Drills',
    blurb: 'Work a focused set with instant explanations and pacing after every answer.',
  },
  {
    src: '/welcome/screens/03-full-test.webp',
    label: 'Full-length simulation',
    blurb: 'Run both sections with real timing, scoring and a proper module break.',
  },
  {
    src: '/welcome/screens/04-question-bank.webp',
    label: 'Question Bank',
    blurb: 'Search 10,000+ questions by skill, source, difficulty and mastery.',
  },
  {
    src: '/welcome/screens/05-flashcards.webp',
    label: 'Flashcards',
    blurb: 'Keep high-utility vocabulary and math formulas in rotation.',
  },
  {
    src: '/welcome/screens/06-arcade.webp',
    label: 'Arcade',
    blurb: 'Take a deliberate break with short games that keep the edge sharp.',
  },
  {
    src: '/welcome/screens/07-resources.webp',
    label: 'Study Resources',
    blurb: 'Find curated guides, official references and practice tools.',
  },
  {
    src: '/welcome/screens/08-rewards.webp',
    label: 'Rewards',
    blurb: 'Earn HDCoins, unlock themes and collect achievement emblems.',
  },
  {
    src: '/welcome/screens/09-account.webp',
    label: 'Account',
    blurb: 'Local-first by default, with cloud sync when you want it.',
  },
  {
    src: '/welcome/screens/10-credits.webp',
    label: 'Credits & Attribution',
    blurb: 'See the sources, licences and people behind HDSAT.',
  },
];

const AUTOPLAY_MS = 3400;
const COUNT = WELCOME_SLIDES.length;

type Position = 'active' | 'prev' | 'next' | 'far-prev' | 'far-next' | 'hidden';

function positionFor(index: number, active: number): Position {
  let offset = index - active;
  if (offset > COUNT / 2) offset -= COUNT;
  if (offset < -COUNT / 2) offset += COUNT;
  if (offset === 0) return 'active';
  if (offset === -1) return 'prev';
  if (offset === 1) return 'next';
  if (offset === -2) return 'far-prev';
  if (offset === 2) return 'far-next';
  return 'hidden';
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, [query]);

  return matches;
}

/**
 * A CSS 3D carousel. The active screen sits in front; the adjacent screens are
 * tilted, recessed and blurred. The whole stage follows a fine pointer, while a
 * coarse pointer gets one stable random tilt instead of pretending to hover.
 *
 * Autoplay resets after every slide and pauses on hover, keyboard focus, when
 * the tab is hidden, or when the visitor uses the pause control. Reduced-motion
 * visitors get the same carousel with no autoplay, tilt or transitions.
 */
export function WelcomeCarousel() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [keyboardFocused, setKeyboardFocused] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  const sceneRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLElement>(null);

  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const coarsePointer = useMediaQuery('(pointer: coarse)');
  const activeSlide = WELCOME_SLIDES[active];

  const go = (step: number) => {
    setActive((current) => (current + step + COUNT) % COUNT);
  };

  const setTilt = (x: number, y: number) => {
    sceneRef.current?.style.setProperty('--tilt-x', `${x.toFixed(2)}deg`);
    sceneRef.current?.style.setProperty('--tilt-y', `${y.toFixed(2)}deg`);
  };

  const resetTilt = () => setTilt(0, 0);

  useEffect(() => {
    if (reducedMotion || !coarsePointer) {
      resetTilt();
      return;
    }
    // No cursor on a phone, so give the scene a gentle, stable angle. It is
    // deliberately not rerolled on every rotation; a moving floor would make
    // the whole page feel unsteady while reading.
    setTilt((Math.random() * 5 - 2.5), (Math.random() * 9 - 4.5));
  }, [coarsePointer, reducedMotion]);

  useEffect(() => {
    const updateVisibility = () => setTabHidden(document.hidden);
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);

  useEffect(() => {
    if (reducedMotion || paused || hovered || keyboardFocused || tabHidden) return;
    const timer = window.setTimeout(() => {
      setActive((current) => (current + 1) % COUNT);
    }, AUTOPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [active, hovered, keyboardFocused, paused, reducedMotion, tabHidden]);

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (coarsePointer || reducedMotion) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const across = Math.min(1, Math.max(0, x / rect.width)) - 0.5;
    const down = Math.min(1, Math.max(0, y / rect.height)) - 0.5;
    setTilt(-down * 6, across * 10);
  };

  const handlePointerEnter = () => {
    if (!coarsePointer) setHovered(true);
  };

  const handlePointerLeave = () => {
    if (coarsePointer) return;
    setHovered(false);
    resetTilt();
  };

  const handleFocus = (event: ReactFocusEvent<HTMLElement>) => {
    // A mouse click also focuses a button. Only keyboard focus should stop the
    // timer; pointer users already pause it by hovering.
    if ((event.target as HTMLElement).matches(':focus-visible')) setKeyboardFocused(true);
  };

  const handleBlur = (event: ReactFocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setKeyboardFocused(false);
    }
  };

  const selectSlide = (index: number) => {
    setActive(index);
    // A pointer click should not leave focus on a card and pause the tour after
    // the cursor leaves. Keyboard users never reach these cards; the dots and
    // arrow buttons are their controls.
    if (rootRef.current?.contains(document.activeElement)) {
      (document.activeElement as HTMLElement | null)?.blur();
    }
  };

  return (
    <figure
      ref={rootRef}
      className="welcome-carousel"
      role="group"
      aria-roledescription="carousel"
      aria-label="A visual tour of HDSAT"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onFocusCapture={handleFocus}
      onBlurCapture={handleBlur}
    >
      <div className="welcome-carousel-head">
        <p className="welcome-carousel-kicker">Inside HDSAT</p>
        <span className="welcome-carousel-count" aria-hidden="true">
          {String(active + 1).padStart(2, '0')} / {String(COUNT).padStart(2, '0')}
        </span>
      </div>

      <div
        className="welcome-carousel-viewport"
        onPointerMove={handlePointerMove}
      >
        <div className="welcome-carousel-stage">
          <div className="welcome-carousel-scene" ref={sceneRef}>
            {WELCOME_SLIDES.map((slide, index) => {
              const position = positionFor(index, active);
              const isActive = position === 'active';
              return (
                <button
                  key={slide.src}
                  type="button"
                  className="welcome-carousel-card"
                  data-position={position}
                  tabIndex={-1}
                  aria-hidden={!isActive}
                  aria-label={`${slide.label}: ${slide.blurb}`}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => selectSlide(index)}
                >
                  <img
                    src={slide.src}
                    alt=""
                    width={1440}
                    height={900}
                    loading="eager"
                    decoding="async"
                    draggable={false}
                  />
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          className="welcome-carousel-arrow is-prev"
          aria-label="Previous screenshot"
          onClick={() => go(-1)}
        >
          <ChevronLeft size={18} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="welcome-carousel-arrow is-next"
          aria-label="Next screenshot"
          onClick={() => go(1)}
        >
          <ChevronRight size={18} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>

      <figcaption className="welcome-carousel-caption">
        <div className="welcome-carousel-copy" key={active}>
          <strong>{activeSlide.label}</strong>
          <span>{activeSlide.blurb}</span>
        </div>
      </figcaption>

      <div className="welcome-carousel-controls">
        <div className="welcome-carousel-dots" role="group" aria-label="Choose a screenshot">
          {WELCOME_SLIDES.map((slide, index) => (
            <button
              key={slide.src}
              type="button"
              className="welcome-carousel-dot"
              aria-label={`Show ${slide.label}`}
              aria-current={index === active ? 'true' : undefined}
              onClick={() => setActive(index)}
            />
          ))}
        </div>
        {!reducedMotion && (
          <button
            type="button"
            className="welcome-carousel-pause"
            aria-label={paused ? 'Play the screenshot carousel' : 'Pause the screenshot carousel'}
            aria-pressed={paused}
            title={paused ? 'Play the screenshot carousel' : 'Pause the screenshot carousel'}
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? (
              <Play size={13} fill="currentColor" aria-hidden="true" />
            ) : (
              <Pause size={13} fill="currentColor" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
    </figure>
  );
}
