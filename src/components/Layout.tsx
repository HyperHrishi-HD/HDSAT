import { NavLink, Outlet } from 'react-router-dom';
import { useApp } from '../lib/store';
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
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-stats">
            <span className="pill" title="HDCoins balance">
              <strong>{app.hdCoins}</strong> HDCoins
            </span>
            <span className="pill" title="Consecutive practice days">
              <strong>{app.currentStreak}</strong> day streak
            </span>
            <span className="pill" title="Practice answers recorded">
              <strong>{app.totals.attempts}</strong> answered
            </span>
            <Badge tone={app.mode === 'cloud' ? 'good' : 'warn'}>
              {app.mode === 'cloud' ? `Cloud · ${app.user?.email ?? ''}` : 'Guest mode'}
            </Badge>
          </div>
          <NavLink to="/account" className="btn btn-outline btn-sm">
            {app.user ? 'Account' : 'Sign in'}
          </NavLink>
        </header>

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
