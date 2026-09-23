import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { DASHBOARD_SCHEMA_VERSION } from '../publication/dashboardJson.ts';
import type { DashboardRow, TenantDashboard } from '../publication/dashboardJson.ts';
import { EXPORT_FILES } from '../publication/exportTenants.ts';
import type { ExportFileSpec } from '../publication/exportTenants.ts';
import {
  DASHBOARD_SECTIONS,
  DASHBOARD_TENANTS,
  DashboardReaderError,
  dashboardSectionCsv,
  readTenantDashboard,
  resolveTenant,
  selectDashboard,
  type DashboardSection,
} from './reader.js';

const RUN_ID = 'run-2026a';
const PERIOD = '2026-spring';
const PREVIOUS_PERIOD = '2025-autumn';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.length = 0;
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dashboard-reader-'));
  tempRoots.push(root);
  return root;
}

function exportSpec(section: DashboardSection): ExportFileSpec {
  const spec = EXPORT_FILES.find((file) => file.fileName === `${section}.csv`);
  if (spec === undefined) {
    throw new Error(`Missing export file spec for dashboard section ${section}`);
  }
  return spec;
}

function isNumericColumn(column: string): boolean {
  return /_count$|_rank$|_rate$|_pp$|^answer_order$/.test(column);
}

function buildRow(spec: ExportFileSpec, tenant: string, index: number): DashboardRow {
  const suppressed = index % 3 === 2;
  const row: Record<string, string | number | boolean | null> = {};
  for (const column of spec.columns) {
    if (column === 'trust_id') {
      row[column] = tenant;
    } else if (column === 'is_suppressed') {
      row[column] = suppressed;
    } else if (suppressed && spec.suppressedColumns.includes(column)) {
      row[column] = null;
    } else if (column === 'school_id') {
      row[column] = index % 3 === 1 ? 'school-b' : 'school-a';
    } else if (column === 'survey_period') {
      row[column] = index === 1 ? PREVIOUS_PERIOD : PERIOD;
    } else if (column === 'question_code') {
      row[column] = index % 3 === 2 ? 'q3' : `q${index}`;
    } else if (column === 'category_code') {
      row[column] = `cat-${index % 2}`;
    } else if (column.startsWith('is_')) {
      row[column] = false;
    } else if (isNumericColumn(column)) {
      row[column] = index + 1;
    } else {
      row[column] = `value-${index}`;
    }
  }
  return row;
}

function buildSections(tenant: string): Record<DashboardSection, readonly DashboardRow[]> {
  const sections = {} as Record<DashboardSection, readonly DashboardRow[]>;
  for (const section of DASHBOARD_SECTIONS) {
    sections[section] = [0, 1, 2].map((index) => buildRow(exportSpec(section), tenant, index));
  }
  return sections;
}

function buildDashboardDocument(tenant: string, runId: string): TenantDashboard {
  const sections = buildSections(tenant);
  return {
    schema_version: DASHBOARD_SCHEMA_VERSION,
    tenant,
    run_id: runId,
    freshness: null,
    filters: {
      periods: [PERIOD, PREVIOUS_PERIOD],
      schools: [
        { code: 'school-a', label: 'School A' },
        { code: 'school-b', label: 'School B' },
      ],
      categories: [
        { code: 'cat-0', label: 'Category 0' },
        { code: 'cat-1', label: 'Category 1' },
      ],
      questions: [
        { code: 'q0', label: 'Question 0', interpretation_note: null },
        { code: 'q1', label: 'Question 1', interpretation_note: null },
        { code: 'q3', label: 'Question 3', interpretation_note: null },
      ],
    },
    indicator_analysis: sections.indicator_analysis,
    category_analysis: sections.category_analysis,
    change_drivers: sections.change_drivers,
    question_response_distribution: sections.question_response_distribution,
    support_signal_summary: sections.support_signal_summary,
  };
}

function writeCurrentFile(root: string, tenants: Record<string, string>): void {
  const current = {
    run_id: RUN_ID,
    published_at: '2026-01-15T00:00:00.000Z',
    tenants,
  };
  writeFileSync(join(root, 'current.json'), `${JSON.stringify(current, null, 2)}\n`);
}

