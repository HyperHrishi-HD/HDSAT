import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { emblemFor } from '../lib/catalog';
import { hasSeenWelcome, markWelcomeSeen } from '../lib/storage';
import { useApp } from '../lib/store';
import { AuthModal } from './AuthModal';
import { VerifyEmailBanner } from './VerifyEmailBanner';
import {
  COPYRIGHT_PATH,
  CREATOR_NAME,
  CREDITS_PATH,
  PRIVACY_PATH,
  TERMS_PATH,
} from '../lib/legal';
import { Alert, Badge, Icon, type IconName } from './ui';

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

/** Same mark as the sidebar brand, sized for the mobile top bar. */
function BrandMark() {
  return (
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
  );
}

/**
 * A name that scrolls back and forth inside its pill once it is too long to
 * fit. The animation distance is measured, so short names stay still and a
 * long display name is still readable on a narrow top bar.
 */
function ScrollName({ text }: { text: string }) {
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const innerRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const inner = innerRef.current;
    if (!wrap || !inner) return;
    const measure = () => {
      const overflow = inner.scrollWidth - wrap.clientWidth;
      if (overflow > 2) {
        wrap.style.setProperty('--scroll-x', `-${Math.ceil(overflow)}px`);
        wrap.classList.add('is-scrolling');
      } else {
        wrap.classList.remove('is-scrolling');
        wrap.style.removeProperty('--scroll-x');
      }
    };
    measure();
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(wrap);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [text]);

  return (
    <span className="scroll-name" ref={wrapRef} title={text}>
      <span ref={innerRef}>{text}</span>
    </span>
  );
}

