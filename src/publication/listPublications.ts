import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const RUN_DIR_PATTERN = /^run_id=(.+)$/;
const TENANT_DIR_PATTERN = /^tenant=(.+)$/;
const TENANT_PREFIX = 'tenant=';
const MANIFEST_FILE_NAME = 'publication_manifest.json';
const CURRENT_FILE_NAME = 'current.json';

export interface PublicationTenant {
  tenant: string;
  rowCount: number;
  sha256: string;
}

export interface PublicationRun {
  runId: string;
  current: boolean;
  tenants: PublicationTenant[];
}

interface ManifestFile {
  row_count: number;
  sha256: string;
}

interface Manifest {
  files?: ManifestFile[];
}

export async function listPublications(exportRoot: string): Promise<PublicationRun[]> {
  if (!existsSync(exportRoot)) {
    return [];
  }

  let currentRunId: string | undefined;
  const currentPath = join(exportRoot, CURRENT_FILE_NAME);
  if (existsSync(currentPath)) {
    const current = JSON.parse(readFileSync(currentPath, 'utf8')) as { run_id?: string };
    currentRunId = current.run_id;
  }

  const runs: PublicationRun[] = [];
  for (const entry of readdirSync(exportRoot)) {
    const runMatch = RUN_DIR_PATTERN.exec(entry);
    const runId = runMatch?.[1];
    if (runId === undefined) {
      continue;
    }

    const runPath = join(exportRoot, entry);
    const tenantDirs = readdirSync(runPath)
      .filter((name) => TENANT_DIR_PATTERN.test(name))
      .sort();

    const tenants: PublicationTenant[] = [];
    for (const tenantDir of tenantDirs) {
      const tenant = tenantDir.slice(TENANT_PREFIX.length);
      const manifestPath = join(runPath, tenantDir, MANIFEST_FILE_NAME);
      if (!existsSync(manifestPath)) {
        continue;
      }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
      const file = manifest.files?.[0];
      if (file === undefined) {
        continue;
      }
      tenants.push({ tenant, rowCount: file.row_count, sha256: file.sha256 });
    }

    if (tenants.length === 0) {
      continue;
    }

    runs.push({ runId, current: runId === currentRunId, tenants });
  }

  runs.sort((a, b) => a.runId.localeCompare(b.runId));
  return runs;
}
