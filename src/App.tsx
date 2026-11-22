import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AppSkeleton, skeletonVariantForPath } from './components/Skeleton';
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

/**
 * The starting page is deliberately readable while signed in, including when
 * it is opened from Credits. A visitor who signs in *while* it is open is
 * still taken into the app by WelcomePage's one-time transition.
 */
function WelcomeRoute() {
  return <WelcomePage />;
}

export function App() {
  const app = useApp();

  if (!app.ready) {
    const pathVariant = skeletonVariantForPath(
      typeof window === 'undefined' ? '/' : window.location.hash
    );
    // A blank browser has no profile yet, so the home route becomes Welcome as
    // soon as the store is ready. Start on the Welcome silhouette instead of
    // drawing a Dashboard and then swapping it.
    const bootVariant =
      pathVariant === 'welcome'
        ? 'welcome'
        : !app.user && !hasStoredProfile() && pathVariant === 'dashboard'
        ? 'welcome'
        : pathVariant;
    return <AppSkeleton variant={bootVariant} />;
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
