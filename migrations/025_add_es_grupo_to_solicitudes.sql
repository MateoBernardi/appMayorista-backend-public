-- Adds es_grupo flag to solicitudes so private CHAT (1-on-1) can be
-- distinguished from group CHATs without relying on participant count alone.
-- Existing rows default to false (all pre-existing chats are private).
ALTER TABLE solicitudes
  ADD COLUMN IF NOT EXISTS es_grupo BOOLEAN NOT NULL DEFAULT false;
