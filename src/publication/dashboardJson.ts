import type { DuckDBConnection } from '@duckdb/node-api';

import type { ExportFileSpec } from './exportTenants.ts';

export const DASHBOARD_SCHEMA_VERSION = 'wellbeing-dashboard/1';

export class DashboardJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DashboardJsonError';
  }
}

export type DashboardValue = string | number | boolean | null;

export type DashboardRow = Readonly<Record<string, DashboardValue>>;

export interface TenantFreshness {
  trust_id: string;
  last_loaded_at: string | null;
  latest_source_updated_at: string | null;
  logical_event_count: number | null;
}

export interface DashboardFilterEntry {
  code: string;
  label: string;
}

export interface DashboardQuestionFilterEntry extends DashboardFilterEntry {
  interpretation_note: string | null;
}

export interface TenantDashboardFilters {
  periods: readonly string[];
  schools: readonly DashboardFilterEntry[];
  categories: readonly DashboardFilterEntry[];
  questions: readonly DashboardQuestionFilterEntry[];
}

export interface TenantDashboard {
  schema_version: typeof DASHBOARD_SCHEMA_VERSION;
  tenant: string;
  run_id: string;
  freshness: TenantFreshness | null;
  filters: TenantDashboardFilters;
  indicator_analysis: readonly DashboardRow[];
  category_analysis: readonly DashboardRow[];
  change_drivers: readonly DashboardRow[];
  question_response_distribution: readonly DashboardRow[];
  support_signal_summary: readonly DashboardRow[];
}

const DASHBOARD_SECTIONS = [
  'indicator_analysis',
  'category_analysis',
  'change_drivers',
  'question_response_distribution',
  'support_signal_summary',
] as const;

type DashboardSectionName = (typeof DASHBOARD_SECTIONS)[number];

const COUNT_RANK_ORDER_PATTERN = /_count$|_rank$|answer_order$/;

