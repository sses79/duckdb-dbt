# DuckDB + AWS + Dashboard + Power BI Project Handover

## 1. Purpose

This is the implementation brief for a new repository that preserves most of
the school wellbeing demo while replacing Snowflake with DuckDB. It should keep
the checked source/event contracts, mutation semantics, analytical marts,
privacy rules, Next.js experience, Power BI report, and operational evidence.
It can retain the existing AWS landing resources after their Snowflake-specific
trust and queue destination are replaced.

Read [`project-outcomes-and-lessons.md`](project-outcomes-and-lessons.md) first
for the evidence and lessons behind this design.

The new project should continue to prove this data path:

```text
School wellbeing CSV
        |
        v
Deterministic event generator
        |
        v
Gzipped NDJSON batches + manifests
        |
        v
DuckDB raw history
        |
        v
dbt-duckdb: staging -> intermediate -> core -> marts
        |
        v
Tenant-safe aggregate publications
        |
        +---------------------------+
        |                           |
        v                           v
Next.js dashboard           Power BI semantic model/report
```

The source dataset, generated row-level data, DuckDB database files, exports,
and credentials must stay out of Git.

The target is capability parity, not a line-for-line database migration. A
local DuckDB file cannot reproduce Snowflake secure views, warehouse RBAC,
managed Snowpipe, or Account Usage. The new design replaces those boundaries
with physical tenant publications, AWS IAM, an account-owned SQS queue, and
application/job audit evidence.

## 2. Required local and optional AWS architectures

### Local target: implement first

Power BI should not connect directly to the local DuckDB file in the first
version. Use DuckDB as the analytical engine and publish only aggregate BI
outputs:

```text
CSV -> generator -> DuckDB -> dbt build -> CSV/Parquet mart export
                                             |
                                             v
                                  OneDrive or SharePoint
                                             |
                                             v
                                     Power BI Import
```

This target is the cheapest correctness loop because it does not require a
database server, Snowflake account, Power BI gateway, or continuously running
machine.

Use one serial publishing workflow:

1. Generate and validate source batches.
2. Load new batches into DuckDB in one writer process.
3. Run `dbt build` and stop if any model or test fails.
4. Export tenant-safe aggregate marts to temporary files.
5. Atomically promote the completed exports.
6. Refresh the Power BI semantic model.

Power BI should never import raw respondent rows.

### AWS target: retain the landing boundary

```text
authenticated upload API or generator
        |
        v
existing versioned/encrypted S3 landing bucket
        |
        v
S3 notification -> SQS queue in our AWS account
        |
        v
singleton ECS/Fargate job
  validate -> DuckDB/dbt -> tests -> tenant exports
        |
        +----------------------+----------------------+
        |                                             |
        v                                             v
S3 dashboard-ready aggregates              SharePoint/OneDrive publication
        |                                             |
        v                                             v
server-side Next.js adapter                       Power BI Import
```

For this dataset, prefer a full cloud rebuild from immutable S3 input inside
an ephemeral container. This avoids turning a DuckDB file into a shared
database or coordinating multiple writers. The persistent local target still
demonstrates incremental behavior and full-refresh equivalence.

