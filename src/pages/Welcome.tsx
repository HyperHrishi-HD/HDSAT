import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthModal } from '../components/AuthModal';
import {
  COPYRIGHT_PATH,
  CREATOR_NAME,
  CREDITS_PATH,
  PRIVACY_PATH,
  SITE_NAME,
  TERMS_PATH,
} from '../lib/legal';
import { markEntered, markWelcomeSeen } from '../lib/storage';
import { useApp } from '../lib/store';

/**
 * The starting homepage. A separate screen, not a banner: it exists only before
 * this browser has any HDSAT profile and no account is signed in, and one click
 * enters the app for good.
 *
 * It is deliberately static — no question bank, no network — so it costs
 * nothing on hosting and appears instantly.
 */
export function WelcomePage() {
  const app = useApp();
  const navigate = useNavigate();

  // Signing in from here is the other way in; once a session exists the
  // homepage has done its job.
  useEffect(() => {
    if (app.user) navigate('/', { replace: true });
  }, [app.user, navigate]);

  const enter = () => {
    markEntered();
    // The homepage replaces the old in-app onboarding banner; showing both in
    // a row would be the same welcome twice.
    markWelcomeSeen();
    navigate('/', { replace: true });
  };

  return (
    <div className="welcome-page">
      <header className="welcome-top">
        <span className="welcome-brand">
          <span className="brand-mark" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 64 64" fill="none">
              <path
                d="M16 14V50M48 14V50M16 32H48"
                stroke="currentColor"
                strokeWidth="7.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="48" cy="14" r="4.5" fill="#93c5fd" />
            </svg>
          </span>
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
        <p className="welcome-eyebrow">Digital SAT &amp; PSAT practice</p>
        <h1>
          Practise the way
          <br />
          the test is built.
        </h1>
        <p className="welcome-sub">
          Adaptive full tests, drills that schedule themselves, and flashcards. Works offline in
          this browser.
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
