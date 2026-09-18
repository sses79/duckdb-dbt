# School wellbeing on DuckDB and dbt

A local, privacy-aware analytics demo: a school wellbeing survey becomes deterministic change
events, DuckDB raw history, tested dbt-duckdb models, and per-tenant aggregate publications.

```text
survey CSV -> generator -> gzipped NDJSON + manifest -> DuckDB raw -> dbt build -> tenant exports
```

This is the first slice of the replacement specified in
[`docs/duckdb-power-bi-handover.md`](docs/duckdb-power-bi-handover.md). The lessons it carries over
are in [`docs/project-outcomes-and-lessons.md`](docs/project-outcomes-and-lessons.md).

## Data

**No survey data is committed.** The source CSV (see [`data/README.md`](data/README.md)), generated
batches, DuckDB files and exports are all ignored. Tests and the `pipeline` check use a synthetic,
fictional fixture with the source's shape.

## Setup

```bash
pnpm install --frozen-lockfile          # Node 26.7.0
python3.13 -m venv .venv && .venv/bin/pip install -r requirements-dbt.txt
export PATH="$PWD/.venv/bin:$PATH"      # dbt must be on PATH
```

## Checks

```bash
node_modules/.bin/tsc --noEmit
node_modules/.bin/vitest run --dir src --maxWorkers=1
node scripts/verify-local.ts            # fixture -> generate -> load -> dbt build, in a temp dir
```
