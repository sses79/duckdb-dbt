import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeBatch } from '../generator/batch.ts';
import type { SubmissionEvent } from '../generator/envelope.ts';
import { applyFoundation } from './foundation.ts';
import { LoadBatchError, loadBatch } from './loadBatch.ts';

let connection: DuckDBConnection;
const tempDirs: string[] = [];

beforeEach(async () => {
  connection = await (await DuckDBInstance.create(':memory:')).connect();
  tempDirs.length = 0;
  await applyFoundation(connection);
});

afterEach(async () => {
  connection.closeSync();
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

function makeEvent(batchId: string, index: number): SubmissionEvent {
  return {
    event_id: `evt_${batchId}_${index}`,
    document_id: `doc_${batchId}_${index}`,
    operation: 'upsert',
    source_version: 1,
    source_updated_at: '2018-10-01T00:00:00.000Z',
    extracted_at: '2019-01-02T03:04:05.000Z',
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
      answers: { q_01: index % 2 === 0 ? 'Often' : null },
      provenance: {
        trust_id: 'generated_for_demo',
        school_id: 'generated_for_demo',
        survey_period: 'generated_for_demo',
        source_updated_at: 'generated_for_demo',
        document_id: 'generated_for_demo',
      },
    },
  } as unknown as SubmissionEvent;
}

async function makeBatch(batchId: string, eventCount: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'loadBatch-'));
  tempDirs.push(dir);
  const events = Array.from({ length: eventCount }, (_, index) => makeEvent(batchId, index));
  await writeBatch({ events, outputDir: dir, batchId, scenario: 'test', expected: {} });
  return dir;
}

async function countRows(sql: string, values: DuckDBValue[]): Promise<number> {
  const rows = (await connection.runAndReadAll(sql, values)).getRowObjects();
  return Number(rows[0]?.n ?? 0);
}

