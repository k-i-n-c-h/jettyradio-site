CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  submitted_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  data TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed')),
  revision INTEGER NOT NULL DEFAULT 1,
  reviewed_by TEXT,
  reviewed_at TEXT
);
CREATE INDEX submissions_recent ON submissions (submitted_at DESC, id DESC);
