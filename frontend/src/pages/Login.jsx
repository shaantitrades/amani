import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { t } from '../i18n/index.js';
import { api } from '../lib/api.js';
import { afterLoginPath } from '../lib/chat.js';
import { dialCode } from '../lib/format.js';
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
          <Field label="📞" hint={t(language, 'phone_hint')}>
            <input
              className="input input--phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder={`+${dial} 66 12 34 56`}
              value={phone}
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
      ) : (
        <div className="login">
          <h1 className="login__title">{t(language, 'code_prompt')}</h1>
          {devCode ? <p className="login__devcode">Code de test : {devCode}</p> : null}
          <Field label="🔢">
            <input
              className="input input--code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
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
      )}
    </div>
  );
}
