// The `pipeline` check. Runs the local path end to end in a temporary directory so the
// working tree is never written to: build a synthetic survey source, generate a batch,
// load it into DuckDB, prove reload is idempotent, then run dbt build on the same file.
// dbt is DBT_EXECUTABLE when set (factory runs get a fixed PATH), otherwise `dbt` on PATH.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { handleDashboardCsv, handleDashboardJson } from '../src/dashboard/http.ts';
import { DashboardReaderError, readTenantDashboard } from '../src/dashboard/reader.ts';
import { exportTenants, EXPORT_FILES, TENANTS } from '../src/publication/exportTenants.ts';
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
        join(workDir, 'dbt-logs'),
        '--full-refresh'
      ],
      env
    );

    const checkInstance = await DuckDBInstance.create(join(workDir, 'wellbeing.duckdb'));
    const checkConnection = await checkInstance.connect();
    try {
      const comparisons = [
        { relation: 'core.fct_wellbeing_response', snapshot: 'core.fct_equivalence_snapshot' },
        { relation: 'marts.mart_school_wellbeing_trend', snapshot: 'marts.mart_equivalence_snapshot' },
      ];
      for (const comparison of comparisons) {
        const fullRefreshOnly = await checkConnection.runAndReadAll(
          `SELECT count(*)::INTEGER AS n FROM (SELECT * FROM ${comparison.relation} EXCEPT SELECT * FROM ${comparison.snapshot})`,
        );
        const fullRefreshOnlyCount = Number(fullRefreshOnly.getRowObjects()[0]?.n ?? 0);
        if (fullRefreshOnlyCount !== 0) {
          throw new Error(
            `${comparison.relation} differs: ${fullRefreshOnlyCount} row(s) only in the full-refresh result`,
          );
        }
        const incrementalOnly = await checkConnection.runAndReadAll(
          `SELECT count(*)::INTEGER AS n FROM (SELECT * FROM ${comparison.snapshot} EXCEPT SELECT * FROM ${comparison.relation})`,
        );
        const incrementalOnlyCount = Number(incrementalOnly.getRowObjects()[0]?.n ?? 0);
        if (incrementalOnlyCount !== 0) {
          throw new Error(
            `${comparison.relation} differs: ${incrementalOnlyCount} row(s) only in the incremental result`,
          );
        }
      }
      console.log('pipeline: equivalence: incremental and full-refresh results are equivalent');
    } finally {
      await checkConnection.run('drop table if exists core.fct_equivalence_snapshot');
      await checkConnection.run('drop table if exists marts.mart_equivalence_snapshot');
      checkConnection.closeSync();
      checkInstance.closeSync();
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

  console.log('pipeline: publication');
  try {
    const exportRoot = join(workDir, 'exports');
    for (const tenant of TENANTS) {
      const tenantPath = join(exportRoot, `run_id=pipeline_check/tenant=${tenant}`);
      const manifestPath = join(tenantPath, 'publication_manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        files: Array<{ file_name: string; row_count: number; sha256: string }>;
      };
      const expectedFiles = [...EXPORT_FILES.map((spec) => spec.fileName), 'freshness.json', 'dashboard.json'];
      if (manifest.files.length !== expectedFiles.length) {
        throw new Error(`expected ${expectedFiles.length} files in ${manifestPath}, got ${manifest.files.length}`);
      }
      for (let index = 0; index < expectedFiles.length; index += 1) {
        const expected = expectedFiles[index];
        const actual = manifest.files[index]?.file_name;
        if (expected !== actual) {
          throw new Error(`expected manifest file ${index} to be '${String(expected)}', got '${String(actual)}'`);
        }
      }
      for (const entry of manifest.files) {
        const filePath = join(tenantPath, entry.file_name);
        const actualSha256 = createHash('sha256').update(readFileSync(filePath)).digest('hex');
        if (actualSha256 !== entry.sha256) {
          throw new Error(`expected sha256 of ${entry.file_name} to be ${entry.sha256}, got ${actualSha256}`);
        }
        if (entry.file_name !== 'freshness.json' && entry.row_count <= 0) {
          throw new Error(`expected ${entry.file_name} row_count to be greater than 0, got ${entry.row_count}`);
        }
      }
      const dashboard = await readTenantDashboard(exportRoot, tenant);
      const sections = [
        'indicator_analysis',
        'category_analysis',
        'change_drivers',
        'question_response_distribution',
        'support_signal_summary',
      ] as const;
      for (const section of sections) {
        for (const row of dashboard[section]) {
          if (row.trust_id !== tenant) {
            throw new Error(`expected ${section} rows to have trust_id '${tenant}', got '${String(row.trust_id)}'`);
          }
        }
      }
      console.log(
        `pipeline: publication ${tenant} ${sections.map((section) => `${section}=${dashboard[section].length}`).join(' ')}`,
      );
    }

    const copyRoot = join(workDir, 'exports-copy');
    cpSync(exportRoot, copyRoot, { recursive: true });
    const copyCurrentPath = join(copyRoot, 'current.json');
    const copyCurrent = JSON.parse(readFileSync(copyCurrentPath, 'utf8')) as {
      run_id: string;
      tenants: Record<string, string>;
    };
    copyCurrent.tenants.trust_north = 'run_id=pipeline_check/tenant=trust_south';
    writeFileSync(copyCurrentPath, `${JSON.stringify(copyCurrent, null, 2)}\n`);
    let refused = false;
    try {
      await readTenantDashboard(copyRoot, 'trust_north');
    } catch (error) {
      if (error instanceof DashboardReaderError) {
        refused = true;
      } else {
        throw error;
      }
    }
    if (!refused) {
      throw new Error('expected readTenantDashboard to refuse the cross-tenant pointer');
    }
    console.log('pipeline: publication cross-tenant pointer was refused');
  } catch (error) {
    throw stepError('publication', error);
  }

  console.log('pipeline: dashboard');
  try {
    const exportRoot = join(workDir, 'exports');
    const sections = [
      'indicator_analysis',
      'category_analysis',
      'change_drivers',
      'question_response_distribution',
      'support_signal_summary',
    ] as const;
    for (const tenant of TENANTS) {
      const env: Readonly<Record<string, string | undefined>> = {
        DASHBOARD_TENANT: tenant,
        DASHBOARD_EXPORT_ROOT: exportRoot,
      };
      const base = 'http://dashboard.check/api';

      const jsonResponse = await handleDashboardJson(new Request(base), env);
      const jsonBody = await jsonResponse.text();
      if (jsonResponse.status !== 200) {
        throw new Error(`${tenant} no query: expected json 200, got ${jsonResponse.status}`);
      }
      if (jsonBody.includes('document_id') || jsonBody.includes('event_id')) {
        throw new Error(`${tenant} no query: json body contains document_id or event_id`);
      }
      const dashboard = JSON.parse(jsonBody) as Record<string, Array<Record<string, unknown>>>;
      for (const section of sections) {
        const rows = dashboard[section];
        if (!Array.isArray(rows)) {
          throw new Error(`${tenant} no query: json body is missing ${section}`);
        }
        for (const row of rows) {
          if (row.trust_id !== tenant) {
            throw new Error(
              `${tenant} no query: expected ${section} rows to have trust_id '${tenant}', got '${String(row.trust_id)}'`,
            );
          }
          if (row.is_suppressed === true) {
            if (row.adverse_response_rate != null || row.response_rate != null) {
              throw new Error(
                `${tenant} no query: suppressed ${section} row has non-null adverse_response_rate or response_rate`,
              );
            }
          }
        }
      }

      const csvResponse = await handleDashboardCsv(
        new Request(`${base}?section=indicator_analysis`),
        env,
      );
      const csvBody = await csvResponse.text();
      if (csvResponse.status !== 200) {
        throw new Error(`${tenant} ?section=indicator_analysis: expected csv 200, got ${csvResponse.status}`);
      }
      const csvContentType = csvResponse.headers.get('content-type') ?? '';
      if (!csvContentType.startsWith('text/csv')) {
        throw new Error(
          `${tenant} ?section=indicator_analysis: expected content-type starting 'text/csv', got '${csvContentType}'`,
        );
      }
      if (!csvBody.startsWith('trust_id')) {
        throw new Error(`${tenant} ?section=indicator_analysis: expected header line beginning 'trust_id'`);
      }
      const csvStatus = csvResponse.status;

      const refusedQueries = [
        '?tenant=trust_south',
        '?trust_id=trust_south',
        '?school=..%2Fetc',
        '?school=a&school=b',
        '?unknown=1',
      ];
      let refused = 0;
      for (const query of refusedQueries) {
        const response = await handleDashboardJson(new Request(`${base}${query}`), env);
        const body = await response.text();
        if (response.status !== 400) {
          throw new Error(`${tenant} ${query}: expected 400, got ${response.status}`);
        }
        if (body.includes(exportRoot) || body.includes(workDir)) {
          throw new Error(`${tenant} ${query}: response body leaks exportRoot or workDir`);
        }
        refused += 1;
      }

      const otherTenant = TENANTS.find((candidate) => candidate !== tenant);
      if (otherTenant === undefined) {
        throw new Error(`${tenant}: expected another tenant in TENANTS`);
      }
      const otherDocument = await readTenantDashboard(exportRoot, otherTenant);
      let schoolCode: string | undefined;
      outer: for (const section of sections) {
        for (const row of otherDocument[section]) {
          const entries = Object.entries(row).filter(
            ([key, value]) => /school/i.test(key) && value !== null && value !== undefined,
          );
          const preferred = entries.find(
            ([key]) => key === 'school_id' || key === 'school_code' || key === 'school',
          );
          const entry = preferred ?? entries[0];
          if (entry !== undefined && String(entry[1]).length > 0) {
            schoolCode = String(entry[1]);
            break outer;
          }
        }
      }
      if (schoolCode === undefined) {
        throw new Error(`${tenant}: no school code found in the ${otherTenant} document`);
      }
      const schoolQuery = `?school=${encodeURIComponent(schoolCode)}`;
      const schoolResponse = await handleDashboardJson(new Request(`${base}${schoolQuery}`), env);
      const schoolBody = await schoolResponse.text();
      if (schoolResponse.status !== 400) {
        throw new Error(`${tenant} ${schoolQuery}: expected 400, got ${schoolResponse.status}`);
      }
      if (schoolBody.includes(exportRoot) || schoolBody.includes(workDir)) {
        throw new Error(`${tenant} ${schoolQuery}: response body leaks exportRoot or workDir`);
      }
      refused += 1;

      console.log(`pipeline: dashboard ${tenant} json=${jsonResponse.status} csv=${csvStatus} refused=${refused}`);
    }

    const copyRoot = join(workDir, 'exports-copy');
    const crossTenantResponse = await handleDashboardJson(
      new Request('http://dashboard.check/api'),
      { DASHBOARD_TENANT: 'trust_north', DASHBOARD_EXPORT_ROOT: copyRoot },
    );
    await crossTenantResponse.text();
    if (crossTenantResponse.status !== 503) {
      throw new Error(`cross-tenant pointer: expected 503, got ${crossTenantResponse.status}`);
    }
    console.log('pipeline: dashboard cross-tenant pointer was refused');
  } catch (error) {
    throw stepError('dashboard', error);
  }
  console.log('pipeline: ok');
} catch (error) {
  console.error(`pipeline: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
