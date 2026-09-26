/**
 * Localisation : GPS d'abord, repli sur les quartiers en gros boutons.
 *
 * ETAT ACTUEL : ce module n'est plus branche dans l'interface. L'etape "ou
 * etes-vous" de la publication a ete retiree (le quartier du profil est repris
 * silencieusement, et beaucoup de vendeurs — bergers, zones rurales ou
 * desertiques — n'ont aucun quartier du referentiel). Le code et ses tests sont
 * conserves pour un usage ulterieur (recherche "pres de moi", tri par distance).
 *
 * Les echecs sont classes par `code` (denied, unavailable, timeout, insecure,
 * unsupported) afin que l'interface explique la situation au lieu d'une
 * "erreur generique".
 */

import { secureContextOk } from './secure.js';

export function geolocationAvailable() {
  return typeof navigator !== 'undefined' && Boolean(navigator.geolocation);
}

/**
 * Probleme empechant l'utilisation du GPS.
 * @returns {null|'insecure'|'unsupported'}
 */
export function geolocationIssue() {
  if (!secureContextOk()) return 'insecure';
  if (!geolocationAvailable()) return 'unsupported';
  return null;
}

function positionFailure(code, message) {
  const error = new Error(message);
  error.name = 'PositionError';
  error.code = code;
  return error;
}

const POSITION_ERROR_CODES = {
  1: ['denied', 'Position refusee'],
  2: ['unavailable', 'Position introuvable'],
  3: ['timeout', 'Position trop lente'],
};

/**
 * Position courante.
 *
 * Deux tentatives maximum : une lecture rapide (position en cache acceptee),
 * puis une lecture precise si l'appareil n'a pas repondu du tout. Chaque echec
 * porte un `code` explicite.
 *
 * @param {{timeout?: number}} [options]
 * @returns {Promise<{lat: number, lng: number, accuracy: number}>}
 */
export function getCurrentPosition({ timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const issue = geolocationIssue();
    if (issue) {
      reject(positionFailure(issue, issue === 'insecure' ? 'GPS refuse hors contexte securise' : 'GPS indisponible'));
      return;
    }

    const onSuccess = (position) =>
      resolve({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      });

    const onError = (error) => {
      const [code, message] = POSITION_ERROR_CODES[error?.code] || ['unavailable', 'Position introuvable'];
      // Un seul essai supplementaire, uniquement si l'appareil n'a rien trouve
      if (attempt === 1 && (code === 'unavailable' || code === 'timeout')) {
        attempt = 2;
        ask({ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }, () =>
          reject(positionFailure(code, error?.message || message)),
        );
        return;
      }
      reject(positionFailure(code, error?.message || message));
    };

    const ask = (options, onFinalError) => {
      const failure = onFinalError || onError;
      try {
        navigator.geolocation.getCurrentPosition(onSuccess, failure, options);
      } catch (err) {
        failure(err);
      }
    };

    let attempt = 1;
    // Lecture rapide : une position en cache (5 minutes) suffit pour choisir un quartier
    ask({ enableHighAccuracy: false, timeout, maximumAge: 300000 });
  });
}

/** Quartier le plus proche d'une position (distance de Haversine). */
export function nearestDistrict(districts = [], position) {
  if (!position || !districts.length) return null;
  const toRad = (deg) => (deg * Math.PI) / 180;
  let best = null;
  for (const district of districts) {
    if (district.lat === null || district.lng === null) continue;
    const dLat = toRad(district.lat - position.lat);
    const dLng = toRad(district.lng - position.lng);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(position.lat)) * Math.cos(toRad(district.lat)) * Math.sin(dLng / 2) ** 2;
    const distanceKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    if (!best || distanceKm < best.distanceKm) best = { district, distanceKm };
  }
  return best;
}

export default { getCurrentPosition, nearestDistrict, geolocationAvailable, geolocationIssue };
