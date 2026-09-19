// The `pipeline` check. Runs the local path end to end in a temporary directory so the
// working tree is never written to: build a synthetic survey source, generate a batch,
// load it into DuckDB, prove reload is idempotent, then run dbt build on the same file.
// dbt is DBT_EXECUTABLE when set (factory runs get a fixed PATH), otherwise `dbt` on PATH.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBConnection } from '@duckdb/node-api';

import { writeBatch } from '../src/generator/batch.ts';
import { buildSubmissionEvent } from '../src/generator/envelope.ts';
import { parseSurveySource } from '../src/generator/source.ts';
import type { SourceResponse } from '../src/generator/source.ts';
import { buildSyntheticSurveyCsv } from '../src/generator/testing/syntheticSurvey.ts';
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
    const events = responses.map((response) =>
      buildSubmissionEvent(response, {
        batchId: 'batch_pipeline_check',
        extractedAt: '2019-07-31T00:00:00.000Z',
      }),
    );
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
    connection.closeSync();
    instance.closeSync();
  } catch (error) {
    throw stepError('reload', error);
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
  console.log('pipeline: ok');
} catch (error) {
  console.error(`pipeline: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
