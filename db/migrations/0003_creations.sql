-- Durable Creations for a studio session. The model binary stays in Blob
-- storage; this table keeps the URLs and print metadata.

CREATE TABLE IF NOT EXISTS creations (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  name text NOT NULL,
  model_url text NOT NULL,
  thumbnail_url text,
  width double precision NOT NULL,
  depth double precision NOT NULL,
  height double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creations_user_created_idx
  ON creations (user_id, created_at DESC);
