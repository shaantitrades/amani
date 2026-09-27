import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { disableScrollRestoration, scrollPageToTop } from './lib/scroll.js';
import './styles/app.css';

/**
 * Point d'entree de la PWA Bodogui.
 * Le service worker est injecte par vite-plugin-pwa (strategie autoUpdate) ;
 * la mise a jour se fait en arriere-plan, sans bloquer l'utilisateur.
 */

// L'application repart toujours du haut. Sans cela, quand la PWA installee est
// rouverte (ou la page rechargee), le navigateur restaure la position de
// defilement precedente : les premiers boutons de l'ecran (onglets du groupe,
// tuile VENDRE) apparaissent a moitie caches sous la barre du haut collante.
disableScrollRestoration();
scrollPageToTop();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

// Rechargement automatique quand une nouvelle version est prete
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Une seule fois : evite une boucle si le reseau est instable
    if (!sessionStorage.getItem('bodogui.reloaded')) {
      sessionStorage.setItem('bodogui.reloaded', '1');
      window.location.reload();
    }
  });
}
