// Rerunnable local loader for the five mutation deliveries. Rebuilds the baseline batch from the
// real survey CSV the same way src/generator/cli.ts does, then writes each delivery under
// <out>/<batchId> and loads it into the local database. An existing delivery manifest is reused
// instead of rewritten, and loadBatch reports already_loaded for batches already in the raw
// ledger, so re-running is safe.
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

import { DuckDBInstance } from '@duckdb/node-api';

import { writeBatch } from '../src/generator/batch.ts';
import { buildSubmissionEvent } from '../src/generator/envelope.ts';
import { buildMutationDeliveries } from '../src/generator/mutations.ts';
import { parseSurveySource } from '../src/generator/source.ts';
import { applyFoundation } from '../src/warehouse/foundation.ts';
import { loadBatch } from '../src/warehouse/loadBatch.ts';

const BASELINE_BATCH_ID = 'batch_initial_2019';
const BASELINE_EXTRACTED_AT = '2019-07-31T00:00:00.000Z';

export async function main(argv: string[]): Promise<number> {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        source: { type: 'string', default: 'data/school-survey-2018-19-1.csv' },
        out: { type: 'string', default: 'generated-data/mutations' },
        db: { type: 'string', default: 'warehouse/wellbeing.duckdb' },
      },
    });

    const source = values.source;
    const out = values.out;
    const db = values.db;
    if (typeof source !== 'string' || typeof out !== 'string' || typeof db !== 'string') {
      throw new Error('missing --source, --out or --db');
    }

    const csv = await readFile(source, 'utf8');
    const survey = parseSurveySource(csv);
    const baselineEvents = survey.responses.map((response) =>
      buildSubmissionEvent(response, {
        batchId: BASELINE_BATCH_ID,
        extractedAt: BASELINE_EXTRACTED_AT,
      }),
    );

    const deliveries = buildMutationDeliveries(baselineEvents.slice(0, 4));

    await mkdir(dirname(db), { recursive: true });
    const instance = await DuckDBInstance.create(db);
    const connection = await instance.connect();
    try {
      await applyFoundation(connection);
      for (const delivery of deliveries) {
        const batchDir = join(out, delivery.batchId);
        if (!existsSync(join(batchDir, 'manifest.json'))) {
          await writeBatch({
            events: delivery.events,
            outputDir: batchDir,
            batchId: delivery.batchId,
            scenario: delivery.scenario,
            expected: delivery.expected,
          });
        }
        const loaded = await loadBatch(connection, batchDir);
        console.log(`${loaded.status}: ${loaded.batchId} ${loaded.rowsLoaded} rows`);
      }
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`load-mutations: ${message}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