async function tamperManifest(dir: string, field: 'data_file_sha256' | 'row_count'): Promise<void> {
  const manifestFile = join(dir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as Record<string, unknown>;
  if (field === 'data_file_sha256') {
    manifest.data_file_sha256 = 'f'.repeat(64);
  } else {
    manifest.row_count = Number(manifest.row_count) + 1;
  }
  await writeFile(manifestFile, JSON.stringify(manifest));
}

describe('loadBatch', () => {
  it('loads a valid 120-event batch and records a succeeded pipeline run', async () => {
    const batchId = 'valid-120';
    const dir = await makeBatch(batchId, 120);

    const result = await loadBatch(connection, dir);

    expect(result).toEqual({ status: 'loaded', batchId, rowsLoaded: 120 });
    expect(
      await countRows(
        'SELECT count(*)::INTEGER AS n FROM raw.wellbeing_submission_events WHERE batch_id = $1',
        [batchId],
      ),
    ).toBe(120);
    expect(
      await countRows('SELECT count(*)::INTEGER AS n FROM raw.loaded_batches WHERE batch_id = $1', [batchId]),
    ).toBe(1);
    expect(
      await countRows(
        "SELECT count(*)::INTEGER AS n FROM audit.pipeline_runs WHERE step = 'load' AND status = 'succeeded' AND batch_id = $1",
        [batchId],
      ),
    ).toBe(1);

    const rows = (
      await connection.runAndReadAll(
        `SELECT event_id, document_id, operation, source_version, source_updated_at::VARCHAR AS source_updated_at, extracted_at::VARCHAR AS extracted_at, schema_version, batch_id, region, payload::VARCHAR AS payload, source_file, source_file_row_number FROM raw.wellbeing_submission_events WHERE batch_id = $1 ORDER BY source_file_row_number`,
        [batchId],
      )
    ).getRowObjects();
    expect(rows).toHaveLength(120);

    const first = rows[0] as Record<string, DuckDBValue>;
    const firstEvent = makeEvent(batchId, 0);
    expect(first?.event_id).toBe('evt_valid-120_0');
    expect(first?.document_id).toBe(firstEvent.document_id);
    expect(first?.operation).toBe('upsert');
    expect(Number(first?.source_version)).toBe(1);
    expect(first?.schema_version).toBe('wellbeing-submission/1');
    expect(first?.batch_id).toBe(batchId);
    expect(first?.region).toBe('uk');
    expect(first?.source_file).toBe('valid-120/submissions.ndjson.gz');
    expect(Number(first?.source_file_row_number)).toBe(1);
    expect(JSON.parse(String(first?.payload))).toEqual(firstEvent.payload);
    expect(new Date(String(first?.source_updated_at)).toISOString()).toBe(firstEvent.source_updated_at);
    expect(new Date(String(first?.extracted_at)).toISOString()).toBe(firstEvent.extracted_at);

    const last = rows[119] as Record<string, DuckDBValue>;
    expect(last?.event_id).toBe('evt_valid-120_119');
    expect(Number(last?.source_file_row_number)).toBe(120);
  });

  it('returns already_loaded when the same batch is loaded again', async () => {
    const batchId = 'repeat-120';
    const dir = await makeBatch(batchId, 120);

    await loadBatch(connection, dir);
    const result = await loadBatch(connection, dir);

    expect(result).toEqual({ status: 'already_loaded', batchId, rowsLoaded: 0 });
    expect(
      await countRows(
        'SELECT count(*)::INTEGER AS n FROM raw.wellbeing_submission_events WHERE batch_id = $1',
        [batchId],
      ),
    ).toBe(120);
    expect(
      await countRows('SELECT count(*)::INTEGER AS n FROM raw.loaded_batches WHERE batch_id = $1', [batchId]),
    ).toBe(1);
    expect(
      await countRows(
        "SELECT count(*)::INTEGER AS n FROM audit.pipeline_runs WHERE step = 'load' AND status = 'skipped' AND batch_id = $1",
        [batchId],
      ),
    ).toBe(1);
  });

  it('refuses the same batch_id with a different data file checksum and leaves raw and ledger unchanged', async () => {
    const batchId = 'checksum-120';
    const dir = await makeBatch(batchId, 120);
    await loadBatch(connection, dir);

    const alteredDir = await makeBatch(batchId, 121);

    await expect(loadBatch(connection, alteredDir)).rejects.toBeInstanceOf(LoadBatchError);
    expect(
      await countRows(
        'SELECT count(*)::INTEGER AS n FROM raw.wellbeing_submission_events WHERE batch_id = $1',
        [batchId],
      ),
    ).toBe(120);
    expect(
      await countRows('SELECT count(*)::INTEGER AS n FROM raw.loaded_batches WHERE batch_id = $1', [batchId]),
    ).toBe(1);
    expect(
      await countRows(
        "SELECT count(*)::INTEGER AS n FROM audit.pipeline_runs WHERE step = 'load' AND status = 'failed' AND batch_id = $1",
        [batchId],
      ),
    ).toBe(1);
  });

  it('refuses a manifest whose checksum or row_count does not match the data file before writing any raw row', async () => {
    const checksumBatchId = 'tampered-checksum';
    const checksumDir = await makeBatch(checksumBatchId, 12);
    await tamperManifest(checksumDir, 'data_file_sha256');

    await expect(loadBatch(connection, checksumDir)).rejects.toBeInstanceOf(LoadBatchError);
    expect(
      await countRows(
        'SELECT count(*)::INTEGER AS n FROM raw.wellbeing_submission_events WHERE batch_id = $1',
        [checksumBatchId],
      ),
    ).toBe(0);
    expect(
      await countRows('SELECT count(*)::INTEGER AS n FROM raw.loaded_batches WHERE batch_id = $1', [
        checksumBatchId,
      ]),
    ).toBe(0);
    expect(
      await countRows(
        "SELECT count(*)::INTEGER AS n FROM audit.pipeline_runs WHERE step = 'load' AND status = 'failed' AND batch_id = $1",
        [checksumBatchId],
      ),
    ).toBe(1);

    const rowCountBatchId = 'tampered-row-count';
    const rowCountDir = await makeBatch(rowCountBatchId, 12);
    await tamperManifest(rowCountDir, 'row_count');

    await expect(loadBatch(connection, rowCountDir)).rejects.toBeInstanceOf(LoadBatchError);
    expect(
      await countRows(
        'SELECT count(*)::INTEGER AS n FROM raw.wellbeing_submission_events WHERE batch_id = $1',
        [rowCountBatchId],
      ),
    ).toBe(0);
    expect(
      await countRows('SELECT count(*)::INTEGER AS n FROM raw.loaded_batches WHERE batch_id = $1', [
        rowCountBatchId,
      ]),
    ).toBe(0);
    expect(
      await countRows(
        "SELECT count(*)::INTEGER AS n FROM audit.pipeline_runs WHERE step = 'load' AND status = 'failed' AND batch_id = $1",
        [rowCountBatchId],
      ),
    ).toBe(1);
  });

  it('loads 1,201 events across three chunks with placeholders restarting at $1', async () => {
    const batchId = 'large-1201';
    const dir = await makeBatch(batchId, 1201);

    const result = await loadBatch(connection, dir);

    expect(result.status).toBe('loaded');
    expect(result.rowsLoaded).toBe(1201);
    expect(
      await countRows(
        'SELECT count(*)::INTEGER AS n FROM raw.wellbeing_submission_events WHERE batch_id = $1',
        [batchId],
      ),
    ).toBe(1201);
  });

  it('wraps unexpected database errors in LoadBatchError with the underlying message', async () => {
    const batchId = 'db-error';
    const dir = await makeBatch(batchId, 5);
    await connection.run('DROP TABLE raw.wellbeing_submission_events');

    const caught = await loadBatch(connection, dir).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(LoadBatchError);
    expect((caught as Error).message).toContain('wellbeing_submission_events');
    expect(
      await countRows(
        "SELECT count(*)::INTEGER AS n FROM audit.pipeline_runs WHERE step = 'load' AND status = 'failed' AND batch_id = $1",
        [batchId],
      ),
    ).toBe(1);
  });
});
