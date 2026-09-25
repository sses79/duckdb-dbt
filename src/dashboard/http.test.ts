import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TenantDashboard } from '../publication/dashboardJson.ts';
import { handleDashboardCsv, handleDashboardJson } from './http.ts';
import { DASHBOARD_SECTIONS } from './reader.ts';
import { buildFixtureDashboard, FIXTURE_RUN_ID, writeFixtureExports } from './testing/dashboardFixture.ts';

type Env = Readonly<Record<string, string | undefined>>;

let exportRoot: string;

beforeEach(() => {
  exportRoot = mkdtempSync(join(tmpdir(), 'dashboard-http-test-'));
  writeFixtureExports(exportRoot, [
    buildFixtureDashboard('trust_north'),
    buildFixtureDashboard('trust_south'),
  ]);
});

afterEach(() => {
  rmSync(exportRoot, { recursive: true, force: true });
});

function requestEnv(overrides: Readonly<Record<string, string | undefined>> = {}): Env {
  return {
    DASHBOARD_TENANT: 'trust_north',
    DASHBOARD_EXPORT_ROOT: exportRoot,
    ...overrides,
  };
}

function expectSecurityHeaders(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
}

function field(row: unknown, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

async function expectJsonError(
  response: Response,
  status: 400 | 503,
  received: readonly string[] = [],
): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  expectSecurityHeaders(response);
  const body = await response.text();
  if (status === 400) {
    expect(body).toBe('{"error":"Invalid dashboard query"}');
  } else {
    expect(body).toBe('{"error":"Dashboard data is temporarily unavailable"}');
  }
  expect(body).not.toContain(exportRoot);
  for (const value of received) {
    expect(body).not.toContain(value);
  }
}

describe('handleDashboardJson', () => {
  it('returns the whole trust_north document when no query is given', async () => {
    const response = await handleDashboardJson(new Request('http://dashboard.test/api'), requestEnv());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expectSecurityHeaders(response);
    const document = (await response.json()) as TenantDashboard;
    expect(document.tenant).toBe('trust_north');
    expect(document.run_id).toBe(FIXTURE_RUN_ID);
    for (const section of DASHBOARD_SECTIONS) {
      expect(document[section].length).toBeGreaterThan(0);
      for (const row of document[section]) {
        expect(field(row, 'trust_id')).toBe('trust_north');
      }
    }
    expect(JSON.stringify(document)).not.toContain('document_id');
  });

  it('rejects tenant and trust_id query keys with 400', async () => {
    for (const key of ['tenant', 'trust_id']) {
      const response = await handleDashboardJson(
        new Request(`http://dashboard.test/api?${key}=trust_south`),
        requestEnv(),
      );
      await expectJsonError(response, 400, ['trust_south']);
    }
  });

  it('rejects a school from another tenant with 400', async () => {
    const response = await handleDashboardJson(
      new Request('http://dashboard.test/api?school=school_s01'),
      requestEnv(),
    );
    await expectJsonError(response, 400, ['school_s01']);
  });

  it('rejects an invalid query value with 400', async () => {
    const response = await handleDashboardJson(
      new Request('http://dashboard.test/api?school=..%2Fx'),
      requestEnv(),
    );
    await expectJsonError(response, 400, ['../x']);
  });

  it('rejects a repeated query key with 400', async () => {
    const response = await handleDashboardJson(
      new Request('http://dashboard.test/api?school=school_n01&school=school_n02'),
      requestEnv(),
    );
    await expectJsonError(response, 400, ['school_n01', 'school_n02']);
  });

  it('rejects an unknown query key with 400', async () => {
    const response = await handleDashboardJson(
      new Request('http://dashboard.test/api?unknown=value'),
      requestEnv(),
    );
    await expectJsonError(response, 400, ['unknown', 'value']);
  });

  it('returns 503 when DASHBOARD_TENANT is missing', async () => {
    const response = await handleDashboardJson(
      new Request('http://dashboard.test/api'),
      requestEnv({ DASHBOARD_TENANT: undefined }),
    );
    await expectJsonError(response, 503);
  });

  it('returns 503 when DASHBOARD_EXPORT_ROOT is relative', async () => {
    const response = await handleDashboardJson(
      new Request('http://dashboard.test/api'),
      requestEnv({ DASHBOARD_EXPORT_ROOT: 'exports' }),
    );
    await expectJsonError(response, 503, ['exports']);
  });

  it('returns 503 when current.json points trust_north at another tenant', async () => {
    const currentPath = join(exportRoot, 'current.json');
    const current = JSON.parse(readFileSync(currentPath, 'utf8')) as { tenants: Record<string, string> };
    current.tenants['trust_north'] = `run_id=${FIXTURE_RUN_ID}/tenant=trust_south`;
    writeFileSync(currentPath, JSON.stringify(current));
    const response = await handleDashboardJson(new Request('http://dashboard.test/api'), requestEnv());
    await expectJsonError(response, 503, ['trust_south']);
  });

  it('returns null adverse_response_rate for suppressed rows and leaks no document_id', async () => {
    const response = await handleDashboardJson(
      new Request('http://dashboard.test/api?school=school_n02&period=2019-spring'),
      requestEnv(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expectSecurityHeaders(response);
    const document = (await response.json()) as TenantDashboard;
    for (const section of DASHBOARD_SECTIONS) {
      expect(document[section].length).toBeGreaterThan(0);
      for (const row of document[section]) {
        expect(field(row, 'school_id')).toBe('school_n02');
        expect(field(row, 'survey_period')).toBe('2019-spring');
      }
    }
    for (const row of document.indicator_analysis) {
      expect(field(row, 'adverse_response_rate')).toBeNull();
    }
    expect(JSON.stringify(document)).not.toContain('document_id');
  });
});

describe('handleDashboardCsv', () => {
  it('exports indicator_analysis with attachment headers and empty suppressed cells', async () => {
    const response = await handleDashboardCsv(
      new Request('http://dashboard.test/api?section=indicator_analysis&school=school_n02&period=2019-spring'),
      requestEnv(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="trust_north-indicator_analysis.csv"',
    );
    expectSecurityHeaders(response);
    const text = await response.text();
    expect(text).not.toContain('document_id');
    const lines = text.trimEnd().split('\n');
    const header = lines[0]!.split(',');
    const rateColumn = header.indexOf('adverse_response_rate');
    expect(rateColumn).toBeGreaterThanOrEqual(0);
    const rows = lines.slice(1);
    expect(rows.length).toBeGreaterThan(0);
    for (const line of rows) {
      const cells = line.split(',');
      expect(cells[rateColumn]).toBe('');
    }
  });

  it('rejects an unknown section with 400', async () => {
    const response = await handleDashboardCsv(
      new Request('http://dashboard.test/api?section=school_wellbeing_trend'),
      requestEnv(),
    );
    await expectJsonError(response, 400, ['school_wellbeing_trend']);
  });

  it('rejects a missing section with 400', async () => {
    const response = await handleDashboardCsv(new Request('http://dashboard.test/api'), requestEnv());
    await expectJsonError(response, 400);
  });

  it('returns 503 when DASHBOARD_TENANT is missing', async () => {
    const response = await handleDashboardCsv(
      new Request('http://dashboard.test/api?section=indicator_analysis'),
      requestEnv({ DASHBOARD_TENANT: undefined }),
    );
    await expectJsonError(response, 503);
  });
});
