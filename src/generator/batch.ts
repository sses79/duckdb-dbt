import { createHash } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { SCHEMA_VERSION } from './envelope.ts';
import type { SubmissionEvent } from './envelope.ts';

export interface BatchManifest {
  batch_id: string;
  schema_version: typeof SCHEMA_VERSION;
  data_file: 'submissions.ndjson.gz';
  data_file_sha256: string;
  row_count: number;
  distinct_event_count: number;
  scenario: string;
  expected: Record<string, number>;
}

const DATA_FILE = 'submissions.ndjson.gz';
const MANIFEST_FILE = 'manifest.json';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function writeBatch(input: {
  events: SubmissionEvent[];
  outputDir: string;
  batchId: string;
  scenario: string;
  expected: Record<string, number>;
}): Promise<BatchManifest> {
  const { events, outputDir, batchId, scenario, expected } = input;

  await mkdir(outputDir, { recursive: true });

  const dataFile = join(outputDir, DATA_FILE);
  const manifestFile = join(outputDir, MANIFEST_FILE);
  if ((await exists(dataFile)) || (await exists(manifestFile))) {
    throw new Error(
      `Refusing to write batch: ${outputDir} already contains submissions.ndjson.gz or manifest.json`,
    );
  }

  const gzipped = gzipSync(events.map((event) => JSON.stringify(event)).join('\n') + '\n');

  const manifest: BatchManifest = {
    batch_id: batchId,
    schema_version: SCHEMA_VERSION,
    data_file: DATA_FILE,
    data_file_sha256: createHash('sha256').update(gzipped).digest('hex'),
    row_count: events.length,
    distinct_event_count: new Set(events.map((event) => event.event_id)).size,
    scenario,
    expected,
  };

  await writeFile(dataFile, gzipped);
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');

  return manifest;
}
