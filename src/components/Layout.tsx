import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { itemById } from '../lib/catalog';
import { hasSeenWelcome, markWelcomeSeen } from '../lib/storage';
import { useApp } from '../lib/store';
import { COPYRIGHT_PATH, PRIVACY_PATH, SUPPORT_EMAIL, TERMS_PATH } from '../lib/legal';
import { Alert, Badge, Icon, InfoTip, type IconName } from './ui';

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/practice', label: 'Practice', icon: 'practice' },
  { to: '/test', label: 'Full test', icon: 'test' },
  { to: '/bank', label: 'Question bank', icon: 'bank' },
  { to: '/flashcards', label: 'Flashcards', icon: 'flashcards' },
  { to: '/arcade', label: 'Arcade', icon: 'arcade' },
  { to: '/resources', label: 'Resources', icon: 'resources' },
  { to: '/rewards', label: 'Rewards', icon: 'rewards' },
  { to: '/account', label: 'Account', icon: 'account' },
];

export function Layout() {
  const app = useApp();
  const [showWelcome, setShowWelcome] = useState(() => !hasSeenWelcome());

  const activeTheme = app.settings?.activeTheme ?? null;
  const activeFlair = app.settings?.activeFlair ? itemById(app.settings.activeFlair) : undefined;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (activeTheme) {
      document.documentElement.setAttribute('data-theme', activeTheme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, [activeTheme]);

  // The banner is a guest onboarding card: once the student has a session it is
  // wrong to keep saying "no account needed" and offering "continue as guest",
  // so signing in retires it for good.
  useEffect(() => {
    if (app.user && showWelcome) {
      markWelcomeSeen();
      setShowWelcome(false);
    }
  }, [app.user, showWelcome]);

  const dismissWelcome = () => {
    markWelcomeSeen();
    setShowWelcome(false);
  };

  return (
    <div className="app-shell" data-theme={activeTheme ?? undefined}>
      <aside className="sidebar">
        <NavLink to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 64 64" fill="none">
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
          <span>
            <strong>HDSAT</strong>
            <em>Digital SAT prep</em>
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
              <Icon name={item.icon} size={16} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
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
              <Icon name="coins" size={14} />
              <strong>{app.hdCoins}</strong> HDCoins
              {app.accountStatus !== 'cloud' ? <em className="pill-tag">local</em> : null}
            </span>
            <span className="pill" title="Consecutive practice days">
              <Icon name="flame" size={14} />
              <strong>{app.currentStreak}</strong> day streak
            </span>
            <span className="pill" title="Practice answers recorded">
              <Icon name="check" size={14} />
              <strong>{app.totals.attempts}</strong> answered
            </span>
            {activeFlair ? (
              <Badge tone="info">★ {activeFlair.name.replace(/ Emblem$/, '')}</Badge>
            ) : null}
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
            <Icon name="account" size={14} />
            <span>{app.user ? 'Account' : 'Sign in'}</span>
          </NavLink>
        </header>

        {showWelcome && app.cloudConfigured && !app.user ? (
          <div className="welcome-banner" role="status">
            <div className="row-between">
              <div>
                <strong>Welcome to HDSAT.</strong> Start studying right away — no account needed.
                Practice, flashcards and full tests save automatically in <em>this browser</em>.
              </div>
              <InfoTip label="How guest & cloud sync work">
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  <li>
                    <strong>HDCoins shown now are local and provisional.</strong> If you create an
                    account and confirm your email, your cloud balance takes over.
                  </li>
                  <li>
                    On your first sign-in we upload this device&apos;s history to your account once,
                    so nothing you practised is lost.
                  </li>
                </ul>
              </InfoTip>
            </div>
            <div className="welcome-actions">
              <Link to="/account" className="btn btn-primary btn-sm">
                <Icon name="account" size={13} />
                <span>Create account or sign in</span>
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
            <Icon name={item.icon} size={15} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
