CREATE TABLE IF NOT EXISTS render_jobs (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  cache_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'rendering', 'complete', 'failed', 'awaiting_renderer')),
  request_json TEXT NOT NULL,
  asset_key TEXT,
  mime_type TEXT,
  byte_length INTEGER,
  sha256 TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_render_jobs_asset_id ON render_jobs(asset_id);
CREATE INDEX IF NOT EXISTS idx_render_jobs_status ON render_jobs(status);