export function Layout() {
  const app = useApp();
  const [showWelcome, setShowWelcome] = useState(() => !hasSeenWelcome());
  const topbarRef = useRef<HTMLDivElement | null>(null);
  const statsRef = useRef<HTMLDivElement | null>(null);
  const brandRef = useRef<HTMLAnchorElement | null>(null);
  const accountRef = useRef<HTMLElement | null>(null);
  const mobileNavRef = useRef<HTMLElement | null>(null);
  const [compact, setCompact] = useState(false);
  const [navLabels, setNavLabels] = useState(true);

  const activeTheme = app.settings?.activeTheme ?? null;
  const activeEmblem = emblemFor(app.settings?.activeFlair);
  const displayName = app.user?.displayName || app.user?.email || 'Student';
  const pending = app.accountStatus === 'pending';

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

  /**
   * Decide whether the status pills need their labels. A hidden clone of the
   * stats row (full labels, never compacted) is measured against the space the
   * top bar actually has, so the switch happens exactly when the row would wrap
   * — not at an arbitrary breakpoint. Because the clone never inherits the
   * compact class, this cannot oscillate.
   */
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const measure = () => {
      const bar = topbarRef.current;
      const stats = statsRef.current;
      if (!bar || !stats) return;
      const clone = stats.cloneNode(true) as HTMLDivElement;
      Object.assign(clone.style, {
        position: 'fixed',
        top: '-2000px',
        left: '0',
        display: 'flex',
        flexWrap: 'nowrap',
        width: 'max-content',
        maxWidth: 'none',
        visibility: 'hidden',
        pointerEvents: 'none',
        zIndex: '-1',
      });
      document.body.appendChild(clone);
      const needed = clone.getBoundingClientRect().width;
      clone.remove();

      const brandWidth = brandRef.current?.offsetWidth ?? 0;
      const accountWidth = accountRef.current?.offsetWidth ?? 0;
      const padding = 56;
      const available = bar.clientWidth - brandWidth - accountWidth - padding;
      if (available > 0) setCompact(needed > available);
    };

    measure();
    window.addEventListener('resize', measure);
    const observer =
      typeof ResizeObserver !== 'undefined' && topbarRef.current
        ? new ResizeObserver(measure)
        : null;
    if (observer && topbarRef.current) observer.observe(topbarRef.current);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [
    app.hdCoins,
    app.currentStreak,
    app.totals.attempts,
    app.mode,
    app.accountStatus,
    displayName,
    activeEmblem?.id,
  ]);

  // Bottom tabs keep their labels only while the row has room for the longest
  // one; otherwise the icons stand alone instead of squeezing.
  useEffect(() => {
    const nav = mobileNavRef.current;
    if (!nav) return;
    const check = () => {
      const count = nav.querySelectorAll('.mobile-link').length || 5;
      setNavLabels(nav.clientWidth > 0 && nav.clientWidth / count >= 80);
    };
    check();
    window.addEventListener('resize', check);
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null;
    if (observer) observer.observe(nav);
    return () => {
      window.removeEventListener('resize', check);
      observer?.disconnect();
    };
  }, []);

  const dismissWelcome = () => {
    markWelcomeSeen();
    setShowWelcome(false);
  };

  return (
    <div className="app-shell" data-theme={activeTheme ?? undefined}>
      <aside className="sidebar">
        <NavLink to="/" className="brand">
          <BrandMark />
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
        <header className={`topbar${compact ? ' is-compact' : ''}`}>
          <div className="topbar-inner" ref={topbarRef}>
            <Link to="/" className="topbar-brand" aria-label="HDSAT home" ref={brandRef}>
              <BrandMark />
            </Link>

            <div className="topbar-stats" ref={statsRef}>
              <span
                className="pill"
                title={
                  app.accountStatus === 'cloud'
                    ? 'HDCoins balance saved to your account'
                    : 'Guest HDCoins live in this browser only. After you confirm an account, your cloud balance replaces them.'
                }
              >
                <Icon name="coins" size={14} />
                <strong>{app.hdCoins}</strong>
                <span className="pill-label">HDCoins</span>
                {app.accountStatus !== 'cloud' ? (
                  <em className="pill-tag" title="Saved in this browser only">
                    <Icon name="device" size={11} />
                    <span className="pill-tag-text">local</span>
                  </em>
                ) : null}
              </span>
              <span className="pill" data-pill="streak" title="Consecutive practice days">
                <Icon name="flame" size={14} />
                <strong>{app.currentStreak}</strong>
                <span className="pill-label">day streak</span>
              </span>
              <span className="pill" data-pill="answered" title="Practice answers recorded">
                <Icon name="check" size={14} />
                <strong>{app.totals.attempts}</strong>
                <span className="pill-label">answered</span>
              </span>
              {activeEmblem ? (
                <span
                  className="flair-chip"
                  title={`${activeEmblem.name.replace(/ Emblem$/, '')} emblem equipped`}
                  aria-label={`${activeEmblem.name.replace(/ Emblem$/, '')} emblem equipped`}
                >
                  <Icon name={activeEmblem.icon ?? 'compass'} size={14} />
                </span>
              ) : null}
              {app.mode === 'cloud' ? (
                <span
                  className="badge badge-good badge-cloud"
                  title={`Signed in to the cloud as ${displayName}`}
                  aria-label={`Signed in to the cloud as ${displayName}`}
                >
                  <Icon name="cloud" size={12} />
                  <ScrollName text={displayName} />
                </span>
              ) : pending && !app.user ? (
                <Badge tone="warn">
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => app.actions.openAuthModal('verify')}
                  >
                    <span className="badge-label-full">Confirm email</span>
                    <span className="badge-label-compact">Confirm</span>
                  </button>
                </Badge>
              ) : (
                <Badge tone="warn">
                  <Icon name="device" size={12} />
                  <span className="badge-label-full">Guest mode</span>
                  <span className="badge-label-compact">Guest</span>
                </Badge>
              )}
            </div>

            {app.user ? (
              <NavLink
                to="/account"
                className="btn btn-outline btn-sm topbar-account"
                ref={(el) => {
                  accountRef.current = el;
                }}
              >
                <Icon name="account" size={14} />
                <span className="btn-label">Account</span>
              </NavLink>
            ) : (
              <button
                type="button"
                className="btn btn-outline btn-sm topbar-account"
                ref={(el) => {
                  accountRef.current = el;
                }}
                onClick={() =>
                  app.actions.openAuthModal(pending ? 'verify' : 'signin')
                }
              >
                <Icon name="account" size={14} />
                <span className="btn-label">Sign in</span>
              </button>
            )}
          </div>
        </header>

        {showWelcome && app.cloudConfigured && !app.user ? (
          <div className="welcome-banner" role="status">
            <span>
              <strong>Welcome to HDSAT.</strong> Saved on this device.
            </span>
            <div className="welcome-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => app.actions.openAuthModal(pending ? 'verify' : 'signin')}
              >
                <Icon name="account" size={13} />
                <span>Sign in to sync</span>
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={dismissWelcome}>
                Keep as guest
              </button>
            </div>
          </div>
        ) : null}

        <VerifyEmailBanner />

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
            <Link to={CREDITS_PATH}>Credits</Link>
            <span className="legal-credit">By {CREATOR_NAME}</span>
          </nav>
        </footer>
      </div>

      <nav className={`mobile-nav${navLabels ? '' : ' is-icon-only'}`} ref={mobileNavRef}>
        {NAV.slice(0, 5).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `mobile-link${isActive ? ' is-active' : ''}`}
          >
            <Icon name={item.icon} size={17} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <AuthModal />
    </div>
  );
}
