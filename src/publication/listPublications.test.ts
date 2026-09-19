import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listPublications } from './listPublications.js';

function writeManifest(root: string, runId: string, tenant: string, rowCount: number, sha256: string): void {
  const tenantDir = join(root, `run_id=${runId}`, `tenant=${tenant}`);
  mkdirSync(tenantDir, { recursive: true });
  const manifest = {
    schema_version: 'wellbeing-publication/1',
    run_id: runId,
    tenant,
    created_at: '2026-01-01T00:00:00.000Z',
    files: [{ file_name: 'school_wellbeing_trend.csv', row_count: rowCount, sha256 }],
  };
  writeFileSync(join(tenantDir, 'publication_manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function writeCurrent(root: string, runId: string): void {
  const current = { run_id: runId, published_at: '2026-01-01T00:00:00.000Z', tenants: {} };
  writeFileSync(join(root, 'current.json'), `${JSON.stringify(current, null, 2)}\n`);
}

describe('listPublications', () => {
  it('returns runs sorted by runId with the current run flagged', async () => {
    const root = mkdtempSync(join(tmpdir(), 'list-publications-'));
    try {
      writeCurrent(root, 'run-b');
      writeManifest(root, 'run-b', 'trust_north', 2, 'sha-b-north');
      writeManifest(root, 'run-b', 'trust_south', 3, 'sha-b-south');
      writeManifest(root, 'run-a', 'trust_north', 1, 'sha-a-north');
      writeManifest(root, 'run-c', 'trust_north', 4, 'sha-c-north');

      await expect(listPublications(root)).resolves.toEqual([
        {
          runId: 'run-a',
          current: false,
          tenants: [{ tenant: 'trust_north', rowCount: 1, sha256: 'sha-a-north' }],
        },
        {
          runId: 'run-b',
          current: true,
          tenants: [
            { tenant: 'trust_north', rowCount: 2, sha256: 'sha-b-north' },
            { tenant: 'trust_south', rowCount: 3, sha256: 'sha-b-south' },
          ],
        },
        {
          runId: 'run-c',
          current: false,
          tenants: [{ tenant: 'trust_north', rowCount: 4, sha256: 'sha-c-north' }],
        },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns an empty list when the export root is missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'list-publications-'));
    try {
      await expect(listPublications(join(root, 'does-not-exist'))).resolves.toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips a run directory without manifests', async () => {
    const root = mkdtempSync(join(tmpdir(), 'list-publications-'));
    try {
      mkdirSync(join(root, 'run_id=empty-run'), { recursive: true });
      writeManifest(root, 'run-a', 'trust_north', 1, 'sha-a-north');

      await expect(listPublications(root)).resolves.toEqual([
        {
          runId: 'run-a',
          current: false,
          tenants: [{ tenant: 'trust_north', rowCount: 1, sha256: 'sha-a-north' }],
        },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('flags no run as current when current.json is missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'list-publications-'));
    try {
      writeManifest(root, 'run-a', 'trust_north', 1, 'sha-a-north');
      writeManifest(root, 'run-b', 'trust_south', 2, 'sha-b-south');

      await expect(listPublications(root)).resolves.toEqual([
        {
          runId: 'run-a',
          current: false,
          tenants: [{ tenant: 'trust_north', rowCount: 1, sha256: 'sha-a-north' }],
        },
        {
          runId: 'run-b',
          current: false,
          tenants: [{ tenant: 'trust_south', rowCount: 2, sha256: 'sha-b-south' }],
        },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
