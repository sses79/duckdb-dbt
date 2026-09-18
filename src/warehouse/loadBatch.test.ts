import { DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { writeBatch } from '../generator/batch.ts';
import type { SubmissionEvent } from '../generator/envelope.ts';
import { applyFoundation } from './foundation.ts';
import { LoadBatchError, loadBatch } from './loadBatch.ts';

const connections: DuckDBConnection[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
  for (const connection of connections.splice(0)) {
    connection.closeSync();
  }
});

async function openConnection(): Promise<DuckDBConnection> {
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  connections.push(connection);
  await applyFoundation(connection);
  return connection;
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'loadbatch-test-'));
  tempDirs.push(dir);
  return dir;
}

async function countAll(
  connection: DuckDBConnection,
  sql: string,
  values?: DuckDBValue[],
): Promise<number> {
  const rows = (await connection.runAndReadAll(sql, values)).getRowObjects();
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`count query returned no rows: ${sql}`);
  }
  return Number(row['n']);
}

function makeEvent(index: number, batchId: string, variant = ''): SubmissionEvent {
  const suffix = String(index).padStart(6, '0');
  return {
    event_id: `evt_${suffix}`,
    document_id: `doc_${suffix}`,
    operation: 'upsert',
    source_version: 1,
    source_updated_at: '2018-10-01T00:00:00Z',
    extracted_at: variant === '' ? '2026-09-18T00:00:00Z' : '2026-09-18T00:00:01Z',
    schema_version: 'wellbeing-submission/1',
    batch_id: batchId,
    region: 'uk',
    payload: {
      trust_id: 'trust_north',
      school_id: 'school_n01',
      school_classification: 'Primary',
      year_group: 'Year 5',
      local_authority: 'Leeds',
      survey_period: '2018-autumn',
      answers: {
        q_01: 'Strongly agree',
        q_02: null,
      } as unknown as SubmissionEvent['payload']['answers'],
      provenance: {
        trust_id: 'generated_for_demo',
        school_id: 'generated_for_demo',
        survey_period: 'generated_for_demo',
        source_updated_at: 'generated_for_demo',
        document_id: 'generated_for_demo',
      },
    },
  };
}

async function createBatch(
  dir: string,
  batchId: string,
  count: number,
  variant = '',
): Promise<SubmissionEvent[]> {
  const events = Array.from({ length: count }, (_, index) => makeEvent(index, batchId, variant));
  await writeBatch({
    events,
    outputDir: dir,
    batchId,
    scenario: 'test-scenario',
    expected: { ok: count },
  });
  return events;
}

