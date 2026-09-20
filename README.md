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
node scripts/verify-local.ts            # fixture -> generate -> load -> dbt build -> export, in a temp dir
```

## Local run

The local path runs against the real survey CSV at `data/school-survey-2018-19-1.csv` (see [`data/README.md`](data/README.md)), and `dbt` comes from `DBT_EXECUTABLE` when set, otherwise from `PATH`.

```bash
make help      # list the available targets
make check     # run typecheck, tests and the pipeline check (uses the synthetic fixture)
make generate  # create the batch in generated-data/ from the real CSV
make load      # load the batch into warehouse/wellbeing.duckdb
make build     # run dbt build over the DuckDB warehouse
make export    # write per-tenant exports under exports/
make load-mutations # load the five mutation deliveries into warehouse/wellbeing.duckdb
make all       # run generate -> load -> build -> export
```

### Mutation deliveries

`make load-mutations` rebuilds the baseline batch from the real CSV and loads the five mutation
deliveries into `warehouse/wellbeing.duckdb`. It is rerunnable: a delivery directory that already
holds a manifest is loaded as-is, and batches already in the raw ledger report `already_loaded`.

- `batch_m2_01_new_inserts` — two new submissions; proves new documents are picked up by later loads.
- `batch_m2_02_correction_duplicate` — a corrected answer at source version 3; proves the newest source version wins.
- `batch_m2_03_late_older_version` — an older correction at source version 2; proves a lower source version loses to the correction.
- `batch_m2_04_withdrawal` — a delete at source version 2; proves a withdrawn submission is removed.
- `batch_m2_replay_late_older` — a replay of the late older event; proves replays are deduplicated by `event_id`.

The equivalence comparison (incremental dbt build vs a full-refresh rebuild) is the pipeline
check:

```bash
node scripts/verify-local.ts
```

Outputs go to the ignored `generated-data/`, `warehouse/` and `exports/` directories;
`exports/current.json` names the files for the latest publication. No survey data or anything
derived from it is committed.
