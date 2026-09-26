-- =============================================================================
-- BODOGUI - Migration 004 : photos et documents dans la discussion de groupe
--
--  - le type message_kind accepte deux nouvelles valeurs : 'image' et 'file'
--  - colonnes generiques pour les pieces jointes (nom, type, poids, vignette)
--
-- NB : les valeurs d'enum ajoutees ne peuvent pas etre utilisees dans la meme
-- transaction -> la contrainte de coherence est posee par la migration 005.
-- =============================================================================

ALTER TYPE message_kind ADD VALUE IF NOT EXISTS 'image';
ALTER TYPE message_kind ADD VALUE IF NOT EXISTS 'file';

ALTER TABLE group_messages
  ADD COLUMN IF NOT EXISTS file_key   text,
  ADD COLUMN IF NOT EXISTS thumb_key  text,
  ADD COLUMN IF NOT EXISTS file_name  text,
  ADD COLUMN IF NOT EXISTS file_mime  text,
  ADD COLUMN IF NOT EXISTS file_bytes integer;

CREATE INDEX IF NOT EXISTS group_messages_kind_idx ON group_messages (group_id, kind);
