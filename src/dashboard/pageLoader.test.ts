import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { loadDashboardPage } from './pageLoader.ts';
import {
  buildFixtureDashboard,
  FIXTURE_RUN_ID,
  writeFixtureExports,
} from './testing/dashboardFixture.ts';

describe('loadDashboardPage', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dashboard-fixture-'));
    writeFixtureExports(root, [
      buildFixtureDashboard('trust_north'),
      buildFixtureDashboard('trust_south'),
    ]);
  });

  function envFor(
    overrides: Readonly<Record<string, string | undefined>> = {},
  ): Readonly<Record<string, string | undefined>> {
    return {
      DASHBOARD_TENANT: 'trust_north',
      DASHBOARD_EXPORT_ROOT: root,
      ...overrides,
    };
  }

  const invalidQueries: Readonly<Record<string, string | string[] | undefined>>[] = [
    { school: 'school_s01' },
    { school: ['school_n01', 'school_n02'] },
    { tenant: 'trust_south' },
    { category: 'relationships', question: 'feel_sad' },
  ];

  it.each(invalidQueries)('returns exactly invalid-query for %#', async (params) => {
    const result = await loadDashboardPage(params, envFor());
    expect(result).toEqual({ kind: 'invalid-query' });
  });

  it('returns the ok view with tenant and latest period', async () => {
    const result = await loadDashboardPage({}, envFor());
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.view.tenant).toBe('trust_north');
      expect(result.view.selection.period).toBe('2019-spring');
    }
  });

  it('returns an ok view with school selection null for an empty school value', async () => {
    const result = await loadDashboardPage({ school: '' }, envFor());
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.view.selection.school).toBeNull();
    }
  });

  it('returns exactly invalid-query when a school array contains an empty string', async () => {
    const result = await loadDashboardPage({ school: ['', 'school_n01'] }, envFor());
    expect(result).toEqual({ kind: 'invalid-query' });
  });

  it('returns exactly unavailable when DASHBOARD_TENANT is missing', async () => {
    const result = await loadDashboardPage({}, { DASHBOARD_EXPORT_ROOT: root });
    expect(result).toEqual({ kind: 'unavailable' });
  });

  it('returns exactly unavailable when DASHBOARD_EXPORT_ROOT is relative', async () => {
    const result = await loadDashboardPage(
      {},
      { DASHBOARD_TENANT: 'trust_north', DASHBOARD_EXPORT_ROOT: 'exports/current' },
    );
    expect(result).toEqual({ kind: 'unavailable' });
  });

  it('returns exactly unavailable when the export root directory is empty', async () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), 'dashboard-empty-'));
    const result = await loadDashboardPage(
      {},
      { DASHBOARD_TENANT: 'trust_north', DASHBOARD_EXPORT_ROOT: emptyRoot },
    );
    expect(result).toEqual({ kind: 'unavailable' });
  });

  it('returns exactly unavailable when current.json points trust_north at trust_south', async () => {
    const current = {
      run_id: FIXTURE_RUN_ID,
      published_at: '2026-09-01T10:00:00.000Z',
      tenants: {
        trust_north: `run_id=${FIXTURE_RUN_ID}/tenant=trust_south`,
        trust_south: `run_id=${FIXTURE_RUN_ID}/tenant=trust_south`,
      },
    };
    writeFileSync(join(root, 'current.json'), `${JSON.stringify(current, null, 2)}\n`);
    const result = await loadDashboardPage({}, envFor());
    expect(result).toEqual({ kind: 'unavailable' });
  });
});
