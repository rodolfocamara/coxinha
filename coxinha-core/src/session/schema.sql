CREATE TABLE session (
 id TEXT PRIMARY KEY NOT NULL,
 title TEXT NOT NULL CHECK(length(trim(title)) > 0),
 starts_at TEXT, ends_at TEXT,
 status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','active','completed','cancelled')),
 origin TEXT NOT NULL CHECK(origin IN ('manual','recording')),
 meeting_id TEXT UNIQUE REFERENCES meeting(id),
 note_id TEXT UNIQUE, note_path TEXT UNIQUE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(ends_at IS NULL OR (starts_at IS NOT NULL AND ends_at >= starts_at)),
 CHECK((note_id IS NULL AND note_path IS NULL) OR (note_id IS NOT NULL AND note_path IS NOT NULL))
);