AWS supports synchronous Step Functions execution of ECS/Fargate jobs. Fargate
local bind storage is ephemeral, so S3 remains the durable input and
publication boundary. See the official
[Step Functions ECS integration](https://docs.aws.amazon.com/step-functions/latest/dg/connect-ecs.html)
and [ECS storage options](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/using_data_volumes.html).

## 3. Direct Power BI connection alternatives

### Local DuckDB through ODBC

DuckDB publishes an ODBC driver for Windows, macOS, and Linux. Power BI
Desktop can use the Windows 64-bit driver and a DSN that points to the local
database file ([DuckDB ODBC documentation](https://duckdb.org/docs/current/clients/odbc/overview)).

Example Windows DSN:

```ini
[WellbeingDuckDB]
Driver = DuckDB Driver
Database = C:\wellbeing\warehouse\wellbeing.duckdb
access_mode = read_only
```

In Power BI Desktop, select **Get data -> ODBC**, select the DSN, and use
Import mode. Do not let dbt write to the file while Power BI is reading it.

Power BI Service cannot reach a file on a developer laptop directly. A
scheduled Service refresh through ODBC requires an always-on Windows machine,
the Power BI gateway, the same 64-bit DuckDB driver, and access to the database
file. Microsoft documents that a gateway is required when connector software
or an inaccessible data source must be hosted
([gateway guidance](https://learn.microsoft.com/en-us/power-bi/guidance/powerbi-implementation-planning-data-gateways)).

This route is technically valid but is not recommended for the first version.

### MotherDuck for cloud-to-cloud BI

If direct Power BI Service connectivity becomes a requirement, keep
`dbt-duckdb` but use MotherDuck as the managed DuckDB environment:

```text
dbt-duckdb -> MotherDuck -> PostgreSQL-compatible endpoint -> Power BI
```

MotherDuck documents a native PostgreSQL-endpoint route for Power BI that does
not require a custom connector, local ODBC driver, or gateway
([Power BI integration](https://motherduck.com/blog/april-2026-product-roundup/)).

This is the recommended upgrade path for shared cloud access. It introduces a
managed provider and credentials, so it should remain a separate production
target rather than a prerequisite for local development.

## 3A. Capability-parity contract

| Current capability | Replacement | Required? |
|---|---|---|
| Source checksum/schema validation | Reuse TypeScript generator and tests | Yes |
| NDJSON envelope and manifest | Reuse unchanged where possible | Yes |
| Internal stage and `COPY` | Transactional DuckDB loader | Yes |
| S3/Snowpipe ingestion | S3 plus account-owned SQS and singleton job | AWS target |
| Append-only raw history | DuckDB raw event table plus batch ledger | Yes |
| Event/document version semantics | Port staging/latest/current models | Yes |
| Incremental/full-refresh equivalence | Snapshot and bidirectional `EXCEPT` checks | Yes |
| Analytical marts | Port catalogue seeds and all useful marts | Yes |
| Secure tenant views | Physically separate, validated tenant exports | Yes |
| Next.js dashboard | Reuse UI/types; replace Snowflake adapter and SQL | Yes |
| Aggregate CSV export | Export from tenant-safe marts | Yes |
| Power BI report | Import aggregate files through SharePoint/OneDrive | Yes |
| Pipeline health | Audit tables, publication manifest, CloudWatch, freshness export | Yes |
| Service identities | AWS task roles, upload role, publication identity | AWS target |
| Resource monitor | Container resource/time limits and AWS Budget | AWS target |
| Account Usage | Application audit plus CloudWatch/job metadata | AWS target |
| Managed multi-user SQL | None locally; add MotherDuck/PostgreSQL only if required | Optional |

## 3B. Reusing the existing AWS resources

The current Terraform root created a useful S3 boundary, but it also contains
Snowflake-specific resources:

- retain the bucket, encryption, versioning, public-access block, ownership
  controls, lifecycle policy, and valid immutable objects;
- replace the IAM role whose trust points at Snowflake;
- replace the bucket notification whose SQS destination belongs to Snowflake;
  and
- keep one authoritative Terraform state owner.

The existing queue is not in this project's AWS account. Its ARN was returned
by `SHOW PIPES` and stored only so Terraform could configure the S3 event
destination. Create a new standard SQS queue in the same Region as the bucket.
AWS documents that S3 notifications are delivered at least once and are not
ordered, so the batch ledger and event-version rules remain essential. See
[S3 notification destinations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html).

### State ownership procedure

1. Back up the ignored `infra/aws/terraform.tfstate` securely; never commit it.
2. Create the new repository and choose its Terraform backend/state owner.
3. Move or import retained resources into that state before applying changes.
4. Do not let the old and new Terraform roots both manage the bucket
   notification; S3 treats it as one configuration.
5. Keep `prevent_destroy` on the landing bucket during the migration.
6. Add an account-owned SQS queue, dead-letter queue, queue policy, and S3
   notification.
7. Add a task role scoped to landing reads and curated writes. Do not repurpose
   Snowflake's cross-account trust.
8. Verify one valid event reaches the new queue/job, then remove the
   Snowflake-specific IAM role and variables.

The landing prefix contains the deliberately malformed
`batch_m6_02_rejected_file` acceptance object. The replacement bootstrap must
quarantine or exclude it rather than glob every historical `.ndjson.gz` object
into a successful build.

### Extended S3 layout

Preserve existing landing keys and add immutable publication namespaces:

```text
region=uk/collection=wellbeing_submissions/date=YYYY-MM-DD/batch_id=<id>/
  manifest.json
  submissions.ndjson.gz

curated/run_id=<id>/tenant=trust_north/
  school_wellbeing_trend.parquet
  indicator_analysis.parquet
  category_analysis.parquet
  change_drivers.parquet
  distributions.parquet
  support_signals.parquet
  indicator_answer_catalog.parquet
  freshness.json
  dashboard.json
  publication_manifest.json

curated/run_id=<id>/tenant=trust_south/
  ...

curated/current.json
```

Publish under a new run prefix, validate every file, and update the small
`current.json` pointer only after all dbt tests pass. Readers then see either
the previous complete publication or the new complete publication, never a
partial set.

## 3C. Upload and orchestration contract

If the dashboard accepts uploads, the browser must never receive long-lived
AWS credentials. Use an authenticated server endpoint that validates filename,
size, media type, and scope, constructs the S3 key itself, and either uploads
server-side or returns a short-lived presigned request. Publish the manifest
first and the notification-matching `.ndjson.gz` object last.

SQS is a wake-up/buffering boundary, not the correctness ledger. Because
messages can repeat or arrive out of order:

- validate checksum, row count, schema version, object key, and manifest;
- record batch ID, checksum, object version, status, and timestamps;
- treat the same batch/checksum as a successful no-op;
- reject the same batch ID with a different checksum;
- deduplicate stable `event_id` separately; and
- select current state by source version/time, never queue arrival time.

Prevent overlapping DuckDB writers. Start with one scheduled or locked Step
Functions execution that drains work and invokes a single Fargate task using
`RunTask.sync`. Add concurrency only after changing the persistence design.

## 4. Proposed repository structure

```text
apps/
  dashboard/
    app/
    components/
    lib/
    test/
  generator/
    src/
    test/
data/
  README.md
dbt/
  models/
    staging/
    intermediate/
    core/
    marts/
  seeds/
  tests/
  dbt_project.yml
  profiles.yml
infra/
  aws/
    # retained bucket plus account-owned SQS, job, IAM, and monitoring
  duckdb/
    00_foundation.sql
scripts/
  load-batch.ts
  reset-demo.sh
  export-tenant-marts.ts
  publish-power-bi.ts
  verify-incremental-equivalence.sh
  verify-aws-ingestion.sh
exports/                 # ignored
generated-data/          # ignored
warehouse/               # ignored
.env.example
.gitignore
Makefile
README.md
requirements-dbt.txt
```

Suggested ignored paths:

```gitignore
.env
.venv/
data/*.csv
data/*.zip
generated-data/
warehouse/
exports/
dbt/target/
dbt/logs/
```

## 5. Stack

| Layer | Selection |
|---|---|
| Runtime | Node.js 22+ and TypeScript |
| Source | School Student Health and Wellbeing CSV |
| Delivery contract | Gzipped NDJSON plus sidecar manifest |
| Analytical database | DuckDB persistent file |
| Transformation | dbt Core with `dbt-duckdb` |
| Local SQL client | DuckDB CLI |
| AWS landing | Existing private, encrypted, versioned S3 bucket |
| AWS notification | Standard SQS plus dead-letter queue in this AWS account |
| AWS compute | Singleton ECS/Fargate DuckDB/dbt job coordinated by Step Functions |
| Dashboard | Existing Next.js UI with local DuckDB and S3 aggregate adapters |
| BI publishing | Aggregate CSV/Parquet copied to SharePoint/OneDrive |
| BI product | Power BI Service in Import mode |
| Automation | Makefile and GitHub Actions |
| Optional cloud target | MotherDuck |

Install dbt in an isolated Python environment and lock compatible versions:

```bash
python3 -m venv .venv
.venv/bin/pip install dbt-duckdb
```

Install the DuckDB CLI on macOS:

```bash
brew install duckdb
```

## 6. DuckDB and dbt configuration

Use a persistent local database for development:

```yaml
school_wellbeing_demo:
  target: dev
  outputs:
    dev:
      type: duckdb
      path: "{{ env_var('DUCKDB_PATH', 'warehouse/wellbeing.duckdb') }}"
      schema: staging
      threads: 4
```

The dbt `threads` setting controls concurrent model execution. DuckDB also has
an engine-level thread setting for individual queries. Do not maximize both
without measuring resource contention.

Example `.env.example`:

```bash
DUCKDB_PATH=warehouse/wellbeing.duckdb
BI_EXPORT_DIR=exports
```

No database password is required for a local DuckDB file. File-system access
is the security boundary.

In AWS, DuckDB should use the normal task-role credential chain rather than
embedded access keys. DuckDB's `httpfs` extension supports reading and writing
S3 objects and AWS credential-chain authentication; see the official
[DuckDB S3 API documentation](https://duckdb.org/docs/current/core_extensions/httpfs/s3api).

## 7. Database layout

Create the same logical layers used in the Snowflake demo:

```sql
CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS staging;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS marts;
CREATE SCHEMA IF NOT EXISTS audit;
```

Recommended raw objects:

```text
raw.wellbeing_submission_events   append-only event history
raw.loaded_batches                manifest and idempotency ledger
audit.pipeline_runs               run outcome and row counts
audit.publications                tested tenant export/checksum ledger
```

The raw event table should retain at least:

```text
event_id
document_id
operation
source_version
source_updated_at
extracted_at
batch_id
region
payload
source_file
source_file_row_number
loaded_at
```

DuckDB can read newline-delimited JSON directly. Prefer a small loader that
validates the manifest checksum and expected row count before inserting the
parsed batch in a transaction. On failure, roll back raw and ledger writes,
then record a sanitized failed run separately. Never log survey payloads.

## 8. Idempotent loading contract

Snowflake previously remembered loaded stage filenames. DuckDB needs an
explicit batch ledger:

```text
Read manifest
   |
   +-- validate batch ID, filename, row count, and SHA-256
   |
   +-- is batch ID + checksum already in raw.loaded_batches?
          | yes -> report already loaded and exit successfully
          | no
          v
       BEGIN
          insert raw event rows
          reconcile inserted count with manifest
          insert raw.loaded_batches record
       COMMIT
```

If the same `batch_id` arrives with a different checksum, fail rather than
silently replacing history. Delivery deduplication and business-event
deduplication remain separate:

- `raw.loaded_batches` prevents loading the same delivery twice;
- staging deduplicates the same stable `event_id` delivered under another
  batch or filename; and
- the latest-state model chooses one winning event per `document_id`.

Keep the existing manifest fields:

```text
batch_id
schema_version
data_file
data_file_sha256
row_count
distinct_event_count
scenario
expected
```

## 9. dbt model flow

Preserve the current model responsibilities:

```text
raw.wellbeing_submission_events
        |
        v
stg_wellbeing_submission_changes
  typed event fields; one row per event_id
        |
        v
int_wellbeing_submission_latest
  winning event per document_id, including tombstones
        |
        v
int_wellbeing_submission_current
  current upserts only
        |
        v
int_wellbeing_answers
  one row per document and question
        |
        v
fct_wellbeing_response
  answer flags and adverse-response rule
        |
        v
mart_school_wellbeing_trend
  tenant/school/period/question aggregates
```

Preserve the complete useful analytical surface, not only the first trend
mart:

- `dim_wellbeing_indicator_answer`;
- `mart_school_wellbeing_trend`;
- `mart_question_response_distribution`;
- `mart_support_signal_summary`;
- `mart_data_freshness`;
- `mart_school_indicator_analysis`;
- `mart_school_category_analysis`; and
- `mart_school_change_drivers`.

Replace `mart_pipeline_health` with a provider-neutral model over the batch,
run, and publication audit tables. Present AWS/CloudWatch resource telemetry
alongside it rather than embedding provider-specific system views in the core
analytical graph.

Retain the Milestone 2 ordering rule:

```text
source_version DESC
source_updated_at DESC
event_id DESC
```

Arrival time must not determine the winning business version.

The response fact grain remains:

```text
(document_id, question_code)
```

The BI mart grain remains:

```text
(trust_id, school_id, school_classification, survey_period, question_code)
```

Keep numerator and denominator columns alongside the adverse-response rate so
BI consumers can audit the calculation.

## 10. Snowflake-to-DuckDB migration map

| Snowflake implementation | DuckDB replacement |
|---|---|
| `snow sql` | `duckdb` CLI |
| Database, schemas, warehouses | One database file plus schemas; no warehouses |
| Roles and grants | File permissions, separate outputs, or controls in a cloud target |
| Resource monitor | Host/CI resource limits and job timeouts |
| Internal stage | Local or object-storage batch files |
| `CREATE FILE FORMAT` | Reader-function arguments |
| `PUT` | Not required |
| `COPY INTO` from stage | `read_json_auto`, `read_csv`, or loader inserts |
| Snowflake `VARIANT` paths | DuckDB JSON extraction functions |
| `LATERAL FLATTEN` | DuckDB JSON/list unnesting functions |
| `COUNT_IF(condition)` | `COUNT(*) FILTER (WHERE condition)` |
| `MINUS` | `EXCEPT` |
| Zero-copy `CLONE` | Temporary copied tables or direct comparison queries |
| Secure tenant views | Separate tenant exports, Power BI RLS, or cloud access controls |
| `dbt-snowflake` | `dbt-duckdb` |
| `IFF(condition, a, b)` | `CASE WHEN condition THEN a ELSE b END` |
| `BOOLOR_AGG(condition)` | `BOOL_OR(condition)` |

`QUALIFY` is available in DuckDB, but all migrated SQL must still be compiled
and tested rather than assumed portable.

## 11. Incremental correctness

Port the deterministic Milestone 2 fixtures from the existing generator:

| Fixture | Expected result |
|---|---|
| New inserts | Add two current documents |
| Correction plus exact duplicate | Version 3 wins; duplicate does not double-count |
| Late older version | Version 2 cannot replace version 3 |
| Withdrawal tombstone | Raw history remains; current fact rows disappear |
| Same event in a new delivery | Delivery remains auditable; logical event is deduplicated |

Do not assume the same incremental strategy works unchanged across adapters.
Confirm the installed `dbt-duckdb` and DuckDB versions support the chosen
materialization. If necessary, implement a deterministic delete-and-insert
strategy keyed by `document_id` and `(document_id, question_code)`.

The key acceptance test remains:

```text
incremental result EXCEPT full-refresh result = zero rows
full-refresh result EXCEPT incremental result = zero rows
```

Compare both the response fact and the final BI mart.

## 12. Power BI publishing contract

Create only aggregate tenant outputs. Publish the complete analytical product
used by the current dashboard rather than only the original trend table:

```text
exports/north/school_wellbeing_trend.csv
exports/north/indicator_analysis.csv
exports/north/category_analysis.csv
exports/north/change_drivers.csv
exports/north/question_response_distribution.csv
exports/north/support_signal_summary.csv
exports/north/indicator_answer_catalog.csv
exports/north/freshness.json
exports/north/publication_manifest.json

exports/south/...
```

Example export SQL:

```sql
COPY (
    SELECT
        trust_id,
        school_id,
        school_classification,
        survey_period,
        question_code,
        eligible_submission_count,
        answered_response_count,
        missing_response_count,
        adverse_response_count,
        adverse_response_rate
    FROM marts.mart_school_wellbeing_trend
    WHERE trust_id = 'trust_north'
)
TO 'exports/north/school_wellbeing_trend.csv'
(FORMAT CSV, HEADER);
```

The publishing script should write to a new temporary/run-specific export path,
validate it, and then replace the current pointer. Create a separate south
publication with `trust_id = 'trust_south'`. Validate each file before
publishing:

- it contains exactly one allowed `trust_id`;
- its row count matches the source mart filter;
- required dimensions are non-null;
- aggregate reconciliation tests pass; and
- no `document_id`, answer-level row, identifier, or free text is present.

The publication manifest records run ID, tenant, source watermark, creation
time, schema version, dbt result, row counts, and checksums. A failed build must
leave the previous successful publication readable.

In Power BI Service, create one semantic model per tenant export unless the
project deliberately demonstrates Power BI row-level security. Use Import
mode, configure scheduled refresh after the export job, and retain the current
report fields:

```text
tenant, school, classification, survey period
question/category labels and interpretation note
eligible, answered, missing, and adverse counts/rates
suppression, coverage, and movement status
prior-period comparison and trust gap
distribution order/count/rate
category movement and ranked change drivers
publication/freshness timestamp
```

For a gateway-free file publication, copy the validated aggregate files to a
controlled SharePoint/OneDrive location and use Power BI Import. The SharePoint
Folder connector supports Power BI semantic models and Power Query Online;
filter it to the exact controlled folder/file before combining content. See
the official [SharePoint Folder connector documentation](https://learn.microsoft.com/en-us/power-query/connectors/sharepoint-folder).

## 12A. Next.js dashboard migration

Reuse the current components, typed dashboard result structures, filter-domain
validation, aggregate CSV formula-injection protection, question metadata, and
browser-boundary tests.

Rewrite:

- `apps/dashboard/lib/snowflake.ts` as a local read-only DuckDB adapter and a
  server-side S3 aggregate adapter;
- Snowflake-qualified names in `tenant.ts` as fixed tenant publication keys;
  and
- Snowflake-only SQL in `query-contract.ts`, or remove runtime SQL by
  publishing dashboard-ready tenant JSON.

The simplest hosted path is one small `dashboard.json` per tenant/run. The
server resolves only a fixed tenant allowlist, reads the object selected by
`current.json`, validates its schema, and returns aggregate rows. AWS
credentials remain server-side; raw events and the DuckDB file never reach the
browser.

Retain negative tests proving:

- every request resolves to a fixed tenant publication;
- filter values never become object keys or identifiers;
- unknown filters fail;
- responses contain no row-level identifier;
- suppressed values stay null through JSON and CSV; and
- north and south deployments cannot read each other's prefix.

## 13. Security differences

Removing Snowflake also removes its role hierarchy, secure views, warehouse
isolation, and grants. A local DuckDB database does not provide an equivalent
multi-user authorization boundary. Anyone who can copy the database file can
inspect its contents.

For the local demo:

- keep `warehouse/` readable only by the developer account;
- never publish the DuckDB database file;
- publish only tenant-filtered aggregates;
- maintain separate north and south export locations;
- do not rely on a view alone as a security boundary; and
- keep generated survey rows out of the public repository.

If remote users or services need direct database access, move to MotherDuck or
use PostgreSQL instead of exposing a DuckDB file over a shared filesystem.

For AWS:

- give the upload API write-only access to constructed landing keys;
- give the transformation task read access to landing and write access to a
  temporary/run-specific curated prefix;
- give each dashboard deployment read access only to its tenant publication;
- give the publication job read access only to validated aggregate outputs;
- keep task credentials in IAM roles rather than `.env`; and
- never log survey payloads to CloudWatch.

Replace Snowflake operational evidence with signals the new stack owns:

| Signal | Source |
|---|---|
| Batch received/validated | `raw.loaded_batches` and job log |
| Run start/success/failure | `audit.pipeline_runs` |
| Latest source event | raw source timestamp maximum |
| Last good publication | publication manifest/current pointer |
| Rejected object | quarantine record, dead-letter queue, sanitized error |
| Duration/resource use | Step Functions, ECS, and CloudWatch |
| Spend boundary | AWS Budget and task CPU/memory/time limits |
| Tenant safety | export validator and dashboard negative tests |

## 14. Suggested Makefile interface

```make
generate:
	node apps/generator/src/cli.ts

test:
	node --test apps/generator/test/*.test.ts

foundation:
	duckdb $(DUCKDB_PATH) < infra/duckdb/00_foundation.sql

load:
	node scripts/load-batch.ts $(MANIFEST)

dbt-build:
	.venv/bin/dbt build --project-dir dbt --profiles-dir dbt

export-tenants:
	node scripts/export-tenant-marts.ts

verify-equivalence:
	./scripts/verify-incremental-equivalence.sh

verify-local: test foundation generate load dbt-build export-tenants verify-equivalence

aws-plan:
	terraform -chdir=infra/aws plan

verify-aws:
	./scripts/verify-aws-ingestion.sh
```

The real Makefile should source `.env`, stop on errors, and avoid updating the
current publication when tests or export validation fail.

## 15. Delivery milestones

### Milestone 0: extraction and AWS ownership

- Create the new repository and ignored directories.
- Copy only reusable source, tests, seeds, UI, and documentation.
- Install and lock DuckDB, dbt Core, and `dbt-duckdb`.
- Add a secret-free `.env.example`.
- Securely transfer/import the retained AWS Terraform state.
- Replace the Snowflake notification with an account-owned SQS/DLQ.

Acceptance:

```text
no Snowflake credential or runtime dependency
one Terraform owner for the retained bucket
bucket protections remain enabled
new SQS and dead-letter queue are visible in our AWS account
```

### Milestone 1: local source-to-mart parity

- Port the deterministic generator and manifest.
- Implement transactional, manifest-aware raw loading.
- Add schemas and raw/audit tables.
- Port staging, answer, fact, catalogue, and all useful mart models.
- Add grain, null, accepted-value, and reconciliation tests.
- Export one validated tenant aggregate set.

Acceptance:

```text
empty database -> generate -> load -> dbt build -> tenant publication
```

### Milestone 2: incremental correctness

- Port all mutation and replay fixtures.
- Make current-state and fact processing incremental.
- Test duplicates, late versions, corrections, and tombstones.
- Compare incremental and full-refresh results in both directions.

Acceptance:

```text
all fixtures reconcile
rerunning a delivery is idempotent
incremental and full-refresh outputs are identical
```

### Milestone 3: analytical and dashboard parity

- Port suppression-aware indicator, category, distribution, signal, driver,
  and freshness marts.
- Replace the Snowflake dashboard adapter.
- Retain tenant/filter/CSV security tests.
- Show the same analytical questions in the Next.js UI.

Acceptance:

```text
dashboard receives aggregate rows only
north/south isolation and suppression tests pass
```

### Milestone 4: Power BI delivery

- Publish complete tenant aggregate sets to SharePoint/OneDrive.
- Create or repoint the semantic model.
- Configure refresh after successful publication.
- Rebuild the analytical report and add a publication timestamp.
- Demonstrate visible insert/correction/withdrawal evidence.

Acceptance:

```text
Power BI refresh completes without a gateway
each semantic model contains only its tenant
dashboard totals reconcile with exported marts
```

### Milestone 5: AWS event-driven path

- Complete S3/SQS/job Terraform.
- Run the DuckDB/dbt container as a singleton.
- Publish immutable curated runs and update the current pointer on success.
- Add CloudWatch and dead-letter evidence.

Acceptance:

```text
new valid S3 batch triggers a tested publication
duplicate notification is harmless
bad input is visible and the last good publication remains available
```

### Optional Milestone 6: managed SQL target

- Add a MotherDuck dbt target.
- Keep local DuckDB development working.
- Connect Power BI through the managed PostgreSQL-compatible endpoint.
- Replace file-based tenant isolation with reviewed cloud controls.

## 16. Verification checklist

The new repository is ready when all of these are true:

- [ ] A new developer can build the project without a Snowflake account.
- [ ] The original CSV and generated row-level data are ignored.
- [ ] Every loaded batch has a validated manifest and audit record.
- [ ] Replaying a batch does not change the logical current state.
- [ ] Late older events do not replace newer source versions.
- [ ] Withdrawals remain in history and disappear from current facts.
- [ ] Fact grain is unique by document and question.
- [ ] Incremental and full-refresh facts are equivalent.
- [ ] Incremental and full-refresh marts are equivalent.
- [ ] BI exports contain aggregate fields only.
- [ ] North and south outputs cannot contain the other trust.
- [ ] Power BI totals reconcile with the published export.
- [ ] The report displays the pipeline/export freshness timestamp.
- [ ] All eight useful analytical products are available to the dashboard or
      BI publication.
- [ ] Suppressed cohorts expose no numerator or derived rate.
- [ ] The existing S3 bucket is managed by exactly one Terraform state.
- [ ] S3 events target an SQS queue owned by this AWS account.
- [ ] A duplicate notification is a successful no-op.
- [ ] A failed cloud build cannot replace the previous good publication.
- [ ] Rejected objects, run duration, and publication status are observable.
- [ ] No Snowflake credential or Snowflake-specific AWS trust remains.

## 17. What to reuse from this repository

Reuse or adapt:

- `apps/generator/src/generator.ts`;
- `apps/generator/src/mutations.ts`;
- generator tests;
- `apps/dashboard/components/` and its typed result models;
- dashboard filter, tenant-boundary, and CSV tests;
- the event envelope and manifest contracts;
- dbt seeds, model grains, business rules, suppression unit test, and
  reconciliation tests;
- immutable S3 key and manifest validation logic;
- S3 bucket protection settings; and
- the Power BI visual design and analytical field contracts.

Rewrite:

- Snowflake JSON syntax in staging models;
- the stage/`PUT`/`COPY INTO` loader;
- Snowflake-specific incremental SQL and hooks;
- zero-copy clone verification;
- the Snowflake dashboard adapter and qualified object names;
- Snowflake infrastructure, connection, warehouse, monitor, and grant SQL;
- the Snowflake-managed queue notification and cross-account IAM trust; and
- tenant security enforcement as physical publication and AWS IAM controls.

Do not copy:

- `.env`;
- Snowflake connection files or PATs;
- the Kaggle source CSV;
- `generated-data/`;
- exported survey records; or
- a populated DuckDB database file; or
- Terraform state in Git. Transfer retained state only through a secure state
  migration or resource import.

## 18. Decision boundary

DuckDB is the right choice when this remains a batch-oriented analytical demo
with one writer and file-based BI publication.

Choose PostgreSQL instead when multiple services need concurrent, low-latency
queries or writes against transformed data. Choose MotherDuck when the main
requirement is shared cloud analytics and direct BI connectivity while keeping
the DuckDB/dbt development model.

## 19. Snowflake closure and AWS cutover order

Do not make account closure the first migration step. Use this order:

1. Merge/archive the current repository and retain non-sensitive test evidence.
2. Securely back up the ignored Terraform state and confirm the S3 bucket is
   still protected by versioning, encryption, public-access block, lifecycle,
   and `prevent_destroy`.
3. Create the new repository and import/move the retained AWS resources into
   its single Terraform state.
4. Deploy the account-owned SQS/DLQ and replacement bucket notification.
5. Deploy the new task role and prove a valid landing event can be read without
   Snowflake.
6. Remove the Snowflake queue ARN, external ID, IAM trust, and unused role from
   the desired AWS configuration.
7. Export only required aggregate evidence or report artifacts from Snowflake.
8. Revoke/delete local PAT files and connection entries. Cancel any separate
   CoCo subscription independently.
9. If this is a trial, self-service, or last organization account, submit a
   Snowflake Support case requesting cancellation and confirmation that no
   further charges will occur. Letting a trial expire suspends it; it is not a
   formal closure request.
10. Confirm the S3 bucket has no dead notification target and the new project
    can rebuild from retained valid landing objects.

This sequence preserves the useful AWS investment while making Snowflake a
closed implementation chapter rather than a hidden runtime dependency.

Use Snowflake's current documentation for
[trial cancellation](https://docs.snowflake.com/en/user-guide/admin-trial-account),
[Support cases](https://docs.snowflake.com/en/user-guide/ui-support), and
[account deletion constraints](https://docs.snowflake.com/en/user-guide/organizations-manage-accounts-delete).
