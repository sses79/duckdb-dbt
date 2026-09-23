import { DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBConnection } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyFoundation } from '../warehouse/foundation.ts';
import {
  DASHBOARD_SCHEMA_VERSION,
  DashboardJsonError,
  buildTenantDashboard,
  buildTenantFreshness,
  validateTenantDashboard,
} from './dashboardJson.ts';
import type { TenantDashboard } from './dashboardJson.ts';
import { EXPORT_FILES } from './exportTenants.ts';
import type { ExportFileSpec } from './exportTenants.ts';

const DASHBOARD_SECTIONS = [
  'indicator_analysis',
  'category_analysis',
  'change_drivers',
  'question_response_distribution',
  'support_signal_summary',
] as const;

type DashboardSectionName = (typeof DASHBOARD_SECTIONS)[number];

let connection!: DuckDBConnection;

beforeEach(async () => {
  connection = await (await DuckDBInstance.create(':memory:')).connect();
  await applyFoundation(connection);
  await createMarts(connection);
  await seedData(connection);
});

afterEach(() => {
  connection.closeSync();
});

function columnType(column: string): string {
  if (/_count$|_rank$/.test(column)) {
    return 'BIGINT';
  }
  if (/_rate$|_pp$/.test(column)) {
    return 'DOUBLE';
  }
  if (column.startsWith('is_')) {
    return 'BOOLEAN';
  }
  return 'VARCHAR';
}

async function createMarts(connection: DuckDBConnection): Promise<void> {
  for (const spec of EXPORT_FILES) {
    const columns = spec.columns.map((column) => `${column} ${columnType(column)}`).join(', ');
    await connection.run(`CREATE TABLE ${spec.relation} (${columns})`);
  }
  await connection.run(
    `CREATE TABLE marts.mart_data_freshness (
      trust_id VARCHAR,
      last_loaded_at TIMESTAMPTZ,
      latest_source_updated_at TIMESTAMPTZ,
      logical_event_count BIGINT
    )`,
  );
}

function specFor(fileName: string): ExportFileSpec {
  const spec = EXPORT_FILES.find((file) => file.fileName === fileName);
  if (spec === undefined) {
    throw new Error(`Missing export file spec ${fileName}`);
  }
  return spec;
}

function defaultValue(column: string): unknown {
  if (/_count$|_rank$/.test(column)) {
    return 1;
  }
  if (/_rate$|_pp$/.test(column)) {
    return 0.0;
  }
  if (column.startsWith('is_')) {
    return false;
  }
  return 'value';
}

function rowFor(spec: ExportFileSpec, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const column of spec.columns) {
    values[column] = defaultValue(column);
  }
  for (const [column, value] of Object.entries(overrides)) {
    values[column] = value;
  }
  return values;
}

