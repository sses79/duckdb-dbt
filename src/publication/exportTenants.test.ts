import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBConnection } from '@duckdb/node-api';
import { parse } from 'csv-parse/sync';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyFoundation } from '../warehouse/foundation.ts';
import {
  ExportTenantsError,
  TENANTS,
  TREND_COLUMNS,
  exportTenants,
  validateTenantExport,
} from './exportTenants.ts';

const MART_TABLE = 'marts.mart_school_wellbeing_trend';
const TREND_CSV_FILE = 'school_wellbeing_trend.csv';
const MANIFEST_FILE = 'publication_manifest.json';
const CURRENT_FILE = 'current.json';

let connection!: DuckDBConnection;
let exportRoot!: string;

beforeEach(async () => {
  connection = await (await DuckDBInstance.create(':memory:')).connect();
  await applyFoundation(connection);
  await connection.run(
    `CREATE TABLE ${MART_TABLE} (
      trust_id VARCHAR,
      school_id VARCHAR,
      school_classification VARCHAR,
      survey_period VARCHAR,
      question_code VARCHAR,
      category VARCHAR,
      eligible_submission_count INTEGER,
      answered_response_count INTEGER,
      missing_response_count INTEGER,
      adverse_response_count INTEGER,
      adverse_response_rate DOUBLE,
      is_suppressed BOOLEAN
    )`,
  );
  await connection.run(
    `INSERT INTO ${MART_TABLE} (trust_id, school_id, school_classification, survey_period, question_code, category, eligible_submission_count, answered_response_count, missing_response_count, adverse_response_count, adverse_response_rate, is_suppressed) VALUES
      ('trust_north', 'school_a', 'Secondary', '2018-autumn', 'feel_sad', 'emotional_wellbeing', 10, 10, 0, 3, 0.3, false),
      ('trust_north', 'school_b', 'Secondary', '2018-autumn', 'feel_sad', 'emotional_wellbeing', 10, 9, 1, NULL, NULL, true),
      ('trust_south', 'school_c', 'Primary', '2019-spring', 'feel_worried', 'emotional_wellbeing', 20, 18, 2, 5, 0.25, false)`,
  );
  exportRoot = mkdtempSync(join(tmpdir(), 'tenant-export-'));
});

afterEach(() => {
  connection.closeSync();
  rmSync(exportRoot, { recursive: true, force: true });
});

function trendRow(overrides: Record<string, string> = {}): string {
  const values: Record<string, string> = {
    trust_id: 'trust_north',
    school_id: 'school_a',
    school_classification: 'Secondary',
    survey_period: '2018-autumn',
    question_code: 'feel_sad',
    category: 'emotional_wellbeing',
    eligible_submission_count: '10',
    answered_response_count: '10',
    missing_response_count: '0',
    adverse_response_count: '3',
    adverse_response_rate: '0.3',
    is_suppressed: 'false',
  };
  for (const [column, value] of Object.entries(overrides)) {
    values[column] = value;
  }
  return TREND_COLUMNS.map((column) => values[column] ?? '').join(',');
}

function writeTrendCsv(filePath: string, rows: string[]): void {
  writeFileSync(filePath, `${TREND_COLUMNS.join(',')}\n${rows.join('\n')}\n`);
}

async function martCount(tenant: string): Promise<number> {
  const rows = (
    await connection.runAndReadAll(
      'SELECT count(*)::INTEGER AS n FROM marts.mart_school_wellbeing_trend WHERE trust_id = $1',
      [tenant],
    )
  ).getRowObjects();
  return Number(rows[0]?.n ?? 0);
}

