import { readFile } from 'node:fs/promises';
import type { DuckDBConnection } from '@duckdb/node-api';

export const FOUNDATION_SQL_PATH = new URL('../../infra/duckdb/00_foundation.sql', import.meta.url);

export async function applyFoundation(connection: DuckDBConnection): Promise<void> {
  const sql = await readFile(FOUNDATION_SQL_PATH, 'utf8');
  await connection.run(sql);
}
