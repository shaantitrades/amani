/**
 * Navigation principale : definition des onglets de la barre du bas (mode
 * mobile, facon WhatsApp).
 * La logique est isolee du rendu React pour rester testable sans DOM.
 */

/** Onglets de la barre du bas, dans l'ordre d'affichage. */
export const TABS = [
  { key: 'home', path: '/home', icon: '🏠', labelKey: 'tab_home' },
  { key: 'messages', path: '/messages', icon: '💬', labelKey: 'messages', badge: 'messages' },
  { key: 'calls', path: '/calls', icon: '📞', labelKey: 'calls' },
  { key: 'my_ads', path: '/my-ads', icon: '🏷️', labelKey: 'my_ads' },
  { key: 'notifications', path: '/notifications', icon: '🔔', labelKey: 'notifications', badge: 'notifications' },
];

/**
 * Ecrans "plein ecran" : l'assistant de publication et les conversations
 * prennent tout l'ecran (clavier, barre de contact, pieces jointes). La barre
 * du bas s'efface, exactement comme dans WhatsApp.
 */
const FULL_SCREENS = [
  /^\/welcome/,
  /^\/login/,
  /^\/sell/,
  /^\/ad\/[^/]+/,
  /^\/messages\/[^/]+/,
  /^\/group\/[^/]+/,
];

/** Chemins rattaches visuellement a l'onglet Accueil (accueil et fil d'annonces). */
const HOME_PREFIXES = ['/home', '/browse', '/ad', '/groups', '/group'];

/** Normalise un chemin : parametres et slash final retires. */
export function normalizePath(pathname) {
  if (!pathname) return '/';
  const clean = String(pathname).split('?')[0].replace(/\/+$/, '');
  return clean === '' ? '/' : clean;
}

/** La barre du bas doit-elle etre visible sur cet ecran ? */
export function tabBarVisible(pathname) {
  const path = normalizePath(pathname);
  return !FULL_SCREENS.some((pattern) => pattern.test(path));
}

/** Onglet actif pour un chemin donne (null si l'ecran n'est pas un onglet). */
export function activeTab(pathname) {
  const path = normalizePath(pathname);
  for (const tab of TABS) {
    if (path === tab.path || path.startsWith(`${tab.path}/`)) return tab.key;
  }
  if (path === '/' || HOME_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return 'home';
  }
  return null;
}

/** Chemin d'un onglet (liens et tests). */
export function tabPath(key) {
  const tab = TABS.find((item) => item.key === key);
  return tab ? tab.path : null;
}

export default { TABS, tabBarVisible, activeTab, normalizePath, tabPath };