function buildFixture(): string {
  const root = makeRoot();
  writeCurrentFile(root, {
    trust_north: `run_id=${RUN_ID}/tenant=trust_north`,
    trust_south: `run_id=${RUN_ID}/tenant=trust_south`,
  });
  for (const tenant of DASHBOARD_TENANTS) {
    const directory = join(root, `run_id=${RUN_ID}`, `tenant=${tenant}`);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'dashboard.json'),
      `${JSON.stringify(buildDashboardDocument(tenant, RUN_ID), null, 2)}\n`,
    );
  }
  return root;
}

function withDashboard(
  root: string,
  tenant: string,
  mutate: (document: TenantDashboard) => TenantDashboard,
): void {
  const path = join(root, `run_id=${RUN_ID}`, `tenant=${tenant}`, 'dashboard.json');
  const document = JSON.parse(readFileSync(path, 'utf8')) as TenantDashboard;
  writeFileSync(path, `${JSON.stringify(mutate(document), null, 2)}\n`);
}

describe('resolveTenant', () => {
  it('accepts exactly the allowlisted tenant names', () => {
    expect(resolveTenant('trust_north')).toBe('trust_north');
    expect(resolveTenant('trust_south')).toBe('trust_south');
  });

  it.each(['', 'TRUST_NORTH', ' trust_north', 'trust_east', '../trust_south', 'trust_north/../trust_south', null, 42])(
    'refuses %p',
    (value) => {
      expect(() => resolveTenant(value)).toThrow(DashboardReaderError);
    },
  );
});

describe('readTenantDashboard', () => {
  it('reads and validates the current dashboard for each tenant', async () => {
    const root = buildFixture();
    const north = await readTenantDashboard(root, 'trust_north');
    const south = await readTenantDashboard(root, 'trust_south');
    expect(north.tenant).toBe('trust_north');
    expect(south.tenant).toBe('trust_south');
    expect(north.run_id).toBe(RUN_ID);
    for (const section of DASHBOARD_SECTIONS) {
      expect(north[section]).toHaveLength(3);
    }
  });

  it('refuses an unknown tenant input', async () => {
    const root = buildFixture();
    await expect(readTenantDashboard(root, 'trust_east')).rejects.toThrow(DashboardReaderError);
    await expect(readTenantDashboard(root, 42)).rejects.toThrow(DashboardReaderError);
  });

  it('refuses a pointer sending the tenant to the other tenant directory', async () => {
    const root = buildFixture();
    writeCurrentFile(root, {
      trust_north: `run_id=${RUN_ID}/tenant=trust_south`,
      trust_south: `run_id=${RUN_ID}/tenant=trust_south`,
    });
    await expect(readTenantDashboard(root, 'trust_north')).rejects.toThrow(DashboardReaderError);
  });

  it.each([
    `run_id=${RUN_ID}/../tenant=trust_north`,
    `run_id=run/2026a/tenant=trust_north`,
    `run_id=${RUN_ID}tenant=trust_north`,
  ])('refuses an unsafe current pointer: %s', async (pointer) => {
    const root = buildFixture();
    writeCurrentFile(root, {
      trust_north: pointer,
      trust_south: `run_id=${RUN_ID}/tenant=trust_south`,
    });
    await expect(readTenantDashboard(root, 'trust_north')).rejects.toThrow(DashboardReaderError);
  });

  it('refuses a missing current.json', async () => {
    const root = makeRoot();
    await expect(readTenantDashboard(root, 'trust_north')).rejects.toThrow(DashboardReaderError);
  });

  it('refuses a missing dashboard.json', async () => {
    const root = makeRoot();
    writeCurrentFile(root, { trust_north: `run_id=${RUN_ID}/tenant=trust_north` });
    await expect(readTenantDashboard(root, 'trust_north')).rejects.toThrow(DashboardReaderError);
  });

  it('refuses a dashboard whose tenant is the other tenant', async () => {
    const root = buildFixture();
    withDashboard(root, 'trust_north', (document) => ({ ...document, tenant: 'trust_south' }));
    await expect(readTenantDashboard(root, 'trust_north')).rejects.toThrow(DashboardReaderError);
  });

  it('refuses a dashboard with a row trust_id of the other tenant', async () => {
    const root = buildFixture();
    withDashboard(root, 'trust_north', (document) => ({
      ...document,
      change_drivers: document.change_drivers.map((row) => ({ ...row, trust_id: 'trust_south' })),
    }));
    await expect(readTenantDashboard(root, 'trust_north')).rejects.toThrow(DashboardReaderError);
  });

  it('refuses a dashboard whose run_id differs from the pointer', async () => {
    const root = buildFixture();
    withDashboard(root, 'trust_north', (document) => ({ ...document, run_id: 'run-other' }));
    await expect(readTenantDashboard(root, 'trust_north')).rejects.toThrow(DashboardReaderError);
  });

  it.each(['document_id', 'event_id', 'source_file', 'payload'])(
    'refuses a dashboard row carrying %s',
    async (extraKey) => {
      const root = buildFixture();
      withDashboard(root, 'trust_north', (document) => ({
        ...document,
        indicator_analysis: [
          { ...document.indicator_analysis[0]!, [extraKey]: 'x' },
          ...document.indicator_analysis.slice(1),
        ],
      }));
      await expect(readTenantDashboard(root, 'trust_north')).rejects.toThrow(DashboardReaderError);
    },
  );

  it('refuses a dashboard row carrying a non-spec column', async () => {
    const root = buildFixture();
    withDashboard(root, 'trust_north', (document) => ({
      ...document,
      category_analysis: [
        { ...document.category_analysis[0]!, mystery_key: 'x' },
        ...document.category_analysis.slice(1),
      ],
    }));
    await expect(readTenantDashboard(root, 'trust_north')).rejects.toThrow(DashboardReaderError);
  });

  it('reads trust_north without touching the trust_south directory', async () => {
    const root = buildFixture();
    rmSync(join(root, `run_id=${RUN_ID}`, 'tenant=trust_south'), { recursive: true, force: true });
    const document = await readTenantDashboard(root, 'trust_north');
    expect(document.tenant).toBe('trust_north');
    expect(document.run_id).toBe(RUN_ID);
  });
});

