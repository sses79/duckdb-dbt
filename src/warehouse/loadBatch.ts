import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';

import type { BatchManifest } from '../generator/batch.ts';
import { SCHEMA_VERSION } from '../generator/envelope.ts';
import type { SubmissionEvent } from '../generator/envelope.ts';

const DATA_FILE = 'submissions.ndjson.gz';
const MANIFEST_FILE = 'manifest.json';
const CHUNK_SIZE = 500;

const INSERT_COLUMNS = [
  'event_id',
  'document_id',
  'operation',
  'source_version',
  'source_updated_at',
  'extracted_at',
  'schema_version',
  'batch_id',
  'region',
  'payload',
  'source_file',
  'source_file_row_number',
] as const;

const PLACEHOLDER_CAST: Record<(typeof INSERT_COLUMNS)[number], string> = {
  event_id: '',
  document_id: '',
  operation: '',
  source_version: '',
  source_updated_at: '::TIMESTAMPTZ',
  extracted_at: '::TIMESTAMPTZ',
  schema_version: '',
  batch_id: '',
  region: '',
  payload: '::JSON',
  source_file: '',
  source_file_row_number: '',
};

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateManifest(value: unknown): BatchManifest {
  if (!isRecord(value)) {
    throw new LoadBatchError('manifest.json must contain an object');
  }

  const {
    batch_id,
    schema_version,
    data_file,
    data_file_sha256,
    row_count,
    distinct_event_count,
    scenario,
    expected,
  } = value;

  if (typeof batch_id !== 'string' || batch_id === '') {
    throw new LoadBatchError('manifest batch_id must be a non-empty string');
  }
  if (schema_version !== SCHEMA_VERSION) {
    throw new LoadBatchError('manifest schema_version must match SCHEMA_VERSION');
  }
  if (data_file !== DATA_FILE) {
    throw new LoadBatchError(`manifest data_file must be '${DATA_FILE}'`);
  }
  if (typeof data_file_sha256 !== 'string' || data_file_sha256 === '') {
    throw new LoadBatchError('manifest data_file_sha256 must be a non-empty string');
  }
  if (typeof row_count !== 'number' || !Number.isInteger(row_count) || row_count < 0) {
    throw new LoadBatchError('manifest row_count must be a non-negative integer');
  }
  if (
    typeof distinct_event_count !== 'number' ||
    !Number.isInteger(distinct_event_count) ||
    distinct_event_count < 0
  ) {
    throw new LoadBatchError('manifest distinct_event_count must be a non-negative integer');
  }
  if (typeof scenario !== 'string') {
    throw new LoadBatchError('manifest scenario must be a string');
  }
  if (!isRecord(expected)) {
    throw new LoadBatchError('manifest expected must be an object');
  }

  const expectedCounts: Record<string, number> = {};
  for (const [key, count] of Object.entries(expected)) {
    if (typeof count !== 'number' || !Number.isInteger(count)) {
      throw new LoadBatchError('manifest expected values must be integers');
    }
    expectedCounts[key] = count;
  }

  return {
    batch_id,
    schema_version,
    data_file,
    data_file_sha256,
    row_count,
    distinct_event_count,
    scenario,
    expected: expectedCounts,
  };
}

async function readManifest(batchDir: string): Promise<BatchManifest> {
  const text = await readFile(join(batchDir, MANIFEST_FILE), 'utf8');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new LoadBatchError('manifest.json is not valid JSON');
  }
  return validateManifest(value);
}

function verifyData(gzipped: Buffer, manifest: BatchManifest): SubmissionEvent[] {
  let text: string;
  try {
    text = gunzipSync(gzipped).toString('utf8');
  } catch {
    throw new LoadBatchError('data file is not valid gzip');
  }

  const lines = text.split('\n').filter((line) => line.length > 0);
  if (lines.length !== manifest.row_count) {
    throw new LoadBatchError('data file line count does not match manifest row_count');
  }

  const events: SubmissionEvent[] = [];
  const eventIds = new Set<string>();
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new LoadBatchError('data file contains a line that is not valid JSON');
    }
    if (!isRecord(parsed) || typeof parsed.event_id !== 'string' || !isRecord(parsed.payload)) {
      throw new LoadBatchError('data file contains an event with missing or invalid fields');
    }
    const eventId: string = parsed.event_id;
    eventIds.add(eventId);
    events.push(parsed as unknown as SubmissionEvent);
  }

  if (eventIds.size !== manifest.distinct_event_count) {
    throw new LoadBatchError('data file distinct event count does not match manifest');
  }

  return events;
}

interface LedgerEntry {
  data_file_sha256: string;
}

async function findLedger(connection: DuckDBConnection, batchId: string): Promise<LedgerEntry | null> {
  const result = await connection.runAndReadAll(
    'SELECT data_file_sha256::VARCHAR AS data_file_sha256 FROM raw.loaded_batches WHERE batch_id::VARCHAR = $1',
    [batchId],
  );
  const row = result.getRowObjects()[0];
  if (row === undefined) {
    return null;
  }
  return { data_file_sha256: String(row.data_file_sha256 ?? '') };
}

function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

