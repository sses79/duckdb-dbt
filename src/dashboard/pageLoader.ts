import { DashboardReaderError, readTenantDashboard } from './reader.ts';
import type { TenantDashboard } from '../publication/dashboardJson.ts';
import {
  DashboardRequestError,
  dashboardServerConfig,
  parseDashboardQuery,
  searchParamsFromRecord,
} from './request.ts';
import type { DashboardQuery } from './request.ts';
import { resolveSelection } from './selection.ts';
import type { DashboardSelection } from './selection.ts';
import { buildDashboardView } from './viewModel.ts';
import type { DashboardView } from './viewModel.ts';

export type DashboardPageResult =
  | { kind: 'ok'; view: DashboardView }
  | { kind: 'invalid-query' }
  | { kind: 'unavailable' };

type DashboardConfig = ReturnType<typeof dashboardServerConfig>;

function withoutEmpty(
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
): Record<string, string | string[] | undefined> {
  const result: Record<string, string | string[] | undefined> = {};
  for (const key of Object.keys(searchParams)) {
    const value = searchParams[key];
    if (value === '') {
      continue;
    }
    result[key] = value;
  }
  return result;
}

export async function loadDashboardPage(
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
  env: Readonly<Record<string, string | undefined>>,
): Promise<DashboardPageResult> {
  let config: DashboardConfig;
  try {
    config = dashboardServerConfig(env);
  } catch {
    return { kind: 'unavailable' };
  }

  let query: DashboardQuery;
  try {
    query = parseDashboardQuery(searchParamsFromRecord(withoutEmpty(searchParams)));
  } catch {
    return { kind: 'invalid-query' };
  }

  let document: TenantDashboard;
  try {
    document = await readTenantDashboard(config.exportRoot, config.tenant);
  } catch {
    return { kind: 'unavailable' };
  }

  let selection: DashboardSelection;
  try {
    selection = resolveSelection(document, query);
  } catch (error) {
    if (error instanceof DashboardReaderError || error instanceof DashboardRequestError) {
      return { kind: 'invalid-query' };
    }
    return { kind: 'unavailable' };
  }

  try {
    const view = buildDashboardView(document, selection);
    return { kind: 'ok', view };
  } catch {
    return { kind: 'unavailable' };
  }
}
