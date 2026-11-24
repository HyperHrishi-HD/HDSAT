import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { emblemFor } from '../lib/catalog';
import { beginThemeTransition } from '../lib/themeMode';
import { useApp } from '../lib/store';
import { AuthModal } from './AuthModal';
import { BrandMark } from './BrandMark';
import { GuestMergePrompt } from './GuestMergePrompt';
import { Skeleton } from 'skullet/react';
import { PageSkeleton, skeletonVariantForPath } from './Skeleton';
import { VerifyEmailBanner } from './VerifyEmailBanner';
import {
  COPYRIGHT_PATH,
  CREATOR_NAME,
  CREDITS_PATH,
  PRIVACY_PATH,
  TERMS_PATH,
} from '../lib/legal';
import { Alert, Badge, Icon } from './ui';
import { SECTIONS as NAV } from '../lib/sections';

const SIDEBAR_HIDDEN_KEY = 'hdsat.sidebar.hidden.v1';

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
    let frame = 0;
    const update = () => {
      const overflow = inner.scrollWidth - wrap.clientWidth;
      if (overflow > 2) {
        wrap.style.setProperty('--scroll-x', `-${Math.ceil(overflow)}px`);
        wrap.classList.add('is-scrolling');
      } else {
        wrap.classList.remove('is-scrolling');
        wrap.style.removeProperty('--scroll-x');
      }
    };
    const measure = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };
    update();
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(wrap);
    window.addEventListener('resize', measure);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
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
  const location = useLocation();
  const topbarRef = useRef<HTMLDivElement | null>(null);
  const statsRef = useRef<HTMLDivElement | null>(null);
  const brandRef = useRef<HTMLAnchorElement | null>(null);
  const accountRef = useRef<HTMLElement | null>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement | null>(null);
  const menuToggleRef = useRef<HTMLButtonElement | null>(null);
  const [compact, setCompact] = useState(false);
  // The phone layout opens the whole section list in a drawer instead of
  // squeezing a few tabs into a bottom bar.
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    try {
      return localStorage.getItem(SIDEBAR_HIDDEN_KEY) === '1';
    } catch {
      return false;
    }
  });

  // This is a desk-layout preference, not study progress. Keep it on this
  // device so opening a new tab does not make the menu jump back into place.
  useEffect(() => {
    try {
      if (sidebarHidden) localStorage.setItem(SIDEBAR_HIDDEN_KEY, '1');
      else localStorage.removeItem(SIDEBAR_HIDDEN_KEY);
    } catch {
      /* storage disabled: the choice still works for this session */
    }
  }, [sidebarHidden]);

  const activeTheme = app.settings?.activeTheme ?? null;
  const appliedThemeRef = useRef<string | null | undefined>(undefined);
  const activeEmblem = emblemFor(app.settings?.activeFlair);
  const displayName = app.user?.displayName || app.user?.email || 'Student';
  const pending = app.accountStatus === 'pending';
  const toggleSidebar = () => {
    setSidebarHidden((hidden) => !hidden);
  };

  // Routes that do not read the catalogue can paint immediately. The study
  // screens wait behind the lazy bank chunk and get a silhouette of themselves
  // instead of a centred logo or a page full of zeroes.
  const needsBank = ![
    '/account',
    '/resources',
    '/rewards',
    '/terms',
    '/privacy',
    '/copyright',
    '/credits',
  ].includes(location.pathname);
  const showBankSkeleton = needsBank && app.bankReady === false && !app.bankError;

  // Theme tokens live on <html>, so a store theme change and a light/dark
  // change repaint through the same coordinated fade. useLayoutEffect keeps the
  // attribute change before the browser paints the next frame.
  useLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    if (appliedThemeRef.current !== undefined && appliedThemeRef.current !== activeTheme) {
      beginThemeTransition();
    }
    appliedThemeRef.current = activeTheme;
    if (activeTheme) {
      document.documentElement.setAttribute('data-theme', activeTheme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, [activeTheme]);

  // The question bank is still a lazy chunk. The old shell had no bank gate, so
  // start the load once here for every app route; the pre-Phase-1 pages assume
  // the catalog is available.
  useEffect(() => {
    app.actions.ensureBank();
  }, [app.actions.ensureBank]);

  /**
   * Decide whether the status pills need their labels. A hidden clone of the
   * header (full labels, never compacted) is measured against the space the
   * full header would have. Measuring the live controls instead feeds the
   * compact class back into the decision: hiding the labels frees space, full
   * mode then looks like it fits, restoring the labels makes it overflow, and
   * the two states flip every frame. The off-screen clone breaks that loop.
   */
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const runMeasure = () => {
      const inner = topbarRef.current;
      if (!inner) return;

      const clone = inner.cloneNode(true) as HTMLDivElement;
      clone.setAttribute('aria-hidden', 'true');
      Object.assign(clone.style, {
        position: 'fixed',
        top: '-2000px',
        left: '0',
        width: `${inner.clientWidth}px`,
        maxWidth: 'none',
        visibility: 'hidden',
        pointerEvents: 'none',
        zIndex: '-1',
      });
      document.body.appendChild(clone);

      const fullStats = clone.querySelector<HTMLElement>('.topbar-stats');
      if (fullStats) {
        Object.assign(fullStats.style, {
          display: 'flex',
          flex: '0 0 auto',
          flexWrap: 'nowrap',
          width: 'max-content',
          maxWidth: 'none',
          overflow: 'visible',
        });
      }
      const needed = Math.max(
        fullStats?.getBoundingClientRect().width ?? 0,
        fullStats?.scrollWidth ?? 0
      );
      const widthOf = (selector: string) =>
        clone.querySelector<HTMLElement>(selector)?.getBoundingClientRect().width ?? 0;
      const brandWidth = widthOf('.topbar-brand');
      const accountWidth = widthOf('.topbar-account');
      const toggleWidth = widthOf('.sidebar-toggle');
      const style = getComputedStyle(clone);
      const padding =
        parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const gap = parseFloat(style.columnGap) || 0;
      const visibleItems = [...clone.children].filter((child) => {
        const el = child as HTMLElement;
        return (
          getComputedStyle(el).display !== 'none' &&
          el.getBoundingClientRect().width > 0
        );
      }).length;
      const gaps = gap * Math.max(0, visibleItems - 1);
      const available =
        clone.clientWidth - padding - gaps - brandWidth - accountWidth - toggleWidth;
      clone.remove();

      if (available > 0) setCompact(needed > available);
    };

    let frame = 0;
    const measure = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        runMeasure();
      });
    };

    measure();
    window.addEventListener('resize', measure);
    const observer =
      typeof ResizeObserver !== 'undefined' && topbarRef.current
        ? new ResizeObserver(measure)
        : null;
    if (observer && topbarRef.current) observer.observe(topbarRef.current);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
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
   * The drawer belongs to the page that opened it: any route change closes it.
   * While it is open the page behind must not scroll, and Escape closes it —
   * the same two rules the sign-in window follows.
   */
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  // Growing the window back to the desk layout must not leave an invisible
  // drawer holding the page scroll lock.
  useEffect(() => {
    if (!menuOpen || typeof window.matchMedia !== 'function') return;
    const wide = window.matchMedia('(min-width: 901px)');
    const onChange = () => {
      if (wide.matches) setMenuOpen(false);
    };
    wide.addEventListener('change', onChange);
    return () => wide.removeEventListener('change', onChange);
  }, [menuOpen]);

  return (
    <div className={`app-shell${sidebarHidden ? ' is-sidebar-hidden' : ''}`}>
      <aside className="sidebar" id="app-sidebar">
        <NavLink to="/" className="brand">
          <BrandMark />
          <span>
            <strong>HDSAT</strong>
            <em>Digital SAT prep</em>
          </span>
        </NavLink>
        <nav className="nav" aria-label="Sections">
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
            <button
              type="button"
              className="btn btn-outline btn-sm mobile-menu-toggle"
              aria-controls="app-drawer"
              aria-expanded={menuOpen}
              aria-label="Open navigation menu"
              title="Open navigation menu"
              ref={menuToggleRef}
              onClick={() => setMenuOpen(true)}
            >
              <Icon name="menu" size={16} />
            </button>

            <button
              type="button"
              className="btn btn-outline btn-sm sidebar-toggle"
              aria-controls="app-sidebar"
              aria-expanded={!sidebarHidden}
              aria-label={sidebarHidden ? 'Show navigation menu' : 'Hide navigation menu'}
              title={sidebarHidden ? 'Show navigation menu' : 'Hide navigation menu'}
              ref={sidebarToggleRef}
              onClick={toggleSidebar}
            >
              <Icon name="menu" size={15} />
            </button>

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
          {/* Skullet owns the loading transition and its hold/reveal timing. The
              route silhouette is the measured, responsive shape already used
              by the shell; the real outlet is not mounted until the bank is
              ready, so no page runs against an empty catalogue. */}
          <Skeleton
            loading={showBankSkeleton}
            skeleton={
              <PageSkeleton variant={skeletonVariantForPath(location.pathname)} />
            }
            label="Loading page"
          >
            <Outlet />
          </Skeleton>
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

      {/* Phone navigation: the same nine sections as the desk sidebar, in a
          glass panel that slides over the page. It stays mounted so the exit
          animation can finish; `visibility` keeps its links out of the tab
          order while it is closed. */}
      <div className={`drawer-layer${menuOpen ? ' is-open' : ''}`}>
        <button
          type="button"
          className="drawer-scrim"
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => setMenuOpen(false)}
        />
        <aside
          className="drawer"
          id="app-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Sections"
          aria-hidden={!menuOpen}
        >
          <div className="drawer-head">
            <NavLink to="/" className="brand drawer-brand" onClick={() => setMenuOpen(false)}>
              <BrandMark />
              <span>
                <strong>HDSAT</strong>
                <em>Digital SAT prep</em>
              </span>
            </NavLink>
            <button
              type="button"
              className="drawer-close"
              aria-label="Close navigation menu"
              onClick={() => setMenuOpen(false)}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          <nav className="drawer-nav" aria-label="Sections">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}
                onClick={() => setMenuOpen(false)}
              >
                <Icon name={item.icon} size={17} />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </aside>
      </div>
      <AuthModal />
      <GuestMergePrompt />
    </div>
  );
}
