import { isAbsolute } from 'node:path';

import { DASHBOARD_SECTIONS, resolveTenant } from './reader.ts';
import type { DashboardSection, DashboardTenant } from './reader.ts';

export class DashboardRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DashboardRequestError';
  }
}

export const DASHBOARD_QUERY_KEYS = ['school', 'period', 'category', 'question'] as const;
export type DashboardQuery = Partial<Record<(typeof DASHBOARD_QUERY_KEYS)[number], string>>;

const EXPORT_QUERY_KEYS = ['section', ...DASHBOARD_QUERY_KEYS] as const;
const QUERY_VALUE_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_QUERY_VALUE_LENGTH = 80;

function isValidQueryValue(value: string): boolean {
  return value.length > 0 && value.length <= MAX_QUERY_VALUE_LENGTH && QUERY_VALUE_PATTERN.test(value);
}

function parseQuery(
  params: URLSearchParams,
  allowedKeys: readonly string[],
): { query: DashboardQuery; section: DashboardSection | undefined } {
  const query: Record<string, string> = {};
  let section: DashboardSection | undefined;
  for (const key of params.keys()) {
    if (!allowedKeys.includes(key)) {
      throw new DashboardRequestError('Unknown dashboard query key');
    }
    const values = params.getAll(key);
    if (values.length !== 1) {
      throw new DashboardRequestError('Dashboard query key must be given exactly once');
    }
    const value = values[0];
    if (value === undefined || !isValidQueryValue(value)) {
      throw new DashboardRequestError('Invalid dashboard query value');
    }
    if (key === 'section') {
      if (!(DASHBOARD_SECTIONS as readonly string[]).includes(value)) {
        throw new DashboardRequestError('Unknown dashboard section');
      }
      section = value as DashboardSection;
    } else {
      query[key] = value;
    }
  }
  return { query: query as DashboardQuery, section };
}

export function parseDashboardQuery(params: URLSearchParams): DashboardQuery {
  return parseQuery(params, DASHBOARD_QUERY_KEYS).query;
}

export function parseExportQuery(
  params: URLSearchParams,
): { section: DashboardSection; query: DashboardQuery } {
  const { query, section } = parseQuery(params, EXPORT_QUERY_KEYS);
  if (section === undefined) {
    throw new DashboardRequestError('Dashboard section is required');
  }
  return { section, query };
}

export function searchParamsFromRecord(
  record: Readonly<Record<string, string | string[] | undefined>>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        params.append(key, entry);
      }
    } else {
      params.append(key, value);
    }
  }
  return params;
}

export function dashboardServerConfig(
  env: Readonly<Record<string, string | undefined>>,
): { tenant: DashboardTenant; exportRoot: string } {
  let tenant: DashboardTenant;
  try {
    tenant = resolveTenant(env.DASHBOARD_TENANT);
  } catch {
    throw new DashboardRequestError('Invalid DASHBOARD_TENANT');
  }
  const exportRoot = env.DASHBOARD_EXPORT_ROOT;
  if (typeof exportRoot !== 'string' || exportRoot === '' || !isAbsolute(exportRoot)) {
    throw new DashboardRequestError('DASHBOARD_EXPORT_ROOT must be a non-empty absolute path');
  }
  return { tenant, exportRoot };
}
