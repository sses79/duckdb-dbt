import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';

import { DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBConnection } from '@duckdb/node-api';

import { exportTenants } from '../publication/exportTenants.ts';
import { applyFoundation } from './foundation.ts';
import { loadBatch } from './loadBatch.ts';

const DEFAULT_DB = 'warehouse/wellbeing.duckdb';
const USAGE =
  'usage: node src/warehouse/cli.ts load --batch DIR [--db FILE] | export --run-id ID --export-root DIR [--db FILE]';

export async function main(argv: string[]): Promise<number> {
  const subcommand = argv[0];
  if (subcommand !== 'load' && subcommand !== 'export') {
    console.error(USAGE);
    return 2;
  }

  let connection: DuckDBConnection | undefined;
  let instance: DuckDBInstance | undefined;
  try {
    const { values } = parseArgs({
      args: argv.slice(1),
      options: {
        db: { type: 'string', default: DEFAULT_DB },
        batch: { type: 'string' },
        'export-root': { type: 'string' },
        'run-id': { type: 'string' },
      },
    });

    const db = values.db ?? DEFAULT_DB;
    const batch = values.batch;
    const exportRoot = values['export-root'];
    const runId = values['run-id'];

    if (subcommand === 'load') {
      if (typeof batch !== 'string') {
        console.error(USAGE);
        return 2;
      }
      mkdirSync(dirname(db), { recursive: true });
      instance = await DuckDBInstance.create(db);
      connection = await instance.connect();
      await applyFoundation(connection);
      const result = await loadBatch(connection, batch);
      console.log(`${result.status} ${result.batchId} ${result.rowsLoaded}`);
      return 0;
    }

    if (typeof runId !== 'string' || typeof exportRoot !== 'string') {
      console.error(USAGE);
      return 2;
    }
    mkdirSync(dirname(db), { recursive: true });
    instance = await DuckDBInstance.create(db);
    connection = await instance.connect();
    await exportTenants(connection, { exportRoot, runId });
    console.log(`exported ${runId}`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  } finally {
    connection?.closeSync();
    instance?.closeSync();
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
