import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { validateTenantDashboard } from '../publication/dashboardJson.ts';
import type { DashboardRow, TenantDashboard } from '../publication/dashboardJson.ts';
import { EXPORT_FILES } from '../publication/exportTenants.ts';
import type { ExportFileSpec } from '../publication/exportTenants.ts';
import { toSafeCsv } from '../publication/safeCsv.ts';

export const DASHBOARD_TENANTS = ['trust_north', 'trust_south'] as const;
export type DashboardTenant = (typeof DASHBOARD_TENANTS)[number];

export const DASHBOARD_SECTIONS = [
  'indicator_analysis',
  'category_analysis',
  'change_drivers',
  'question_response_distribution',
  'support_signal_summary',
] as const;
export type DashboardSection = (typeof DASHBOARD_SECTIONS)[number];

export class DashboardReaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DashboardReaderError';
  }
}

const CURRENT_POINTER_PATTERN = /^run_id=([A-Za-z0-9_-]+)\/tenant=(trust_north|trust_south)$/;

const FILTER_KEYS = ['school', 'period', 'category', 'question'] as const;
type DashboardFilterKey = (typeof FILTER_KEYS)[number];
type DashboardFilters = Partial<Record<DashboardFilterKey, string>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function exportSpec(section: DashboardSection): ExportFileSpec {
  const spec = EXPORT_FILES.find((file) => file.fileName === `${section}.csv`);
  if (spec === undefined) {
    throw new DashboardReaderError(`Missing export file spec for dashboard section ${section}`);
  }
  return spec;
}

export function resolveTenant(value: unknown): DashboardTenant {
  for (const tenant of DASHBOARD_TENANTS) {
    if (value === tenant) {
      return tenant;
    }
  }
  throw new DashboardReaderError(`Unknown dashboard tenant: ${String(value)}`);
}