describe('loadBatch', () => {
  it('loads a valid 120-event batch', async () => {
    const connection = await openConnection();
    const dir = await makeTempDir();
    await createBatch(dir, 'valid-batch', 120);

    const result = await loadBatch(connection, dir, { runId: 'valid-run' });

    expect(result).toEqual({ status: 'loaded', batchId: 'valid-batch', rowsLoaded: 120 });
    expect(
      await countAll(connection, 'SELECT count(*)::INTEGER AS n FROM raw.wellbeing_submission_events'),
    ).toBe(120);
    expect(
      await countAll(
        connection,
        `SELECT count(*)::INTEGER AS n FROM raw.loaded_batches WHERE batch_id::VARCHAR = 'valid-batch'`,
      ),
    ).toBe(1);
    expect(
      await countAll(
        connection,
        `SELECT count(*)::INTEGER AS n FROM audit.pipeline_runs WHERE run_id::VARCHAR = 'valid-run' AND step::VARCHAR = 'load' AND status::VARCHAR = 'succeeded' AND rows_affected::INTEGER = 120`,
      ),
    ).toBe(1);
    expect(
      await countAll(
        connection,
        `SELECT count(*)::INTEGER AS n FROM audit.pipeline_runs WHERE step::VARCHAR = 'load'`,
      ),
    ).toBe(1);
  });

  it('returns already_loaded for the same batch without writing rows', async () => {
    const connection = await openConnection();
    const dir = await makeTempDir();
    await createBatch(dir, 'valid-batch', 120);

    const first = await loadBatch(connection, dir, { runId: 'first-run' });
    const second = await loadBatch(connection, dir, { runId: 'second-run' });

    expect(first).toEqual({ status: 'loaded', batchId: 'valid-batch', rowsLoaded: 120 });
    expect(second).toEqual({ status: 'already_loaded', batchId: 'valid-batch', rowsLoaded: 0 });
    expect(
      await countAll(connection, 'SELECT count(*)::INTEGER AS n FROM raw.wellbeing_submission_events'),
    ).toBe(120);
    expect(
      await countAll(
        connection,
        `SELECT count(*)::INTEGER AS n FROM raw.loaded_batches WHERE batch_id::VARCHAR = 'valid-batch'`,
      ),
    ).toBe(1);
    expect(
      await countAll(
        connection,
        `SELECT count(*)::INTEGER AS n FROM audit.pipeline_runs WHERE run_id::VARCHAR = 'first-run' AND status::VARCHAR = 'succeeded'`,
      ),
    ).toBe(1);
    expect(
      await countAll(
        connection,
        `SELECT count(*)::INTEGER AS n FROM audit.pipeline_runs WHERE run_id::VARCHAR = 'second-run' AND status::VARCHAR = 'skipped' AND rows_affected::INTEGER = 0`,
      ),
    ).toBe(1);
  });

  it('refuses the same batch_id with a different data file checksum', async () => {
    const connection = await openConnection();
    const firstDir = await makeTempDir();
    await createBatch(firstDir, 'checksum-batch', 30);
    await loadBatch(connection, firstDir, { runId: 'checksum-first' });

    const secondDir = await makeTempDir();
    await createBatch(secondDir, 'checksum-batch', 30, 'different');

    await expect(
      loadBatch(connection, secondDir, { runId: 'checksum-second' }),
    ).rejects.toBeInstanceOf(LoadBatchError);

    expect(
      await countAll(connection, 'SELECT count(*)::INTEGER AS n FROM raw.wellbeing_submission_events'),
    ).toBe(30);
    expect(
      await countAll(
        connection,
        `SELECT count(*)::INTEGER AS n FROM raw.loaded_batches WHERE batch_id::VARCHAR = 'checksum-batch'`,
      ),
    ).toBe(1);
    expect(
      await countAll(
        connection,
        `SELECT count(*)::INTEGER AS n FROM audit.pipeline_runs WHERE run_id::VARCHAR = 'checksum-second' AND status::VARCHAR = 'failed'`,
      ),
    ).toBe(1);
  });

  it('refuses a data_file_sha256 mismatch before writing rows', async () => {
    const connection = await openConnection();
    const dir = await makeTempDir();
    await createBatch(dir, 'sha-batch', 25);

    const manifestPath = join(dir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      data_file_sha256: string;
      row_count: number;
    };
    manifest.data_file_sha256 = 'f'.repeat(64);
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    await expect(loadBatch(connection, dir, { runId: 'sha-run' })).rejects.toBeInstanceOf(
      LoadBatchError,
    );

    expect(
      await countAll(connection, 'SELECT count(*)::INTEGER AS n FROM raw.wellbeing_submission_events'),
    ).toBe(0);
    expect(
      await countAll(
        connection,
        `SELECT count(*)::INTEGER AS n FROM raw.loaded_batches WHERE batch_id::VARCHAR = 'sha-batch'`,
      ),
    ).toBe(0);
    expect(
      await countAll(
        connection,
        `SELECT count(*)::INTEGER AS n FROM audit.pipeline_runs WHERE run_id::VARCHAR = 'sha-run' AND status::VARCHAR = 'failed' AND error_message::VARCHAR IS NOT NULL`,
      ),
    ).toBe(1);
  });

  it('refuses a row_count mismatch before writing rows', async () => {
    const connection = await openConnection();
    const dir = await makeTempDir();
    const events = await createBatch(dir, 'row-batch', 25);

    const manifestPath = join(dir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { row_count: number };
    manifest.row_count = events.length + 5;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    await expect(loadBatch(connection, dir, { runId: 'row-run' })).rejects.toBeInstanceOf(
      LoadBatchError,
    );

    expect(
      await countAll(connection, 'SELECT count(*)::INTEGER AS n FROM raw.wellbeing_submission_events'),
    ).toBe(0);
    expect(
      await countAll(
        connection,
        `SELECT count(*)::INTEGER AS n FROM raw.loaded_batches WHERE batch_id::VARCHAR = 'row-batch'`,
      ),
    ).toBe(0);
    expect(
      await countAll(
        connection,
        `SELECT count(*)::INTEGER AS n FROM audit.pipeline_runs WHERE run_id::VARCHAR = 'row-run' AND status::VARCHAR = 'failed'`,
      ),
    ).toBe(1);
  });

  it('round-trips stored event fields, payload, source_file and row number', async () => {
    const connection = await openConnection();
    const dir = await makeTempDir();
    const events = await createBatch(dir, 'roundtrip-batch', 120);
    await loadBatch(connection, dir, { runId: 'roundtrip-run' });

    const sql = `SELECT event_id::VARCHAR AS event_id, document_id::VARCHAR AS document_id, operation::VARCHAR AS operation, source_version::INTEGER AS source_version, strftime(CAST(source_updated_at AT TIME ZONE 'UTC' AS TIMESTAMP), '%Y-%m-%dT%H:%M:%SZ') AS source_updated_at, strftime(CAST(extracted_at AT TIME ZONE 'UTC' AS TIMESTAMP), '%Y-%m-%dT%H:%M:%SZ') AS extracted_at, schema_version::VARCHAR AS schema_version, batch_id::VARCHAR AS batch_id, region::VARCHAR AS region, payload::VARCHAR AS payload, source_file::VARCHAR AS source_file, source_file_row_number::INTEGER AS source_file_row_number FROM raw.wellbeing_submission_events WHERE source_file_row_number::INTEGER = $1 ORDER BY source_file_row_number::INTEGER LIMIT 1`;

    const firstRows = (await connection.runAndReadAll(sql, [1])).getRowObjects();
    const first = firstRows[0];
    expect(first).toBeDefined();
    const expectedFirst = events[0];
    expect(expectedFirst).toBeDefined();
    expect(first?.['event_id']).toBe(expectedFirst?.event_id);
    expect(first?.['document_id']).toBe(expectedFirst?.document_id);
    expect(first?.['operation']).toBe(expectedFirst?.operation);
    expect(Number(first?.['source_version'])).toBe(expectedFirst?.source_version);
    expect(first?.['source_updated_at']).toBe(expectedFirst?.source_updated_at);
    expect(first?.['extracted_at']).toBe(expectedFirst?.extracted_at);
    expect(first?.['schema_version']).toBe(expectedFirst?.schema_version);
    expect(first?.['batch_id']).toBe(expectedFirst?.batch_id);
    expect(first?.['region']).toBe(expectedFirst?.region);
    expect(JSON.parse(String(first?.['payload']))).toEqual(expectedFirst?.payload);
    expect(first?.['source_file']).toBe('roundtrip-batch/submissions.ndjson.gz');
    expect(Number(first?.['source_file_row_number'])).toBe(1);

    const lastRows = (await connection.runAndReadAll(sql, [120])).getRowObjects();
    const last = lastRows[0];
    expect(last).toBeDefined();
    const expectedLast = events[119];
    expect(expectedLast).toBeDefined();
    expect(last?.['event_id']).toBe(expectedLast?.event_id);
    expect(Number(last?.['source_file_row_number'])).toBe(120);
  });
});
