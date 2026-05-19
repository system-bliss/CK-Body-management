CREATE TABLE IF NOT EXISTS profile (
  user_id TEXT PRIMARY KEY,
  profile_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  log_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, log_date)
);

CREATE TABLE IF NOT EXISTS ai_estimates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  daily_log_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  source_msg_id TEXT,
  entry_type TEXT NOT NULL,
  meal_type TEXT,
  raw_text TEXT,
  photo_r2_key TEXT,
  photo_content_type TEXT,
  estimate_json TEXT NOT NULL,
  confidence TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (daily_log_id) REFERENCES daily_logs(id)
);

CREATE TABLE IF NOT EXISTS meal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  daily_log_id INTEGER NOT NULL,
  estimate_id INTEGER,
  meal_type TEXT NOT NULL,
  calories_kcal REAL,
  protein_g REAL,
  carbs_g REAL,
  fat_g REAL,
  summary TEXT,
  estimated INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY (daily_log_id) REFERENCES daily_logs(id),
  FOREIGN KEY (estimate_id) REFERENCES ai_estimates(id)
);

CREATE TABLE IF NOT EXISTS exercise_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  daily_log_id INTEGER NOT NULL,
  estimate_id INTEGER,
  minutes REAL,
  calories_kcal REAL,
  summary TEXT,
  estimated INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY (daily_log_id) REFERENCES daily_logs(id),
  FOREIGN KEY (estimate_id) REFERENCES ai_estimates(id)
);

CREATE TABLE IF NOT EXISTS measurements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  daily_log_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  weight_kg REAL,
  body_fat_percent REAL,
  waist_cm REAL,
  measured_at TEXT NOT NULL,
  FOREIGN KEY (daily_log_id) REFERENCES daily_logs(id)
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  report_type TEXT NOT NULL,
  period_start TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminder_settings (
  user_id TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_daily_logs_user_date ON daily_logs(user_id, log_date);
CREATE INDEX IF NOT EXISTS idx_ai_estimates_user_created ON ai_estimates(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_measurements_user_time ON measurements(user_id, measured_at);
CREATE INDEX IF NOT EXISTS idx_reports_user_period ON reports(user_id, report_type, period_start);
