import { describe, expect, it } from 'vitest';

import {
  DashboardRequestError,
  dashboardServerConfig,
  parseDashboardQuery,
  parseExportQuery,
  searchParamsFromRecord,
} from './request.ts';

function errorFrom(fn: () => unknown): Error {
  try {
    fn();
  } catch (caught) {
    return caught instanceof Error ? caught : new Error(String(caught));
  }
  throw new Error('Expected an error');
}

describe('parseDashboardQuery', () => {
  it('parses known keys into a query', () => {
    expect(parseDashboardQuery(new URLSearchParams('school=school_n01&period=2019-spring'))).toEqual({
      school: 'school_n01',
      period: '2019-spring',
    });
  });

  it('returns an empty query for empty parameters', () => {
    expect(parseDashboardQuery(new URLSearchParams())).toEqual({});
  });

  for (const key of ['tenant', 'trust_id', 'section', '__proto__']) {
    it(`refuses the key ${key}`, () => {
      expect(() => parseDashboardQuery(new URLSearchParams(`${key}=value`))).toThrow(DashboardRequestError);
    });
  }

  it('refuses a repeated key', () => {
    expect(() => parseDashboardQuery(new URLSearchParams('school=first&school=second'))).toThrow(
      DashboardRequestError,
    );
  });

  it('refuses an empty value', () => {
    expect(() => parseDashboardQuery(new URLSearchParams('school='))).toThrow(DashboardRequestError);
  });

  it('refuses a value longer than 80 characters', () => {
    expect(() => parseDashboardQuery(new URLSearchParams(`school=${'a'.repeat(81)}`))).toThrow(
      DashboardRequestError,
    );
  });

  for (const value of ['../x', 'a/b', 'a.b', 'a b', '%00']) {
    it(`refuses the value ${value}`, () => {
      expect(() => parseDashboardQuery(new URLSearchParams(`school=${value}`))).toThrow(DashboardRequestError);
    });
  }

  it('accepts a value of exactly 80 characters', () => {
    expect(parseDashboardQuery(new URLSearchParams(`school=${'a'.repeat(80)}`))).toEqual({
      school: 'a'.repeat(80),
    });
  });
});

describe('parseExportQuery', () => {
  it('requires a section', () => {
    expect(() => parseExportQuery(new URLSearchParams('school=a'))).toThrow(DashboardRequestError);
  });

  it('accepts indicator_analysis with filter keys', () => {
    expect(
      parseExportQuery(new URLSearchParams('section=indicator_analysis&school=a&period=2019-spring')),
    ).toEqual({
      section: 'indicator_analysis',
      query: { school: 'a', period: '2019-spring' },
    });
  });

  it('refuses school_wellbeing_trend', () => {
    expect(() => parseExportQuery(new URLSearchParams('section=school_wellbeing_trend'))).toThrow(
      DashboardRequestError,
    );
  });

  it('refuses an unknown section', () => {
    expect(() => parseExportQuery(new URLSearchParams('section=unlisted_section'))).toThrow(
      DashboardRequestError,
    );
  });

  it('refuses a key outside the allowed set', () => {
    expect(() => parseExportQuery(new URLSearchParams('section=indicator_analysis&tenant=trust_south'))).toThrow(
      DashboardRequestError,
    );
  });
});

describe('searchParamsFromRecord', () => {
  it('appends every array element under its key and skips undefined', () => {
    const params = searchParamsFromRecord({ school: ['a', 'b'], period: undefined });
    expect(params.getAll('school')).toEqual(['a', 'b']);
    expect(params.has('period')).toBe(false);
  });

  it('appends a single value once', () => {
    const params = searchParamsFromRecord({ school: 'a', period: undefined });
    expect(params.getAll('school')).toEqual(['a']);
    expect(params.has('period')).toBe(false);
  });

  it('keeps repeated keys visible to parsing', () => {
    expect(() => parseDashboardQuery(searchParamsFromRecord({ school: ['a', 'b'], period: undefined }))).toThrow(
      DashboardRequestError,
    );
  });
});

describe('dashboardServerConfig', () => {
  it('refuses a missing DASHBOARD_TENANT', () => {
    expect(() => dashboardServerConfig({ DASHBOARD_EXPORT_ROOT: '/srv/exports' })).toThrow(DashboardRequestError);
  });

  it('refuses an unknown tenant, naming DASHBOARD_TENANT without echoing the value', () => {
    const error = errorFrom(() =>
      dashboardServerConfig({ DASHBOARD_TENANT: 'trust_east', DASHBOARD_EXPORT_ROOT: '/srv/exports' }),
    );
    expect(error).toBeInstanceOf(DashboardRequestError);
    expect(error.message).toContain('DASHBOARD_TENANT');
    expect(error.message).not.toContain('trust_east');
  });

  it('refuses a missing DASHBOARD_EXPORT_ROOT, naming the variable', () => {
    const error = errorFrom(() => dashboardServerConfig({ DASHBOARD_TENANT: 'trust_south' }));
    expect(error).toBeInstanceOf(DashboardRequestError);
    expect(error.message).toContain('DASHBOARD_EXPORT_ROOT');
  });

  it('refuses a relative DASHBOARD_EXPORT_ROOT', () => {
    expect(() => dashboardServerConfig({ DASHBOARD_TENANT: 'trust_south', DASHBOARD_EXPORT_ROOT: 'exports' })).toThrow(
      DashboardRequestError,
    );
  });

  it('returns the tenant and export root for valid input', () => {
    expect(
      dashboardServerConfig({ DASHBOARD_TENANT: 'trust_south', DASHBOARD_EXPORT_ROOT: '/srv/exports' }),
    ).toEqual({ tenant: 'trust_south', exportRoot: '/srv/exports' });
  });
});

describe('DashboardRequestError', () => {
  it('has the expected name', () => {
    expect(new DashboardRequestError('boom').name).toBe('DashboardRequestError');
  });
});
