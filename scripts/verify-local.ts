// The `pipeline` check. Runs the local path end to end in a temporary directory so the
// working tree is never written to: build a synthetic survey source, generate a batch,
// load it into DuckDB, prove reload is idempotent, then run dbt build on the same file.
// dbt is DBT_EXECUTABLE when set (factory runs get a fixed PATH), otherwise `dbt` on PATH.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBConnection } from '@duckdb/node-api';

import { writeBatch } from '../src/generator/batch.ts';
import { buildSubmissionEvent } from '../src/generator/envelope.ts';
import { buildMutationDeliveries } from '../src/generator/mutations.ts';
import { parseSurveySource } from '../src/generator/source.ts';
import type { SourceResponse } from '../src/generator/source.ts';
import { buildSyntheticSurveyCsv } from '../src/generator/testing/syntheticSurvey.ts';
import { exportTenants, TENANTS } from '../src/publication/exportTenants.ts';
import { applyFoundation } from '../src/warehouse/foundation.ts';
import { loadBatch } from '../src/warehouse/loadBatch.ts';

function step(name: string, argv: [string, ...string[]], env: NodeJS.ProcessEnv): void {
  const [command, ...args] = argv;
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.error) throw new Error(`${name} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${name} failed with exit code ${String(result.status)}`);
}