describe('selectDashboard', () => {
  const document = buildDashboardDocument('trust_north', RUN_ID);

  it('narrows every section by school', () => {
    const selected = selectDashboard(document, { school: 'school-b' });
    for (const section of DASHBOARD_SECTIONS) {
      expect(selected[section].length).toBeGreaterThan(0);
      for (const row of selected[section]) {
        expect(row.school_id).toBe('school-b');
      }
    }
  });

  it('narrows with every allowed filter at once', () => {
    const selected = selectDashboard(document, {
      school: 'school-b',
      period: PREVIOUS_PERIOD,
      category: 'cat-1',
      question: 'q1',
    });
    for (const section of DASHBOARD_SECTIONS) {
      expect(selected[section]).toHaveLength(1);
      for (const row of selected[section]) {
        expect(row.school_id).toBe('school-b');
        expect(row.survey_period).toBe(PREVIOUS_PERIOD);
        if ('category_code' in row) {
          expect(row.category_code).toBe('cat-1');
        }
        if ('question_code' in row) {
          expect(row.question_code).toBe('q1');
        }
      }
    }
  });

  it('applies no narrowing when filters are undefined', () => {
    const selected = selectDashboard(document, undefined);
    for (const section of DASHBOARD_SECTIONS) {
      expect(selected[section]).toEqual(document[section]);
    }
  });

  it('refuses an unknown filter key', () => {
    expect(() => selectDashboard(document, { school_id: 'school-a' })).toThrow(DashboardReaderError);
    expect(() => selectDashboard(document, { admin: '../config' })).toThrow(DashboardReaderError);
  });

  it('refuses non-object filter input', () => {
    expect(() => selectDashboard(document, null)).toThrow(DashboardReaderError);
    expect(() => selectDashboard(document, 42)).toThrow(DashboardReaderError);
    expect(() => selectDashboard(document, ['school'])).toThrow(DashboardReaderError);
    expect(() => selectDashboard(document, 'school-a')).toThrow(DashboardReaderError);
  });

  it('refuses non-string filter values', () => {
    expect(() => selectDashboard(document, { school: 42 })).toThrow(DashboardReaderError);
    expect(() => selectDashboard(document, { period: null })).toThrow(DashboardReaderError);
    expect(() => selectDashboard(document, { question: false })).toThrow(DashboardReaderError);
  });

  it('refuses filter values absent from the document filters', () => {
    expect(() => selectDashboard(document, { school: 'school-z' })).toThrow(DashboardReaderError);
    expect(() => selectDashboard(document, { period: '2020-summer' })).toThrow(DashboardReaderError);
    expect(() => selectDashboard(document, { category: 'cat-z' })).toThrow(DashboardReaderError);
    expect(() => selectDashboard(document, { question: 'q-z' })).toThrow(DashboardReaderError);
  });

  it('refuses a path-like filter value rather than resolving it', () => {
    expect(() => selectDashboard(document, { school: '../x' })).toThrow(DashboardReaderError);
    expect(() => selectDashboard(document, { period: '2026-spring/../config' })).toThrow(DashboardReaderError);
    expect(() => selectDashboard(document, { question: '/etc/passwd' })).toThrow(DashboardReaderError);
  });

  it('narrows only where the row carries the filtered column', () => {
    const selected = selectDashboard(document, { question: 'q0' });
    for (const section of DASHBOARD_SECTIONS) {
      for (const row of selected[section]) {
        if ('question_code' in row) {
          expect(row.question_code).toBe('q0');
        }
      }
      expect(selected[section].length).toBeGreaterThanOrEqual(1);
    }
  });

  it('returns rows carrying only their spec columns', () => {
    const selected = selectDashboard(document, undefined);
    for (const section of DASHBOARD_SECTIONS) {
      const spec = exportSpec(section);
      for (const row of selected[section]) {
        const keys = Object.keys(row);
        expect(keys).toHaveLength(spec.columns.length);
        for (const key of keys) {
          expect(spec.columns).toContain(key);
        }
      }
    }
  });
});

