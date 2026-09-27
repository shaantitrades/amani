import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { t } from '../i18n/index.js';
import { api } from '../lib/api.js';
import { afterLoginPath } from '../lib/chat.js';
import { dialCode } from '../lib/format.js';
import { keepFieldVisible } from '../lib/keyboard.js';
import { BigButton, Field, TopBar } from '../components/ui.jsx';

/**
 * Inscription / connexion par numero de telephone + code SMS.
 * Aucun email, aucun mot de passe. Le numero se saisit avec un clavier
 * numerique natif (inputMode="tel") pour rester simple sur Android 5.
 *
 * Le compte est obligatoire pour parler a un vendeur : un visiteur venu d'un
 * lien partage (annonce) revient sur cette annonce apres validation du code.
 */
export default function Login() {
  const { language, login, notify, meta } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState('phone'); // phone | code
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [devCode, setDevCode] = useState(null);
  const [countdown, setCountdown] = useState(0);
  // Ecran demande avant l'inscription (ex. /ad/<id> recu par un lien partage).
  const from = location.state?.from;
  // Le clavier recouvre le bas de l'ecran et la barre du haut est collante : des
  // que le champ prend le focus, on ramene le champ ET le bouton dans la zone
  // visible, sans jamais laisser le champ passer SOUS la barre du haut (sinon il
  // disparait pendant toute la saisie du numero).
  const actionsRef = useRef(null);
  const fieldRef = useRef(null);
  const keepFieldOnScreen = () => keepFieldVisible({ field: fieldRef.current, action: actionsRef.current });
  const keepActionsVisible = () => {
    // Le clavier met 200 a 500 ms a s'ouvrir selon le telephone : on repasse
    // plusieurs fois, chaque passage restant sans effet si tout est deja visible.
    for (const delay of [90, 280, 560]) setTimeout(keepFieldOnScreen, delay);
  };

  useEffect(() => {
    // Navigateurs recents : la zone visible change quand le clavier s'ouvre ou
    // se ferme. On recalcule alors (l'ancien Android 5 n'a pas visualViewport).
    const viewport = typeof window === 'undefined' ? null : window.visualViewport;
    if (!viewport) return undefined;
    viewport.addEventListener('resize', keepFieldOnScreen);
    return () => viewport.removeEventListener('resize', keepFieldOnScreen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (countdown <= 0) return undefined;
    const timer = setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const requestCode = async () => {
    setBusy(true);
    try {
      const data = await api.post('/auth/request-code', { phone, language }, { auth: false });
      setDevCode(data.devCode || null);
      setStep('code');
      setCountdown(60);
    } catch (err) {
      // L'API renvoie la raison exacte (numero invalide, trop de demandes,
      // erreur serveur) : on l'affiche au lieu d'accuser le numero a tort.
      const key = err?.voiceKey || 'error_phone_invalid';
      notify(t(language, key), { kind: 'error', voiceKey: key });
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    try {
      // Un nouveau compte comme un compte existant revient a l'ecran demande
      // (une annonce partagee, par exemple) : le vendeur n'est joignable
      // qu'avec un compte.
      await login(phone, code);
      navigate(afterLoginPath(from), { replace: true });
    } catch (err) {
      const key = err?.voiceKey || 'error_code_invalid';
      notify(t(language, key), { kind: 'error', voiceKey: key });
    } finally {
      setBusy(false);
    }
  };

  // Repli sur l'indicatif du Tchad tant que le referentiel n'est pas charge
  const countries = Array.isArray(meta.countries) ? meta.countries : [];
  const dial = dialCode(countries);

  return (
    <div className="screen">
      <TopBar title={t(language, 'app_name')} onBack={() => navigate('/welcome')} />

      {/* Lien partage : on explique pourquoi le compte est demande avant de
          pouvoir parler au vendeur (la conversation se tient dans Bodogui). */}
      {from ? <p className="wizard__hint">🔒 {t(language, 'login_to_chat')}</p> : null}

      {step === 'phone' ? (
        <div className="login">
          <h1 className="login__title">{t(language, 'phone_prompt')}</h1>
          {/* Pas d'icone au-dessus du champ : tout l'espace gagne reste au
              bouton, qui doit demeurer visible quand le clavier s'ouvre. */}
          <div className="login__actions" ref={actionsRef}>
            <Field>
              <input
                ref={fieldRef}
                className="input input--phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder={`+${dial} 66 12 34 56`}
                value={phone}
                onFocus={keepActionsVisible}
                onChange={(event) => setPhone(event.target.value)}
              />
            </Field>
            <BigButton
              icon="✉️"
              label={busy ? t(language, 'loading') : t(language, 'send_code')}
              color="green"
              size="large"
              disabled={busy || phone.replace(/\D/g, '').length < 8}
              onClick={requestCode}
            />
          </div>
          {/* Aide sous le bouton : utile, mais elle ne doit plus repousser
              l'action hors de la zone visible. */}
          <span className="field__hint">{t(language, 'phone_hint')}</span>
        </div>
      ) : (
        <div className="login">
          <h1 className="login__title">{t(language, 'code_prompt')}</h1>
          {devCode ? <p className="login__devcode">Code de test : {devCode}</p> : null}
          <div className="login__actions" ref={actionsRef}>
            <Field>
              <input
                ref={fieldRef}
                className="input input--code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onFocus={keepActionsVisible}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <BigButton
              icon="✅"
              label={busy ? t(language, 'loading') : t(language, 'verify')}
              color="green"
              size="large"
              disabled={busy || code.length < 4}
              onClick={verify}
            />
            <BigButton
              icon="🔁"
              label={countdown > 0 ? `${t(language, 'resend')} (${countdown})` : t(language, 'resend')}
              color="grey"
              disabled={countdown > 0 || busy}
              onClick={requestCode}
            />
          </div>
        </div>
      )}
    </div>
  );
}
