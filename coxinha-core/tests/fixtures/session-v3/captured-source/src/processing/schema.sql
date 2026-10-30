CREATE TABLE processing_run(job_id TEXT PRIMARY KEY REFERENCES job(id), config_json TEXT NOT NULL, result_json TEXT);
