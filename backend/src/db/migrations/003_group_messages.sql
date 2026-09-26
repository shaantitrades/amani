-- =============================================================================
-- BODOGUI - Migration 003 : discussion de groupe (cadre type WhatsApp)
--   Messages vocaux et textuels echanges dans un groupe (en plus des annonces).
-- =============================================================================

CREATE TABLE IF NOT EXISTS group_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      uuid        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  sender_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          message_kind NOT NULL DEFAULT 'text',
  audio_key     text,
  audio_seconds smallint,
  transcript    text,
  body          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'voice' OR audio_key IS NOT NULL),
  CHECK (kind <> 'text' OR body IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS group_messages_group_idx ON group_messages (group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS group_messages_sender_idx ON group_messages (sender_id, created_at DESC);

-- Dernier message d'un groupe (badge "nouveaux messages" dans la liste)
CREATE INDEX IF NOT EXISTS group_messages_recent_idx ON group_messages (group_id, created_at);