const FORBIDDEN_KEYS = ['document_id', 'event_id', 'source_id', 'source_file', 'payload'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function selectColumn(column: string): string {
  if (COUNT_RANK_ORDER_PATTERN.test(column)) {
    return `CAST(${column} AS INTEGER) AS ${column}`;
  }
  if (column.endsWith('_at')) {
    return `strftime(${column} AT TIME ZONE 'UTC', '%Y-%m-%dT%H:%M:%SZ') AS ${column}`;
  }
  return column;
}

export async function buildTenantFreshness(
  connection: DuckDBConnection,
  tenant: string,
): Promise<TenantFreshness | null> {
  const rows = (
    await connection.runAndReadAll(
      `SELECT
        trust_id,
        strftime(last_loaded_at AT TIME ZONE 'UTC', '%Y-%m-%dT%H:%M:%SZ') AS last_loaded_at,
        strftime(latest_source_updated_at AT TIME ZONE 'UTC', '%Y-%m-%dT%H:%M:%SZ') AS latest_source_updated_at,
        CAST(logical_event_count AS INTEGER) AS logical_event_count
      FROM marts.mart_data_freshness
      WHERE trust_id = $1`,
      [tenant],
    )
  ).getRowObjectsJson() as unknown as readonly TenantFreshness[];
  return rows[0] ?? null;
}

function seasonNumberFor(season: string): number {
  switch (season) {
    case 'winter':
      return 1;
    case 'spring':
      return 2;
    case 'summer':
      return 3;
    case 'autumn':
      return 4;
    default:
      return 5;
  }
}

function periodSortKey(period: string): number {
  const [yearText, seasonText] = period.split('-');
  const year = Number(yearText ?? '');
  const yearNumber = Number.isNaN(year) ? 0 : year;
  return yearNumber * 10 + seasonNumberFor((seasonText ?? '').toLowerCase());
}

function comparePeriods(a: string, b: string): number {
  return periodSortKey(a) - periodSortKey(b);
}

function buildFilters(sections: Record<DashboardSectionName, readonly DashboardRow[]>): TenantDashboardFilters {
  const periods = new Set<string>();
  const schoolLabels = new Map<string, string>();
  const categoryLabels = new Map<string, string>();
  const questionLabels = new Map<string, string>();
  const questionNotes = new Map<string, string>();

  for (const rows of Object.values(sections)) {
    for (const row of rows) {
      const period = row.survey_period;
      if (typeof period === 'string') {
        periods.add(period);
      }
      const schoolId = row.school_id;
      const schoolLabel = row.school_classification;
      if (typeof schoolId === 'string' && typeof schoolLabel === 'string' && !schoolLabels.has(schoolId)) {
        schoolLabels.set(schoolId, schoolLabel);
      }
      const categoryCode = row.category_code;
      const categoryLabel = row.category_label;
      if (
        typeof categoryCode === 'string' &&
        typeof categoryLabel === 'string' &&
        !categoryLabels.has(categoryCode)
      ) {
        categoryLabels.set(categoryCode, categoryLabel);
      }
      const questionCode = row.question_code;
      if (typeof questionCode === 'string') {
        const indicatorLabel = row.indicator_label;
        if (typeof indicatorLabel === 'string' && !questionLabels.has(questionCode)) {
          questionLabels.set(questionCode, indicatorLabel);
        }
        const interpretationNote = row.interpretation_note;
        if (typeof interpretationNote === 'string' && !questionNotes.has(questionCode)) {
          questionNotes.set(questionCode, interpretationNote);
        }
      }
    }
  }

  const schools = [...schoolLabels.entries()]
    .map(([code, label]) => ({ code, label }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const categories = [...categoryLabels.entries()]
    .map(([code, label]) => ({ code, label }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const questionCodes = new Set([...questionLabels.keys(), ...questionNotes.keys()]);
  const questions = [...questionCodes]
    .map((code) => ({
      code,
      label: questionLabels.get(code) ?? '',
      interpretation_note: questionNotes.get(code) ?? null,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

  return {
    periods: [...periods].sort(comparePeriods),
    schools,
    categories,
    questions,
  };
}

export async function buildTenantDashboard(
  connection: DuckDBConnection,
  tenant: string,
  runId: string,
  files: readonly ExportFileSpec[],
): Promise<TenantDashboard> {
  const fetched: Array<[DashboardSectionName, readonly DashboardRow[]]> = [];
  for (const sectionName of DASHBOARD_SECTIONS) {
    const spec = files.find((file) => file.fileName === `${sectionName}.csv`);
    if (spec === undefined) {
      throw new DashboardJsonError(`Missing export file spec for dashboard section ${sectionName}`);
    }
    const sql = [
      `SELECT ${spec.columns.map(selectColumn).join(', ')}`,
      `FROM ${spec.relation}`,
      'WHERE trust_id = $1',
      `ORDER BY ${spec.orderBy.join(', ')}`,
    ].join('\n');
    const rows = (await connection.runAndReadAll(sql, [tenant])).getRowObjectsJson() as unknown as readonly DashboardRow[];
    fetched.push([sectionName, rows]);
  }
  const sections = Object.fromEntries(fetched) as Record<DashboardSectionName, readonly DashboardRow[]>;

  return {
    schema_version: DASHBOARD_SCHEMA_VERSION,
    tenant,
    run_id: runId,
    freshness: await buildTenantFreshness(connection, tenant),
    filters: buildFilters(sections),
    indicator_analysis: sections.indicator_analysis,
    category_analysis: sections.category_analysis,
    change_drivers: sections.change_drivers,
    question_response_distribution: sections.question_response_distribution,
    support_signal_summary: sections.support_signal_summary,
  };
}

function assertNoForbiddenKeys(row: Record<string, unknown>, label: string): void {
  for (const key of FORBIDDEN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      throw new DashboardJsonError(`Dashboard ${label} row must not contain ${key}`);
    }
  }
}

function validateRow(row: unknown, tenant: string, spec: ExportFileSpec): DashboardRow {
  if (!isRecord(row)) {
    throw new DashboardJsonError('Dashboard section rows must be objects');
  }
  assertNoForbiddenKeys(row, 'section');
  if (row.trust_id !== tenant) {
    throw new DashboardJsonError(`Dashboard section row trust_id must be ${tenant}; got ${String(row.trust_id)}`);
  }
  for (const [key, value] of Object.entries(row)) {
    if (COUNT_RANK_ORDER_PATTERN.test(key) && value !== null && typeof value !== 'number') {
      throw new DashboardJsonError(`Dashboard section row ${key} must be a number or null`);
    }
    if (key.startsWith('is_') && typeof value !== 'boolean') {
      throw new DashboardJsonError(`Dashboard section row ${key} must be a boolean`);
    }
  }
  if (row.is_suppressed === true) {
    for (const column of spec.suppressedColumns) {
      if (row[column] !== null) {
        throw new DashboardJsonError(`Dashboard section row must have a null ${column} for a suppressed row`);
      }
    }
  }
  return row as unknown as DashboardRow;
}

function validateSection(
  value: unknown,
  tenant: string,
  files: readonly ExportFileSpec[],
  sectionName: DashboardSectionName,
): readonly DashboardRow[] {
  if (!Array.isArray(value)) {
    throw new DashboardJsonError(`Dashboard section ${sectionName} must be an array`);
  }
  const spec = files.find((file) => file.fileName === `${sectionName}.csv`);
  if (spec === undefined) {
    throw new DashboardJsonError(`Missing export file spec for dashboard section ${sectionName}`);
  }
  return value.map((row) => validateRow(row, tenant, spec));
}

function validateFreshness(value: unknown, tenant: string): TenantFreshness | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!isRecord(value)) {
    throw new DashboardJsonError('Dashboard freshness must be an object, null, or undefined');
  }
  assertNoForbiddenKeys(value, 'freshness');
  if (value.trust_id !== tenant) {
    throw new DashboardJsonError(`Dashboard freshness trust_id must be ${tenant}; got ${String(value.trust_id)}`);
  }
  if (value.logical_event_count !== null && typeof value.logical_event_count !== 'number') {
    throw new DashboardJsonError('Dashboard freshness logical_event_count must be a number or null');
  }
  for (const column of ['last_loaded_at', 'latest_source_updated_at']) {
    const timestamp = value[column];
    if (timestamp !== null && typeof timestamp !== 'string') {
      throw new DashboardJsonError(`Dashboard freshness ${column} must be a string or null`);
    }
  }
  return value as unknown as TenantFreshness;
}

function validateFilterEntries(value: unknown, label: string): readonly DashboardFilterEntry[] {
  if (!Array.isArray(value)) {
    throw new DashboardJsonError(`Dashboard ${label} must be an array`);
  }
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.code !== 'string' || typeof entry.label !== 'string') {
      throw new DashboardJsonError(`Dashboard ${label} entries must have string code and label values`);
    }
  }
  return value as unknown as readonly DashboardFilterEntry[];
}

function validateQuestionEntries(value: unknown): readonly DashboardQuestionFilterEntry[] {
  if (!Array.isArray(value)) {
    throw new DashboardJsonError('Dashboard filters.questions must be an array');
  }
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.code !== 'string' ||
      typeof entry.label !== 'string' ||
      (entry.interpretation_note !== null && typeof entry.interpretation_note !== 'string')
    ) {
      throw new DashboardJsonError(
        'Dashboard filters.questions entries must have string code and label values and a string or null interpretation_note',
      );
    }
  }
  return value as unknown as readonly DashboardQuestionFilterEntry[];
}

function validateFilters(value: unknown): TenantDashboardFilters {
  if (!isRecord(value)) {
    throw new DashboardJsonError('Dashboard filters must be an object');
  }
  const periods = value.periods;
  if (!Array.isArray(periods) || !periods.every((period) => typeof period === 'string')) {
    throw new DashboardJsonError('Dashboard filters.periods must be an array of strings');
  }
  return {
    periods,
    schools: validateFilterEntries(value.schools, 'filters.schools'),
    categories: validateFilterEntries(value.categories, 'filters.categories'),
    questions: validateQuestionEntries(value.questions),
  };
}

export function validateTenantDashboard(
  document: unknown,
  tenant: string,
  files: readonly ExportFileSpec[],
): TenantDashboard {
  if (!isRecord(document)) {
    throw new DashboardJsonError('Dashboard document must be an object');
  }
  if (document.schema_version !== DASHBOARD_SCHEMA_VERSION) {
    throw new DashboardJsonError(
      `Dashboard document schema_version must be ${DASHBOARD_SCHEMA_VERSION}; got ${String(document.schema_version)}`,
    );
  }
  if (document.tenant !== tenant) {
    throw new DashboardJsonError(`Dashboard document tenant must be ${tenant}; got ${String(document.tenant)}`);
  }
  const runId = document.run_id;
  if (typeof runId !== 'string') {
    throw new DashboardJsonError('Dashboard document run_id must be a string');
  }

  return {
    schema_version: DASHBOARD_SCHEMA_VERSION,
    tenant,
    run_id: runId,
    freshness: validateFreshness(document.freshness, tenant),
    filters: validateFilters(document.filters),
    indicator_analysis: validateSection(document.indicator_analysis, tenant, files, 'indicator_analysis'),
    category_analysis: validateSection(document.category_analysis, tenant, files, 'category_analysis'),
    change_drivers: validateSection(document.change_drivers, tenant, files, 'change_drivers'),
    question_response_distribution: validateSection(
      document.question_response_distribution,
      tenant,
      files,
      'question_response_distribution',
    ),
    support_signal_summary: validateSection(document.support_signal_summary, tenant, files, 'support_signal_summary'),
  };
}
