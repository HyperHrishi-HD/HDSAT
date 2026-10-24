import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { hasStoredProfile } from './lib/storage';
import { useApp } from './lib/store';
import { AccountPage } from './pages/Account';
import { AdminPage } from './pages/Admin';
import { ArcadePage } from './pages/Arcade';
import { DashboardPage } from './pages/Dashboard';
import { FlashcardsPage } from './pages/Flashcards';
import { PracticePage } from './pages/Practice';
import { QuestionBankPage } from './pages/QuestionBank';
import { ResourcesPage } from './pages/Resources';
import { RewardsPage } from './pages/Rewards';
import { FullTestPage } from './pages/FullTest';
import { CopyrightPage, CreditsPage, PrivacyPage, TermsPage } from './pages/Legal';
import { WelcomePage } from './pages/Welcome';

/**
 * Blank slate: no profile in this browser and no session. Reading this inside a
 * routed component (rather than App) is what lets "Start now" take effect — the
 * navigation re-renders the route, which re-reads storage, and the homepage is
 * gone for good.
 */
function needsWelcome(): boolean {
  return !useApp().user && !hasStoredProfile();
}

function HomeRoute() {
  useLocation();
  return needsWelcome() ? <Navigate to="/welcome" replace /> : <DashboardPage />;
}

function WelcomeRoute() {
  useLocation();
  return needsWelcome() ? <WelcomePage /> : <Navigate to="/" replace />;
}

export function App() {
  const app = useApp();

  if (!app.ready) {
    return (
      <div className="boot">
        <div className="boot-mark">HDSAT</div>
        <p>Loading your practice environment...</p>
      </div>
    );
  }

  return (
    <HashRouter>
      <Routes>
        {/* Operator console. Deliberately absent from every navigation surface:
            the only way in is the /admin URL (or #/admin). */}
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/welcome" element={<WelcomeRoute />} />

        <Route element={<Layout />}>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/practice" element={<PracticePage />} />
          <Route path="/test" element={<FullTestPage />} />
          <Route path="/bank" element={<QuestionBankPage />} />
          <Route path="/flashcards" element={<FlashcardsPage />} />
          <Route path="/arcade" element={<ArcadePage />} />
          <Route path="/resources" element={<ResourcesPage />} />
          <Route path="/rewards" element={<RewardsPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/copyright" element={<CopyrightPage />} />
          <Route path="/credits" element={<CreditsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
