BEGIN;

CREATE TABLE IF NOT EXISTS image_slot_drafts (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  section     text        NOT NULL,
  description text        NOT NULL,
  image_id    integer     NULL REFERENCES images(id),
  action      text        NOT NULL CHECK (action IN ('set', 'clear')),
  updated_by  integer     NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT image_slot_drafts_slot_uniq UNIQUE (section, description),
  CONSTRAINT image_slot_drafts_action_image_chk CHECK (
    (action = 'set' AND image_id IS NOT NULL) OR (action = 'clear' AND image_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS image_slot_drafts_image_idx ON image_slot_drafts (image_id);

COMMIT;
