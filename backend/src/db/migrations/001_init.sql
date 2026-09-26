-- =============================================================================
-- BODOGUI - Schema initial (MVP Phase 1) - PostgreSQL 15+
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- recherche floue

-- Fonction utilitaire : mise a jour automatique de updated_at
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Types enumeres
DO $$ BEGIN
  CREATE TYPE ad_kind AS ENUM ('sell', 'want');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ad_status AS ENUM ('draft', 'pending', 'published', 'rejected', 'sold', 'archived', 'deleted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE group_role AS ENUM ('admin', 'member');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE membership_status AS ENUM ('active', 'banned', 'left');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE report_target AS ENUM ('ad', 'user', 'group');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE report_status AS ENUM ('open', 'reviewed', 'actioned', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE notification_channel AS ENUM ('sms', 'push', 'voice');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE notification_status AS ENUM ('queued', 'sent', 'failed', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Quartiers (boutons de localisation simplifiee)
CREATE TABLE IF NOT EXISTS districts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  name_ar     text,
  city        text        NOT NULL,
  country     char(2)     NOT NULL DEFAULT 'TD',
  lat         double precision,
  lng         double precision,
  radius_km   double precision NOT NULL DEFAULT 2,
  is_active   boolean     NOT NULL DEFAULT true,
  sort_order  integer     NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city, name)
);