async function readCurrentPointer(exportRoot: string, tenant: DashboardTenant): Promise<string> {
  const currentPath = join(exportRoot, 'current.json');
  let text: string;
  try {
    text = await readFile(currentPath, 'utf8');
  } catch (error) {
    throw new DashboardReaderError(`Failed to read ${currentPath}: ${messageOf(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new DashboardReaderError(`Failed to parse ${currentPath}: ${messageOf(error)}`);
  }
  if (!isRecord(parsed)) {
    throw new DashboardReaderError(`${currentPath} must contain an object`);
  }
  const tenants = parsed.tenants;
  if (!isRecord(tenants)) {
    throw new DashboardReaderError(`${currentPath} tenants must be an object`);
  }
  const pointer = tenants[tenant];
  if (typeof pointer !== 'string') {
    throw new DashboardReaderError(`current.json has no pointer for tenant ${tenant}`);
  }
  const match = CURRENT_POINTER_PATTERN.exec(pointer);
  const runId = match?.[1];
  const pointerTenant = match?.[2];
  if (runId === undefined || pointerTenant !== tenant) {
    throw new DashboardReaderError(`Invalid current.json pointer for tenant ${tenant}: ${pointer}`);
  }
  return runId;
}

function assertExactSectionColumns(document: TenantDashboard): void {
  for (const section of DASHBOARD_SECTIONS) {
    const spec = exportSpec(section);
    const expected = new Set(spec.columns);
    document[section].forEach((row, index) => {
      const keys = Object.keys(row);
      if (keys.length !== spec.columns.length || keys.some((key) => !expected.has(key))) {
        throw new DashboardReaderError(
          `Dashboard section ${section} row ${index} must have exactly the columns ${spec.columns.join(', ')}; got ${keys.join(', ')}`,
        );
      }
    });
  }
}

async function readDashboardDocument(
  exportRoot: string,
  tenant: DashboardTenant,
  runId: string,
): Promise<TenantDashboard> {
  const dashboardPath = join(exportRoot, `run_id=${runId}`, `tenant=${tenant}`, 'dashboard.json');
  let text: string;
  try {
    text = await readFile(dashboardPath, 'utf8');
  } catch (error) {
    throw new DashboardReaderError(`Failed to read ${dashboardPath}: ${messageOf(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new DashboardReaderError(`Failed to parse ${dashboardPath}: ${messageOf(error)}`);
  }
  let document: TenantDashboard;
  try {
    document = validateTenantDashboard(parsed, tenant, EXPORT_FILES);
  } catch (error) {
    throw new DashboardReaderError(messageOf(error));
  }
  if (document.run_id !== runId) {
    throw new DashboardReaderError(`Dashboard document run_id must be ${runId}; got ${document.run_id}`);
  }
  assertExactSectionColumns(document);
  return document;
}

export async function readTenantDashboard(exportRoot: string, tenantInput: unknown): Promise<TenantDashboard> {
  const tenant = resolveTenant(tenantInput);
  const runId = await readCurrentPointer(exportRoot, tenant);
  return readDashboardDocument(exportRoot, tenant, runId);
}

function requireStringFilter(
  value: unknown,
  key: DashboardFilterKey,
  present: (candidate: string) => boolean,
): string {
  if (typeof value !== 'string') {
    throw new DashboardReaderError(`Dashboard filter ${key} must be a string`);
  }
  if (!present(value)) {
    throw new DashboardReaderError(`Dashboard filter ${key} value not present in the document: ${value}`);
  }
  return value;
}

function parseFilters(value: unknown, document: TenantDashboard): DashboardFilters {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new DashboardReaderError('Dashboard filters must be a plain object or undefined');
  }
  for (const key of Object.keys(value)) {
    if (!(FILTER_KEYS as readonly string[]).includes(key)) {
      throw new DashboardReaderError(`Unknown dashboard filter: ${key}`);
    }
  }
  const periods = new Set(document.filters.periods);
  const schoolCodes = new Set(document.filters.schools.map((entry) => entry.code));
  const categoryCodes = new Set(document.filters.categories.map((entry) => entry.code));
  const questionCodes = new Set(document.filters.questions.map((entry) => entry.code));
  const filters: DashboardFilters = {};
  if (value.school !== undefined) {
    filters.school = requireStringFilter(value.school, 'school', (candidate) => schoolCodes.has(candidate));
  }
  if (value.period !== undefined) {
    filters.period = requireStringFilter(value.period, 'period', (candidate) => periods.has(candidate));
  }
  if (value.category !== undefined) {
    filters.category = requireStringFilter(value.category, 'category', (candidate) => categoryCodes.has(candidate));
  }
  if (value.question !== undefined) {
    filters.question = requireStringFilter(value.question, 'question', (candidate) => questionCodes.has(candidate));
  }
  return filters;
}

function matchesFilters(row: DashboardRow, filters: DashboardFilters): boolean {
  if (filters.school !== undefined && row.school_id !== filters.school) {
    return false;
  }
  if (filters.period !== undefined && row.survey_period !== filters.period) {
    return false;
  }
  if (filters.category !== undefined && 'category_code' in row && row.category_code !== filters.category) {
    return false;
  }
  if (filters.question !== undefined && 'question_code' in row && row.question_code !== filters.question) {
    return false;
  }
  return true;
}

export function selectDashboard(document: TenantDashboard, filters: unknown): TenantDashboard {
  const selected = parseFilters(filters, document);
  const rows = (section: DashboardSection): readonly DashboardRow[] =>
    document[section].filter((row) => matchesFilters(row, selected));
  return {
    ...document,
    indicator_analysis: rows('indicator_analysis'),
    category_analysis: rows('category_analysis'),
    change_drivers: rows('change_drivers'),
    question_response_distribution: rows('question_response_distribution'),
    support_signal_summary: rows('support_signal_summary'),
  };
}

export function dashboardSectionCsv(rows: readonly DashboardRow[], section: DashboardSection): string {
  return toSafeCsv(exportSpec(section).columns, rows);
}