function stepError(name: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${name}: ${message}`);
}

const workDir = mkdtempSync(join(tmpdir(), 'wellbeing-pipeline-'));
try {
  let csv: string;
  let baselineEvents: ReturnType<typeof buildSubmissionEvent>[] = [];
  let firstMutationDir: string | null = null;
  console.log('pipeline: fixture');
  try {
    csv = buildSyntheticSurveyCsv({ rows: 1200, seed: 20260918 });
    writeFileSync(join(workDir, 'source.csv'), csv);
  } catch (error) {
    throw stepError('fixture', error);
  }

  let responses: SourceResponse[];
  console.log('pipeline: generate');
  try {
    const survey = parseSurveySource(csv);
    responses = survey.responses;
    baselineEvents = responses.map((response) =>
      buildSubmissionEvent(response, {
        batchId: 'batch_pipeline_check',
        extractedAt: '2019-07-31T00:00:00.000Z',
      }),
    );
    const events = baselineEvents;
    await writeBatch({
      events,
      outputDir: join(workDir, 'batch'),
      batchId: 'batch_pipeline_check',
      scenario: 'initial_load',
      expected: { current_documents: responses.length },
    });
  } catch (error) {
    throw stepError('generate', error);
  }

  let instance: DuckDBInstance;
  let connection: DuckDBConnection;
  console.log('pipeline: load');
  try {
    instance = await DuckDBInstance.create(join(workDir, 'wellbeing.duckdb'));
    connection = await instance.connect();
    await applyFoundation(connection);
    const loaded = await loadBatch(connection, join(workDir, 'batch'));
    if (loaded.status !== 'loaded') {
      throw new Error(`expected status 'loaded', got '${loaded.status}'`);
    }
    if (loaded.rowsLoaded !== responses.length) {
      throw new Error(`expected ${responses.length} rows loaded, got ${loaded.rowsLoaded}`);
    }
  } catch (error) {
    throw stepError('load', error);
  }

  console.log('pipeline: reload');
  try {
    const reloaded = await loadBatch(connection, join(workDir, 'batch'));
    if (reloaded.status !== 'already_loaded') {
      throw new Error(`expected status 'already_loaded', got '${reloaded.status}'`);
    }
  } catch (error) {
    throw stepError('reload', error);
  }

  console.log('pipeline: mutations');
  try {
    const deliveries = buildMutationDeliveries(baselineEvents.slice(0, 4));
    const baseline = await connection.runAndReadAll(
      'SELECT count(*)::INTEGER AS n FROM raw.wellbeing_submission_events',
    );
    const baselineRows = Number(baseline.getRowObjects()[0]?.n ?? 0);

    for (const delivery of deliveries) {
      const batchDir = join(workDir, 'mutations', delivery.batchId);
      if (firstMutationDir === null) {
        firstMutationDir = batchDir;
      }
      const manifest = await writeBatch({
        events: delivery.events,
        outputDir: batchDir,
        batchId: delivery.batchId,
        scenario: delivery.scenario,
        expected: delivery.expected,
      });
      const loaded = await loadBatch(connection, batchDir);
      if (loaded.status !== 'loaded') {
        throw new Error(`expected status 'loaded', got '${loaded.status}'`);
      }
      if (loaded.rowsLoaded !== manifest.row_count) {
        throw new Error(`expected ${manifest.row_count} rows loaded, got ${loaded.rowsLoaded}`);
      }
    }

    const rows = await connection.runAndReadAll(
      'SELECT count(*)::INTEGER AS n FROM raw.wellbeing_submission_events',
    );
    const rowCount = Number(rows.getRowObjects()[0]?.n ?? 0);
    if (rowCount !== baselineRows + 7) {
      throw new Error(`expected ${baselineRows + 7} rows after mutation deliveries, got ${rowCount}`);
    }

    const mutationBatchIds = deliveries.map((delivery) => delivery.batchId);
    const placeholders = mutationBatchIds.map((_, index) => `$${index + 1}`).join(', ');
    const batchRows = (
      await connection.runAndReadAll(
        `SELECT batch_id, count(*)::INTEGER AS n FROM raw.wellbeing_submission_events WHERE batch_id IN (${placeholders}) GROUP BY batch_id`,
        mutationBatchIds,
      )
    ).getRowObjects();
    const rowsByBatch = new Map<string, number>();
    for (const row of batchRows) {
      rowsByBatch.set(String(row.batch_id), Number(row.n ?? 0));
    }
    const expectedByBatch = new Map<string, number>();
    for (const delivery of deliveries) {
      expectedByBatch.set(delivery.batchId, delivery.events.length);
    }
    for (const [batchId, expectedCount] of expectedByBatch) {
      const actualCount = rowsByBatch.get(batchId);
      if (actualCount !== expectedCount) {
        throw new Error(`expected ${expectedCount} mutation rows for ${batchId}, got ${String(actualCount)}`);
      }
    }
  } catch (error) {
    throw stepError('mutations', error);
  }

  console.log('pipeline: mutation reload');
  try {
    if (firstMutationDir === null) {
      throw new Error('no mutation delivery was created');
    }
    const before = await connection.runAndReadAll(
      'SELECT count(*)::INTEGER AS n FROM raw.wellbeing_submission_events',
    );
    const beforeCount = Number(before.getRowObjects()[0]?.n ?? 0);
    const reloaded = await loadBatch(connection, firstMutationDir);
    if (reloaded.status !== 'already_loaded') {
      throw new Error(`expected status 'already_loaded', got '${reloaded.status}'`);
    }
    const after = await connection.runAndReadAll(
      'SELECT count(*)::INTEGER AS n FROM raw.wellbeing_submission_events',
    );
    const afterCount = Number(after.getRowObjects()[0]?.n ?? 0);
    if (afterCount !== beforeCount) {
      throw new Error(`expected ${beforeCount} rows, got ${afterCount}`);
    }
    connection.closeSync();
    instance.closeSync();
  } catch (error) {
    throw stepError('mutation reload', error);
  }

  console.log('pipeline: dbt build');
  const env = { ...process.env, DUCKDB_PATH: join(workDir, 'wellbeing.duckdb') };
  step(
    'dbt build',
    [
      process.env.DBT_EXECUTABLE ?? 'dbt',
      'build',
      '--project-dir',
      'dbt',
      '--profiles-dir',
      'dbt',
      '--target-path',
      join(workDir, 'dbt-target'),
      '--log-path',
      join(workDir, 'dbt-logs')
    ],
    env
  );

  console.log('pipeline: equivalence');
  try {
    const snapshotInstance = await DuckDBInstance.create(join(workDir, 'wellbeing.duckdb'));
    const snapshotConnection = await snapshotInstance.connect();
    try {
      await snapshotConnection.run(
        'create or replace table core.fct_equivalence_snapshot as select * from core.fct_wellbeing_response',
      );
      await snapshotConnection.run(
        'create or replace table marts.mart_equivalence_snapshot as select * from marts.mart_school_wellbeing_trend',
      );
    } finally {
      snapshotConnection.closeSync();
      snapshotInstance.closeSync();
    }

    step(
      'dbt build (full refresh)',
      [
        process.env.DBT_EXECUTABLE ?? 'dbt',
        'build',
        '--project-dir',
        'dbt',
        '--profiles-dir',
        'dbt',
        '--target-path',
        join(workDir, 'dbt-target'),
        '--log-path',
        join(workDir, 'dbt-logs'),
        '--full-refresh',
      ],
      env,
    );

    const verifyInstance = await DuckDBInstance.create(join(workDir, 'wellbeing.duckdb'));
    const verifyConnection = await verifyInstance.connect();
    try {
      const relations = [
        ['core.fct_wellbeing_response', 'core.fct_equivalence_snapshot'],
        ['marts.mart_school_wellbeing_trend', 'marts.mart_equivalence_snapshot'],
      ] as const;
      for (const [relation, snapshot] of relations) {
        const incrementalMinusSnapshot = Number(
          (
            await verifyConnection.runAndReadAll(
              `SELECT count(*)::INTEGER AS n FROM (SELECT * FROM ${relation} EXCEPT SELECT * FROM ${snapshot})`,
            )
          ).getRowObjects()[0]?.n ?? 0,
        );
        if (incrementalMinusSnapshot !== 0) {
          throw new Error(
            `${relation} differs in direction incremental-minus-snapshot (${incrementalMinusSnapshot} rows)`,
          );
        }
        const snapshotMinusIncremental = Number(
          (
            await verifyConnection.runAndReadAll(
              `SELECT count(*)::INTEGER AS n FROM (SELECT * FROM ${snapshot} EXCEPT SELECT * FROM ${relation})`,
            )
          ).getRowObjects()[0]?.n ?? 0,
        );
        if (snapshotMinusIncremental !== 0) {
          throw new Error(
            `${relation} differs in direction snapshot-minus-incremental (${snapshotMinusIncremental} rows)`,
          );
        }
      }
      console.log('pipeline: equivalence: incremental and full-refresh results are equivalent');
    } finally {
      await verifyConnection.run('drop table if exists core.fct_equivalence_snapshot');
      await verifyConnection.run('drop table if exists marts.mart_equivalence_snapshot');
      verifyConnection.closeSync();
      verifyInstance.closeSync();
    }
  } catch (error) {
    throw stepError('equivalence', error);
  }

  console.log('pipeline: export');
  try {
    const instance = await DuckDBInstance.create(join(workDir, 'wellbeing.duckdb'));
    const connection = await instance.connect();
    await exportTenants(connection, {
      exportRoot: join(workDir, 'exports'),
      runId: 'pipeline_check',
    });

    const current = JSON.parse(readFileSync(join(workDir, 'exports', 'current.json'), 'utf8')) as {
      run_id: string;
      tenants: Record<string, string>;
    };
    if (current.run_id !== 'pipeline_check') {
      throw new Error(`expected current.json run_id 'pipeline_check', got '${current.run_id}'`);
    }
    for (const tenant of TENANTS) {
      const tenantRun = `run_id=pipeline_check/tenant=${tenant}`;
      if (current.tenants[tenant] !== tenantRun) {
        throw new Error(
          `expected current.json tenants[${tenant}] to be '${tenantRun}', got '${current.tenants[tenant]}'`,
        );
      }
      const manifestPath = join(workDir, 'exports', tenantRun, 'publication_manifest.json');
      if (!existsSync(manifestPath)) {
        throw new Error(`expected manifest to exist at ${manifestPath}`);
      }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        files: Array<{ row_count: number }>;
      };
      const rowCount = manifest.files[0]?.row_count ?? 0;
      if (rowCount <= 0) {
        throw new Error(`expected ${manifestPath} files[0].row_count to be greater than 0, got ${rowCount}`);
      }
      console.log(`pipeline: export ${tenant} ${rowCount} rows`);
    }
    connection.closeSync();
    instance.closeSync();
  } catch (error) {
    throw stepError('export', error);
  }
  console.log('pipeline: ok');
} catch (error) {
  console.error(`pipeline: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
