import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
    return (_jsxs("div", { className: "app-shell", children: [_jsxs("aside", { className: "sidebar", children: [_jsxs(NavLink, { to: "/", className: "brand", children: [_jsx("span", { className: "brand-mark", children: "H" }), _jsxs("span", { children: [_jsx("strong", { children: "HDSAT" }), _jsx("em", { children: "Digital SAT practice" })] })] }), _jsx("nav", { className: "nav", children: NAV.map((item) => (_jsx(NavLink, { to: item.to, end: item.end, className: ({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`, children: item.label }, item.to))) }), _jsx("div", { className: "sidebar-foot", children: _jsxs("p", { className: "muted", children: ["Bank ", app.bankVersion, " \u00B7 ", app.questions.length, " items"] }) })] }), _jsxs("div", { className: "main", children: [_jsxs("header", { className: "topbar", children: [_jsxs("div", { className: "topbar-stats", children: [_jsxs("span", { className: "pill", title: "HDCoins balance", children: [_jsx("strong", { children: app.hdCoins }), " HDCoins"] }), _jsxs("span", { className: "pill", title: "Consecutive practice days", children: [_jsx("strong", { children: app.currentStreak }), " day streak"] }), _jsxs("span", { className: "pill", title: "Practice answers recorded", children: [_jsx("strong", { children: app.totals.attempts }), " answered"] }), _jsx(Badge, { tone: app.mode === 'cloud' ? 'good' : 'warn', children: app.mode === 'cloud' ? `Cloud · ${app.user?.email ?? ''}` : 'Guest mode' })] }), _jsx(NavLink, { to: "/account", className: "btn btn-outline btn-sm", children: app.user ? 'Account' : 'Sign in' })] }), app.error ? (_jsx(Alert, { tone: "error", onDismiss: app.actions.dismissMessages, children: app.error })) : null, app.notice ? (_jsx(Alert, { tone: "notice", onDismiss: app.actions.dismissMessages, children: app.notice })) : null, !app.cloudConfigured ? (_jsx(Alert, { tone: "info", children: "Supabase is not configured for this deployment, so HDSAT is running in local guest mode. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable accounts and cloud sync." })) : null, _jsx("main", { className: "content", children: _jsx(Outlet, {}) })] }), _jsx("nav", { className: "mobile-nav", children: NAV.slice(0, 5).map((item) => (_jsx(NavLink, { to: item.to, end: item.end, className: ({ isActive }) => `mobile-link${isActive ? ' is-active' : ''}`, children: item.label }, item.to))) })] }));
}