async function insertEvents(
  connection: DuckDBConnection,
  events: SubmissionEvent[],
  manifest: BatchManifest,
): Promise<void> {
  const sourceFile = `${manifest.batch_id}/${DATA_FILE}`;
  let rowNumber = 1;
  let placeholder = 1;

  for (const chunk of chunkArray(events, CHUNK_SIZE)) {
    const values: DuckDBValue[] = [];
    const rowPlaceholders: string[] = [];

    for (const event of chunk) {
      values.push(
        event.event_id,
        event.document_id,
        event.operation,
        event.source_version,
        event.source_updated_at,
        event.extracted_at,
        event.schema_version,
        manifest.batch_id,
        event.region,
        JSON.stringify(event.payload),
        sourceFile,
        rowNumber,
      );
      rowPlaceholders.push(
        `(${INSERT_COLUMNS.map((column) => `$${placeholder++}${PLACEHOLDER_CAST[column]}`).join(', ')})`,
      );
      rowNumber++;
    }

    const sql = `INSERT INTO raw.wellbeing_submission_events (${INSERT_COLUMNS.join(', ')}) VALUES ${rowPlaceholders.join(', ')}`;
    await connection.run(sql, values);
  }
}

async function countRows(connection: DuckDBConnection, batchId: string): Promise<number> {
  const result = await connection.runAndReadAll(
    'SELECT count(*)::INTEGER AS n FROM raw.wellbeing_submission_events WHERE batch_id::VARCHAR = $1',
    [batchId],
  );
  const row = result.getRowObjects()[0];
  if (row === undefined) {
    throw new LoadBatchError('could not count inserted rows');
  }
  return Number(row['n']);
}

async function insertLedger(connection: DuckDBConnection, manifest: BatchManifest): Promise<void> {
  await connection.run(
    `INSERT INTO raw.loaded_batches (batch_id, data_file, data_file_sha256, schema_version, row_count, distinct_event_count, scenario, loaded_at) VALUES ($1, $2, $3, $4, $5, $6, $7, current_timestamp)`,
    [
      manifest.batch_id,
      manifest.data_file,
      manifest.data_file_sha256,
      manifest.schema_version,
      manifest.row_count,
      manifest.distinct_event_count,
      manifest.scenario,
    ],
  );
}

type PipelineStatus = 'succeeded' | 'skipped' | 'failed';

interface AuditRecord {
  runId: string;
  status: PipelineStatus;
  batchId: string | null;
  rowsAffected: number | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string;
}

async function writeAudit(connection: DuckDBConnection, record: AuditRecord): Promise<void> {
  await connection.run(
    `INSERT INTO audit.pipeline_runs (run_id, step, status, batch_id, rows_affected, error_message, started_at, finished_at) VALUES ($1, $2, $3, $4, $5, $6, $7::TIMESTAMPTZ, $8::TIMESTAMPTZ)`,
    [
      record.runId,
      'load',
      record.status,
      record.batchId,
      record.rowsAffected,
      record.errorMessage,
      record.startedAt,
      record.finishedAt,
    ],
  );
}

export async function loadBatch(
  connection: DuckDBConnection,
  batchDir: string,
  options?: LoadBatchOptions,
): Promise<LoadBatchResult> {
  const runId = options?.runId ?? randomUUID();
  const startedAt = new Date().toISOString();
  let batchId: string | null = null;

  try {
    const manifest = await readManifest(batchDir);
    batchId = manifest.batch_id;

    const gzipped = await readFile(join(batchDir, DATA_FILE));
    const dataChecksum = createHash('sha256').update(gzipped).digest('hex');
    if (dataChecksum !== manifest.data_file_sha256) {
      throw new LoadBatchError('data file checksum does not match manifest');
    }

    const events = verifyData(gzipped, manifest);

    const ledgerEntry = await findLedger(connection, manifest.batch_id);
    if (ledgerEntry !== null) {
      if (ledgerEntry.data_file_sha256 === manifest.data_file_sha256) {
        await writeAudit(connection, {
          runId,
          status: 'skipped',
          batchId: manifest.batch_id,
          rowsAffected: 0,
          errorMessage: null,
          startedAt,
          finishedAt: new Date().toISOString(),
        });
        return { status: 'already_loaded', batchId: manifest.batch_id, rowsLoaded: 0 };
      }
      throw new LoadBatchError('batch already loaded with a different data file checksum');
    }

    await connection.run('BEGIN TRANSACTION');
    try {
      await insertEvents(connection, events, manifest);

      const insertedRows = await countRows(connection, manifest.batch_id);
      if (insertedRows !== manifest.row_count) {
        throw new LoadBatchError('inserted row count does not match manifest row_count');
      }

      await insertLedger(connection, manifest);
      await connection.run('COMMIT');

      await writeAudit(connection, {
        runId,
        status: 'succeeded',
        batchId: manifest.batch_id,
        rowsAffected: insertedRows,
        errorMessage: null,
        startedAt,
        finishedAt: new Date().toISOString(),
      });

      return { status: 'loaded', batchId: manifest.batch_id, rowsLoaded: insertedRows };
    } catch (error) {
      try {
        await connection.run('ROLLBACK');
      } catch {}
      throw error instanceof LoadBatchError ? error : new LoadBatchError('failed to load batch');
    }
  } catch (error) {
    const loadError = error instanceof LoadBatchError ? error : new LoadBatchError('failed to load batch');
    try {
      await writeAudit(connection, {
        runId,
        status: 'failed',
        batchId,
        rowsAffected: null,
        errorMessage: loadError.message,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
    } catch {}
    throw loadError;
  }
}
