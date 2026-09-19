import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';

import type { BatchManifest } from '../generator/batch.ts';
import { SCHEMA_VERSION } from '../generator/envelope.ts';
import type { SubmissionEvent } from '../generator/envelope.ts';

const MANIFEST_FILE = 'manifest.json';
const DATA_FILE = 'submissions.ndjson.gz';
const CHUNK_SIZE = 500;
const ROW_COLUMN_COUNT = 12;

export class LoadBatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoadBatchError';
  }
}

export interface LoadBatchOptions {
  runId?: string;
}

export interface LoadBatchResult {
  status: 'loaded' | 'already_loaded';
  batchId: string;
  rowsLoaded: number;
}

const REDACTED_SUFFIX = ' [values redacted]';

// DuckDB repeats bound values in its messages (a malformed JSON payload after `Input:`, a bad
// timestamp in quotes), so a database error keeps only its first line up to the first quote.
export function redactDatabaseMessage(message: string): string {
  const firstLine = message.split('\n', 1)[0] ?? '';
  const quoteAt = firstLine.search(/["']/);
  if (quoteAt === -1) {
    return firstLine;
  }
  const kept = firstLine.slice(0, quoteAt).replace(/\s*Input:\s*$/, '').trimEnd();
  return `${kept}${REDACTED_SUFFIX}`;
}

interface PipelineRunRecord {
  runId: string;
  status: 'succeeded' | 'skipped' | 'failed';
  batchId: string | null;
  rowsAffected: number | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string;
}

function validateManifest(parsed: unknown): BatchManifest {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new LoadBatchError('Batch manifest is not a JSON object');
  }
  const manifest = parsed as Record<string, unknown>;

  if (typeof manifest.batch_id !== 'string') {
    throw new LoadBatchError('Batch manifest batch_id must be a string');
  }
  if (manifest.schema_version !== SCHEMA_VERSION) {
    throw new LoadBatchError(
      `Batch manifest schema_version must be ${SCHEMA_VERSION}; got ${String(manifest.schema_version)}`,
    );
  }
  if (manifest.data_file !== DATA_FILE) {
    throw new LoadBatchError(
      `Batch manifest data_file must be ${DATA_FILE}; got ${String(manifest.data_file)}`,
    );
  }
  if (typeof manifest.data_file_sha256 !== 'string') {
    throw new LoadBatchError('Batch manifest data_file_sha256 must be a string');
  }
  if (!Number.isInteger(manifest.row_count as number) || (manifest.row_count as number) < 0) {
    throw new LoadBatchError('Batch manifest row_count must be a non-negative integer');
  }
  if (!Number.isInteger(manifest.distinct_event_count as number) || (manifest.distinct_event_count as number) < 0) {
    throw new LoadBatchError('Batch manifest distinct_event_count must be a non-negative integer');
  }
  if (typeof manifest.scenario !== 'string') {
    throw new LoadBatchError('Batch manifest scenario must be a string');
  }
  if (typeof manifest.expected !== 'object' || manifest.expected === null || Array.isArray(manifest.expected)) {
    throw new LoadBatchError('Batch manifest expected must be an object');
  }
  for (const [key, value] of Object.entries(manifest.expected)) {
    if (typeof value !== 'number') {
      throw new LoadBatchError(`Batch manifest expected.${key} must be a number`);
    }
  }
  return manifest as unknown as BatchManifest;
}

function chunkInsertSql(rowCount: number): string {
  const tuples: string[] = [];
  let placeholder = 1;
  for (let row = 0; row < rowCount; row++) {
    const columns: string[] = [];
    for (let column = 1; column <= ROW_COLUMN_COUNT; column++) {
      const value = `$${placeholder}`;
      placeholder += 1;
      if (column === 5 || column === 6) {
        columns.push(`${value}::TIMESTAMPTZ`);
      } else if (column === 10) {
        columns.push(`${value}::JSON`);
      } else {
        columns.push(value);
      }
    }
    tuples.push(`(${columns.join(', ')})`);
  }
  return `INSERT INTO raw.wellbeing_submission_events (event_id, document_id, operation, source_version, source_updated_at, extracted_at, schema_version, batch_id, region, payload, source_file, source_file_row_number) VALUES ${tuples.join(', ')}`;
}

async function recordPipelineRun(connection: DuckDBConnection, run: PipelineRunRecord): Promise<void> {
  await connection.run(
    `INSERT INTO audit.pipeline_runs (run_id, step, status, batch_id, rows_affected, error_message, started_at, finished_at) VALUES ($1, $2, $3, $4, $5, $6, $7::TIMESTAMPTZ, $8::TIMESTAMPTZ)`,
    [run.runId, 'load', run.status, run.batchId, run.rowsAffected, run.errorMessage, run.startedAt, run.finishedAt],
  );
}

export async function loadBatch(
  connection: DuckDBConnection,
  batchDir: string,
  options?: LoadBatchOptions,
): Promise<LoadBatchResult> {
  const runId = options?.runId ?? randomUUID();
  const startedAt = new Date().toISOString();
  let status: 'succeeded' | 'skipped' | 'failed' = 'succeeded';
  let batchId: string | null = null;
  let rowsAffected: number | null = null;
  let errorMessage: string | null = null;
  let transactionOpen = false;

  try {
    const manifestText = await readFile(join(batchDir, MANIFEST_FILE), 'utf8');
    const manifest = validateManifest(JSON.parse(manifestText));
    batchId = manifest.batch_id;

    const gzipped = await readFile(join(batchDir, DATA_FILE));
    const checksum = createHash('sha256').update(gzipped).digest('hex');
    if (checksum !== manifest.data_file_sha256) {
      throw new LoadBatchError(
        `Refusing to load batch ${batchId}: data file sha256 does not match manifest.data_file_sha256`,
      );
    }

    const text = gunzipSync(gzipped).toString('utf8');
    const lines = text.split('\n').filter((line) => line.trim() !== '');
    if (lines.length !== manifest.row_count) {
      throw new LoadBatchError(
        `Refusing to load batch ${batchId}: data file has ${lines.length} lines; manifest row_count is ${manifest.row_count}`,
      );
    }

    const events: SubmissionEvent[] = [];
    const eventIds = new Set<string>();
    for (const line of lines) {
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        throw new LoadBatchError(`Refusing to load batch ${batchId}: data file contains an invalid event line`);
      }
      if (typeof event !== 'object' || event === null || typeof (event as { event_id?: unknown }).event_id !== 'string') {
        throw new LoadBatchError(`Refusing to load batch ${batchId}: data file event is missing a string event_id`);
      }
      eventIds.add((event as { event_id: string }).event_id);
      events.push(event as SubmissionEvent);
    }
    if (eventIds.size !== manifest.distinct_event_count) {
      throw new LoadBatchError(
        `Refusing to load batch ${batchId}: data file has ${eventIds.size} distinct event_ids; manifest distinct_event_count is ${manifest.distinct_event_count}`,
      );
    }

    const ledgerRows = (
      await connection.runAndReadAll(
        'SELECT batch_id, data_file_sha256 FROM raw.loaded_batches WHERE batch_id = $1',
        [batchId],
      )
    ).getRowObjects();
    if (ledgerRows.length > 0) {
      const existing = ledgerRows[0] as Record<string, DuckDBValue>;
      if (String(existing?.data_file_sha256) === manifest.data_file_sha256) {
        status = 'skipped';
        rowsAffected = 0;
        return { status: 'already_loaded', batchId, rowsLoaded: 0 };
      }
      throw new LoadBatchError(
        `Refusing to load batch ${batchId}: already loaded with a different data file checksum`,
      );
    }

    await connection.run('BEGIN TRANSACTION');
    transactionOpen = true;

    const sourceFile = `${batchId}/${DATA_FILE}`;
    for (let offset = 0; offset < events.length; offset += CHUNK_SIZE) {
      const chunk = events.slice(offset, offset + CHUNK_SIZE);
      const sql = chunkInsertSql(chunk.length);
      const values: DuckDBValue[] = [];
      for (let index = 0; index < chunk.length; index++) {
        const event = chunk[index];
        if (event === undefined) {
          throw new LoadBatchError('Internal error: undefined event in chunk');
        }
        values.push(
          event.event_id,
          event.document_id,
          event.operation,
          event.source_version,
          event.source_updated_at,
          event.extracted_at,
          event.schema_version,
          event.batch_id,
          event.region,
          JSON.stringify(event.payload),
          sourceFile,
          offset + index + 1,
        );
      }
      await connection.run(sql, values);
    }

    await connection.run(
      `INSERT INTO raw.loaded_batches (batch_id, data_file, data_file_sha256, schema_version, row_count, distinct_event_count, scenario, loaded_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::TIMESTAMPTZ)`,
      [
        manifest.batch_id,
        manifest.data_file,
        manifest.data_file_sha256,
        manifest.schema_version,
        manifest.row_count,
        manifest.distinct_event_count,
        manifest.scenario,
        new Date().toISOString(),
      ],
    );

    const countRows = (
      await connection.runAndReadAll(
        'SELECT count(*)::INTEGER AS n FROM raw.wellbeing_submission_events WHERE batch_id = $1',
        [batchId],
      )
    ).getRowObjects();
    const inserted = Number(countRows[0]?.n ?? 0);
    if (inserted !== manifest.row_count) {
      throw new LoadBatchError(
        `Refusing to load batch ${batchId}: inserted ${inserted} rows; expected ${manifest.row_count}`,
      );
    }

    await connection.run('COMMIT');
    transactionOpen = false;
    rowsAffected = manifest.row_count;
    return { status: 'loaded', batchId, rowsLoaded: manifest.row_count };
  } catch (error) {
    status = 'failed';
    const rawMessage = error instanceof Error ? error.message : String(error);
    errorMessage = error instanceof LoadBatchError ? rawMessage : redactDatabaseMessage(rawMessage);
    if (transactionOpen) {
      transactionOpen = false;
      try {
        await connection.run('ROLLBACK');
      } catch {
        // Ignore rollback failures.
      }
    }
    if (error instanceof LoadBatchError) {
      throw error;
    }
    throw new LoadBatchError(errorMessage);
  } finally {
    const finishedAt = new Date().toISOString();
    try {
      await recordPipelineRun(connection, {
        runId,
        status,
        batchId,
        rowsAffected,
        errorMessage,
        startedAt,
        finishedAt,
      });
    } catch {
      // Pipeline run recording is best-effort.
    }
  }
}
