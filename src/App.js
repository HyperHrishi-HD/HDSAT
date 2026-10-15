import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { useApp } from './lib/store';
import { AccountPage } from './pages/Account';
import { ArcadePage } from './pages/Arcade';
import { DashboardPage } from './pages/Dashboard';
import { FlashcardsPage } from './pages/Flashcards';
import { PracticePage } from './pages/Practice';
import { QuestionBankPage } from './pages/QuestionBank';
import { ResourcesPage } from './pages/Resources';
import { RewardsPage } from './pages/Rewards';
import { FullTestPage } from './pages/FullTest';
export function App() {
    const app = useApp();
    if (!app.ready) {
        return (_jsxs("div", { className: "boot", children: [_jsx("div", { className: "boot-mark", children: "HDSAT" }), _jsx("p", { children: "Loading your practice environment..." })] }));
    }
    return (_jsx(HashRouter, { children: _jsx(Routes, { children: _jsxs(Route, { element: _jsx(Layout, {}), children: [_jsx(Route, { path: "/", element: _jsx(DashboardPage, {}) }), _jsx(Route, { path: "/practice", element: _jsx(PracticePage, {}) }), _jsx(Route, { path: "/test", element: _jsx(FullTestPage, {}) }), _jsx(Route, { path: "/bank", element: _jsx(QuestionBankPage, {}) }), _jsx(Route, { path: "/flashcards", element: _jsx(FlashcardsPage, {}) }), _jsx(Route, { path: "/arcade", element: _jsx(ArcadePage, {}) }), _jsx(Route, { path: "/resources", element: _jsx(ResourcesPage, {}) }), _jsx(Route, { path: "/rewards", element: _jsx(RewardsPage, {}) }), _jsx(Route, { path: "/account", element: _jsx(AccountPage, {}) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/", replace: true }) })] }) }) }));
}