describe('exportTenants', () => {
  it('writes per-tenant CSVs, manifests, audit rows and current.json', async () => {
    const runId = 'run_a';
    await exportTenants(connection, { exportRoot, runId });

    const runPath = join(exportRoot, `run_id=${runId}`);
    for (const tenant of TENANTS) {
      const tenantPath = join(runPath, `tenant=${tenant}`);
      const csvPath = join(tenantPath, TREND_CSV_FILE);
      const csvBytes = readFileSync(csvPath);
      const rows = parse(csvBytes, { columns: true }) as Array<Record<string, string>>;

      expect(rows.length).toBe(await martCount(tenant));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.trust_id).toBe(tenant);
      }

      const manifest = JSON.parse(
        readFileSync(join(tenantPath, MANIFEST_FILE), 'utf8'),
      ) as Record<string, unknown>;
      expect(manifest.schema_version).toBe('wellbeing-publication/1');
      expect(manifest.run_id).toBe(runId);
      expect(manifest.tenant).toBe(tenant);
      expect(typeof manifest.created_at).toBe('string');
      const files = manifest.files as Array<Record<string, unknown>>;
      expect(files).toHaveLength(1);
      expect(files[0]?.file_name).toBe(TREND_CSV_FILE);
      expect(files[0]?.row_count).toBe(rows.length);
      expect(files[0]?.sha256).toBe(createHash('sha256').update(csvBytes).digest('hex'));
    }

    const auditCount = await connection.runAndReadAll(
      'SELECT count(*)::INTEGER AS n FROM audit.publications',
    );
    expect(Number(auditCount.getRowObjects()[0]?.n ?? 0)).toBe(TENANTS.length);

    const auditTenants = (
      await connection.runAndReadAll('SELECT tenant FROM audit.publications ORDER BY tenant')
    ).getRowObjects();
    expect(auditTenants.map((row) => String(row.tenant))).toEqual(['trust_north', 'trust_south']);

    const current = JSON.parse(readFileSync(join(exportRoot, CURRENT_FILE), 'utf8')) as Record<string, unknown>;
    expect(current.run_id).toBe(runId);
    expect(typeof current.published_at).toBe('string');
    expect(current.tenants).toEqual({
      trust_north: 'run_id=run_a/tenant=trust_north',
      trust_south: 'run_id=run_a/tenant=trust_south',
    });
  });

  it('keeps adverse count and rate empty for suppressed rows', async () => {
    await exportTenants(connection, { exportRoot, runId: 'run_suppressed' });
    const rows = parse(
      readFileSync(join(exportRoot, 'run_id=run_suppressed', 'tenant=trust_north', TREND_CSV_FILE), 'utf8'),
      { columns: true },
    ) as Array<Record<string, string>>;
    const suppressed = rows.filter((row) => row.is_suppressed === 'true');
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]?.school_id).toBe('school_b');
    expect(suppressed[0]?.adverse_response_count).toBe('');
    expect(suppressed[0]?.adverse_response_rate).toBe('');
  });

  it('exports under a directory whose name contains a single quote', async () => {
    const quotedRoot = join(exportRoot, "o'brien");
    await exportTenants(connection, { exportRoot: quotedRoot, runId: 'run_q' });

    for (const tenant of TENANTS) {
      const csvPath = join(quotedRoot, 'run_id=run_q', `tenant=${tenant}`, TREND_CSV_FILE);
      const rows = parse(readFileSync(csvPath, 'utf8'), { columns: true }) as Array<Record<string, string>>;
      expect(rows.length).toBe(await martCount(tenant));
    }
    const current = JSON.parse(readFileSync(join(quotedRoot, CURRENT_FILE), 'utf8')) as { run_id: string };
    expect(current.run_id).toBe('run_q');
  });

  it('refuses to export under an existing run_id', async () => {
    const runId = 'run_existing';
    mkdirSync(join(exportRoot, `run_id=${runId}`), { recursive: true });
    await expect(exportTenants(connection, { exportRoot, runId })).rejects.toBeInstanceOf(ExportTenantsError);
    expect(() => readFileSync(join(exportRoot, CURRENT_FILE), 'utf8')).toThrow();
  });

  it('leaves current.json naming run_a when a later run fails validation', async () => {
    await exportTenants(connection, { exportRoot, runId: 'run_a' });
    await connection.run(
      `INSERT INTO ${MART_TABLE} (trust_id, school_id, school_classification, survey_period, question_code, category, eligible_submission_count, answered_response_count, missing_response_count, adverse_response_count, adverse_response_rate, is_suppressed) VALUES ('trust_north', NULL, 'Secondary', '2020-summer', 'feel_sad', 'emotional_wellbeing', 1, 1, 0, 1, 1.0, false)`,
    );
    await expect(exportTenants(connection, { exportRoot, runId: 'run_b' })).rejects.toBeInstanceOf(
      ExportTenantsError,
    );

    const current = JSON.parse(readFileSync(join(exportRoot, CURRENT_FILE), 'utf8')) as Record<string, unknown>;
    expect(current.run_id).toBe('run_a');
    expect(current.tenants).toEqual({
      trust_north: 'run_id=run_a/tenant=trust_north',
      trust_south: 'run_id=run_a/tenant=trust_south',
    });
  });
});

describe('validateTenantExport', () => {
  it('accepts a valid file for the tenant', () => {
    const csvPath = join(exportRoot, 'valid.csv');
    writeTrendCsv(csvPath, [
      trendRow(),
      trendRow({
        school_id: 'school_b',
        answered_response_count: '9',
        missing_response_count: '1',
        adverse_response_count: '',
        adverse_response_rate: '',
        is_suppressed: 'true',
      }),
    ]);
    expect(() => validateTenantExport(csvPath, 'trust_north', 2)).not.toThrow();
  });

  it('refuses a file with an extra document_id column', () => {
    const csvPath = join(exportRoot, 'extra-document-id.csv');
    writeFileSync(csvPath, `${[...TREND_COLUMNS, 'document_id'].join(',')}\n${trendRow()},doc_1\n`);
    expect(() => validateTenantExport(csvPath, 'trust_north', 1)).toThrow(ExportTenantsError);
  });

  it('refuses a row from the other tenant', () => {
    const csvPath = join(exportRoot, 'other-tenant.csv');
    writeTrendCsv(csvPath, [trendRow({ trust_id: 'trust_south' })]);
    expect(() => validateTenantExport(csvPath, 'trust_north', 1)).toThrow(ExportTenantsError);
  });

  it('refuses a row with an empty school_id', () => {
    const csvPath = join(exportRoot, 'empty-school-id.csv');
    writeTrendCsv(csvPath, [trendRow({ school_id: '' })]);
    expect(() => validateTenantExport(csvPath, 'trust_north', 1)).toThrow(ExportTenantsError);
  });

  it('refuses a row count mismatch', () => {
    const csvPath = join(exportRoot, 'row-count.csv');
    writeTrendCsv(csvPath, [trendRow(), trendRow({ school_id: 'school_b' })]);
    expect(() => validateTenantExport(csvPath, 'trust_north', 1)).toThrow(ExportTenantsError);
  });

  it('refuses a suppressed row with populated adverse values', () => {
    const csvPath = join(exportRoot, 'suppressed-with-adverse.csv');
    writeTrendCsv(csvPath, [
      trendRow({
        answered_response_count: '9',
        missing_response_count: '1',
        adverse_response_count: '3',
        adverse_response_rate: '0.3',
        is_suppressed: 'true',
      }),
    ]);
    expect(() => validateTenantExport(csvPath, 'trust_north', 1)).toThrow(ExportTenantsError);
  });

  it('refuses a missing file', () => {
    expect(() => validateTenantExport(join(exportRoot, 'missing.csv'), 'trust_north', 0)).toThrow(
      ExportTenantsError,
    );
  });
});
