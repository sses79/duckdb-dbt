import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Page from '../app/page.tsx';
import { NON_DIAGNOSTIC_NOTICE } from '../components/EvidencePanels.tsx';
import {
  buildFixtureDashboard,
  writeFixtureExports,
} from '../../../src/dashboard/testing/dashboardFixture.ts';

const ORIGINAL_TENANT = process.env.DASHBOARD_TENANT;
const ORIGINAL_EXPORT_ROOT = process.env.DASHBOARD_EXPORT_ROOT;

function setEnv(tenant: string | undefined, exportRoot: string | undefined): void {
  if (tenant === undefined) {
    delete process.env.DASHBOARD_TENANT;
  } else {
    process.env.DASHBOARD_TENANT = tenant;
  }
  if (exportRoot === undefined) {
    delete process.env.DASHBOARD_EXPORT_ROOT;
  } else {
    process.env.DASHBOARD_EXPORT_ROOT = exportRoot;
  }
}

function restoreEnv(): void {
  setEnv(ORIGINAL_TENANT, ORIGINAL_EXPORT_ROOT);
}

async function renderPage(query: Record<string, string>): Promise<string> {
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(query) }));
}

describe('dashboard page', () => {
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'dashboard-page-'));
    await writeFixtureExports(root, [
      buildFixtureDashboard('trust_north'),
      buildFixtureDashboard('trust_south'),
    ]);
    setEnv('trust_north', root);
  });

  afterEach(() => {
    restoreEnv();
    rmSync(root, { recursive: true, force: true });
  });

  it('renders the loaded view for the default query', async () => {
    const markup = await renderPage({});
    expect(markup).toContain('School Wellbeing Signals');
    expect(markup).toContain('trust_north');
    expect(markup).toContain('school_n01');
    expect(markup).toContain('school_n02');
    expect(markup).toContain('Suppressed');
    expect(markup).toContain(NON_DIAGNOSTIC_NOTICE.slice(0, 40));
    expect(markup).toContain('/api/export?section=indicator_analysis');
    expect(markup).not.toContain('trust_south');
    expect(markup).not.toContain('school_s01');
    expect(markup).not.toContain('document_id');
    expect(markup).not.toContain(root);
  });

  it('rejects a selection for another trust without leaking export details', async () => {
    const markup = await renderPage({ tenant: 'trust_south' });
    expect(markup).toContain('That selection is not available.');
    expect(markup).not.toContain('school_');
    expect(markup).not.toContain(root);
  });

  it('shows the unavailable message when the tenant is not configured', async () => {
    setEnv(undefined, root);
    const markup = await renderPage({});
    expect(markup).toContain('Dashboard data is temporarily unavailable.');
    expect(markup).not.toContain('school_');
    expect(markup).not.toContain(root);
  });

  it('keeps the page a server component importing only the loader from src', () => {
    const source = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain("'use client'");
    const srcImports = [...source.matchAll(/from '\.\.\/\.\.\/\.\.\/src\/([^']+)'/g)].map(
      (match) => match[1],
    );
    expect(srcImports).toEqual(['dashboard/pageLoader.ts']);
  });
});