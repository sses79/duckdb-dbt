import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DuckDBConnection } from '@duckdb/node-api';
import { parse } from 'csv-parse/sync';

export const TENANTS = ['trust_north', 'trust_south'] as const;

export const TREND_COLUMNS = [
  'trust_id',
  'school_id',
  'school_classification',
  'survey_period',
  'question_code',
  'category',
  'eligible_submission_count',
  'answered_response_count',
  'missing_response_count',
  'adverse_response_count',
  'adverse_response_rate',
  'is_suppressed',
] as const;

const DIMENSION_COLUMNS = [
  'trust_id',
  'school_id',
  'school_classification',
  'survey_period',
  'question_code',
  'category',
] as const;

const SUPPRESSED_VALUE_COLUMNS = ['adverse_response_count', 'adverse_response_rate'] as const;

const SCHEMA_VERSION = 'wellbeing-publication/1';
const TREND_CSV_FILE = 'school_wellbeing_trend.csv';
const MANIFEST_FILE = 'publication_manifest.json';
const CURRENT_FILE = 'current.json';
const CURRENT_TMP_FILE = 'current.json.tmp';

export class ExportTenantsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportTenantsError';
  }
}

export interface ExportTenantsOptions {
  exportRoot: string;
  runId: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function validateTenantExport(filePath: string, tenant: string, expectedRowCount: number): void {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new ExportTenantsError(`Failed to read export file ${filePath}: ${messageOf(error)}`);
  }

  let rows: string[][];
  try {
    rows = parse(text, { columns: false }) as string[][];
  } catch (error) {
    throw new ExportTenantsError(`Failed to parse export file ${filePath}: ${messageOf(error)}`);
  }

  const header = rows[0] ?? [];
  const headerMatches =
    header.length === TREND_COLUMNS.length && header.every((column, index) => column === TREND_COLUMNS[index]);
  if (!headerMatches) {
    throw new ExportTenantsError(
      `Export file ${filePath} header must be exactly ${TREND_COLUMNS.join(', ')}; got ${header.join(', ')}`,
    );
  }

  let records: Array<Record<string, string | undefined>>;
  try {
    records = parse(text, { columns: true }) as Array<Record<string, string | undefined>>;
  } catch (error) {
    throw new ExportTenantsError(`Failed to parse export file ${filePath}: ${messageOf(error)}`);
  }

  if (records.length !== expectedRowCount) {
    throw new ExportTenantsError(`Export file ${filePath} has ${records.length} rows; expected ${expectedRowCount}`);
  }

  for (const [index, record] of records.entries()) {
    const rowNumber = index + 2;
    for (const column of DIMENSION_COLUMNS) {
      const value = record[column];
      if (value === undefined || value === '') {
        throw new ExportTenantsError(`Export file ${filePath} row ${rowNumber} has an empty ${column}`);
      }
    }
    if (record.trust_id !== tenant) {
      throw new ExportTenantsError(
        `Export file ${filePath} row ${rowNumber} trust_id must be ${tenant}; got ${String(record.trust_id)}`,
      );
    }
    if (record.is_suppressed === 'true') {
      for (const column of SUPPRESSED_VALUE_COLUMNS) {
        const value = record[column];
        if (value !== undefined && value !== '') {
          throw new ExportTenantsError(
            `Export file ${filePath} row ${rowNumber} must have an empty ${column} for a suppressed row`,
          );
        }
      }
    }
  }
}

export async function exportTenants(connection: DuckDBConnection, options: ExportTenantsOptions): Promise<void> {
  const { exportRoot, runId } = options;
  const runPath = join(exportRoot, `run_id=${runId}`);

  try {
    if (existsSync(runPath)) {
      throw new ExportTenantsError(`Refusing to export: ${runPath} already exists`);
    }
    mkdirSync(runPath, { recursive: true });

    const publishedAt = new Date().toISOString();

    for (const tenant of TENANTS) {
      const tenantPath = join(runPath, `tenant=${tenant}`);
      mkdirSync(tenantPath, { recursive: true });
      const csvPath = join(tenantPath, TREND_CSV_FILE);

      await connection.run(
        `COPY (SELECT ${TREND_COLUMNS.join(', ')} FROM marts.mart_school_wellbeing_trend WHERE trust_id = '${tenant}' ORDER BY school_id, school_classification, survey_period, question_code) TO '${csvPath.replaceAll("'", "''")}' (FORMAT CSV, HEADER)`,
      );

      const countRows = (
        await connection.runAndReadAll(
          `SELECT count(*)::INTEGER AS n FROM marts.mart_school_wellbeing_trend WHERE trust_id = '${tenant}'`,
        )
      ).getRowObjects();
      const expectedRowCount = Number(countRows[0]?.n ?? 0);

      validateTenantExport(csvPath, tenant, expectedRowCount);

      const bytes = readFileSync(csvPath);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const file = { file_name: TREND_CSV_FILE, row_count: expectedRowCount, sha256 };
      const manifest = {
        schema_version: SCHEMA_VERSION,
        run_id: runId,
        tenant,
        created_at: publishedAt,
        files: [file],
      };
      writeFileSync(join(tenantPath, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);

      await connection.run(
        'INSERT INTO audit.publications (run_id, tenant, file_name, row_count, sha256, created_at) VALUES ($1, $2, $3, $4, $5, $6::TIMESTAMPTZ)',
        [runId, tenant, TREND_CSV_FILE, expectedRowCount, sha256, publishedAt],
      );
    }

    const tenants: Record<string, string> = {};
    for (const tenant of TENANTS) {
      tenants[tenant] = `run_id=${runId}/tenant=${tenant}`;
    }
    const current = { run_id: runId, published_at: publishedAt, tenants };
    const tmpPath = join(exportRoot, CURRENT_TMP_FILE);
    writeFileSync(tmpPath, `${JSON.stringify(current, null, 2)}\n`);
    renameSync(tmpPath, join(exportRoot, CURRENT_FILE));
  } catch (error) {
    if (error instanceof ExportTenantsError) {
      throw error;
    }
    throw new ExportTenantsError(messageOf(error));
  }
}
