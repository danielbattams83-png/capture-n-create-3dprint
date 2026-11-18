-- Rolling per-session request limits. Events older than the longest window
-- are deleted by the cleanup cron.

CREATE INDEX IF NOT EXISTS jobs_user_active_idx
  ON jobs (user_id)
  WHERE status IN ('queued', 'processing');

CREATE TABLE IF NOT EXISTS request_rates (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS request_rates_lookup_idx
  ON request_rates (user_id, action, created_at DESC);
