import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import { writeBatch } from './batch.ts';
import type { BatchManifest } from './batch.ts';
import { main } from './cli.ts';
import { buildSubmissionEvent } from './envelope.ts';
import type { SubmissionEvent } from './envelope.ts';
import { parseSurveySource } from './source.ts';
import { buildSyntheticSurveyCsv } from './testing/syntheticSurvey.ts';

const EXTRACTED_AT = '2019-07-31T00:00:00.000Z';
const BATCH_ID = 'batch-test-001';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wb-batch-writer-'));
  tempDirs.push(dir);
  return dir;
}

function buildEvents(rows: number, seed: number, batchId = BATCH_ID) {
  const csv = buildSyntheticSurveyCsv({ rows, seed });
  const survey = parseSurveySource(csv);
  const events = survey.responses.map((response) =>
    buildSubmissionEvent(response, { batchId, extractedAt: EXTRACTED_AT }),
  );
  return { csv, responseCount: survey.responses.length, events };
}

function writeInput(events: SubmissionEvent[], outputDir: string, batchId = BATCH_ID) {
  return {
    events,
    outputDir,
    batchId,
    scenario: 'initial_load',
    expected: { current_documents: events.length },
  };
}

describe('writeBatch', () => {
  it('writes a manifest and a gzipped NDJSON data file that round-trips', async () => {
    const dir = await tempDir();
    const { events } = buildEvents(5, 42);

    const manifest = await writeBatch(writeInput(events, dir));

    const gzipped = await readFile(join(dir, 'submissions.ndjson.gz'));
    const ndjson = gunzipSync(gzipped).toString('utf8');
    const lines = ndjson.split('\n');
    expect(lines.pop()).toBe('');
    expect(lines).toHaveLength(events.length);
    expect(lines.map((line) => JSON.parse(line))).toEqual(events);

    expect(manifest.batch_id).toBe(BATCH_ID);
    expect(manifest.schema_version).toBe('wellbeing-submission/1');
    expect(manifest.data_file).toBe('submissions.ndjson.gz');
    expect(manifest.data_file_sha256).toBe(
      createHash('sha256').update(gzipped).digest('hex'),
    );
    expect(manifest.row_count).toBe(events.length);
    expect(manifest.distinct_event_count).toBe(
      new Set(events.map((event) => event.event_id)).size,
    );
    expect(manifest.scenario).toBe('initial_load');
    expect(manifest.expected).toEqual({ current_documents: events.length });

    expect(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))).toEqual(manifest);
  });

  it('writes byte-identical outputs for the same events into two directories', async () => {
    const dirA = await tempDir();
    const dirB = await tempDir();
    const { events } = buildEvents(8, 7);

    await writeBatch(writeInput(events, dirA));
    await writeBatch(writeInput(events, dirB));

    expect(await readFile(join(dirA, 'submissions.ndjson.gz'))).toEqual(
      await readFile(join(dirB, 'submissions.ndjson.gz')),
    );
    expect(await readFile(join(dirA, 'manifest.json'), 'utf8')).toBe(
      await readFile(join(dirB, 'manifest.json'), 'utf8'),
    );
  });

  it('refuses a directory that already holds a batch and leaves existing files unchanged', async () => {
    const dir = await tempDir();
    const { events } = buildEvents(3, 99);

    await writeBatch(writeInput(events, dir, 'batch-first'));
    const gzipped = await readFile(join(dir, 'submissions.ndjson.gz'));
    const manifestText = await readFile(join(dir, 'manifest.json'), 'utf8');

    await expect(writeBatch(writeInput(events, dir, 'batch-second'))).rejects.toThrow(dir);

    expect(await readFile(join(dir, 'submissions.ndjson.gz'))).toEqual(gzipped);
    expect(await readFile(join(dir, 'manifest.json'), 'utf8')).toBe(manifestText);
  });
});

describe('main', () => {
  it('writes a batch from a synthetic CSV file and returns 0', async () => {
    const dir = await tempDir();
    const { csv, responseCount } = buildEvents(4, 5);
    const sourceFile = join(dir, 'source.csv');
    await writeFile(sourceFile, csv);

    const outDir = join(dir, 'out');
    const exitCode = await main([
      '--source',
      sourceFile,
      '--out',
      outDir,
      '--batch-id',
      'cli-batch-1',
      '--extracted-at',
      EXTRACTED_AT,
    ]);

    expect(exitCode).toBe(0);
    const gzipped = await readFile(join(outDir, 'submissions.ndjson.gz'));
    const manifest = JSON.parse(
      await readFile(join(outDir, 'manifest.json'), 'utf8'),
    ) as BatchManifest;
    expect(manifest.batch_id).toBe('cli-batch-1');
    expect(manifest.scenario).toBe('initial_load');
    expect(manifest.expected).toEqual({ current_documents: responseCount });
    expect(manifest.row_count).toBe(responseCount);
    expect(manifest.data_file_sha256).toBe(
      createHash('sha256').update(gzipped).digest('hex'),
    );
  });

  it('returns 1 without writing when the source file is missing', async () => {
    const dir = await tempDir();
    const outDir = join(dir, 'out');

    const exitCode = await main([
      '--source',
      join(dir, 'missing.csv'),
      '--out',
      outDir,
      '--batch-id',
      'cli-batch-2',
    ]);

    expect(exitCode).toBe(1);
    await expect(readFile(join(outDir, 'manifest.json'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(outDir, 'submissions.ndjson.gz'))).rejects.toThrow();
  });
});
