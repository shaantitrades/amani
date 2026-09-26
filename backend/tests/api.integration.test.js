import './helpers/bootstrap.js';
import { RUN_DB_TESTS } from './helpers/bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { one, query, closePool } from '../src/lib/db.js';
import { runMigrations } from '../src/db/migrate.js';

/**
 * Test de bout en bout de l'API (necessite PostgreSQL).
 *
 * Lancement :
 *   $env:RUN_DB_TESTS=1; npm test
 * (DATABASE_URL doit pointer vers une base ou les migrations sont autorisees)
 *
 * Couverture : inscription par SMS -> publication d'annonce (photo + vocal) ->
 * fil d'annonces -> detail -> blocage utilisateur (disparition des annonces) ->
 * signalement -> moderation -> bannissement plateforme.
 */
test('parcours complet Bodogui', { skip: !RUN_DB_TESTS ? 'RUN_DB_TESTS=1 requis (PostgreSQL)' : false }, async (t) => {
  await runMigrations();

  // ---- Fixtures ------------------------------------------------------------
  const suffix = Date.now().toString().slice(-6);
  /** Numero local tchadien valide (8 chiffres) unique pour ce test. */
  const localPhone = (i) => `66${suffix.slice(-5)}${i}`;
  const category = await one(
    `INSERT INTO categories (code, label_fr, icon, color, sort_order)
     VALUES ($1, 'Animaux test', '🐄', '#128C7E', 1)
     ON CONFLICT (code) DO UPDATE SET label_fr = EXCLUDED.label_fr RETURNING *`,
    [`test-animaux-${suffix}`],
  );
  const district = await one(
    `INSERT INTO districts (name, city) VALUES ($1, 'Ville test')
     ON CONFLICT (city, name) DO UPDATE SET radius_km = EXCLUDED.radius_km RETURNING *`,
    [`Quartier test ${suffix}`],
  );

  const app = createApp();
  const server = app.listen(0);
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const createdPhones = [];

  const api = async (path, { method = 'GET', body, token, raw } = {}) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload;
    if (raw) {
      payload = raw;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${base}${path}`, { method, headers, body: payload });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { status: res.status, body: json };
  };

  const login = async (phone) => {
    createdPhones.push(`+235${phone}`); // nettoyage en fin de test (format E.164)
    const requested = await api('/api/v1/auth/request-code', { method: 'POST', body: { phone } });
    assert.equal(requested.status, 200, 'demande de code');
    assert.ok(requested.body.devCode, 'code de developpement renvoye');
    const verified = await api('/api/v1/auth/verify', {
      method: 'POST',
      body: { phone, code: requested.body.devCode },
    });
    assert.equal(verified.status, 200, 'verification du code');
    return { user: verified.body.user, token: verified.body.tokens.accessToken, refresh: verified.body.tokens.refreshToken };
  };

  t.after(async () => {
    // Nettoyage complet des fixtures du test (comptes, annonces, medias en base)
    await query('DELETE FROM users WHERE phone = ANY($1::text[])', [createdPhones]).catch(() => {});
    await query('DELETE FROM districts WHERE id = $1', [district.id]).catch(() => {});
    await query('DELETE FROM categories WHERE id = $1', [category.id]).catch(() => {});
    server.close();
    await closePool();
  });

  // ---- Sante ---------------------------------------------------------------
  await t.test('GET /healthz repond ok', async () => {
    const res = await api('/healthz');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.checks.database, true);
  });

  // ---- Reference -----------------------------------------------------------
  await t.test('GET /api/v1/bootstrap renvoie categories et quartiers', async () => {
    const res = await api('/api/v1/bootstrap');
    assert.equal(res.status, 200);
    assert.ok(res.body.categories.some((c) => c.id === category.id));
    assert.ok(res.body.districts.some((d) => d.id === district.id));
    assert.equal(res.body.features.maxPhotos, 6);
    assert.equal(res.body.features.maxAudioSeconds, 60);
    assert.ok(res.body.languages.length >= 4);
  });

  // ---- Inscription par SMS -------------------------------------------------
  let seller;
  let buyer;
  let third;

  await t.test('inscription : numero invalide refuse, numero valide cree le compte', async () => {
    const bad = await api('/api/v1/auth/request-code', { method: 'POST', body: { phone: '123' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.voiceKey, 'error_phone_invalid');

    seller = await login(localPhone(1));
    assert.ok(seller.user.phone.startsWith('+235'));
    assert.equal(seller.user.phone_verified, true);
    buyer = await login(localPhone(2));
    third = await login(localPhone(3));
  });

  await t.test('le code OTP est a usage unique', async () => {
    const phone = localPhone(4);
    const requested = await api('/api/v1/auth/request-code', { method: 'POST', body: { phone } });
    createdPhones.push(`+235${phone}`);
    const ok = await api('/api/v1/auth/verify', { method: 'POST', body: { phone, code: requested.body.devCode } });
    assert.equal(ok.status, 200);
    const replay = await api('/api/v1/auth/verify', { method: 'POST', body: { phone, code: requested.body.devCode } });
    assert.equal(replay.status, 400);
    assert.equal(replay.body.error.code, 'code_expired');
  });

  await t.test('profil modifiable (nom, langue, quartier, notifications)', async () => {
    const res = await api('/api/v1/me', {
      method: 'PATCH',
      token: seller.token,
      body: { name: 'Vendeur Test', language: 'ar', district_id: district.id, notify_sms: true },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.name, 'Vendeur Test');
    assert.equal(res.body.user.language, 'ar');
    assert.equal(res.body.user.district_id, district.id);

    const bad = await api('/api/v1/me', { method: 'PATCH', token: seller.token, body: { language: 'zz' } });
    assert.equal(bad.status, 400);
  });

  await t.test('quartier du profil : facultatif et effacable', async () => {
    // L'ecran "Mon compte" laisse choisir son quartier une seule fois, puis
    // l'assistant de publication le reprend. Comme le choix est facultatif, il doit
    // aussi etre reversible : `district_id: null` est ignore par le COALESCE, d'ou
    // le drapeau `clear_district`.
    const noop = await api('/api/v1/me', { method: 'PATCH', token: seller.token, body: { district_id: null } });
    assert.equal(noop.body.user.district_id, district.id, 'null ne suffit pas : utiliser clear_district');

    const cleared = await api('/api/v1/me', { method: 'PATCH', token: seller.token, body: { clear_district: true } });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.user.district_id, null);

    const me = await api('/api/v1/me', { token: seller.token });
    assert.equal(me.body.user.district_id, null);
    assert.equal(me.body.user.district_name, null);

    // On remet le quartier : les tests suivants publient dans ce quartier.
    const restored = await api('/api/v1/me', {
      method: 'PATCH',
      token: seller.token,
      body: { district_id: district.id },
    });
    assert.equal(restored.body.user.district_id, district.id);
  });

  // ---- Publication d'annonce (photos + vocal + prix + localisation) --------
  let adId;
  const clientUuid = globalThis.crypto.randomUUID();

  await t.test('upload photo : recompressee en WebP + vignette', async () => {
    const { default: sharp } = await import('sharp');
    const png = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#25D366' } })
      .png()
      .toBuffer();

    const form = new FormData();
    form.append('photo', new Blob([png], { type: 'image/png' }), 'vache.png');
    const res = await fetch(`${base}/api/v1/media/photo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${seller.token}` },
      body: form,
    });
    const body = await res.json();
    assert.equal(res.status, 201, JSON.stringify(body));
    assert.match(body.key, /^photos\//);
    assert.ok(body.thumb_key);
    assert.equal(body.optimized, true);
    assert.ok(body.width <= 1080, 'largeur limitee a 1080 px');
    assert.equal(body.voiceKey, 'photo_added');
    seller.photoKey = body.key;
    seller.thumbKey = body.thumb_key;
  });

  await t.test('upload du message vocal (conteneur Ogg) et rejet des formats inconnus', async () => {
    const ogg = Buffer.concat([Buffer.from('OggS', 'ascii'), Buffer.alloc(4096, 1)]);
    const form = new FormData();
    form.append('audio', new Blob([ogg], { type: 'audio/ogg' }), 'voix.ogg');
    form.append('seconds', '12');
    const res = await fetch(`${base}/api/v1/media/audio`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${seller.token}` },
      body: form,
    });
    const body = await res.json();
    assert.equal(res.status, 201, JSON.stringify(body));
    assert.match(body.key, /^audio\/ads\//);
    assert.equal(body.seconds, 12);
    assert.equal(body.mime, 'audio/ogg');
    seller.audioKey = body.key;

    const badForm = new FormData();
    badForm.append('audio', new Blob([Buffer.from('ceci nest pas de l audio', 'ascii')], { type: 'audio/ogg' }), 'bad.ogg');
    const rejected = await fetch(`${base}/api/v1/media/audio`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${seller.token}` },
      body: badForm,
    });
    assert.equal(rejected.status, 400);
  });

  await t.test('les medias sont servis par le proxy /media avec cache long', async () => {
    const res = await fetch(`${base}/media/${seller.photoKey}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/webp');
    assert.match(res.headers.get('cache-control'), /immutable/);
  });

  await t.test('publication complete, idempotente via client_uuid (hors ligne)', async () => {
    const payload = {
      category_id: category.id,
      kind: 'sell',
      district_id: district.id,
      city: 'Ville test',
      title: 'Vache laitiere test',
      description_audio_key: seller.audioKey,
      description_audio_seconds: 12,
      price_amount: 250000,
      currency: 'XAF',
      photos: [
        { storage_key: seller.photoKey, thumb_key: seller.thumbKey, width: 1080, height: 810, size_bytes: 90000 },
      ],
      client_uuid: clientUuid,
    };
    const res = await api('/api/v1/ads', { method: 'POST', token: seller.token, body: payload });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.voiceKey, 'ad_published');
    assert.equal(res.body.duplicate, false);
    assert.equal(res.body.ad.price_amount, 250000);
    assert.equal(res.body.ad.photos.length, 1);
    assert.ok(res.body.ad.published_at, 'annonce publiee immediatement');
    adId = res.body.ad.id;

    const again = await api('/api/v1/ads', { method: 'POST', token: seller.token, body: payload });
    assert.equal(again.status, 201);
    assert.equal(again.body.duplicate, true, 'la republication hors ligne ne cree pas de doublon');
    assert.equal(again.body.ad.id, adId);
  });

  await t.test('annonce publiee sans description ni titre (voix facultative)', async () => {
    // Regression : l'API refusait toute annonce sans voix ni texte, alors que
    // la description vocale doit rester facultative (photos + categorie + quartier).
    const res = await api('/api/v1/ads', {
      method: 'POST',
      token: seller.token,
      body: {
        category_id: category.id,
        district_id: district.id,
        description_audio_key: null,
        photos: [],
        client_uuid: crypto.randomUUID(),
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.ad.description_audio_key, null);
    assert.equal(res.body.ad.description_text, null);
    assert.equal(res.body.ad.title, null);
  });

  await t.test('annonce publiee sans quartier (vendeur hors referentiel)', async () => {
    // Regression : le quartier etait exige par l'assistant de publication, ce qui
    // bloquait les bergers et les vendeurs des zones rurales ou desertiques du
    // Tchad, absentes du referentiel des quartiers. L'annonce doit etre acceptee
    // sans quartier, rester visible dans le fil general et sortir des filtres par
    // quartier (on ne ment pas sur une localisation inconnue).
    const res = await api('/api/v1/ads', {
      method: 'POST',
      token: seller.token,
      body: {
        category_id: category.id,
        kind: 'sell',
        title: 'Chevreau sans quartier',
        district_id: null,
        photos: [],
        client_uuid: crypto.randomUUID(),
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.ad.district_id, null);
    assert.equal(res.body.ad.district_name, null);

    const general = await api('/api/v1/ads?limit=50');
    assert.ok(
      general.body.items.some((a) => a.id === res.body.ad.id),
      'annonce sans quartier visible dans le fil general',
    );

    const filtered = await api(`/api/v1/ads?district_id=${district.id}&limit=50`);
    assert.equal(
      filtered.body.items.some((a) => a.id === res.body.ad.id),
      false,
      'annonce sans quartier absente du fil filtre par quartier',
    );

    // Le fil d'accueil, lui, garde les annonces sans quartier : sinon un profil
    // avec quartier ne verrait presque rien (la majorite des vendeurs n'en ont pas).
    const withUnknown = await api(`/api/v1/ads?district_id=${district.id}&include_unknown=true&limit=50`);
    assert.ok(
      withUnknown.body.items.some((a) => a.id === res.body.ad.id),
      'include_unknown ramene les annonces sans quartier',
    );
    assert.ok(
      withUnknown.body.items.some((a) => a.id === adId),
      'include_unknown conserve les annonces du quartier',
    );
  });

  // ---- Recherche, contact, messages ---------------------------------------
  await t.test('le fil expose l\'annonce, le detail donne acces au contact direct', async () => {
    const feed = await api(`/api/v1/ads?district_id=${district.id}&limit=10`);
    assert.equal(feed.status, 200);
    const item = feed.body.items.find((a) => a.id === adId);
    assert.ok(item, 'annonce presente dans le fil');
    assert.equal(item.category_icon, '🐄');
    assert.equal(item.owner_phone, seller.user.phone, 'numero visible (pas de masquage)');

    const detail = await api(`/api/v1/ads/${adId}`, { token: buyer.token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.permissions.can_call, true);
    assert.equal(detail.body.permissions.can_message, true);
    assert.equal(detail.body.permissions.is_owner, false);
    assert.equal(detail.body.safetyVoiceKey, 'safety_warning');

    const mine = await api(`/api/v1/ads/${adId}`, { token: seller.token });
    assert.equal(mine.body.permissions.is_owner, true);
    assert.equal(mine.body.permissions.can_message, false);

    const contact = await api(`/api/v1/ads/${adId}/contact`, { token: buyer.token });
    assert.equal(contact.status, 200);
    assert.equal(contact.body.phone, seller.user.phone);
    assert.match(contact.body.tel_link, /^tel:/);
    // La discussion reste dans Bodogui : plus aucun lien vers une application
    // externe (WhatsApp) dans le contact d'une annonce.
    assert.equal(contact.body.whatsapp_link, undefined);
  });

  await t.test('recherche texte + filtres par prix, categorie, quartier', async () => {
    const res = await api(`/api/v1/search?q=vache&category_id=${category.id}&min_price=1000&max_price=300000`);
    assert.equal(res.status, 200);
    assert.ok(res.body.items.some((a) => a.id === adId));

    const none = await api('/api/v1/search?q=produit-inexistant-xyz');
    assert.equal(none.body.items.length, 0);
    assert.equal(none.body.voiceKey, 'nothing_found');
    assert.ok(none.body.suggestions.length > 0, 'suggestions de categories quand aucun resultat');

    const tooExpensive = await api(`/api/v1/search?category_id=${category.id}&min_price=999999999`);
    assert.equal(tooExpensive.body.items.length, 0);
  });

  await t.test('message vocal envoye au vendeur et notification mise en file', async () => {
    const res = await api('/api/v1/messages', {
      method: 'POST',
      token: buyer.token,
      body: {
        recipient_id: seller.user.id,
        ad_id: adId,
        kind: 'voice',
        audio_key: 'audio/messages/demo.ogg',
        audio_seconds: 8,
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.voiceKey, 'interest_sent');

    const threads = await api('/api/v1/messages/threads', { token: seller.token });
    assert.equal(threads.status, 200);
    assert.equal(threads.body.items.length, 1);
    assert.equal(threads.body.items[0].unread, 1);
    assert.equal(threads.body.items[0].other_id, buyer.user.id);

    const queued = await one(
      `SELECT channel, status FROM notifications WHERE user_id = $1 AND kind = 'new_message'
       ORDER BY created_at DESC LIMIT 1`,
      [seller.user.id],
    );
    assert.ok(queued, 'notification creee pour le vendeur');
  });

  await t.test('discussion dans l application : compte obligatoire, texte et vocal', async () => {
    // Un visiteur venu d'un lien partage n'a pas de compte : impossible
    // d'ecrire au vendeur avant de s'inscrire (le client le conduit a /login).
    const anonymous = await api('/api/v1/messages', {
      method: 'POST',
      body: { recipient_id: seller.user.id, ad_id: adId, kind: 'text', body: 'Bonjour' },
    });
    assert.equal(anonymous.status, 401);

    // Avec un compte, la conversation se tient dans l'application : texte
    // comme vocal, sans jamais ouvrir une application externe.
    const text = await api('/api/v1/messages', {
      method: 'POST',
      token: buyer.token,
      body: {
        recipient_id: seller.user.id,
        ad_id: adId,
        kind: 'text',
        body: 'Bonjour, votre annonce m interesse. Est-elle toujours disponible ?',
      },
    });
    assert.equal(text.status, 201, JSON.stringify(text.body));
    assert.equal(text.body.message.kind, 'text');
    assert.equal(text.body.message.ad_id, adId);

    const emptyBody = await api('/api/v1/messages', {
      method: 'POST',
      token: buyer.token,
      body: { recipient_id: seller.user.id, kind: 'text', body: '' },
    });
    assert.equal(emptyBody.status, 400, 'message texte vide refuse');

    const selfMessage = await api('/api/v1/messages', {
      method: 'POST',
      token: buyer.token,
      body: { recipient_id: buyer.user.id, kind: 'text', body: 'moi-meme' },
    });
    assert.equal(selfMessage.status, 400, 'impossible de s ecrire a soi-meme');

    // Le vendeur ouvre la conversation (comme WhatsApp) et repond.
    const thread = await api(`/api/v1/messages/${buyer.user.id}`, { token: seller.token });
    assert.equal(thread.status, 200);
    assert.ok(
      thread.body.items.some((m) => m.body === 'Bonjour, votre annonce m interesse. Est-elle toujours disponible ?'),
      'le texte de l acheteur est visible dans le fil',
    );

    const reply = await api('/api/v1/messages', {
      method: 'POST',
      token: seller.token,
      body: { recipient_id: buyer.user.id, ad_id: adId, kind: 'text', body: 'Oui, elle est disponible.' },
    });
    assert.equal(reply.status, 201, JSON.stringify(reply.body));

    const buyerThreads = await api('/api/v1/messages/threads', { token: buyer.token });
    assert.equal(buyerThreads.status, 200);
    assert.equal(buyerThreads.body.items.length, 1, 'une seule conversation entre les deux comptes');
    assert.equal(buyerThreads.body.items[0].other_id, seller.user.id);
    assert.equal(buyerThreads.body.items[0].unread, 1, 'la reponse du vendeur est non lue');
  });

  // ---- Ecran "Notifications" de la barre du bas ---------------------------
  await t.test('l ecran Notifications liste les alertes du compte, et reste prive', async () => {
    const res = await api('/api/v1/me/notifications?limit=10', { token: seller.token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(Array.isArray(res.body.items));
    assert.ok(res.body.items.length >= 1, 'au moins une alerte apres un message vocal');
    const [first] = res.body.items;
    assert.ok(first.id && first.created_at, 'champs attendus par l ecran');
    assert.ok(['sms', 'push', 'voice'].includes(first.channel));
    assert.ok(['queued', 'sent', 'failed', 'skipped'].includes(first.status));

    // Sans jeton, la liste des alertes reste privee
    const anonymous = await api('/api/v1/me/notifications');
    assert.equal(anonymous.status, 401);
  });

  // ---- Blocage utilisateur (fonctionnalite cle du MVP) --------------------
  await t.test('le blocage masque les annonces dans les deux sens, le deblocage les restaure', async () => {
    const before = await api(`/api/v1/ads?district_id=${district.id}`, { token: third.token });
    assert.ok(before.body.items.some((a) => a.id === adId));

    const blocked = await api('/api/v1/blocks', {
      method: 'POST',
      token: third.token,
      body: { user_id: seller.user.id, reason: 'Test blocage' },
    });
    assert.equal(blocked.status, 201);
    assert.equal(blocked.body.voiceKey, 'blocked');

    const after = await api(`/api/v1/ads?district_id=${district.id}`, { token: third.token });
    assert.ok(!after.body.items.some((a) => a.id === adId), 'annonce masquee apres blocage');

    const detail = await api(`/api/v1/ads/${adId}`, { token: third.token });
    assert.equal(detail.status, 403);
    assert.equal(detail.body.error.voiceKey, 'error_blocked_target');

    const list = await api('/api/v1/me/blocked', { token: third.token });
    assert.equal(list.body.items.length, 1);
    assert.equal(list.body.items[0].id, seller.user.id);

    // Symetrie : le vendeur ne voit plus non plus le profil de son bloqueur
    const profile = await api(`/api/v1/users/${third.user.id}`, { token: seller.token });
    assert.equal(profile.status, 403);

    const unblocked = await api(`/api/v1/blocks/${seller.user.id}`, { method: 'DELETE', token: third.token });
    assert.equal(unblocked.status, 200);
    const restored = await api(`/api/v1/ads?district_id=${district.id}`, { token: third.token });
    assert.ok(
      restored.body.items.some((a) => a.id === adId),
      `annonce visible apres deblocage (items=${restored.body.items.length}, deblocage=${unblocked.status})`,
    );
  });

  await t.test('signalement d\'annonce : blocage propose et compteur de moderation', async () => {
    const res = await api('/api/v1/reports', {
      method: 'POST',
      token: buyer.token,
      body: { target_type: 'ad', target_id: adId, reason_code: 'scam', comment: 'Prix suspect', block_user: true },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.blocked, true);
    assert.equal(res.body.voiceKey, 'reported_and_blocked');

    const ad = await one('SELECT reports_count FROM ads WHERE id = $1', [adId]);
    assert.equal(ad.reports_count, 1, 'compteur de signalements mis a jour');

    const hidden = await api(`/api/v1/ads/${adId}`, { token: buyer.token });
    assert.equal(hidden.status, 403);
  });

  await t.test('moderation : bannissement par un administrateur, connexion refusee', async () => {
    await query('UPDATE users SET is_admin = true WHERE id = $1', [seller.user.id]);
    const refreshed = await api('/api/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken: seller.refresh },
    });
    assert.equal(refreshed.status, 200);
    const adminToken = refreshed.body.tokens.accessToken;

    const overview = await api('/api/v1/admin/overview', { token: adminToken });
    assert.equal(overview.status, 200);
    // Le jeu de donnees de demonstration contient deja un signalement : >= 1
    assert.ok(overview.body.reports.length >= 1, 'signalements visibles par la moderation');

    const banned = await api(`/api/v1/admin/users/${third.user.id}/ban`, {
      method: 'POST',
      token: adminToken,
      body: { reason: 'Arnaque repetee', days: 7 },
    });
    assert.equal(banned.status, 200);
    assert.equal(banned.body.voiceKey, 'account_banned');

    const request = await api('/api/v1/auth/request-code', { method: 'POST', body: { phone: localPhone(3) } });
    const retry = await api('/api/v1/auth/verify', {
      method: 'POST',
      body: { phone: localPhone(3), code: request.body.devCode },
    });
    assert.equal(retry.status, 403);
    assert.equal(retry.body.error.voiceKey, 'account_banned');

    const denied = await api('/api/v1/me', { token: third.token });
    assert.equal(denied.status, 403);

    const unbanned = await api(`/api/v1/admin/users/${third.user.id}/unban`, {
      method: 'POST',
      token: adminToken,
    });
    assert.equal(unbanned.status, 200);
  });

  await t.test('modification de l\'annonce : proprietaire seulement, photos remplacees', async () => {
    // Bouton "Modifier" de la fiche annonce : le vendeur corrige son prix, sa
    // categorie ou ses photos sans republier (aucun doublon, statut inchange).
    const forbiddenUpdate = await api(`/api/v1/ads/${adId}`, {
      method: 'PATCH',
      token: buyer.token,
      body: { price_amount: 1 },
    });
    assert.equal(forbiddenUpdate.status, 403, JSON.stringify(forbiddenUpdate.body));
    assert.equal(forbiddenUpdate.body.error.code, 'not_ad_owner');

    // Base neuve : aucune autre categorie n'existe, on en cree une pour verifier
    // que la correction de la categorie est bien prise en compte.
    const other = await one(
      `INSERT INTO categories (code, label_fr, icon, color, sort_order)
       VALUES ($1, 'Animaux test bis', '🐐', '#128C7E', 2)
       ON CONFLICT (code) DO UPDATE SET label_fr = EXCLUDED.label_fr RETURNING *`,
      [`test-animaux-bis-${suffix}`],
    );
    const updated = await api(`/api/v1/ads/${adId}`, {
      method: 'PATCH',
      token: seller.token,
      body: { price_amount: 199000, title: 'Vache laitiere (prix baisse)', category_id: other.id },
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.voiceKey, 'ad_updated');
    assert.equal(updated.body.ad.price_amount, 199000);
    assert.equal(updated.body.ad.title, 'Vache laitiere (prix baisse)');
    assert.equal(updated.body.ad.category_id, other.id);
    assert.equal(updated.body.ad.status, 'published', 'une correction ne change pas le statut');
    assert.equal(updated.body.ad.photos.length, 1, 'les photos non touchees restent en place');

    // Corps vide : refus explicite plutot qu'une requete inutile en base
    const empty = await api(`/api/v1/ads/${adId}`, { method: 'PATCH', token: seller.token, body: {} });
    assert.equal(empty.status, 400, JSON.stringify(empty.body));
    assert.equal(empty.body.error.code, 'nothing_to_update');

    // Photos : la liste envoyee remplace la precedente (retrait puis remise)
    const cleared = await api(`/api/v1/ads/${adId}`, {
      method: 'PATCH',
      token: seller.token,
      body: { photos: [] },
    });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
    assert.equal(cleared.body.ad.photos.length, 0);
    assert.equal(cleared.body.ad.photos_count, 0);

    const restored = await api(`/api/v1/ads/${adId}`, {
      method: 'PATCH',
      token: seller.token,
      body: { photos: [{ storage_key: seller.photoKey, thumb_key: seller.thumbKey }] },
    });
    assert.equal(restored.body.ad.photos.length, 1);
    assert.equal(restored.body.ad.photos[0].storage_key, seller.photoKey);

    // La fiche sert la version corrigee, et le proprietaire reste identifie
    const detail = await api(`/api/v1/ads/${adId}`, { token: seller.token });
    assert.equal(detail.body.ad.price_amount, 199000);
    assert.equal(detail.body.permissions.is_owner, true);
  });

  await t.test('cycle de vie de l\'annonce : vendue puis supprimee', async () => {
    const sold = await api(`/api/v1/ads/${adId}/status`, {
      method: 'PATCH',
      token: seller.token,
      body: { status: 'sold' },
    });
    assert.equal(sold.status, 200);
    assert.equal(sold.body.voiceKey, 'ad_sold');
    assert.ok(sold.body.ad.sold_at);

    const del = await api(`/api/v1/ads/${adId}/status`, {
      method: 'PATCH',
      token: seller.token,
      body: { status: 'deleted' },
    });
    assert.equal(del.body.voiceKey, 'ad_deleted');

    const afterDelete = await api(`/api/v1/ads/${adId}`, { token: seller.token });
    assert.equal(afterDelete.status, 404);
  });

  await t.test('publication dans un groupe prive : visible pour les membres, invisible dans le fil public', async () => {
    // 1. Le vendeur cree un groupe prive
    const created = await api('/api/v1/groups', {
      method: 'POST',
      token: seller.token,
      body: {
        name: `Groupe prive test ${suffix}`,
        is_private: true,
        district_id: district.id,
        city: 'Ville test',
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const groupId = created.body.group.id;

    // 2. Il y publie une annonce (l'application transmet group_id depuis ?group=)
    const ad = await api('/api/v1/ads', {
      method: 'POST',
      token: seller.token,
      body: {
        category_id: category.id,
        kind: 'sell',
        district_id: district.id,
        city: 'Ville test',
        title: 'Annonce de groupe',
        description_text: 'Reservee aux membres du groupe',
        price_amount: 45000,
        group_id: groupId,
        client_uuid: globalThis.crypto.randomUUID(),
        photos: [],
      },
    });
    assert.equal(ad.status, 201, JSON.stringify(ad.body));
    assert.equal(ad.body.ad.group_id, groupId, "l'annonce est rattachee au groupe");

    // 3. Le fil du groupe l'affiche pour le membre
    const groupFeed = await api(`/api/v1/groups/${groupId}/ads`, { token: seller.token });
    assert.ok(groupFeed.body.items.some((a) => a.id === ad.body.ad.id), 'annonce presente dans le groupe');

    // 4. Un non-membre n'accede ni au groupe prive ni a l'annonce publique
    const denied = await api(`/api/v1/groups/${groupId}/ads`, { token: third.token });
    assert.equal(denied.status, 403);
    const publicFeed = await api(`/api/v1/ads?district_id=${district.id}&limit=50`);
    assert.ok(
      !publicFeed.body.items.some((a) => a.id === ad.body.ad.id),
      'annonce de groupe prive absente du fil public',
    );

    // 5. Apres avoir rejoint le groupe, l'annonce devient visible pour ce membre
    const joined = await api(`/api/v1/groups/${groupId}/join`, { method: 'POST', token: third.token });
    assert.equal(joined.status, 200);
    const asMember = await api(`/api/v1/ads?district_id=${district.id}&limit=50`, { token: third.token });
    assert.ok(
      asMember.body.items.some((a) => a.id === ad.body.ad.id),
      'membre du groupe : annonce visible',
    );

    // Nettoyage
    await api(`/api/v1/ads/${ad.body.ad.id}/status`, {
      method: 'PATCH',
      token: seller.token,
      body: { status: 'deleted' },
    });
    await query('DELETE FROM groups WHERE id = $1', [groupId]);
  });

  await t.test('discussion de groupe : texte et vocal, reservee aux membres', async () => {
    // Groupe public cree par le vendeur
    const created = await api('/api/v1/groups', {
      method: 'POST',
      token: seller.token,
      body: { name: `Discussion test ${suffix}`, is_private: false, city: 'Ville test' },
    });
    assert.equal(created.status, 201);
    const groupId = created.body.group.id;

    // Un membre rejoint
    const joined = await api(`/api/v1/groups/${groupId}/join`, { method: 'POST', token: third.token });
    assert.equal(joined.status, 200);

    // Message texte du vendeur
    const textMessage = await api(`/api/v1/groups/${groupId}/messages`, {
      method: 'POST',
      token: seller.token,
      body: { kind: 'text', body: 'Bonjour, je vends une vache a Moursal.' },
    });
    assert.equal(textMessage.status, 201, JSON.stringify(textMessage.body));
    assert.equal(textMessage.body.message.kind, 'text');

    // Message vocal du membre (multipart, conteneur Ogg)
    const ogg = Buffer.concat([Buffer.from('OggS', 'ascii'), Buffer.alloc(2048, 3)]);
    const form = new FormData();
    form.append('audio', new Blob([ogg], { type: 'audio/ogg' }), 'groupe.ogg');
    form.append('seconds', '7');
    const voiceResponse = await fetch(`${base}/api/v1/groups/${groupId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${third.token}` },
      body: form,
    });
    const voiceMessage = await voiceResponse.json();
    assert.equal(voiceResponse.status, 201, JSON.stringify(voiceMessage));
    assert.equal(voiceMessage.message.kind, 'voice');
    assert.match(voiceMessage.message.audio_key, /^audio\/groups\//);

    // Le fil de discussion expose les deux messages avec l'auteur
    const feed = await api(`/api/v1/groups/${groupId}/messages`, { token: seller.token });
    assert.equal(feed.status, 200);
    assert.equal(feed.body.items.length, 2);
    assert.equal(feed.body.items[0].kind, 'voice', 'les messages recents arrivent en premier');
    assert.ok(feed.body.items.some((m) => m.sender_name !== null));

    // Un non-membre ne peut ni lire ni ecrire
    const deniedRead = await api(`/api/v1/groups/${groupId}/messages`, { token: buyer.token });
    assert.equal(deniedRead.status, 403);
    const deniedWrite = await api(`/api/v1/groups/${groupId}/messages`, {
      method: 'POST',
      token: buyer.token,
      body: { kind: 'text', body: 'Je ne suis pas membre' },
    });
    assert.equal(deniedWrite.status, 403);

    // Le blocage masque les messages dans les deux sens
    await api('/api/v1/blocks', { method: 'POST', token: seller.token, body: { user_id: third.user.id } });
    const afterBlock = await api(`/api/v1/groups/${groupId}/messages`, { token: seller.token });
    assert.equal(afterBlock.body.items.length, 1, 'message du membre bloque masque');
    await api(`/api/v1/blocks/${third.user.id}`, { method: 'DELETE', token: seller.token });

    // Nettoyage
    await query('DELETE FROM groups WHERE id = $1', [groupId]);
  });

  await t.test('discussion de groupe : photo et document (composer type WhatsApp)', async () => {
    const created = await api('/api/v1/groups', {
      method: 'POST',
      token: seller.token,
      body: { name: `Medias test ${suffix}`, is_private: false, city: 'Ville test' },
    });
    assert.equal(created.status, 201);
    const groupId = created.body.group.id;

    // Photo reelle : recompressee en WebP + vignette, comme les annonces
    const { default: sharp } = await import('sharp');
    const png = await sharp({ create: { width: 900, height: 700, channels: 3, background: '#25D366' } })
      .png()
      .toBuffer();
    const photoForm = new FormData();
    photoForm.append('photo', new Blob([png], { type: 'image/png' }), 'produit.png');
    const photoRes = await fetch(`${base}/api/v1/groups/${groupId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${seller.token}` },
      body: photoForm,
    });
    const photoBody = await photoRes.json();
    assert.equal(photoRes.status, 201, JSON.stringify(photoBody));
    assert.equal(photoBody.message.kind, 'image');
    assert.match(photoBody.message.file_key, /^photos\/groups\//);
    assert.equal(photoBody.message.file_mime, 'image/webp');
    assert.ok(photoBody.message.thumb_key, 'une vignette est generee');
    assert.ok(photoBody.message.file_bytes < 102400, 'photo recompressee sous 100 Ko');

    // Document : facture PDF envoyee par un autre membre du groupe
    await api(`/api/v1/groups/${groupId}/join`, { method: 'POST', token: third.token });
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
    const fileForm = new FormData();
    fileForm.append('file', new Blob([pdf], { type: 'application/pdf' }), 'facture vache.pdf');
    const fileRes = await fetch(`${base}/api/v1/groups/${groupId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${third.token}` },
      body: fileForm,
    });
    const fileBody = await fileRes.json();
    assert.equal(fileRes.status, 201, JSON.stringify(fileBody));
    assert.equal(fileBody.message.kind, 'file');
    assert.equal(fileBody.message.file_name, 'facture vache.pdf');
    assert.equal(fileBody.message.file_mime, 'application/pdf');
    assert.match(fileBody.message.file_key, /^files\/groups\//);

    // Type de fichier refuse (aucun executable accepte)
    const badForm = new FormData();
    badForm.append('file', new Blob([Buffer.from('MZ')], { type: 'application/x-msdownload' }), 'virus.exe');
    const badRes = await fetch(`${base}/api/v1/groups/${groupId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${seller.token}` },
      body: badForm,
    });
    assert.equal(badRes.status, 400);
    const badJson = await badRes.json();
    assert.equal(badJson.error.voiceKey, 'error_file_type');

    // Le fil expose les pieces jointes (vignette, nom, type, poids)
    const feed = await api(`/api/v1/groups/${groupId}/messages`, { token: seller.token });
    assert.equal(feed.body.items.length, 2);
    const image = feed.body.items.find((m) => m.kind === 'image');
    const document = feed.body.items.find((m) => m.kind === 'file');
    assert.ok(image.thumb_key && image.file_key);
    assert.equal(document.file_name, 'facture vache.pdf');
    assert.ok(document.file_bytes > 0);

    // Nettoyage
    await query('DELETE FROM groups WHERE id = $1', [groupId]);
  });
});

export default test;
