-- =============================================================================
-- BODOGUI - Migration 002 : messagerie vocale (contact acheteur <-> vendeur)
-- =============================================================================

CREATE TYPE message_kind AS ENUM ('voice', 'text');

CREATE TABLE IF NOT EXISTS messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id        uuid REFERENCES ads(id) ON DELETE CASCADE,
  thread_key   text        NOT NULL,        -- plus petit(uuid)||'|'||plus grand(uuid)
  sender_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         message_kind NOT NULL DEFAULT 'voice',
  audio_key    text,
  audio_seconds smallint,
  transcript   text,
  body         text,
  read_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (sender_id <> recipient_id)
);

CREATE INDEX IF NOT EXISTS messages_recipient_idx ON messages (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages (thread_key, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_ad_idx ON messages (ad_id);

-- Une annonce signalee plusieurs fois par des utilisateurs differents
-- peut etre masquee automatiquement (seuil FRAUD_AUTO_HIDE_REPORTS).
CREATE INDEX IF NOT EXISTS reports_open_idx ON reports (target_id) WHERE status = 'open';