function sqlLiteral(value: unknown): string {
  if (value === null) {
    return 'NULL';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function insertRow(
  connection: DuckDBConnection,
  spec: ExportFileSpec,
  values: Record<string, unknown>,
): Promise<void> {
  const columns = spec.columns.join(', ');
  const literals = spec.columns.map((column) => sqlLiteral(values[column] ?? null)).join(', ');
  await connection.run(`INSERT INTO ${spec.relation} (${columns}) VALUES (${literals})`);
}

async function seedData(connection: DuckDBConnection): Promise<void> {
  const trend = specFor('school_wellbeing_trend.csv');
  const indicator = specFor('indicator_analysis.csv');
  const category = specFor('category_analysis.csv');
  const drivers = specFor('change_drivers.csv');
  const distribution = specFor('question_response_distribution.csv');
  const signal = specFor('support_signal_summary.csv');
  const catalog = specFor('indicator_answer_catalog.csv');

  await insertRow(connection, trend, rowFor(trend, {
    trust_id: 'trust_north',
    school_id: 'school_a',
    school_classification: 'Secondary',
    survey_period: '2018-autumn',
    question_code: 'feel_sad',
    category: 'emotional_wellbeing',
    eligible_submission_count: 10,
    answered_response_count: 10,
    missing_response_count: 0,
    adverse_response_count: 3,
    adverse_response_rate: 0.3,
    is_suppressed: false,
  }));
  await insertRow(connection, trend, rowFor(trend, {
    trust_id: 'trust_north',
    school_id: 'school_b',
    school_classification: 'Secondary',
    survey_period: '2018-autumn',
    question_code: 'feel_sad',
    category: 'emotional_wellbeing',
    eligible_submission_count: 10,
    answered_response_count: 9,
    missing_response_count: 1,
    adverse_response_count: null,
    adverse_response_rate: null,
    is_suppressed: true,
  }));
  await insertRow(connection, trend, rowFor(trend, {
    trust_id: 'trust_south',
    school_id: 'school_d',
    school_classification: 'Primary',
    survey_period: '2019-spring',
    question_code: 'feel_worried',
    category: 'emotional_wellbeing',
    eligible_submission_count: 20,
    answered_response_count: 18,
    missing_response_count: 2,
    adverse_response_count: 5,
    adverse_response_rate: 0.25,
    is_suppressed: false,
  }));

  await insertRow(connection, indicator, rowFor(indicator, {
    trust_id: 'trust_north',
    school_id: 'school_a',
    school_classification: 'Secondary',
    survey_period: '2018-autumn',
    question_code: 'feel_sad',
    indicator_label: 'I feel sad',
    category_code: 'emotional_wellbeing',
    category_label: 'Emotional wellbeing',
    direction: 'down',
    interpretation_note: 'Feeling sad on most days',
    eligible_submission_count: 10,
    answered_response_count: 9,
    missing_response_count: 1,
    is_suppressed: false,
    adverse_response_count: 3,
    adverse_response_rate: 0.3,
    missing_response_rate: 0.1,
    trust_answered_response_count: 20,
    trust_adverse_response_count: 5,
    trust_adverse_response_rate: 0.25,
    previous_adverse_response_count: 2,
    previous_answered_response_count: 9,
    previous_adverse_response_rate: 0.22,
    period_change_pp: 0.08,
    trust_gap_pp: 0.03,
    coverage_status: 'sufficient',
    movement_status: 'worsened',
  }));
  await insertRow(connection, indicator, rowFor(indicator, {
    trust_id: 'trust_north',
    school_id: 'school_b',
    school_classification: 'Secondary',
    survey_period: '2018-autumn',
    question_code: 'feel_sad',
    indicator_label: 'I feel sad',
    category_code: 'emotional_wellbeing',
    category_label: 'Emotional wellbeing',
    direction: 'down',
    interpretation_note: 'Feeling sad on most days',
    eligible_submission_count: 10,
    answered_response_count: 9,
    missing_response_count: 1,
    is_suppressed: true,
    adverse_response_count: null,
    adverse_response_rate: null,
    missing_response_rate: null,
    period_change_pp: null,
    trust_gap_pp: null,
  }));
  await insertRow(connection, indicator, rowFor(indicator, {
    trust_id: 'trust_north',
    school_id: 'school_c',
    school_classification: 'Primary',
    survey_period: '2019-spring',
    question_code: 'feel_worried',
    indicator_label: 'I feel worried',
    category_code: 'emotional_wellbeing',
    category_label: 'Emotional wellbeing',
    direction: 'up',
    interpretation_note: 'Feeling worried about the future',
    is_suppressed: false,
  }));
  await insertRow(connection, indicator, rowFor(indicator, {
    trust_id: 'trust_south',
    school_id: 'school_d',
    school_classification: 'Primary',
    survey_period: '2019-spring',
    question_code: 'feel_worried',
    indicator_label: 'I feel worried',
    category_code: 'emotional_wellbeing',
    category_label: 'Emotional wellbeing',
    direction: 'up',
    interpretation_note: 'Feeling worried about the future',
    is_suppressed: false,
  }));

  await insertRow(connection, category, rowFor(category, {
    trust_id: 'trust_north',
    school_id: 'school_a',
    school_classification: 'Secondary',
    survey_period: '2018-autumn',
    category_code: 'emotional_wellbeing',
    category_label: 'Emotional wellbeing',
    eligible_submission_count: 10,
    answering_submission_count: 9,
    indicator_count: 4,
    answered_question_response_count: 36,
    missing_question_response_count: 4,
    is_suppressed: false,
    adverse_question_response_count: 12,
    adverse_question_response_rate: 0.25,
    missing_question_response_rate: 0.1,
    trust_answering_submission_count: 19,
    trust_answered_question_response_count: 70,
    trust_adverse_question_response_count: 15,
    trust_adverse_question_response_rate: 0.21,
    previous_adverse_question_response_count: 10,
    previous_answered_question_response_count: 60,
    previous_adverse_question_response_rate: 0.17,
    period_change_pp: 0.04,
    trust_gap_pp: 0.02,
  }));
  await insertRow(connection, category, rowFor(category, {
    trust_id: 'trust_south',
    school_id: 'school_d',
    school_classification: 'Primary',
    survey_period: '2019-spring',
    category_code: 'emotional_wellbeing',
    category_label: 'Emotional wellbeing',
    eligible_submission_count: 20,
    answering_submission_count: 18,
    indicator_count: 4,
    answered_question_response_count: 60,
    missing_question_response_count: 4,
    is_suppressed: false,
    adverse_question_response_count: 15,
    adverse_question_response_rate: 0.25,
    missing_question_response_rate: 0.1,
    trust_answering_submission_count: 35,
    trust_answered_question_response_count: 120,
    trust_adverse_question_response_count: 30,
    trust_adverse_question_response_rate: 0.25,
    previous_adverse_question_response_count: 20,
    previous_answered_question_response_count: 100,
    previous_adverse_question_response_rate: 0.2,
    period_change_pp: 0.05,
    trust_gap_pp: 0.0,
  }));

  await insertRow(connection, drivers, rowFor(drivers, {
    trust_id: 'trust_north',
    school_id: 'school_a',
    school_classification: 'Secondary',
    survey_period: '2018-autumn',
    category_code: 'emotional_wellbeing',
    category_label: 'Emotional wellbeing',
    question_code: 'feel_sad',
    indicator_label: 'I feel sad',
    interpretation_note: 'Feeling sad on most days',
    eligible_submission_count: 10,
    is_suppressed: false,
    adverse_response_rate: 0.3,
    previous_adverse_response_rate: 0.22,
    indicator_change_pp: 0.08,
    category_change_pp: 0.04,
    category_change_contribution_pp: 0.01,
    driver_rank: 1,
  }));
  await insertRow(connection, drivers, rowFor(drivers, {
    trust_id: 'trust_north',
    school_id: 'school_c',
    school_classification: 'Primary',
    survey_period: '2019-spring',
    category_code: 'emotional_wellbeing',
    category_label: 'Emotional wellbeing',
    question_code: 'feel_worried',
    indicator_label: 'I feel worried',
    interpretation_note: 'Feeling worried about the future',
    eligible_submission_count: 20,
    is_suppressed: false,
    adverse_response_rate: 0.25,
    previous_adverse_response_rate: 0.2,
    indicator_change_pp: 0.05,
    category_change_pp: 0.02,
    category_change_contribution_pp: 0.0,
    driver_rank: 1,
  }));
  await insertRow(connection, drivers, rowFor(drivers, {
    trust_id: 'trust_south',
    school_id: 'school_d',
    school_classification: 'Primary',
    survey_period: '2019-spring',
    category_code: 'emotional_wellbeing',
    category_label: 'Emotional wellbeing',
    question_code: 'feel_worried',
    indicator_label: 'I feel worried',
    interpretation_note: 'Feeling worried about the future',
    eligible_submission_count: 20,
    is_suppressed: false,
    adverse_response_rate: 0.25,
    previous_adverse_response_rate: 0.2,
    indicator_change_pp: 0.05,
    category_change_pp: 0.02,
    category_change_contribution_pp: 0.0,
    driver_rank: 1,
  }));

  await insertRow(connection, distribution, rowFor(distribution, {
    trust_id: 'trust_north',
    school_id: 'school_a',
    school_classification: 'Secondary',
    survey_period: '2018-autumn',
    question_code: 'feel_sad',
    indicator_label: 'I feel sad',
    category_code: 'emotional_wellbeing',
    category_label: 'Emotional wellbeing',
    answer_label: 'Often',
    answer_order: '1',
    answered_response_count: 5,
    is_suppressed: false,
    response_count: 5,
    response_rate: 0.5,
  }));
  await insertRow(connection, distribution, rowFor(distribution, {
    trust_id: 'trust_north',
    school_id: 'school_a',
    school_classification: 'Secondary',
    survey_period: '2018-autumn',
    question_code: 'feel_sad',
    indicator_label: 'I feel sad',
    category_code: 'emotional_wellbeing',
    category_label: 'Emotional wellbeing',
    answer_label: 'Sometimes',
    answer_order: '2',
    answered_response_count: 4,
    is_suppressed: false,
    response_count: 4,
    response_rate: 0.4,
  }));
  await insertRow(connection, distribution, rowFor(distribution, {
    trust_id: 'trust_south',
    school_id: 'school_d',
    school_classification: 'Primary',
    survey_period: '2019-spring',
    question_code: 'feel_worried',
    indicator_label: 'I feel worried',
    category_code: 'emotional_wellbeing',
    category_label: 'Emotional wellbeing',
    answer_label: 'Often',
    answer_order: '1',
    answered_response_count: 9,
    is_suppressed: false,
    response_count: 9,
    response_rate: 0.5,
  }));

  await insertRow(connection, signal, rowFor(signal, {
    trust_id: 'trust_north',
    school_id: 'school_a',
    school_classification: 'Secondary',
    survey_period: '2018-autumn',
    question_code: 'feel_sad',
    indicator_label: 'I feel sad',
    category_code: 'emotional_wellbeing',
    category_label: 'Emotional wellbeing',
    rule_version: '1',
    eligible_submission_count: 10,
    answered_response_count: 9,
    missing_response_count: 1,
    is_suppressed: false,
    adverse_response_count: 3,
    adverse_response_rate: 0.3,
    signal_level: 'amber',
  }));
  await insertRow(connection, signal, rowFor(signal, {
    trust_id: 'trust_south',
    school_id: 'school_d',
    school_classification: 'Primary',
    survey_period: '2019-spring',
    question_code: 'feel_worried',
    indicator_label: 'I feel worried',
    category_code: 'emotional_wellbeing',
    category_label: 'Emotional wellbeing',
    rule_version: '1',
    eligible_submission_count: 20,
    answered_response_count: 18,
    missing_response_count: 2,
    is_suppressed: false,
    adverse_response_count: 5,
    adverse_response_rate: 0.25,
    signal_level: 'amber',
  }));

  await insertRow(connection, catalog, rowFor(catalog, {
    question_code: 'feel_sad',
    question_label: 'I feel sad',
    category: 'emotional_wellbeing',
    answer_label: 'Often',
    answer_order: '1',
    is_adverse: true,
  }));

  await connection.run(
    `INSERT INTO marts.mart_data_freshness (trust_id, last_loaded_at, latest_source_updated_at, logical_event_count) VALUES
      ('trust_north', '2024-02-01T10:00:00Z', '2024-01-31T09:30:00Z', 42),
      ('trust_south', '2024-03-01T10:00:00Z', '2024-02-28T09:30:00Z', 7)`,
  );
}

describe('buildTenantFreshness', () => {
  it('returns the tenant row with UTC timestamps and a numeric count', async () => {
    const freshness = await buildTenantFreshness(connection, 'trust_north');
    expect(freshness).toEqual({
      trust_id: 'trust_north',
      last_loaded_at: '2024-02-01T10:00:00Z',
      latest_source_updated_at: '2024-01-31T09:30:00Z',
      logical_event_count: 42,
    });
    expect(Object.keys(freshness ?? {}).sort()).toEqual([
      'last_loaded_at',
      'latest_source_updated_at',
      'logical_event_count',
      'trust_id',
    ]);
    expect(freshness?.logical_event_count).toBeTypeOf('number');
    expect(freshness?.last_loaded_at?.endsWith('Z')).toBe(true);
  });

  it('returns null when the tenant has no freshness row', async () => {
    expect(await buildTenantFreshness(connection, 'trust_unknown')).toBeNull();
  });

  it('never returns another tenant freshness', async () => {
    const freshness = await buildTenantFreshness(connection, 'trust_north');
    expect(freshness?.logical_event_count).toBe(42);
    expect(freshness?.latest_source_updated_at).toBe('2024-01-31T09:30:00Z');
    const other = await buildTenantFreshness(connection, 'trust_south');
    expect(other?.logical_event_count).toBe(7);
  });
});

describe('buildTenantDashboard', () => {
  it('builds a complete tenant-only document', async () => {
    const document = await buildTenantDashboard(connection, 'trust_north', 'run_dash', EXPORT_FILES);

    expect(document.schema_version).toBe(DASHBOARD_SCHEMA_VERSION);
    expect(document.tenant).toBe('trust_north');
    expect(document.run_id).toBe('run_dash');
    expect(document.freshness).toEqual({
      trust_id: 'trust_north',
      last_loaded_at: '2024-02-01T10:00:00Z',
      latest_source_updated_at: '2024-01-31T09:30:00Z',
      logical_event_count: 42,
    });
    expect(document.indicator_analysis).toHaveLength(3);
    expect(document.category_analysis).toHaveLength(1);
    expect(document.change_drivers).toHaveLength(2);
    expect(document.question_response_distribution).toHaveLength(2);
    expect(document.support_signal_summary).toHaveLength(1);

    for (const sectionName of DASHBOARD_SECTIONS) {
      const rows = document[sectionName];
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.trust_id).toBe('trust_north');
      }
    }
  });

  it('never includes the other tenant rows', async () => {
    const document = await buildTenantDashboard(connection, 'trust_south', 'run_dash', EXPORT_FILES);
    expect(document.freshness?.logical_event_count).toBe(7);
    expect(document.filters.periods).toEqual(['2019-spring']);
    expect(document.filters.schools).toEqual([{ code: 'school_d', label: 'Primary' }]);
    for (const sectionName of DASHBOARD_SECTIONS) {
      const rows = document[sectionName];
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.trust_id).toBe('trust_south');
        expect(String(row.school_id)).toBe('school_d');
      }
    }
  });

  it('orders periods and populates filters with codes, labels and notes', async () => {
    const document = await buildTenantDashboard(connection, 'trust_north', 'run_dash', EXPORT_FILES);

    expect(document.filters.periods).toEqual(['2018-autumn', '2019-spring']);
    expect(document.filters.schools).toEqual([
      { code: 'school_a', label: 'Secondary' },
      { code: 'school_b', label: 'Secondary' },
      { code: 'school_c', label: 'Primary' },
    ]);
    expect(document.filters.categories).toEqual([
      { code: 'emotional_wellbeing', label: 'Emotional wellbeing' },
    ]);
    expect(document.filters.questions).toEqual([
      { code: 'feel_sad', label: 'I feel sad', interpretation_note: 'Feeling sad on most days' },
      { code: 'feel_worried', label: 'I feel worried', interpretation_note: 'Feeling worried about the future' },
    ]);
  });

  it('emits counts, ranks and answer orders as numbers or null', async () => {
    const document = await buildTenantDashboard(connection, 'trust_north', 'run_dash', EXPORT_FILES);

    for (const sectionName of DASHBOARD_SECTIONS) {
      for (const row of document[sectionName]) {
        for (const [key, value] of Object.entries(row)) {
          if (/_count$|_rank$|answer_order$/.test(key)) {
            expect(value === null || typeof value === 'number').toBe(true);
          }
        }
      }
    }
    expect(document.freshness?.logical_event_count).toBeTypeOf('number');
    expect(typeof document.question_response_distribution[0]?.answer_order).toBe('number');
    expect(typeof document.question_response_distribution[0]?.answered_response_count).toBe('number');
    expect(typeof document.change_drivers[0]?.driver_rank).toBe('number');
  });

  it('formats timestamps as UTC strings ending in Z', async () => {
    const document = await buildTenantDashboard(connection, 'trust_north', 'run_dash', EXPORT_FILES);
    expect(document.freshness?.last_loaded_at).toMatch(/Z$/);
    expect(document.freshness?.latest_source_updated_at).toMatch(/Z$/);
  });

  it('survives JSON.stringify', async () => {
    const document = await buildTenantDashboard(connection, 'trust_north', 'run_dash', EXPORT_FILES);
    expect(() => JSON.stringify(document)).not.toThrow();
    const roundTrip = JSON.parse(JSON.stringify(document)) as TenantDashboard;
    expect(roundTrip.schema_version).toBe(DASHBOARD_SCHEMA_VERSION);
    expect(roundTrip.indicator_analysis).toHaveLength(document.indicator_analysis.length);
    expect(validateTenantDashboard(roundTrip, 'trust_north', EXPORT_FILES)).toEqual(document);
  });
});

