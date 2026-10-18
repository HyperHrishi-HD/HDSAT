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
import { CopyrightPage, PrivacyPage, TermsPage } from './pages/Legal';

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
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
