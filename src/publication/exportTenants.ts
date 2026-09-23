import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DuckDBConnection } from '@duckdb/node-api';
import { parse } from 'csv-parse/sync';

import { buildTenantDashboard, buildTenantFreshness, validateTenantDashboard } from './dashboardJson.ts';

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

export interface ExportFileSpec {
  fileName: string;
  relation: string;
  columns: readonly string[];
  dimensionColumns: readonly string[];
  suppressedColumns: readonly string[];
  tenantScoped: boolean;
  orderBy: readonly string[];
}

const TREND_SPEC: ExportFileSpec = {
  fileName: 'school_wellbeing_trend.csv',
  relation: 'marts.mart_school_wellbeing_trend',
  columns: TREND_COLUMNS,
  dimensionColumns: [
    'trust_id',
    'school_id',
    'school_classification',
    'survey_period',
    'question_code',
    'category',
  ],
  suppressedColumns: ['adverse_response_count', 'adverse_response_rate'],
  tenantScoped: true,
  orderBy: ['school_id', 'school_classification', 'survey_period', 'question_code'],
};

export const EXPORT_FILES: readonly ExportFileSpec[] = [
  TREND_SPEC,
  {
    fileName: 'indicator_analysis.csv',
    relation: 'marts.mart_school_indicator_analysis',
    columns: [
      'trust_id',
      'school_id',
      'school_classification',
      'survey_period',
      'question_code',
      'indicator_label',
      'category_code',
      'category_label',
      'direction',
      'interpretation_note',
      'eligible_submission_count',
      'answered_response_count',
      'missing_response_count',
      'is_suppressed',
      'adverse_response_count',
      'adverse_response_rate',
      'missing_response_rate',
      'trust_answered_response_count',
      'trust_adverse_response_count',
      'trust_adverse_response_rate',
      'previous_adverse_response_count',
      'previous_answered_response_count',
      'previous_adverse_response_rate',
      'period_change_pp',
      'trust_gap_pp',
      'coverage_status',
      'movement_status',
    ],
    dimensionColumns: ['trust_id', 'school_id', 'school_classification', 'survey_period', 'question_code'],
    suppressedColumns: [
      'adverse_response_count',
      'adverse_response_rate',
      'missing_response_rate',
      'period_change_pp',
      'trust_gap_pp',
    ],
    tenantScoped: true,
    orderBy: ['school_id', 'school_classification', 'survey_period', 'question_code'],
  },
  {
    fileName: 'category_analysis.csv',
    relation: 'marts.mart_school_category_analysis',
    columns: [
      'trust_id',
      'school_id',
      'school_classification',
      'survey_period',
      'category_code',
      'category_label',
      'eligible_submission_count',
      'answering_submission_count',
      'indicator_count',
      'answered_question_response_count',
      'missing_question_response_count',
      'is_suppressed',
      'adverse_question_response_count',
      'adverse_question_response_rate',
      'missing_question_response_rate',
      'trust_answering_submission_count',
      'trust_answered_question_response_count',
      'trust_adverse_question_response_count',
      'trust_adverse_question_response_rate',
      'previous_adverse_question_response_count',
      'previous_answered_question_response_count',
      'previous_adverse_question_response_rate',
      'period_change_pp',
      'trust_gap_pp',
    ],
    dimensionColumns: ['trust_id', 'school_id', 'school_classification', 'survey_period', 'category_code'],
    suppressedColumns: [
      'adverse_question_response_count',
      'adverse_question_response_rate',
      'missing_question_response_rate',
      'period_change_pp',
      'trust_gap_pp',
    ],
    tenantScoped: true,
    orderBy: ['school_id', 'school_classification', 'survey_period', 'category_code'],
  },
  {
    fileName: 'change_drivers.csv',
    relation: 'marts.mart_school_change_drivers',
    columns: [
      'trust_id',
      'school_id',
      'school_classification',
      'survey_period',
      'category_code',
      'category_label',
      'question_code',
      'indicator_label',
      'interpretation_note',
      'eligible_submission_count',
      'is_suppressed',
      'adverse_response_rate',
      'previous_adverse_response_rate',
      'indicator_change_pp',
      'category_change_pp',
      'category_change_contribution_pp',
      'driver_rank',
    ],
    dimensionColumns: [
      'trust_id',
      'school_id',
      'school_classification',
      'survey_period',
      'category_code',
      'question_code',
    ],
    suppressedColumns: ['category_change_contribution_pp'],
    tenantScoped: true,
    orderBy: ['school_id', 'school_classification', 'survey_period', 'category_code', 'question_code'],
  },
  {
    fileName: 'question_response_distribution.csv',
    relation: 'marts.mart_question_response_distribution',
    columns: [
      'trust_id',
      'school_id',
      'school_classification',
      'survey_period',
      'question_code',
      'indicator_label',
      'category_code',
      'category_label',
      'answer_label',
      'answer_order',
      'answered_response_count',
      'is_suppressed',
      'response_count',
      'response_rate',
    ],
    dimensionColumns: [
      'trust_id',
      'school_id',
      'school_classification',
      'survey_period',
      'question_code',
      'answer_label',
    ],
    suppressedColumns: ['response_count', 'response_rate'],
    tenantScoped: true,
    orderBy: ['school_id', 'school_classification', 'survey_period', 'question_code', 'answer_label'],
  },
  {
    fileName: 'support_signal_summary.csv',
    relation: 'marts.mart_support_signal_summary',
    columns: [
      'trust_id',
      'school_id',
      'school_classification',
      'survey_period',
      'question_code',
      'indicator_label',
      'category_code',
      'category_label',
      'rule_version',
      'eligible_submission_count',
      'answered_response_count',
      'missing_response_count',
      'is_suppressed',
      'adverse_response_count',
      'adverse_response_rate',
      'signal_level',
    ],
    dimensionColumns: ['trust_id', 'school_id', 'school_classification', 'survey_period', 'question_code'],
    suppressedColumns: ['adverse_response_count', 'adverse_response_rate', 'signal_level'],
    tenantScoped: true,
    orderBy: ['school_id', 'school_classification', 'survey_period', 'question_code'],
  },
  {
    fileName: 'indicator_answer_catalog.csv',
    relation: 'core.indicator_answer_catalog',
    columns: ['question_code', 'question_label', 'category', 'answer_label', 'answer_order', 'is_adverse'],
    dimensionColumns: ['question_code', 'answer_label'],
    suppressedColumns: [],
    tenantScoped: false,
    orderBy: ['question_code', 'answer_label'],
  },
];

