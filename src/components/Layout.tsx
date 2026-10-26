import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { emblemFor } from '../lib/catalog';
import { useApp } from '../lib/store';
import { AuthModal } from './AuthModal';
import { BrandMark } from './BrandMark';
import { VerifyEmailBanner } from './VerifyEmailBanner';
import {
  COPYRIGHT_PATH,
  CREATOR_NAME,
  CREDITS_PATH,
  PRIVACY_PATH,
  TERMS_PATH,
} from '../lib/legal';
import { Alert, Badge, Icon } from './ui';
import { MOBILE_NAV, SECTIONS as NAV } from '../lib/sections';

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
  const topbarRef = useRef<HTMLDivElement | null>(null);
  const statsRef = useRef<HTMLDivElement | null>(null);
  const brandRef = useRef<HTMLAnchorElement | null>(null);
  const accountRef = useRef<HTMLElement | null>(null);
  const mobileNavRef = useRef<HTMLElement | null>(null);
  const [compact, setCompact] = useState(false);
  const [navSize, setNavSize] = useState<'full' | 'compact' | 'icons'>('full');

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

  /**
   * Five bottom tabs are ~76px wide on a 390px phone, which fits "Question
   * bank" on two lines. The step-down stays anyway: a very narrow phone, or a
   * system font scaled up, must not push the row past the edge.
   */
  useEffect(() => {
    const nav = mobileNavRef.current;
    if (!nav) return;
    const check = () => {
      const count = nav.querySelectorAll('.mobile-link').length || MOBILE_NAV.length;
      const per = nav.clientWidth > 0 ? nav.clientWidth / count : 0;
      // Five tabs give ~75px each on a 390px phone, which is enough for
      // "Question bank" on two lines; the step-downs only catch a 320px phone
      // or a system font scaled up past the default.
      setNavSize(per >= 68 ? 'full' : per >= 40 ? 'compact' : 'icons');
    };
    check();
    // The bar is display:none on a wide layout, so the first measurement can be
    // 0 and every tab would come out icon-only. One frame later the box exists.
    const frame = requestAnimationFrame(check);
    window.addEventListener('resize', check);
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null;
    if (observer) observer.observe(nav);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', check);
      observer?.disconnect();
    };
  }, []);

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

      <nav
        className={`mobile-nav${
          navSize === 'icons' ? ' is-icon-only' : navSize === 'compact' ? ' is-compact' : ''
        }`}
        ref={mobileNavRef}
        aria-label="Sections"
      >
        {MOBILE_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            aria-label={item.label}
            className={({ isActive }) => `mobile-link${isActive ? ' is-active' : ''}`}
          >
            <Icon name={item.icon} size={navSize === 'icons' ? 19 : navSize === 'compact' ? 16 : 17} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <AuthModal />
    </div>
  );
}