describe('validateTenantDashboard', () => {
  async function build(): Promise<TenantDashboard> {
    return buildTenantDashboard(connection, 'trust_north', 'run_dash', EXPORT_FILES);
  }

  function clone(document: TenantDashboard): TenantDashboard {
    return JSON.parse(JSON.stringify(document)) as TenantDashboard;
  }

  function sectionRows(document: TenantDashboard, section: DashboardSectionName): Array<Record<string, unknown>> {
    return document[section] as unknown as Array<Record<string, unknown>>;
  }

  it('accepts the document buildTenantDashboard produced', async () => {
    const document = await build();
    const suppressed = document.indicator_analysis.filter((row) => row.is_suppressed === true);
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]?.adverse_response_count).toBeNull();
    expect(() => validateTenantDashboard(document, 'trust_north', EXPORT_FILES)).not.toThrow();
    expect(validateTenantDashboard(document, 'trust_north', EXPORT_FILES)).toEqual(document);
  });

  it('refuses a wrong schema_version', async () => {
    const document = clone(await build());
    (document as { schema_version: string }).schema_version = 'wellbeing-publication/1';
    expect(() => validateTenantDashboard(document, 'trust_north', EXPORT_FILES)).toThrow(DashboardJsonError);
  });

  it('refuses a document tenant that differs from the argument', async () => {
    const document = clone(await build());
    document.tenant = 'trust_south';
    expect(() => validateTenantDashboard(document, 'trust_north', EXPORT_FILES)).toThrow(DashboardJsonError);
  });

  it('refuses a row whose trust_id differs from the tenant', async () => {
    const document = clone(await build());
    sectionRows(document, 'indicator_analysis')[0]!.trust_id = 'trust_south';
    expect(() => validateTenantDashboard(document, 'trust_north', EXPORT_FILES)).toThrow(DashboardJsonError);
  });

  it('refuses rows carrying forbidden keys', async () => {
    for (const key of ['document_id', 'event_id', 'source_id', 'source_file', 'payload']) {
      const document = clone(await build());
      sectionRows(document, 'indicator_analysis')[0]![key] = 'forbidden';
      expect(() => validateTenantDashboard(document, 'trust_north', EXPORT_FILES)).toThrow(DashboardJsonError);
    }
  });

  it('refuses a suppressed row with a non-null protected value', async () => {
    const document = clone(await build());
    const rows = sectionRows(document, 'indicator_analysis');
    const suppressedIndex = rows.findIndex((row) => row.is_suppressed === true);
    expect(suppressedIndex).toBeGreaterThanOrEqual(0);
    rows[suppressedIndex]!.adverse_response_count = 3;
    expect(() => validateTenantDashboard(document, 'trust_north', EXPORT_FILES)).toThrow(DashboardJsonError);
  });

  it('refuses a non-number count, rank or answer_order value', async () => {
    const document = clone(await build());
    sectionRows(document, 'indicator_analysis')[0]!.eligible_submission_count = '10';
    expect(() => validateTenantDashboard(document, 'trust_north', EXPORT_FILES)).toThrow(DashboardJsonError);

    const rankDocument = clone(await build());
    sectionRows(rankDocument, 'change_drivers')[0]!.driver_rank = '1';
    expect(() => validateTenantDashboard(rankDocument, 'trust_north', EXPORT_FILES)).toThrow(DashboardJsonError);

    const orderDocument = clone(await build());
    sectionRows(orderDocument, 'question_response_distribution')[0]!.answer_order = '1';
    expect(() => validateTenantDashboard(orderDocument, 'trust_north', EXPORT_FILES)).toThrow(DashboardJsonError);
  });

  it('refuses a non-boolean is_* value', async () => {
    const document = clone(await build());
    sectionRows(document, 'indicator_analysis')[0]!.is_suppressed = 'true';
    expect(() => validateTenantDashboard(document, 'trust_north', EXPORT_FILES)).toThrow(DashboardJsonError);
  });
});
