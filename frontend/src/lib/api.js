/**
 * Client HTTP de l'API Bodogui.
 * - jeton JWT stocke localement (l'utilisateur ne ressaisit pas son numero a chaque fois)
 * - erreurs normalisees : { code, message, voiceKey } -> message vocal automatique
 * - detection hors ligne pour basculer sur la file d'attente locale
 */

const API_BASE = import.meta.env?.VITE_API_URL || '/api/v1';
const TOKEN_KEY = 'bodogui.tokens';
const USER_KEY = 'bodogui.user';

export class ApiError extends Error {
  constructor(status, payload = {}) {
    const error = payload.error || {};
    super(error.message || `Erreur ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = error.code || 'unknown';
    this.voiceKey = error.voiceKey || 'error_generic';
    this.details = error.details;
  }
}

export class OfflineError extends Error {
  constructor() {
    super('Pas de connexion internet');
    this.name = 'OfflineError';
    this.code = 'offline';
    this.voiceKey = 'error_offline';
  }
}

export function isOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

export function getTokens() {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
  } catch {
    return null;
  }
}

export function setTokens(tokens) {
  if (!tokens) return clearTokens();
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
  return tokens;
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getCachedUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

export function setCachedUser(user) {
  if (!user) return localStorage.removeItem(USER_KEY);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}

/** Rafraichit le jeton d'acces avec le jeton de rafraichissement. */
let refreshPromise = null;
async function refreshSession() {
  if (refreshPromise) return refreshPromise;
  const tokens = getTokens();
  if (!tokens?.refreshToken) throw new ApiError(401, { error: { code: 'no_refresh_token' } });
  refreshPromise = (async () => {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });
    if (!res.ok) {
      clearTokens();
      throw new ApiError(res.status, await safeJson(res));
    }
    const data = await res.json();
    setTokens({ ...tokens, ...data.tokens });
    setCachedUser(data.user);
    return data.tokens.accessToken;
  })();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

/**
 * Requete authentifiee avec rerafraichissement automatique du jeton.
 * @param {string} path chemin relatif (ex: '/ads')
 * @param {{method?: string, body?: any, formData?: FormData, auth?: boolean, retry?: boolean, signal?: AbortSignal}} options
 */
export async function request(path, options = {}) {
  const { method = 'GET', body, formData, auth = true, retry = true, signal } = options;

  if (!isOnline() && method !== 'GET') throw new OfflineError();

  const headers = {};
  const tokens = getTokens();
  if (auth && tokens?.accessToken) headers.Authorization = `Bearer ${tokens.accessToken}`;
  let payload;
  if (formData) {
    payload = formData;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { method, headers, body: payload, signal });
  } catch (err) {
    if (!isOnline()) throw new OfflineError();
    throw new ApiError(0, { error: { code: 'network_error', message: err.message, voiceKey: 'error_offline' } });
  }

  if (res.status === 401 && auth && retry && tokens?.refreshToken) {
    await refreshSession();
    return request(path, { ...options, retry: false });
  }

  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  if (res.status === 204) return null;
  return safeJson(res);
}

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  del: (path, options) => request(path, { ...options, method: 'DELETE' }),
  upload: (path, formData, options) => request(path, { ...options, method: 'POST', formData }),
};

/** URL publique d'un media (photos, audio) servi par le proxy backend. */
export function mediaUrl(key) {
  if (!key) return null;
  if (/^https?:\/\//.test(key)) return key;
  return `/media/${key}`;
}

export default api;
