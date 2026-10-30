CREATE TABLE processing_publication (
 job_id TEXT PRIMARY KEY,
 meeting_id TEXT NOT NULL,
 input_json TEXT NOT NULL,
 result_json TEXT NOT NULL
);
