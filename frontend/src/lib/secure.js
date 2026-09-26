/**
 * Detection du contexte securise (https ou localhost).
 *
 * Le micro (`getUserMedia`) et le GPS (`geolocation`) sont refuses par les
 * navigateurs hors contexte securise : ouverte en `http://192.168.x.x`, la meme
 * page ne declenche aucune demande d'autorisation. On detecte ce cas pour
 * afficher une explication claire au lieu d'une "erreur generique".
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0', '']);

export function isLocalHost(hostname) {
  return LOCAL_HOSTS.has(String(hostname || '').toLowerCase());
}

export function secureContextOk() {
  if (typeof window === 'undefined') return true; // executions hors navigateur (tests)
  if (typeof window.isSecureContext === 'boolean') return window.isSecureContext;
  // Repli pour les anciens WebView sans `isSecureContext`
  const { protocol, hostname } = window.location || {};
  return protocol === 'https:' || protocol === 'wss:' || isLocalHost(hostname);
}

export default { secureContextOk, isLocalHost };
