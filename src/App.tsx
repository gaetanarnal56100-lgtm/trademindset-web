// src/App.tsx
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthInit, useIsAuthenticated } from '@/hooks/useAuth'
import AppLayout      from '@/components/layout/AppLayout'
import AuthLayout     from '@/components/layout/AuthLayout'
import PublicLayout   from '@/components/layout/PublicLayout'
import LandingPage    from '@/pages/landing/LandingPage'
import LoginPage      from '@/pages/auth/LoginPage'
import SignUpPage     from '@/pages/auth/SignUpPage'
import DashboardPage  from '@/pages/dashboard/DashboardPage'
import TradesPage     from '@/pages/trades/TradesPage'
import AnalysePage    from '@/pages/analyse/AnalysePage'
import MarchesPage    from '@/pages/marches/MarchesPage'
import JournalPage    from '@/pages/journal/JournalPage'
import AlertesPage    from '@/pages/alertes/AlertesPage'
import CalendrierPage from '@/pages/calendrier/CalendrierPage'
import SystemesPage   from '@/pages/systemes/SystemesPage'
import ProfilPage     from '@/pages/profil/ProfilPage'
import SettingsPage   from '@/pages/settings/SettingsPage'
import ExchangesPage  from '@/pages/exchanges/ExchangesPage'
import ReferralPage   from '@/pages/referral/ReferralPage'
import CoachIAPage    from '@/pages/coach/CoachIAPage'
import BadgesPage   from '@/pages/badges/BadgesPage'
import PredictPage  from '@/pages/predict/PredictPage'
import LoadingScreen  from '@/components/ui/LoadingScreen'
import { ThemeProvider, getStoredTheme } from '@/contexts/ThemeContext'
import { useAppStore } from '@/store/appStore'

export default function App() {
  useAuthInit()
  const { isAuthenticated, isAuthLoading } = useIsAuthenticated()
  const user = useAppStore(s => s.user)
  const isPremium = user?.isPremium ?? false

  if (isAuthLoading) return <LoadingScreen />

  return (
    <ThemeProvider isPremium={isPremium}>
    <Routes>
      {/* ── Landing page publique ── */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={!isAuthenticated ? <LandingPage /> : <Navigate to="/app" replace />} />
      </Route>

      {/* ── Auth (non connecté) ── */}
      <Route element={<AuthLayout />}>
        <Route path="/login"   element={!isAuthenticated ? <LoginPage />  : <Navigate to="/app" replace />} />
        <Route path="/signup"  element={!isAuthenticated ? <SignUpPage /> : <Navigate to="/app" replace />} />
      </Route>

      {/* ── App (connecté) ── */}
      <Route path="app" element={
        isAuthenticated
          ? <AppLayout />
          : <Navigate to="/login" replace />
      }>
        <Route index                   element={<DashboardPage />} />
        <Route path="trades"           element={<TradesPage />} />
        <Route path="analyse"          element={<AnalysePage />} />
        <Route path="marches"          element={<MarchesPage />} />
        <Route path="journal"          element={<JournalPage />} />
        <Route path="alertes"          element={<AlertesPage />} />
        <Route path="calendrier"       element={<CalendrierPage />} />
        <Route path="systemes"         element={<SystemesPage />} />
        <Route path="profil"           element={<ProfilPage />} />
        <Route path="settings"         element={<SettingsPage />} />
        <Route path="exchanges"        element={<ExchangesPage />} />
        <Route path="referral"         element={<ReferralPage />} />
        <Route path="coach"            element={<CoachIAPage />} />
        <Route path="badges"           element={<BadgesPage />} />
        <Route path="predict"          element={<PredictPage />} />
      </Route>

      {/* ── Fallback ── */}
      <Route path="*" element={<Navigate to={isAuthenticated ? '/app' : '/'} replace />} />
    </Routes>
    </ThemeProvider>
  )
}
