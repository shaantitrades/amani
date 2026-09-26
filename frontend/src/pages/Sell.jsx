import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { districtLabel, t } from '../i18n/index.js';
import { api, isOnline, mediaUrl } from '../lib/api.js';
import { draftFromAd, editPayload, splitPhotos } from '../lib/adEdit.js';
import { enqueueDraft, newClientUuid } from '../lib/outbox.js';
import { compressImage } from '../lib/image.js';
import { SELL_STEPS, canContinueStep, nextStepIndex, prevStepIndex, stepPosition } from '../lib/wizard.js';
import { BigButton, IconButton, Spinner, TopBar } from '../components/ui.jsx';
import { AudioPlayButton, VoiceRecorder } from '../components/media.jsx';
import { CategoryGrid, NumericKeypad, PhotoPicker } from '../components/forms.jsx';
import { useSync } from '../hooks/useSync.js';

/**
 * Publication d'une annonce en 5 gestes simples, sans jamais devoir ecrire :
 * photos, voix, clavier geant, grille d'icones, puis recapitulatif.
 *
 * Le choix "JE VENDS / JE CHERCHE" n'est plus demande : deux boutons presque
 * identiques egaraient les vendeurs qui ne lisent pas. Toute annonce publiee ici
 * est une vente (`kind: 'sell'`), champ toujours accepte par le serveur.
 *
 * Le lieu n'est plus demande : le quartier du profil (ou du groupe) est repris
 * automatiquement quand il existe, sinon l'annonce part sans quartier — c'est le
 * texte ou la voix du vendeur qui situe le lieu (bergers, zones sans quartier).
 *
 * Ouverture possible avec `?group=<uuid>` : l'annonce est alors publiee dans le
 * fil du groupe (et non dans le fil public).
 *
 * Ouverture possible avec `?edit=<uuid>` : l'assistant sert alors a CORRIGER une
 * annonce deja publiee (prix, photo, voix, categorie). L'enregistrement passe
 * par `PATCH /ads/:id` : aucune annonce en double, et le statut (publiee ou
 * vendue) ne change pas.
 */