describe('suppressed rows', () => {
  const document = buildDashboardDocument('trust_north', RUN_ID);

  it('keeps protected values null in selectDashboard results', () => {
    const selected = selectDashboard(document, { school: 'school-a' });
    for (const section of DASHBOARD_SECTIONS) {
      const spec = exportSpec(section);
      const suppressedRow = selected[section].find((row) => row.is_suppressed === true);
      expect(suppressedRow).toBeDefined();
      for (const column of spec.suppressedColumns) {
        expect(suppressedRow?.[column]).toBeNull();
      }
    }
  });

  it('renders protected values as empty cells in dashboardSectionCsv', () => {
    const selected = selectDashboard(document, undefined);
    for (const section of DASHBOARD_SECTIONS) {
      const spec = exportSpec(section);
      const csv = dashboardSectionCsv(selected[section], section);
      const lines = csv.trimEnd().split('\n');
      const header = lines[0]!.split(',');
      expect(header).toEqual(spec.columns);
      const suppressedIndex = selected[section].findIndex((row) => row.is_suppressed === true);
      const normalIndex = selected[section].findIndex((row) => row.is_suppressed === false);
      const suppressedCells = lines[suppressedIndex + 1]!.split(',');
      const normalCells = lines[normalIndex + 1]!.split(',');
      for (const column of spec.suppressedColumns) {
        expect(suppressedCells[header.indexOf(column)]).toBe('');
        expect(normalCells[header.indexOf(column)]).not.toBe('');
      }
    }
  });
});

describe('dashboardSectionCsv', () => {
  it('renders a section from a read dashboard with the spec header', async () => {
    const root = buildFixture();
    const document = await readTenantDashboard(root, 'trust_north');
    const csv = dashboardSectionCsv(document.indicator_analysis, 'indicator_analysis');
    const header = csv.trimEnd().split('\n')[0]!.split(',');
    expect(header).toEqual(exportSpec('indicator_analysis').columns);
    expect(csv).toContain('trust_north');
  });
});
