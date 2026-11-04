CREATE TABLE personal_note_intent (
    session_id TEXT PRIMARY KEY REFERENCES session(id),
    note_id TEXT NOT NULL UNIQUE,
    relative_path TEXT NOT NULL UNIQUE,
    token TEXT NOT NULL UNIQUE,
    initial_body TEXT NOT NULL,
    last_error TEXT,
    state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','complete'))
);

-- Reservations own UUIDs even before the final session binding is published.
CREATE TRIGGER personal_note_reservation_binding BEFORE UPDATE OF note_id ON session
WHEN NEW.note_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM personal_note_intent i
    WHERE (i.session_id=NEW.id AND i.note_id<>NEW.note_id)
       OR (i.note_id=NEW.note_id AND i.session_id<>NEW.id)
)
BEGIN SELECT RAISE(ABORT, 'personal note reservation ownership conflict'); END;

CREATE TRIGGER personal_note_reservation_insert BEFORE INSERT ON personal_note_intent
WHEN EXISTS (
    SELECT 1 FROM session s WHERE s.note_id IS NOT NULL
      AND ((s.id=NEW.session_id AND s.note_id<>NEW.note_id)
        OR (s.note_id=NEW.note_id AND s.id<>NEW.session_id))
)
BEGIN SELECT RAISE(ABORT, 'personal note reservation ownership conflict'); END;

CREATE TRIGGER personal_note_reservation_immutable
BEFORE UPDATE OF session_id,note_id,relative_path,token,initial_body ON personal_note_intent
BEGIN SELECT RAISE(ABORT, 'personal note reservation is immutable'); END;

CREATE TRIGGER personal_note_completion_guard BEFORE UPDATE OF state ON personal_note_intent
WHEN (OLD.state='complete' AND NEW.state<>'complete')
   OR (NEW.state='complete' AND NOT EXISTS (
       SELECT 1 FROM session WHERE id=NEW.session_id AND note_id=NEW.note_id
   ))
BEGIN SELECT RAISE(ABORT, 'personal note completion requires its owned binding'); END;
