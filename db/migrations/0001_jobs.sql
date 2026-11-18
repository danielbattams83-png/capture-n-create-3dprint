-- Persistent Meshy generation jobs.
-- One row per user and idempotency key. Active and recently completed rows
-- are reused so a refresh or retry does not create another Meshy task.

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  idempotency_key text NOT NULL,
  meshy_task_id text,
  meshy_task_type text,
  type text NOT NULL,
  status text NOT NULL,
  progress integer NOT NULL DEFAULT 0,
  input_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_urls jsonb,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jobs_type_check CHECK (type IN ('model', 'texture')),
  CONSTRAINT jobs_status_check CHECK (status IN ('queued', 'processing', 'succeeded', 'failed')),
  CONSTRAINT jobs_progress_check CHECK (progress >= 0 AND progress <= 100),
  CONSTRAINT jobs_task_type_check CHECK (
    meshy_task_type IS NULL
    OR meshy_task_type IN ('image-to-3d', 'multi-image-to-3d', 'retexture')
  ),
  CONSTRAINT jobs_user_idempotency_key UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS jobs_user_type_updated_idx
  ON jobs (user_id, type, updated_at DESC);

CREATE INDEX IF NOT EXISTS jobs_meshy_task_id_idx
  ON jobs (meshy_task_id);
