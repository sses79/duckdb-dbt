CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS staging;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS marts;
CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE IF NOT EXISTS raw.wellbeing_submission_events (
    event_id VARCHAR NOT NULL,
    document_id VARCHAR NOT NULL,
    operation VARCHAR NOT NULL,
    source_version INTEGER NOT NULL,
    source_updated_at TIMESTAMPTZ NOT NULL,
    extracted_at TIMESTAMPTZ NOT NULL,
    schema_version VARCHAR NOT NULL,
    batch_id VARCHAR NOT NULL,
    region VARCHAR NOT NULL,
    payload JSON NOT NULL,
    source_file VARCHAR NOT NULL,
    source_file_row_number INTEGER NOT NULL,
    loaded_at TIMESTAMPTZ NOT NULL DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS raw.loaded_batches (
    batch_id VARCHAR PRIMARY KEY,
    data_file VARCHAR NOT NULL,
    data_file_sha256 VARCHAR NOT NULL,
    schema_version VARCHAR NOT NULL,
    row_count INTEGER NOT NULL,
    distinct_event_count INTEGER NOT NULL,
    scenario VARCHAR NOT NULL,
    loaded_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS audit.pipeline_runs (
    run_id VARCHAR PRIMARY KEY,
    step VARCHAR NOT NULL,
    status VARCHAR NOT NULL,
    batch_id VARCHAR,
    rows_affected INTEGER,
    error_message VARCHAR,
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit.publications (
    run_id VARCHAR NOT NULL,
    tenant VARCHAR NOT NULL,
    file_name VARCHAR NOT NULL,
    row_count INTEGER NOT NULL,
    sha256 VARCHAR NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (run_id, tenant, file_name)
);
