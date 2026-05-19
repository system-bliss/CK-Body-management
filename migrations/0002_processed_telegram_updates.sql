CREATE TABLE IF NOT EXISTS processed_telegram_updates (
  update_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_processed_telegram_updates_user_time ON processed_telegram_updates(user_id, created_at);
