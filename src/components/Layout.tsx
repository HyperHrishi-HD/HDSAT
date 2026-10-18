import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { hasSeenWelcome, markWelcomeSeen } from '../lib/storage';
import { useApp } from '../lib/store';
import { COPYRIGHT_PATH, PRIVACY_PATH, SUPPORT_EMAIL, TERMS_PATH } from '../lib/legal';
import { Alert, Badge } from './ui';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/practice', label: 'Practice' },
  { to: '/test', label: 'Full test' },
  { to: '/bank', label: 'Question bank' },
  { to: '/flashcards', label: 'Flashcards' },
  { to: '/arcade', label: 'Arcade' },
  { to: '/resources', label: 'Resources' },
  { to: '/rewards', label: 'Rewards' },
  { to: '/account', label: 'Account' },
];

export function Layout() {
  const app = useApp();
  const [showWelcome, setShowWelcome] = useState(() => !hasSeenWelcome());

  const dismissWelcome = () => {
    markWelcomeSeen();
    setShowWelcome(false);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink to="/" className="brand">
          <span className="brand-mark">H</span>
          <span>
            <strong>HDSAT</strong>
            <em>Digital SAT practice</em>
          </span>
        </NavLink>
        <nav className="nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <p className="muted">
            Bank {app.bankVersion} · {app.questions.length} items
          </p>
          <nav className="legal-links" aria-label="Policies">
            <Link to={TERMS_PATH}>Terms</Link>
            <Link to={PRIVACY_PATH}>Privacy</Link>
            <Link to={COPYRIGHT_PATH}>Copyright</Link>
          </nav>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-stats">
            <span
              className="pill"
              title={
                app.accountStatus === 'cloud'
                  ? 'HDCoins balance saved to your account'
                  : 'Guest HDCoins live in this browser only. After you confirm an account, your cloud balance replaces them.'
              }
            >
              <strong>{app.hdCoins}</strong> HDCoins
              {app.accountStatus !== 'cloud' ? <em className="pill-tag">local</em> : null}
            </span>
            <span className="pill" title="Consecutive practice days">
              <strong>{app.currentStreak}</strong> day streak
            </span>
            <span className="pill" title="Practice answers recorded">
              <strong>{app.totals.attempts}</strong> answered
            </span>
            <Badge tone={app.mode === 'cloud' ? 'good' : 'warn'}>
              {app.mode === 'cloud' ? (
                `Cloud · ${app.user?.email ?? ''}`
              ) : app.accountStatus === 'pending' ? (
                <Link to="/account">Confirm email</Link>
              ) : (
                'Guest mode'
              )}
            </Badge>
          </div>
          <NavLink to="/account" className="btn btn-outline btn-sm">
            {app.user ? 'Account' : 'Sign in'}
          </NavLink>
        </header>

        {showWelcome && app.cloudConfigured ? (
          <div className="welcome-banner" role="status">
            <div>
              <strong>Welcome to HDSAT.</strong> You can start studying right away — no account
              needed. Practice, flashcards and full tests are saved in <em>this browser</em>.
            </div>
            <ul>
              <li>
                <strong>HDCoins shown now are local and provisional.</strong> If you create an
                account and confirm your email, your cloud balance (and every future coin) takes
                over, so treat guest coins as practice only.
              </li>
              <li>
                Creating an account keeps working before confirmation: your answers, saved
                questions and past tests stay on this device.{' '}
              </li>
              <li>
                On the first sign-in we upload this device&apos;s history to your account once, so
                nothing you practised is lost.
              </li>
            </ul>
            <div className="welcome-actions">
              <Link to="/account" className="btn btn-sm">
                Create account or sign in
              </Link>
              <button type="button" className="btn btn-outline btn-sm" onClick={dismissWelcome}>
                Keep studying as a guest
              </button>
            </div>
          </div>
        ) : null}

        {app.error ? (
          <Alert tone="error" onDismiss={app.actions.dismissMessages}>
            {app.error}
          </Alert>
        ) : null}
        {app.notice ? (
          <Alert tone="notice" onDismiss={app.actions.dismissMessages}>
            {app.notice}
          </Alert>
        ) : null}
        {!app.cloudConfigured ? (
          <Alert tone="info">
            Supabase is not configured for this deployment, so HDSAT is running in local guest mode. Set
            VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable accounts and cloud sync.
          </Alert>
        ) : null}

        <main className="content">
          <Outlet />
        </main>

        <footer className="legal-foot">
          <nav className="legal-links" aria-label="Policies and support">
            <Link to={TERMS_PATH}>Terms of Service</Link>
            <Link to={PRIVACY_PATH}>Privacy &amp; Data Rights</Link>
            <Link to={COPYRIGHT_PATH}>Copyright &amp; Content Policy</Link>
            <Link to="/account">Appeals &amp; safety reports</Link>
            {SUPPORT_EMAIL ? <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> : null}
          </nav>
          <p className="muted">
            HDSAT is an independent study tool and is not affiliated with or endorsed by the College Board. SAT and PSAT
            are trademarks of the College Board. Practice scores are estimates, not official results.
          </p>
        </footer>
      </div>

      <nav className="mobile-nav">
        {NAV.slice(0, 5).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `mobile-link${isActive ? ' is-active' : ''}`}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
