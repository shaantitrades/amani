import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { LANGUAGES, districtLabel, languageMeta, t } from '../i18n/index.js';
import { api } from '../lib/api.js';
import {
  DANGER_HIDDEN,
  isDangerOpen,
  languageChangeRequest,
  languageConfirmMessage,
  toggleDanger,
} from '../lib/account.js';
import { formatBytes, formatPhone } from '../lib/format.js';
import { registerPush, pushSupported, unregisterPush } from '../lib/push.js';
import { BigButton, OfflineBanner, Sheet, Spinner, TopBar } from '../components/ui.jsx';
import { ConfirmSheet } from '../components/ConfirmSheet.jsx';
import { useSync } from '../hooks/useSync.js';

/**
 * Mon compte : langue, nom, notifications, mes annonces, utilisateurs bloques,
 * quota de medias et moderation (si administrateur).
 *
 * Pas de bouton de deconnexion : le compte reste ouvert sur le telephone. La
 * suppression du compte, elle, est irreversible — elle est donc rangee dans une
 * zone sensible repliee par defaut (voir `lib/account.js`), ouverte par un appui
 * volontaire puis confirmee une seconde fois.
 */
export default function Account() {
  const navigate = useNavigate();
  const {
    language,
    setLanguage,
    user,
    refreshUser,
    logout,
    meta,
    voiceEnabled,
    toggleVoice,
    notify,
    showToast,
    pending,
  } = useApp();
  const { sync } = useSync();
  const [stats, setStats] = useState(null);
  const [storage, setStorage] = useState(null);
  const [sheet, setSheet] = useState(null); // name | district | delete
  const [danger, setDanger] = useState(DANGER_HIDDEN); // zone sensible repliee par defaut
  const [nextLanguage, setNextLanguage] = useState(null); // langue visee, en attente de confirmation
  const [name, setName] = useState(user?.name || '');
  const [loading, setLoading] = useState(false);
  // Quartier du profil : choisi une seule fois ici, puis repris dans les annonces.
  const myDistrict = meta.districts.find((item) => item.id === user?.district_id) || null;
  // Langue vers laquelle on propose de basculer (drapeau + nom natif).
  const targetLanguage = nextLanguage ? languageMeta(nextLanguage) : null;

  useEffect(() => {
    (async () => {
      try {
        const [me, media] = await Promise.all([api.get('/me'), api.get('/media/mine')]);
        setStats(me.stats);
        setStorage(media.storage);
      } catch {
        /* hors ligne : on affiche ce qui est disponible */
      }
    })();
  }, []);

  const saveProfile = async (patch, labelKey = 'edit_name') => {
    setLoading(true);
    try {
      await api.patch('/me', patch);
      await refreshUser();
      showToast(t(language, labelKey), { kind: 'success', voiceKey: 'profile_saved' });
      setSheet(null);
    } catch (err) {
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
    } finally {
      setLoading(false);
    }
  };

  /**
   * Quartier affiche dans les annonces : facultatif, choisi une fois, modifiable et
   * effacable. Le retrait passe par `clear_district` parce que `district_id: null`
   * est ignore par l'API (COALESCE sur le champ existant).
   */
  const saveDistrict = (districtId) =>
    saveProfile(
      districtId ? { district_id: districtId } : { clear_district: true },
      districtId ? 'my_district' : 'no_district',
    );

  const togglePush = async (value) => {
    try {
      if (value) {
        await registerPush(meta.features?.vapidPublicKey);
        await api.patch('/me', { notify_push: true });
      } else {
        await unregisterPush();
        await api.patch('/me', { notify_push: false });
      }
      await refreshUser();
      showToast(t(language, 'notifications_push'), { kind: 'success', voiceKey: 'profile_saved' });
    } catch {
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: 'error_generic' });
    }
  };

  /**
   * Changement de langue : la bascule n'a lieu qu'apres confirmation, affichee
   * dans la langue ACTUELLE (l'utilisateur doit pouvoir lire la question). Le
   * retour est ensuite donne dans la NOUVELLE langue, y compris a la voix :
   * le message vocal d'accueil existe deja dans les 4 langues.
   */
  const confirmLanguage = () => {
    const code = nextLanguage;
    setNextLanguage(null);
    if (!code) return;
    setLanguage(code);
    showToast(t(code, 'language_changed'), { kind: 'success', voiceKey: 'welcome' });
  };

  const deleteAccount = async () => {
    await api.del('/me').catch(() => {});
    await logout();
    navigate('/welcome', { replace: true });
  };

  return (
    <div className="screen">
      <TopBar
        title={t(language, 'account')}
        onBack={() => navigate('/home')}
        right={
          <button type="button" className="topbar__toggle" onClick={() => navigate('/messages')}>
            💬
          </button>
        }
      />
      <OfflineBanner />

      <section className="account-card">
        <div className="account-card__avatar" aria-hidden="true">👤</div>
        <div>
          <strong>{user?.name || t(language, 'edit_name')}</strong>
          <span>{formatPhone(user?.phone)}</span>
          {stats ? (
            <span className="muted">
              {stats.publishedAds} · ⭐ {stats.rating_avg || '-'} ({stats.ratings_count})
            </span>
          ) : null}
        </div>
      </section>

      <div className="account-actions">
        <BigButton
          icon="🏷️"
          label={t(language, 'my_ads')}
          color="green"
          badge={pending || undefined}
          onClick={() => navigate('/my-ads')}
        />
        <BigButton icon="🚫" label={t(language, 'blocked_list')} color="danger" onClick={() => navigate('/blocked')} />
        <BigButton icon="✏️" label={t(language, 'edit_name')} color="grey" onClick={() => setSheet('name')} />
        <BigButton
          icon="📍"
          label={myDistrict ? districtLabel(myDistrict, language) : user?.district_name || t(language, 'my_district')}
          color="grey"
          onClick={() => setSheet('district')}
        />
        <BigButton icon="🔊" label={voiceEnabled ? 'ON' : 'OFF'} color="blue" onClick={() => toggleVoice()} />
        {user?.is_admin ? (
          <BigButton icon="🛡️" label={t(language, 'admin')} color="dark" onClick={() => navigate('/admin')} />
        ) : null}
      </div>

      <section className="account-section">
        <h3>🌍 {t(language, 'language')}</h3>
        <div className="chips">
          {LANGUAGES.map((item) => (
            <button
              key={item.code}
              type="button"
              className={`chip ${language === item.code ? 'chip--active' : ''}`}
              aria-pressed={language === item.code}
              onClick={() => setNextLanguage(languageChangeRequest(language, item.code))}
            >
              {item.flag} {item.native}
            </button>
          ))}
        </div>
      </section>

      <section className="account-section">
        <h3>🔔 {t(language, 'notifications')}</h3>
        <label className="toggle">
          <input
            type="checkbox"
            checked={Boolean(user?.notify_sms)}
            onChange={(event) => saveProfile({ notify_sms: event.target.checked })}
          />
          <span>✉️ {t(language, 'notifications_sms')}</span>
        </label>
        {pushSupported() ? (
          <label className="toggle">
            <input
              type="checkbox"
              checked={Boolean(user?.notify_push)}
              onChange={(event) => togglePush(event.target.checked)}
            />
            <span>📲 {t(language, 'notifications_push')}</span>
          </label>
        ) : null}
      </section>

      <section className="account-section">
        <h3>💾 {t(language, 'storage_label')}</h3>
        {storage ? (
          <p className="muted">
            {storage.files} fichiers · {formatBytes(storage.bytes)}
          </p>
        ) : (
          <Spinner />
        )}
        {pending ? (
          <BigButton icon="🔄" label={`${t(language, 'sync_now')} (${pending})`} color="blue" onClick={() => sync()} />
        ) : null}
      </section>

      <section className="account-section">
        <Link className="link" to="/my-ads">
          {t(language, 'my_ads')} →
        </Link>
      </section>

      {/* Zone sensible, tout en bas et repliee par defaut : la suppression du
          compte est definitive, elle ne doit jamais partir d'un appui mal
          place. Un appui ouvre la zone (on voit alors le bouton et son
          avertissement), un deuxieme ouvre la confirmation, le troisieme
          seulement supprime. Annuler la confirmation referme la zone. */}
      <section className="account-section account-section--danger">
        <button
          type="button"
          className="danger-toggle"
          aria-expanded={isDangerOpen(danger)}
          onClick={() => setDanger(toggleDanger(danger))}
        >
          ⚙️ {t(language, 'account_options')}
        </button>
        {isDangerOpen(danger) ? (
          <div className="danger-zone">
            <p className="muted">🔒 {t(language, 'delete_account_hint')}</p>
            <BigButton
              icon="🗑️"
              label={t(language, 'delete_account')}
              color="danger"
              onClick={() => setSheet('delete')}
            />
          </div>
        ) : null}
      </section>

      {/* Changement de langue : confirmation obligatoire. La question est posee
          dans la langue actuelle, le bouton de droite nomme la langue visee
          (drapeau + nom natif) : lisible meme sans savoir lire. */}
      <ConfirmSheet
        open={Boolean(nextLanguage)}
        title={t(language, 'confirm')}
        message={languageConfirmMessage(t(language, 'confirm_language'), targetLanguage?.native)}
        confirmIcon={targetLanguage?.flag || '🌍'}
        confirmLabel={targetLanguage?.native}
        onClose={() => setNextLanguage(null)}
        onConfirm={confirmLanguage}
      />

      {/* Suppression du compte : confirmation obligatoire */}
      <ConfirmSheet
        open={sheet === 'delete'}
        title={t(language, 'confirm')}
        message={t(language, 'confirm_delete_account')}
        confirmIcon="🗑️"
        confirmLabel={t(language, 'delete_account')}
        busy={loading}
        onClose={() => {
          setSheet(null);
          setDanger(DANGER_HIDDEN); // annulation : le bouton disparait de nouveau
        }}
        onConfirm={async () => {
          setSheet(null);
          await deleteAccount();
        }}
      />

      <Sheet open={sheet === 'name'} title={t(language, 'edit_name')} onClose={() => setSheet(null)}>
        <input
          className="input"
          type="text"
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <BigButton
          icon="✅"
          label={loading ? t(language, 'loading') : t(language, 'apply')}
          color="green"
          size="large"
          onClick={() => saveProfile({ name })}
        />
      </Sheet>

      {/* Quartier facultatif : choisi une fois ici, repris dans les annonces, jamais
          demande a la publication (les vendeurs hors referentiel publient sans quartier). */}
      <Sheet open={sheet === 'district'} title={t(language, 'choose_district')} onClose={() => setSheet(null)}>
        <p className="muted">{t(language, 'district_hint')}</p>
        <div className="district-grid">
          <button
            type="button"
            className={`district-tile ${!user?.district_id ? 'district-tile--active' : ''}`}
            onClick={() => saveDistrict(null)}
          >
            🗺️ {t(language, 'no_district')}
          </button>
          {meta.districts.map((district) => (
            <button
              key={district.id}
              type="button"
              className={`district-tile ${user?.district_id === district.id ? 'district-tile--active' : ''}`}
              onClick={() => saveDistrict(district.id)}
            >
              🏘️ {districtLabel(district, language)}
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
