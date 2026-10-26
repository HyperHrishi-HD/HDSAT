import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthModal } from '../components/AuthModal';
import { BrandMark } from '../components/BrandMark';
import {
  COPYRIGHT_PATH,
  CREATOR_NAME,
  CREDITS_PATH,
  PRIVACY_PATH,
  SITE_NAME,
  TERMS_PATH,
} from '../lib/legal';
import { takeNextMotto } from '../lib/motto';
import { markEntered, markWelcomeSeen } from '../lib/storage';
import { useApp } from '../lib/store';

/**
 * The starting homepage. A separate screen, not a banner: it is what a blank
 * browser lands on, and one click enters the app for good.
 *
 * It is deliberately static — no question bank, no network — so it costs
 * nothing on hosting and appears instantly. The only moving parts are CSS:
 * two drifting light pools behind the hero, which stop for anyone who asks
 * their system for reduced motion.
 */
export function WelcomePage() {
  const app = useApp();
  const navigate = useNavigate();

  // A student who signs in *here* is entering the app; someone who typed
  // /welcome with a session already running is only visiting, so the page
  // stays put until they press a button.
  const signedInOnMount = useRef(Boolean(app.user));
  useEffect(() => {
    if (!signedInOnMount.current && app.user) navigate('/', { replace: true });
  }, [app.user, navigate]);

  // One line per visit, advanced on every open. Computed once per mount so a
  // re-render cannot flick it to a different motto mid-read.
  const [motto] = useState(() => takeNextMotto());

  const enter = () => {
    markEntered();
    // The homepage replaces the old in-app onboarding banner; showing both in
    // a row would be the same welcome twice.
    markWelcomeSeen();
    navigate('/', { replace: true });
  };

  return (
    <div className="welcome-page">
      <div className="welcome-aurora" aria-hidden="true">
        <span className="welcome-pool welcome-pool-a" />
        <span className="welcome-pool welcome-pool-b" />
        <span className="welcome-pool welcome-pool-c" />
      </div>

      <header className="welcome-top">
        <span className="welcome-brand">
          <BrandMark size={34} title="HDSAT" />
          <strong>HDSAT</strong>
        </span>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => app.actions.openAuthModal('signin')}
        >
          Sign in
        </button>
      </header>

      <main className="welcome-hero">
        <span className="welcome-emblem" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 64 64" fill="none">
            <path
              d="M16 14V50M48 14V50M16 32H48"
              stroke="currentColor"
              strokeWidth="7.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="48" cy="14" r="4.5" fill="#bfdbfe" />
          </svg>
        </span>

        <p className="welcome-eyebrow">Digital SAT &amp; PSAT practice</p>
        <h1>
          Practice the way
          <br />
          the test is built.
        </h1>
        <p className="welcome-sub">
          Adaptive full length tests, in depth practice and drills, flashcards and arcades.
        </p>

        <div className="welcome-actions">
          <button type="button" className="btn btn-primary welcome-cta" onClick={enter}>
            Start now
          </button>
          <button
            type="button"
            className="btn btn-outline welcome-cta"
            onClick={() => app.actions.openAuthModal('signin')}
          >
            I have an account
          </button>
        </div>

        <p className="welcome-motto" key={motto}>
          <span aria-hidden="true">“</span>
          {motto}
          <span aria-hidden="true">”</span>
        </p>

        <ul className="welcome-facts">
          <li>
            <strong>Full simulation</strong>
            <span>98 questions, both sections, adaptive routing.</span>
          </li>
          <li>
            <strong>Targeted practice</strong>
            <span>Unseen items first, then reviews when they are due.</span>
          </li>
          <li>
            <strong>Every answer reviewed</strong>
            <span>Explanation and pacing after each item.</span>
          </li>
        </ul>
      </main>

      <footer className="welcome-foot">
        <Link to={TERMS_PATH}>Terms</Link>
        <Link to={PRIVACY_PATH}>Privacy</Link>
        <Link to={COPYRIGHT_PATH}>Copyright</Link>
        <Link to={CREDITS_PATH}>Credits</Link>
        <span>By {CREATOR_NAME}</span>
        <span className="welcome-note">
          {SITE_NAME} is an independent study tool, not affiliated with the College Board.
        </span>
      </footer>

      <AuthModal />
    </div>
  );
}
