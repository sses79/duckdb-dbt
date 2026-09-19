import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeBatch } from '../generator/batch.ts';
import { buildSubmissionEvent } from '../generator/envelope.ts';
import { parseSurveySource } from '../generator/source.ts';
import { buildSyntheticSurveyCsv } from '../generator/testing/syntheticSurvey.ts';
import { main } from './cli.ts';

const EXTRACTED_AT = '2019-07-31T00:00:00.000Z';
const USAGE =
  'usage: node src/warehouse/cli.ts load --batch DIR [--db FILE] | export --run-id ID --export-root DIR [--db FILE]';

describe('warehouse cli', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads a batch and reports already_loaded on a repeat', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'warehouse-cli-'));
    const batchDir = join(dir, 'batch');
    const db = join(dir, 'warehouse', 'wellbeing.duckdb');
    const batchId = 'cli-load-test';

    const survey = parseSurveySource(buildSyntheticSurveyCsv({ rows: 30, seed: 7 }));
    const events = survey.responses.map((response) =>
      buildSubmissionEvent(response, { batchId, extractedAt: EXTRACTED_AT }),
    );
    await writeBatch({
      events,
      outputDir: batchDir,
      batchId,
      scenario: 'initial_load',
      expected: { current_documents: survey.responses.length },
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(main(['load', '--batch', batchDir, '--db', db])).resolves.toBe(0);
    expect(log).toHaveBeenCalledWith(`loaded ${batchId} 30`);

    await expect(main(['load', '--batch', batchDir, '--db', db])).resolves.toBe(0);
    expect(log).toHaveBeenCalledWith(`already_loaded ${batchId} 0`);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('returns 2 with usage for missing subcommand, missing options, and unknown subcommand', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(main([])).resolves.toBe(2);
    await expect(main(['load'])).resolves.toBe(2);
    await expect(main(['export'])).resolves.toBe(2);
    await expect(main(['export', '--run-id', 'run_1'])).resolves.toBe(2);
    await expect(main(['unknown'])).resolves.toBe(2);

    expect(error).toHaveBeenCalledWith(USAGE);
    expect(error).toHaveBeenCalledTimes(5);
  });

  it('returns 1 and writes no current.json when the mart is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'warehouse-cli-'));
    const db = join(dir, 'wellbeing.duckdb');
    const exportRoot = join(dir, 'exports');

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const code = await main([
      'export',
      '--run-id',
      'run_1',
      '--export-root',
      exportRoot,
      '--db',
      db,
    ]);
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('mart_school_wellbeing_trend'));
    expect(existsSync(join(exportRoot, 'current.json'))).toBe(false);
  });
});
