CREATE TABLE submission_imports (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  state TEXT NOT NULL,
  show_id TEXT,
  upload_id TEXT NOT NULL,
  chunk INTEGER NOT NULL DEFAULT 1,
  size INTEGER NOT NULL DEFAULT 0,
  modified TEXT NOT NULL DEFAULT '',
  source_version TEXT NOT NULL DEFAULT '',
  upload_name TEXT NOT NULL DEFAULT '',
  media_id INTEGER,
  media_path TEXT,
  error TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE TABLE submission_sync (id TEXT PRIMARY KEY, initialized INTEGER NOT NULL DEFAULT 0, ignored_ids TEXT NOT NULL DEFAULT '[]', checked_at TEXT, error TEXT NOT NULL DEFAULT '');
