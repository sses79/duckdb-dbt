import { dashboardServerConfig, parseDashboardQuery, parseExportQuery } from './request.ts';
import type { DashboardQuery } from './request.ts';
import { dashboardSectionCsv, readTenantDashboard, selectDashboard } from './reader.ts';
import type { DashboardSection, DashboardTenant } from './reader.ts';
import type { TenantDashboard } from '../publication/dashboardJson.ts';

const BAD_REQUEST_BODY = '{"error":"Invalid dashboard query"}';
const SERVICE_UNAVAILABLE_BODY = '{"error":"Dashboard data is temporarily unavailable"}';

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';

const COMMON_RESPONSE_HEADERS = {
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
} as const;

function jsonResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      ...COMMON_RESPONSE_HEADERS,
      'content-type': JSON_CONTENT_TYPE,
    },
  });
}

function csvResponse(body: string, tenant: DashboardTenant, section: DashboardSection): Response {
  return new Response(body, {
    status: 200,
    headers: {
      ...COMMON_RESPONSE_HEADERS,
      'content-type': CSV_CONTENT_TYPE,
      'content-disposition': `attachment; filename="${tenant}-${section}.csv"`,
    },
  });
}

export async function handleDashboardJson(
  request: Request,
  env: Readonly<Record<string, string | undefined>>,
): Promise<Response> {
  let config: ReturnType<typeof dashboardServerConfig>;
  try {
    config = dashboardServerConfig(env);
  } catch {
    return jsonResponse(503, SERVICE_UNAVAILABLE_BODY);
  }

  let query: DashboardQuery;
  try {
    query = parseDashboardQuery(new URL(request.url).searchParams);
  } catch {
    return jsonResponse(400, BAD_REQUEST_BODY);
  }

  let document: TenantDashboard;
  try {
    document = await readTenantDashboard(config.exportRoot, config.tenant);
  } catch {
    return jsonResponse(503, SERVICE_UNAVAILABLE_BODY);
  }

  let selected: TenantDashboard;
  try {
    selected = selectDashboard(document, query);
  } catch {
    return jsonResponse(400, BAD_REQUEST_BODY);
  }

  return jsonResponse(200, JSON.stringify(selected));
}

export async function handleDashboardCsv(
  request: Request,
  env: Readonly<Record<string, string | undefined>>,
): Promise<Response> {
  let config: ReturnType<typeof dashboardServerConfig>;
  try {
    config = dashboardServerConfig(env);
  } catch {
    return jsonResponse(503, SERVICE_UNAVAILABLE_BODY);
  }

  let exportQuery: { section: DashboardSection; query: DashboardQuery };
  try {
    exportQuery = parseExportQuery(new URL(request.url).searchParams);
  } catch {
    return jsonResponse(400, BAD_REQUEST_BODY);
  }

  let document: TenantDashboard;
  try {
    document = await readTenantDashboard(config.exportRoot, config.tenant);
  } catch {
    return jsonResponse(503, SERVICE_UNAVAILABLE_BODY);
  }

  let selected: TenantDashboard;
  try {
    selected = selectDashboard(document, exportQuery.query);
  } catch {
    return jsonResponse(400, BAD_REQUEST_BODY);
  }

  return csvResponse(
    dashboardSectionCsv(selected[exportQuery.section], exportQuery.section),
    config.tenant,
    exportQuery.section,
  );
}