-- Categories (grille d'icones)
CREATE TABLE IF NOT EXISTS categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text        NOT NULL UNIQUE,
  label_fr    text        NOT NULL,
  label_ar    text,
  label_ff    text,                 -- fulfulde
  label_sar   text,                 -- sara
  icon        text        NOT NULL,
  color       text        NOT NULL DEFAULT '#25D366',
  is_active   boolean     NOT NULL DEFAULT true,
  sort_order  integer     NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Utilisateurs (inscription par numero de telephone uniquement)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone              text        NOT NULL UNIQUE,          -- E.164 : +23566123456
  phone_verified     boolean     NOT NULL DEFAULT false,
  name               text,
  name_audio_key     text,                                 -- nom prononce (Opus)
  avatar_key         text,
  language           text        NOT NULL DEFAULT 'fr',    -- fr | ar | ff | sar
  district_id        uuid REFERENCES districts(id) ON DELETE SET NULL,
  city               text,
  is_admin           boolean     NOT NULL DEFAULT false,   -- moderateur plateforme
  notify_sms         boolean     NOT NULL DEFAULT true,
  notify_push        boolean     NOT NULL DEFAULT true,
  banned_at          timestamptz,
  ban_reason         text,
  ban_expires_at     timestamptz,
  last_seen_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_phone_idx ON users (phone);
CREATE INDEX IF NOT EXISTS users_district_idx ON users (district_id);
CREATE INDEX IF NOT EXISTS users_banned_idx ON users (banned_at) WHERE banned_at IS NOT NULL;

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- Codes OTP (SMS) - codes haches, jamais stockes en clair
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS otp_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        text        NOT NULL,
  code_hash    text        NOT NULL,
  purpose      text        NOT NULL DEFAULT 'login',
  attempts     smallint    NOT NULL DEFAULT 0,
  max_attempts smallint    NOT NULL DEFAULT 5,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  request_ip   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS otp_codes_phone_idx ON otp_codes (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS otp_codes_purge_idx ON otp_codes (expires_at);

-- ----------------------------------------------------------------------------
-- Jetons de rafraichissement (JWT longue duree revocables)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text        NOT NULL UNIQUE,
  user_agent  text,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens (user_id);

-- ----------------------------------------------------------------------------
-- Groupes (achat/vente par quartier, metier, village...)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS groups (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text        NOT NULL,
  name_audio_key        text,
  description_text      text,
  description_audio_key text,
  cover_key             text,
  city                  text,
  district_id           uuid REFERENCES districts(id) ON DELETE SET NULL,
  is_private            boolean     NOT NULL DEFAULT false,
  owner_id              uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  members_count         integer     NOT NULL DEFAULT 1,
  is_active             boolean     NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS groups_owner_idx ON groups (owner_id);
CREATE INDEX IF NOT EXISTS groups_city_idx ON groups (city) WHERE is_active;

DROP TRIGGER IF EXISTS groups_set_updated_at ON groups;
CREATE TRIGGER groups_set_updated_at BEFORE UPDATE ON groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS group_members (
  group_id   uuid        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       group_role  NOT NULL DEFAULT 'member',
  status     membership_status NOT NULL DEFAULT 'active',
  muted      boolean     NOT NULL DEFAULT false,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS group_members_user_idx ON group_members (user_id);

-- ----------------------------------------------------------------------------
-- Annonces
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ads (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id                  uuid REFERENCES groups(id) ON DELETE SET NULL,
  category_id               uuid        NOT NULL REFERENCES categories(id),
  kind                      ad_kind     NOT NULL DEFAULT 'sell',
  status                    ad_status   NOT NULL DEFAULT 'published',
  title                     text,
  description_text          text,
  description_audio_key     text,
  description_audio_seconds integer,
  description_transcript    text,       -- rempli si Speech-to-Text active
  price_amount              bigint      CHECK (price_amount IS NULL OR price_amount >= 0),
  currency                  char(3)     NOT NULL DEFAULT 'XAF',
  price_negotiable          boolean     NOT NULL DEFAULT true,
  district_id               uuid REFERENCES districts(id) ON DELETE SET NULL,
  city                      text,
  lat                       double precision,
  lng                       double precision,
  contact_phone             text,       -- par defaut : telephone du proprietaire (pas de masquage)
  views_count               integer     NOT NULL DEFAULT 0,
  reports_count             integer     NOT NULL DEFAULT 0,
  photos_count              integer     NOT NULL DEFAULT 0,
  client_uuid               uuid,       -- idempotence de la file hors-ligne
  moderation_note           text,
  published_at              timestamptz,
  sold_at                   timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, client_uuid)
);

CREATE INDEX IF NOT EXISTS ads_feed_idx ON ads (status, published_at DESC);
CREATE INDEX IF NOT EXISTS ads_category_idx ON ads (category_id, status, published_at DESC);
CREATE INDEX IF NOT EXISTS ads_district_idx ON ads (district_id, status, published_at DESC);
CREATE INDEX IF NOT EXISTS ads_group_idx ON ads (group_id, published_at DESC) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ads_owner_idx ON ads (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ads_price_idx ON ads (price_amount) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS ads_search_idx ON ads USING gin ((coalesce(title, '') || ' ' || coalesce(description_text, '')) gin_trgm_ops);

DROP TRIGGER IF EXISTS ads_set_updated_at ON ads;
CREATE TRIGGER ads_set_updated_at BEFORE UPDATE ON ads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS ad_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id       uuid        NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
  storage_key text        NOT NULL,
  thumb_key   text,
  width       integer,
  height      integer,
  size_bytes  integer,
  sort_order  smallint    NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ad_photos_ad_idx ON ad_photos (ad_id, sort_order);

-- ----------------------------------------------------------------------------
-- Blocage utilisateur (bouton 🚫) : fonctionnalite cle du MVP
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blocks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS blocks_blocked_idx ON blocks (blocked_id);

-- ----------------------------------------------------------------------------
-- Bannissement plateforme (temporaire ou definitif) par un administrateur
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bans (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason     text        NOT NULL,
  scope      text        NOT NULL DEFAULT 'platform',
  expires_at timestamptz,
  lifted_at  timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bans_user_idx ON bans (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bans_active_idx ON bans (user_id) WHERE lifted_at IS NULL;

-- ----------------------------------------------------------------------------
-- Bannissement d'un membre par l'admin d'un groupe
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS group_bans (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   uuid        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banned_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS group_bans_user_idx ON group_bans (user_id);

-- ----------------------------------------------------------------------------
-- Signalements (arnaque, contenu interdit...)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type report_target NOT NULL,
  target_id   uuid        NOT NULL,
  reason_code text        NOT NULL,   -- scam | illegal | nudity | duplicate | spam | other
  comment     text,
  comment_audio_key text,
  status      report_status NOT NULL DEFAULT 'open',
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reports_target_idx ON reports (target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reports_status_idx ON reports (status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS reports_unique_per_user_idx
  ON reports (reporter_id, target_type, target_id);

-- ----------------------------------------------------------------------------
-- Evaluations vocales apres transaction (systeme de confiance)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ratings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id      uuid REFERENCES ads(id) ON DELETE SET NULL,
  rater_id   uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ratee_id   uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars      smallint    NOT NULL CHECK (stars BETWEEN 1 AND 5),
  audio_key  text,
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (rater_id <> ratee_id)
);

CREATE INDEX IF NOT EXISTS ratings_ratee_idx ON ratings (ratee_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ratings_unique_pair_ad_idx
  ON ratings (ad_id, rater_id) WHERE ad_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Notifications sortantes (SMS / push / vocal) - file d'attente + journal
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel       notification_channel NOT NULL,
  kind          text        NOT NULL,   -- new_ad_in_group | ad_interest | ad_published | ban ...
  title         text,
  body          text        NOT NULL,
  voice_key     text,                   -- cle audio a jouer/lire
  language      text        NOT NULL DEFAULT 'fr',
  payload       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status        notification_status NOT NULL DEFAULT 'queued',
  error         text,
  attempts      smallint    NOT NULL DEFAULT 0,
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_queue_idx ON notifications (status, created_at);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   text        NOT NULL UNIQUE,
  p256dh     text        NOT NULL,
  auth       text        NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (user_id);

-- ----------------------------------------------------------------------------
-- Medias (photos, audios, avatars) : inventaire pour nettoyage et quotas
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media_assets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  kind        text        NOT NULL,  -- photo | audio | avatar | cover
  storage_key text        NOT NULL UNIQUE,
  mime_type   text,
  size_bytes  integer,
  seconds     smallint,
  ad_id       uuid REFERENCES ads(id) ON DELETE CASCADE,
  group_id    uuid REFERENCES groups(id) ON DELETE CASCADE,
  is_orphan   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS media_assets_owner_idx ON media_assets (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS media_assets_orphan_idx ON media_assets (is_orphan, created_at);

-- Recherches vocales (analytique + amelioration des suggestions hors ligne)
CREATE TABLE IF NOT EXISTS voice_searches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  audio_key   text,
  transcript  text,
  language    text,
  results_count integer DEFAULT 0,
  district_id uuid REFERENCES districts(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Journal d'audit (moderation, bannissements, suppressions)
CREATE TABLE IF NOT EXISTS audit_log (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text        NOT NULL,
  target_type text,
  target_id   text,
  meta        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log (action, created_at DESC);

-- Suivi des migrations appliquees
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
