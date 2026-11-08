CREATE TABLE meeting (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 capture_state TEXT NOT NULL DEFAULT 'new' CHECK(capture_state IN ('new','recording','finished','interrupted'))
);
CREATE TABLE job (
 id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meeting(id),
 identity_key TEXT NOT NULL UNIQUE, stage TEXT NOT NULL, input_json TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','succeeded','failed')),
 attempts INTEGER NOT NULL DEFAULT 0, error TEXT
);
CREATE TABLE artifact (
 id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meeting(id), job_id TEXT REFERENCES job(id),
 relative_path TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL
);
CREATE TABLE human_edit (
 id INTEGER PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meeting(id), target TEXT NOT NULL,
 body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
