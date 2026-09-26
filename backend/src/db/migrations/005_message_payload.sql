-- =============================================================================
-- BODOGUI - Migration 005 : coherence des messages de groupe
-- (transaction separee : les valeurs d'enum ajoutees en 004 sont maintenant
--  utilisables dans une contrainte)
-- =============================================================================

ALTER TABLE group_messages DROP CONSTRAINT IF EXISTS group_messages_check;
ALTER TABLE group_messages DROP CONSTRAINT IF EXISTS group_messages_check1;

ALTER TABLE group_messages
  ADD CONSTRAINT group_messages_payload_check CHECK (
    (kind = 'text'  AND body IS NOT NULL)
    OR (kind = 'voice' AND audio_key IS NOT NULL)
    OR (kind = 'image' AND file_key IS NOT NULL)
    OR (kind = 'file'  AND file_key IS NOT NULL)
  );
