// The `pipeline` check. Runs the local path end to end in a temporary directory so the
// working tree is never written to. Onboarding stub: until the generator and loader exist,
// it builds the dbt project against an empty DuckDB file.
// dbt is DBT_EXECUTABLE when set (factory runs get a fixed PATH), otherwise `dbt` on PATH.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function step(name: string, argv: [string, ...string[]], env: NodeJS.ProcessEnv): void {
  const [command, ...args] = argv;
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.error) throw new Error(`${name} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${name} failed with exit code ${String(result.status)}`);
}

const workDir = mkdtempSync(join(tmpdir(), 'wellbeing-pipeline-'));
try {
  const env = { ...process.env, DUCKDB_PATH: join(workDir, 'wellbeing.duckdb') };
  step(
    'dbt build',
    [
      process.env.DBT_EXECUTABLE ?? 'dbt',
      'build',
      '--project-dir',
      'dbt',
      '--profiles-dir',
      'dbt',
      '--target-path',
      join(workDir, 'dbt-target'),
      '--log-path',
      join(workDir, 'dbt-logs')
    ],
    env
  );
  console.log('pipeline: ok');
} catch (error) {
  console.error(`pipeline: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
