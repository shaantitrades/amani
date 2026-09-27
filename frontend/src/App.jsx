import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import { InstallGate } from './components/InstallGate.jsx';
import { InstallPrompt } from './components/InstallPrompt.jsx';
import { ScrollToTop } from './components/ScrollToTop.jsx';
import { OfflineBanner, Spinner, Toast } from './components/ui.jsx';
import { TabBar } from './components/TabBar.jsx';
import { INSTALL_GATE_ENABLED } from './lib/pwa.js';
import Welcome from './pages/Welcome.jsx';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';

// Les ecrans secondaires sont charges a la demande : l'ecran d'accueil reste
// tres leger, ce qui compte sur une connexion 2G.
const Browse = lazy(() => import('./pages/Browse.jsx'));
const AdDetail = lazy(() => import('./pages/AdDetail.jsx'));
const Sell = lazy(() => import('./pages/Sell.jsx'));
const Groups = lazy(() => import('./pages/Groups.jsx'));
const GroupDetail = lazy(() => import('./pages/GroupDetail.jsx'));
const Messages = lazy(() => import('./pages/Messages.jsx'));
const Calls = lazy(() => import('./pages/Calls.jsx'));
const Notifications = lazy(() => import('./pages/Notifications.jsx'));
const Account = lazy(() => import('./pages/Account.jsx'));
const MyAds = lazy(() => import('./pages/MyAds.jsx'));
const Blocked = lazy(() => import('./pages/Blocked.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));

function RequireAuth({ children }) {
  const { authenticated } = useApp();
  const location = useLocation();
  if (!authenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function Router() {
  const { authenticated } = useApp();
  return (
    // Un deuxieme filet de securite entoure les ecrans charges a la demande :
    // en 2G, un morceau de code peut ne pas se telecharger et React leverait
    // une exception (page blanche) sans ce garde-fou.
    <ErrorBoundary>
      <Suspense fallback={<Spinner />}>
        <Routes>
        <Route path="/" element={<Navigate to={authenticated ? '/home' : '/welcome'} replace />} />
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/login" element={<Login />} />
        <Route path="/home" element={<RequireAuth><Home /></RequireAuth>} />
        <Route path="/browse" element={<Browse />} />
        {/* Une annonce partagee (WhatsApp, SMS...) demande une inscription :
            le visiteur est redirige vers l'ecran de connexion. */}
        <Route path="/ad/:id" element={<RequireAuth><AdDetail /></RequireAuth>} />
        <Route path="/sell" element={<RequireAuth><Sell /></RequireAuth>} />
        <Route path="/groups" element={<RequireAuth><Groups /></RequireAuth>} />
        <Route path="/group/:id" element={<RequireAuth><GroupDetail /></RequireAuth>} />
        <Route path="/messages" element={<RequireAuth><Messages /></RequireAuth>} />
        <Route path="/messages/:userId" element={<RequireAuth><Messages /></RequireAuth>} />
        <Route path="/calls" element={<RequireAuth><Calls /></RequireAuth>} />
        <Route path="/notifications" element={<RequireAuth><Notifications /></RequireAuth>} />
        <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
        <Route path="/my-ads" element={<RequireAuth><MyAds /></RequireAuth>} />
        <Route path="/blocked" element={<RequireAuth><Blocked /></RequireAuth>} />
        <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>} />
        <Route path="*" element={<Navigate to={authenticated ? '/home' : '/welcome'} replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    // Filet de securite principal : aucune erreur ne doit produire une page blanche
    <ErrorBoundary>
      <AppProvider>
        {/* Portail d'installation obligatoire : tant que Bodogui n'est pas
            installe, aucun ecran n'est monte (ni requete reseau inutile en 2G).
            L'invitation classique (non bloquante) ne sert plus que si le
            portail est desactive (VITE_INSTALL_GATE=off). */}
        <InstallGate>
          {/* Remise en haut a chaque changement d'ecran : le premier element d'un
              ecran (onglets du groupe, tuile VENDRE de l'accueil) ne doit jamais
              rester a moitie cache sous la barre du haut, qui est collante. */}
          <ScrollToTop />
          <OfflineBanner />
          <Router />
          {/* Barre d'onglets du bas (mobile) : Accueil, Discussions, Appels,
              Mes annonces, Notifications. */}
          <TabBar />
          {INSTALL_GATE_ENABLED ? null : <InstallPrompt />}
          <Toast />
        </InstallGate>
      </AppProvider>
    </ErrorBoundary>
  );
}