const SCHEMA_VERSION = 'wellbeing-publication/1';
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

const FORBIDDEN_HEADER_COLUMNS: readonly string[] = [
  'document_id',
  'event_id',
  'source_id',
  'source_file',
  'payload',
];

function validateExport(spec: ExportFileSpec, filePath: string, tenant: string, expectedRowCount: number): void {
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
    header.length === spec.columns.length && header.every((column, index) => column === spec.columns[index]);
  if (!headerMatches) {
    throw new ExportTenantsError(
      `Export file ${filePath} header must be exactly ${spec.columns.join(', ')}; got ${header.join(', ')}`,
    );
  }
  const forbiddenHeader = header.find((column) => FORBIDDEN_HEADER_COLUMNS.includes(column));
  if (forbiddenHeader !== undefined) {
    throw new ExportTenantsError(`Export file ${filePath} header must not contain ${forbiddenHeader}`);
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
    for (const column of spec.dimensionColumns) {
      const value = record[column];
      if (value === undefined || value === '') {
        throw new ExportTenantsError(`Export file ${filePath} row ${rowNumber} has an empty ${column}`);
      }
    }
    if (spec.tenantScoped && record.trust_id !== tenant) {
      throw new ExportTenantsError(
        `Export file ${filePath} row ${rowNumber} trust_id must be ${tenant}; got ${String(record.trust_id)}`,
      );
    }
    if (record.is_suppressed === 'true') {
      for (const column of spec.suppressedColumns) {
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

export function validateTenantExport(filePath: string, tenant: string, expectedRowCount: number): void {
  validateExport(TREND_SPEC, filePath, tenant, expectedRowCount);
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

      const files: Array<{ file_name: string; row_count: number; sha256: string }> = [];
      for (const spec of EXPORT_FILES) {
        const csvPath = join(tenantPath, spec.fileName);
        const tenantFilter = spec.tenantScoped ? ` WHERE trust_id = '${tenant}'` : '';

        await connection.run(
          `COPY (SELECT ${spec.columns.join(', ')} FROM ${spec.relation}${tenantFilter} ORDER BY ${spec.orderBy.join(', ')}) TO '${csvPath.replaceAll("'", "''")}' (FORMAT CSV, HEADER)`,
        );

        const countRows = (
          await connection.runAndReadAll(
            `SELECT count(*)::INTEGER AS n FROM ${spec.relation}${tenantFilter}`,
          )
        ).getRowObjects();
        const expectedRowCount = Number(countRows[0]?.n ?? 0);

        validateExport(spec, csvPath, tenant, expectedRowCount);

        const bytes = readFileSync(csvPath);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        files.push({ file_name: spec.fileName, row_count: expectedRowCount, sha256 });

        await connection.run(
          'INSERT INTO audit.publications (run_id, tenant, file_name, row_count, sha256, created_at) VALUES ($1, $2, $3, $4, $5, $6::TIMESTAMPTZ)',
          [runId, tenant, spec.fileName, expectedRowCount, sha256, publishedAt],
        );
      }

      const freshness = await buildTenantFreshness(connection, tenant);

      const freshnessPath = join(tenantPath, 'freshness.json');
      writeFileSync(freshnessPath, `${JSON.stringify(freshness, null, 2)}\n`);
      const freshnessBytes = readFileSync(freshnessPath);
      const freshnessSha256 = createHash('sha256').update(freshnessBytes).digest('hex');
      const freshnessRowCount = freshness === null ? 0 : 1;
      files.push({
        file_name: 'freshness.json',
        row_count: freshnessRowCount,
        sha256: freshnessSha256,
      });
      await connection.run(
        'INSERT INTO audit.publications (run_id, tenant, file_name, row_count, sha256, created_at) VALUES ($1, $2, $3, $4, $5, $6::TIMESTAMPTZ)',
        [runId, tenant, 'freshness.json', freshnessRowCount, freshnessSha256, publishedAt],
      );

      const dashboard = validateTenantDashboard(
        JSON.parse(JSON.stringify(await buildTenantDashboard(connection, tenant, runId, EXPORT_FILES))),
        tenant,
        EXPORT_FILES,
      );

      const dashboardPath = join(tenantPath, 'dashboard.json');
      writeFileSync(dashboardPath, `${JSON.stringify(dashboard, null, 2)}\n`);
      const dashboardBytes = readFileSync(dashboardPath);
      const dashboardSha256 = createHash('sha256').update(dashboardBytes).digest('hex');
      const dashboardRowCount =
        dashboard.indicator_analysis.length +
        dashboard.category_analysis.length +
        dashboard.change_drivers.length +
        dashboard.question_response_distribution.length +
        dashboard.support_signal_summary.length;
      files.push({
        file_name: 'dashboard.json',
        row_count: dashboardRowCount,
        sha256: dashboardSha256,
      });
      await connection.run(
        'INSERT INTO audit.publications (run_id, tenant, file_name, row_count, sha256, created_at) VALUES ($1, $2, $3, $4, $5, $6::TIMESTAMPTZ)',
        [runId, tenant, 'dashboard.json', dashboardRowCount, dashboardSha256, publishedAt],
      );

      const manifest = {
        schema_version: SCHEMA_VERSION,
        run_id: runId,
        tenant,
        created_at: publishedAt,
        files,
      };
      writeFileSync(join(tenantPath, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
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