export default function Sell() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const groupeId = searchParams.get('group') || '';
  const editId = searchParams.get('edit') || '';
  const { language, meta, notify, announce, user, loadMeta } = useApp();
  const { sync } = useSync();
  const [step, setStep] = useState(0);
  const [group, setGroup] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [loadingAd, setLoadingAd] = useState(Boolean(editId));
  // Voix deja publiee : conservee tant que le vendeur n'enregistre rien de neuf.
  const [existingAudio, setExistingAudio] = useState(null);
  const [draft, setDraft] = useState(() => ({
    photos: [],
    audio: null,
    title: '',
    description_text: '',
    price_amount: '',
    // Quartier repris du profil (ou du groupe) : jamais demande, souvent inconnu.
    district_id: user?.district_id || '',
    city: user?.city || '',
    category_id: '',
    // Toutes les annonces publiees depuis l'application sont des ventes : le
    // choix "JE VENDS / JE CHERCHE" a ete retire de l'assistant (deux boutons
    // presque identiques pour des vendeurs qui ne lisent pas). `kind` reste
    // envoye au serveur, qui default sur 'sell'.
    kind: 'sell',
    group_id: groupeId,
    client_uuid: newClientUuid(),
  }));

  const [textOpen, setTextOpen] = useState(() => Boolean(draft.title || draft.description_text));

  const current = SELL_STEPS[step];
  const position = stepPosition(step);
  const update = (patch) => setDraft((prev) => ({ ...prev, ...patch }));
  const next = () => setStep((value) => nextStepIndex(value));
  const back = () => {
    if (step > 0) return setStep((value) => prevStepIndex(value));
    if (editId) return navigate(`/ad/${editId}`, { replace: true });
    return navigate(groupeId ? `/group/${groupeId}` : '/home');
  };
  const canContinue = () => canContinueStep(current, draft);

  // Groupe cible : nom affiche en haut et quartier pre-rempli (moins d'etapes).
  // Une modification ne change pas de groupe : rien a charger.
  useEffect(() => {
    if (!groupeId || editId) return undefined;
    let cancelled = false;
    api
      .get(`/groups/${groupeId}`)
      .then((data) => {
        if (cancelled) return;
        setGroup(data.group);
        setDraft((prev) => ({
          ...prev,
          district_id: prev.district_id || data.group?.district_id || '',
          city: prev.city || data.group?.city || '',
        }));
      })
      .catch(() => {
        if (!cancelled) setGroup({ id: groupeId, name: t(language, 'groups') });
      });
    return () => {
      cancelled = true;
    };
  }, [groupeId, language]);

  /**
   * Mode modification : l'assistant reprend l'annonce telle qu'elle est publiee.
   * Le vendeur ne ressaisit rien, il corrige seulement ce qui a change. Le
   * quartier pre-rempli sert au recapitulatif et n'est jamais envoye (le serveur
   * garde celui de l'annonce).
   */
  useEffect(() => {
    if (!editId) return undefined;
    let cancelled = false;
    setLoadingAd(true);
    api
      .get(`/ads/${editId}`)
      .then((data) => {
        if (cancelled) return;
        // Ecran reserve au proprietaire (ou a un moderateur) : un autre compte
        // qui ouvre le lien est renvoye sur la fiche, sans pouvoir enregistrer.
        if (!data.permissions?.is_owner && !data.permissions?.can_moderate) {
          notify(t(language, 'error_generic'), { kind: 'error', voiceKey: 'error_generic' });
          navigate(`/ad/${editId}`, { replace: true });
          return;
        }
        setDraft((prev) => ({
          ...prev,
          ...draftFromAd(data.ad),
          district_id: data.ad.district_id || '',
          city: data.ad.city || '',
        }));
        setExistingAudio(
          data.ad.description_audio_key
            ? { key: data.ad.description_audio_key, seconds: data.ad.description_audio_seconds || 0 }
            : null,
        );
        setTextOpen(Boolean(data.ad.title || data.ad.description_text));
      })
      .catch((err) => {
        if (cancelled) return;
        notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
        navigate('/my-ads', { replace: true });
      })
      .finally(() => {
        if (!cancelled) setLoadingAd(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editId, language, navigate, notify]);

  const publish = async () => {
    if (!draft.category_id) {
      setStep(SELL_STEPS.indexOf('category'));
      return;
    }
    setPublishing(true);
    try {
      if (!isOnline()) {
        const offline = new Error('offline');
        offline.code = 'offline';
        throw offline;
      }

      const uploadedPhotos = [];
      for (const photo of draft.photos) {
        // eslint-disable-next-line no-await-in-loop
        const compressed = photo.blob || (await compressImage(photo.file || photo));
        const form = new FormData();
        form.append('photo', compressed, photo.name || 'photo.webp');
        // eslint-disable-next-line no-await-in-loop
        const result = await api.upload('/media/photo', form);
        uploadedPhotos.push({ storage_key: result.key, thumb_key: result.thumb_key, size_bytes: result.size_bytes });
      }

      let audio = null;
      if (draft.audio?.blob) {
        const form = new FormData();
        form.append('audio', draft.audio.blob, 'voice.webm');
        form.append('seconds', String(draft.audio.seconds));
        audio = await api.upload('/media/audio', form);
      }

      const result = await api.post('/ads', {
        category_id: draft.category_id,
        kind: draft.kind,
        group_id: draft.group_id || null,
        title: draft.title || null,
        description_text: draft.description_text || null,
        description_audio_key: audio?.key || null,
        description_audio_seconds: draft.audio?.seconds || null,
        description_transcript: audio?.transcript || null,
        price_amount: draft.price_amount === '' ? null : Number(draft.price_amount),
        district_id: draft.district_id || null,
        city: draft.city || null,
        client_uuid: draft.client_uuid,
        photos: uploadedPhotos,
      });
      announce('ad_published');
      navigate(`/ad/${result.ad.id}`, { replace: true });
    } catch (err) {
      if (err.code === 'offline' || err.name === 'OfflineError') {
        // Publication differee : tout est conserve dans IndexedDB
        await enqueueDraft({
          fields: {
            title: draft.title || null,
            description_text: draft.description_text || null,
            price_amount: draft.price_amount === '' ? null : Number(draft.price_amount),
            district_id: draft.district_id || null,
            city: draft.city || null,
            group_id: draft.group_id || null,
          },
          category_id: draft.category_id,
          kind: draft.kind,
          photos: draft.photos,
          audio: draft.audio,
        });
        announce('ad_saved_offline');
        await sync({ silent: true });
        navigate('/my-ads', { replace: true });
      } else {
        notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
      }
    } finally {
      setPublishing(false);
    }
  };

  /**
   * Enregistrement des corrections (mode modification).
   * Les photos deja publiees repartent telles quelles : seules les nouvelles sont
   * televersees. Hors ligne, on previent au lieu de perdre la saisie (la file
   * d'attente ne gere que les publications, pas les corrections).
   */
  const saveEdit = async () => {
    if (!draft.category_id) {
      setStep(SELL_STEPS.indexOf('category'));
      return;
    }
    if (!isOnline()) {
      notify(t(language, 'error_offline'), { kind: 'error', voiceKey: 'error_offline' });
      return;
    }
    setPublishing(true);
    try {
      const { fresh } = splitPhotos(draft.photos);
      const uploadedPhotos = [];
      for (const photo of fresh) {
        // eslint-disable-next-line no-await-in-loop
        const compressed = photo.blob || (await compressImage(photo.file || photo));
        const form = new FormData();
        form.append('photo', compressed, photo.name || 'photo.webp');
        // eslint-disable-next-line no-await-in-loop
        const result = await api.upload('/media/photo', form);
        uploadedPhotos.push({ storage_key: result.key, thumb_key: result.thumb_key, size_bytes: result.size_bytes });
      }

      let audio = null;
      if (draft.audio?.blob) {
        const form = new FormData();
        form.append('audio', draft.audio.blob, 'voice.webm');
        form.append('seconds', String(draft.audio.seconds));
        audio = await api.upload('/media/audio', form);
      }

      const result = await api.patch(`/ads/${editId}`, editPayload(draft, { photos: uploadedPhotos, audio }));
      notify(t(language, 'edit_saved'), { kind: 'success', voiceKey: result.voiceKey || 'ad_updated' });
      navigate(`/ad/${editId}`, { replace: true });
    } catch (err) {
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="screen">
      <TopBar
        title={editId ? t(language, 'edit_ad') : group ? group.name : t(language, 'sell')}
        subtitle={`${position.number}/${position.total}`}
        onBack={back}
        right={
          <IconButton
            icon="🔊"
            label={t(language, 'listen')}
            color="onDark"
            onClick={() => announce(editId ? 'ad_updated' : 'ad_published')}
          />
        }
      />
      <div className="progress">
        {SELL_STEPS.map((name, index) => (
          <span key={name} className={index <= step ? 'progress__dot progress__dot--done' : 'progress__dot'} />
        ))}
      </div>
      {group ? <p className="wizard__hint">👥 {group.name}</p> : null}
      {loadingAd ? <Spinner /> : null}
      {!loadingAd ? renderFirstSteps() : null}
      {!loadingAd ? renderLastSteps() : null}
    </div>
  );

  /** Etapes 1 a 3 : photos, description vocale, prix. */
  function renderFirstSteps() {
    if (current === 'photos') {
      return (
        <section className="wizard">
          <h2 className="wizard__title">📷 {t(language, 'add_photos')}</h2>
          <PhotoPicker
            photos={draft.photos}
            onChange={(photos) => update({ photos })}
            onDone={next}
            max={meta.features?.maxPhotos || 6}
          />
          <BigButton icon="➡️" label={t(language, 'apply')} color="green" size="large" onClick={next} />
        </section>
      );
    }

    if (current === 'description') {
      const hasText = Boolean(draft.title.trim() || draft.description_text.trim());
      // En modification, la voix deja publiee compte : le vendeur ne doit pas
      // croire qu'il a perdu son message parce qu'il n'enregistre rien de neuf.
      const hasDescription = Boolean(draft.audio || existingAudio || hasText);
      return (
        <section className="wizard">
          <h2 className="wizard__title">🎙️ {t(language, 'speak')}</h2>
          {/*
            La voix n'est jamais obligatoire : le bouton de validation reste
            actif meme sans enregistrement (l'annonce vit par ses photos).
          */}
          <VoiceRecorder
            onRecorded={(audio) => update({ audio })}
            onCancel={() => update({ audio: null })}
            hint={t(language, 'voice_optional')}
          />
          {draft.audio ? (
            <AudioPlayButton blob={draft.audio.blob} seconds={draft.audio.seconds} color="green" />
          ) : existingAudio ? (
            <AudioPlayButton storageKey={existingAudio.key} seconds={existingAudio.seconds} color="green" />
          ) : null}
          {/*
            Titre et description ne s'affichent qu'apres un appui explicite :
            l'ancien <details> stylise en `display:flex` gardait les champs
            ouverts en permanence, ce qui submergeait les vendeurs non lecteurs.
          */}
          {textOpen ? (
            <div className="wizard__optional">
              <input
                className="input"
                type="text"
                maxLength={120}
                value={draft.title}
                onChange={(event) => update({ title: event.target.value })}
                placeholder={t(language, 'title_optional')}
              />
              <textarea
                className="input input--area"
                rows={3}
                value={draft.description_text}
                onChange={(event) => update({ description_text: event.target.value })}
                placeholder={t(language, 'description')}
              />
              <BigButton icon="✅" label={t(language, 'hide_text')} color="grey" onClick={() => setTextOpen(false)} />
            </div>
          ) : (
            <BigButton
              icon="✍️"
              label={hasText ? t(language, 'title_optional') : t(language, 'write_text')}
              color="grey"
              onClick={() => setTextOpen(true)}
            />
          )}
          <BigButton
            icon="➡️"
            label={hasDescription ? t(language, 'apply') : t(language, 'skip')}
            color="green"
            size="large"
            disabled={!canContinue()}
            onClick={next}
          />
        </section>
      );
    }

    if (current === 'price') {
      return (
        <section className="wizard">
          <h2 className="wizard__title">💰 {t(language, 'price')}</h2>
          <NumericKeypad
            value={draft.price_amount}
            onChange={(value) => update({ price_amount: value })}
            onConfirm={() => {
              announce('price_saved');
              next();
            }}
          />
        </section>
      );
    }

    return null;
  }

  /** Etapes 4 a 6 : categorie, type d'annonce, recapitulatif et publication. */
  function renderLastSteps() {
    if (current === 'category') {
      const categories = meta.categories || [];
      return (
        <section className="wizard">
          <h2 className="wizard__title">🧺 {t(language, 'category')}</h2>

          {categories.length ? (
            // Choix explicite : la vignette selectionnee est confirmee visuellement,
            // puis l'utilisateur appuie sur "Valider" (aucun blocage possible).
            <CategoryGrid
              categories={categories}
              value={draft.category_id}
              onChange={(categoryId) => update({ category_id: categoryId })}
            />
          ) : (
            // Sans referentiel (premier lancement hors ligne), on propose de reessayer
            // au lieu de laisser l'utilisateur bloque sur une grille vide.
            <>
              <p className="wizard__hint">{t(language, 'error_offline')}</p>
              <BigButton
                icon="🔄"
                label={t(language, 'sync_now')}
                color="blue"
                size="large"
                onClick={() => loadMeta()}
              />
            </>
          )}

          <BigButton
            icon="✅"
            label={t(language, 'apply')}
            color="green"
            size="large"
            disabled={!canContinue()}
            onClick={next}
          />
        </section>
      );
    }

    if (current === 'summary') {
      const category = meta.categories.find((item) => item.id === draft.category_id);
      const district = meta.districts.find((item) => item.id === draft.district_id);
      // Le lieu n'est jamais demande : on ne l'affiche que s'il vient du profil
      // ou du groupe (aucune ligne "—" dans le recapitulatif).
      const locationLabel = district ? districtLabel(district, language) : draft.city || '';
      return (
        <section className="wizard">
          <h2 className="wizard__title">🧾 {t(language, 'summary')}</h2>
          <div className="summary">
            <div className="summary__photos">
              {draft.photos.map((photo, index) => (
                <img key={`${photo.name}-${index}`} src={photo.previewUrl || mediaUrl(photo.storage_key)} alt="" />
              ))}
              {!draft.photos.length ? <div className="summary__empty">📷</div> : null}
            </div>
            <ul className="summary__list">
              <li>
                <span>{category?.icon || '🧺'}</span>
                <strong>{category?.label_fr || '—'}</strong>
              </li>
              <li>
                <span>💰</span>
                <strong>{draft.price_amount === '' ? '—' : draft.price_amount}</strong>
              </li>
              {locationLabel ? (
                <li>
                  <span>📍</span>
                  <strong>{locationLabel}</strong>
                </li>
              ) : null}
              {group ? (
                <li>
                  <span>👥</span>
                  <strong>{group.name}</strong>
                </li>
              ) : null}
            </ul>
            {draft.audio ? (
              <AudioPlayButton
                blob={draft.audio.blob}
                seconds={draft.audio.seconds}
                label={t(language, 'replay')}
                color="blue"
              />
            ) : existingAudio ? (
              <AudioPlayButton
                storageKey={existingAudio.key}
                seconds={existingAudio.seconds}
                label={t(language, 'replay')}
                color="blue"
              />
            ) : null}
          </div>
          {publishing ? (
            <Spinner />
          ) : (
            <BigButton
              icon={editId ? '💾' : '📣'}
              label={editId ? t(language, 'save') : t(language, 'publish')}
              color="green"
              size="large"
              onClick={editId ? saveEdit : publish}
            />
          )}
          {!isOnline() ? (
            <p className="wizard__hint">{t(language, editId ? 'error_offline' : 'offline_banner')}</p>
          ) : null}
        </section>
      );
    }

    return null;
  }
}
