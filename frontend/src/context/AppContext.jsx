import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, clearTokens, getCachedUser, getTokens, isOnline, setCachedUser, setTokens } from '../lib/api.js';
import { cacheGet, cacheSet } from '../lib/idb.js';
import { syncOutbox, pendingCount, draftPreview } from '../lib/outbox.js';
import { announce, setVoiceEnabled, setVoiceLanguage } from '../lib/voice.js';
import { DEFAULT_LANGUAGE, isSupportedLanguage, languageMeta } from '../i18n/index.js';

/**
 * Etat global : langue, session, donnees de reference, connexion reseau et
 * file de publication hors ligne.
 */
const AppContext = createContext(null);

const LANG_KEY = 'bodogui.language';
const VOICE_KEY = 'bodogui.voice.enabled';

export function AppProvider({ children }) {
  const [language, setLanguageState] = useState(() => {
    if (typeof localStorage === 'undefined') return DEFAULT_LANGUAGE;
    const stored = localStorage.getItem(LANG_KEY);
    return isSupportedLanguage(stored) ? stored : DEFAULT_LANGUAGE;
  });
  const [voiceEnabled, setVoiceEnabledState] = useState(() => {
    // Retour vocal desactive par defaut : il s'active avec le bouton 🔊
    // (les messages vocaux natifs ne sont pas encore enregistres).
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(VOICE_KEY) === '1';
  });
  const [user, setUser] = useState(() => getCachedUser());
  const [bootstrapping, setBootstrapping] = useState(true);
  const [meta, setMeta] = useState({
    categories: [],
    districts: [],
    features: {},
    currencies: [],
    languages: [],
    countries: [],
  });
  const [online, setOnline] = useState(isOnline());
  const [pending, setPending] = useState(0);
  const [drafts, setDrafts] = useState([]);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const authenticated = Boolean(user && getTokens()?.accessToken);

  // --- Langue ---------------------------------------------------------------
  useEffect(() => {
    setVoiceLanguage(language);
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language;
      document.documentElement.dir = languageMeta(language).dir;
    }
  }, [language]);

  const setLanguage = useCallback((code) => {
    if (!isSupportedLanguage(code)) return;
    localStorage.setItem(LANG_KEY, code);
    setLanguageState(code);
    setVoiceLanguage(code);
    if (getTokens()?.accessToken) api.patch('/me', { language: code }).catch(() => {});
  }, []);

  const toggleVoice = useCallback(
    (next) => {
      const value = typeof next === 'boolean' ? next : !voiceEnabled;
      setVoiceEnabledState(value);
      setVoiceEnabled(value);
      localStorage.setItem(VOICE_KEY, value ? '1' : '0');
      if (value) announce('welcome');
    },
    [voiceEnabled],
  );

  useEffect(() => {
    setVoiceEnabled(voiceEnabled);
  }, [voiceEnabled]);

  // --- Retour utilisateur (message + voix) ---------------------------------
  const showToast = useCallback((message, options = {}) => {
    setToast({ message, kind: options.kind || 'info', voiceKey: options.voiceKey });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), options.duration || 4000);
    if (options.voiceKey) announce(options.voiceKey);
  }, []);

  const notify = useCallback((message, options) => showToast(message, options), [showToast]);

  // --- Donnees de reference (cachees pour le hors ligne) --------------------
  const applyMeta = useCallback((data) => {
    setMeta({
      categories: data.categories || [],
      districts: data.districts || [],
      features: data.features || {},
      currencies: data.currencies || [],
      languages: data.languages || [],
      countries: data.countries || [],
      app: data.app || {},
    });
  }, []);

  const loadMeta = useCallback(async () => {
    try {
      const data = await api.get('/bootstrap', { auth: false });
      applyMeta(data);
      await cacheSet('bootstrap', data);
      return data;
    } catch {
      const cached = await cacheGet('bootstrap');
      if (cached) applyMeta(cached);
      return cached;
    } finally {
      setBootstrapping(false);
    }
  }, [applyMeta]);

  const refreshUser = useCallback(async () => {
    if (!getTokens()?.accessToken) return null;
    try {
      const data = await api.get('/me');
      setUser(data.user);
      setCachedUser(data.user);
      if (data.user?.language && data.user.language !== language) {
        localStorage.setItem(LANG_KEY, data.user.language);
        setLanguageState(data.user.language);
      }
      return data;
    } catch {
      return null;
    }
  }, [language]);

  // --- Authentification ----------------------------------------------------
  const login = useCallback(
    async (phone, code) => {
      const data = await api.post('/auth/verify', { phone, code, language }, { auth: false });
      setTokens(data.tokens);
      setCachedUser(data.user);
      setUser(data.user);
      announce(data.voiceKey || 'welcome');
      return data;
    },
    [language],
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    clearTokens();
    setUser(null);
  }, []);

  return (
    <AppContext.Provider
      value={{
        language,
        setLanguage,
        voiceEnabled,
        toggleVoice,
        user,
        setUser,
        authenticated,
        login,
        logout,
        refreshUser,
        meta,
        loadMeta,
        online,
        pending,
        drafts,
        setPending,
        setDrafts,
        showToast,
        notify,
        toast,
        bootstrapping,
        announce,
        syncOutbox,
        pendingCount,
        draftPreview,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp doit etre utilise dans AppProvider');
  return ctx;
}

export default AppContext;
