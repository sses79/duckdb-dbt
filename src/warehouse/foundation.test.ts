import { DuckDBInstance } from '@duckdb/node-api';
import { describe, expect, it } from 'vitest';
import { applyFoundation, FOUNDATION_SQL_PATH } from './foundation.js';

const expectedTables: Record<string, string[]> = {
  'raw.wellbeing_submission_events': [
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
    'loaded_at',
  ],
  'raw.loaded_batches': [
    'batch_id',
    'data_file',
    'data_file_sha256',
    'schema_version',
    'row_count',
    'distinct_event_count',
    'scenario',
    'loaded_at',
  ],
  'audit.pipeline_runs': [
    'run_id',
    'step',
    'status',
    'batch_id',
    'rows_affected',
    'error_message',
    'started_at',
    'finished_at',
  ],
  'audit.publications': [
    'run_id',
    'tenant',
    'file_name',
    'row_count',
    'sha256',
    'created_at',
  ],
};

async function newConnection() {
  const instance = await DuckDBInstance.create(':memory:');
  return instance.connect();
}

describe('duckdb foundation', () => {
  it('points FOUNDATION_SQL_PATH at the foundation SQL file', () => {
    expect(FOUNDATION_SQL_PATH.href).toMatch(/infra\/duckdb\/00_foundation\.sql$/);
  });

  it('creates the raw, staging, core, marts and audit schemas', async () => {
    const connection = await newConnection();
    try {
      await applyFoundation(connection);
      const result = await connection.runAndReadAll(
        `SELECT schema_name
         FROM information_schema.schemata
         ORDER BY schema_name`,
      );
      const schemaNames = result.getRowObjects().map((row) => String(row.schema_name));
      expect(schemaNames).toEqual(
        expect.arrayContaining(['raw', 'staging', 'core', 'marts', 'audit']),
      );
    } finally {
      connection.closeSync();
    }
  });

  it('creates the four tables with exactly the documented columns', async () => {
    const connection = await newConnection();
    try {
      await applyFoundation(connection);
      const result = await connection.runAndReadAll(
        `SELECT table_schema, table_name, column_name
         FROM information_schema.columns
         ORDER BY table_schema, table_name, ordinal_position`,
      );
      const columnsByTable = new Map<string, string[]>();
      for (const row of result.getRowObjects()) {
        const table = `${String(row.table_schema)}.${String(row.table_name)}`;
        const columns = columnsByTable.get(table) ?? [];
        columns.push(String(row.column_name));
        columnsByTable.set(table, columns);
      }
      for (const [table, columns] of Object.entries(expectedTables)) {
        expect(columnsByTable.get(table)).toEqual(columns);
      }
    } finally {
      connection.closeSync();
    }
  });

  it('applies a second time without throwing and leaves inserted rows in place', async () => {
    const connection = await newConnection();
    try {
      await applyFoundation(connection);
      await connection.run(
        `INSERT INTO raw.loaded_batches (
           batch_id, data_file, data_file_sha256, schema_version,
           row_count, distinct_event_count, scenario, loaded_at
         ) VALUES (
           'batch-1', 'submissions.ndjson.gz', '0123456789abcdef',
           'v1', 3, 3, 'seed', current_timestamp
         )`,
      );
      await expect(applyFoundation(connection)).resolves.toBeUndefined();
      const result = await connection.runAndReadAll(
        'SELECT batch_id, row_count FROM raw.loaded_batches',
      );
      const [first] = result.getRowObjects();
      expect(first).toBeDefined();
      if (first !== undefined) {
        expect(first).toMatchObject({ batch_id: 'batch-1' });
        expect(Number(first.row_count)).toBe(3);
      }
    } finally {
      connection.closeSync();
    }
  });

  it('rejects a second loaded_batches row with the same batch_id', async () => {
    const connection = await newConnection();
    try {
      await applyFoundation(connection);
      await connection.run(
        `INSERT INTO raw.loaded_batches (
           batch_id, data_file, data_file_sha256, schema_version,
           row_count, distinct_event_count, scenario, loaded_at
         ) VALUES (
           'batch-1', 'submissions.ndjson.gz', '0123456789abcdef',
           'v1', 3, 3, 'seed', current_timestamp
         )`,
      );
      await expect(
        connection.run(
          `INSERT INTO raw.loaded_batches (
             batch_id, data_file, data_file_sha256, schema_version,
             row_count, distinct_event_count, scenario, loaded_at
           ) VALUES (
             'batch-1', 'submissions.ndjson.gz', 'fedcba9876543210',
             'v2', 4, 4, 'seed', current_timestamp
           )`,
        ),
      ).rejects.toThrow();
    } finally {
      connection.closeSync();
    }
  });
});
