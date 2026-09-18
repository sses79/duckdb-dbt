# Project Closeout and Learning Guide

This project is complete through Milestone 6. It began as a Snowflake learning
exercise and finished as a production-shaped, privacy-aware analytics system:
a checked public survey becomes deterministic change events, immutable landing
files, tested current-state models, interpretable aggregate marts, tenant-safe
views, a server-side dashboard, a Power BI report, and an event-driven AWS
landing path.

The Snowflake account can now be closed without losing the main engineering
lessons. The durable value is in the contracts, tests, product decisions, and
reproducible code—not in keeping a warehouse account running. The replacement
project is specified in
[`duckdb-power-bi-handover.md`](duckdb-power-bi-handover.md).

## Outcome at a Glance

| Area | Delivered evidence |
|---|---|
| Source boundary | Exact source checksum, two-row/569-column schema validation, and 21,954 checked survey responses |
| Data contract | Deterministic gzipped NDJSON events plus manifests with checksums, counts, schema version, and provenance |
| Change handling | Inserts, corrections, duplicate delivery, late older versions, and withdrawal tombstones |
| Transformation | 14 dbt models across staging, intermediate, core, and marts |
| Quality | 98 dbt data tests, one dbt unit test, generator tests, and dashboard boundary tests |
| Analysis | 18 curated indicators, ordered answer distributions, school/trust comparisons, category movement, and change drivers |
| Privacy | Aggregate-only product surfaces, minimum cohort suppression, fictional tenant metadata, and no committed row-level data |
| Product | Tenant-specific Next.js dashboard, aggregate CSV export, and a Power BI trend report |
| Operations | Workload roles, service-user definitions, freshness, run audit, load/query health, credit evidence, and recovery exercises |
| AWS ingestion | Versioned encrypted S3, least-privilege IAM, immutable upload validation, S3 notification, and Snowpipe auto-ingest |
| Final live gate | Incremental and full-refresh dbt builds both passed 116/116; Snowpipe, replay, rejection, and Terraform no-drift checks passed |

Counts describe the deterministic demo fixture and the final verified build;
they are evidence, not production scale claims.

## The 80/20 View

Six ideas explain most of the system:

```text
checked source
   -> deterministic contract
   -> append-only delivery history
   -> explicit latest/current semantics
   -> tested aggregate marts
   -> tenant-safe product surfaces
   -> observable, replayable operation
```

### 1. Contracts mattered more than transport

`generator.ts` validates the source before
mapping it. The generated envelope carries stable event/document identity,
operation, source version, business timestamps, schema version, batch identity,
payload, and provenance. The manifest records the data checksum and expected
counts.

The same contract was delivered first through an internal Snowflake stage and
later through S3/Snowpipe. Downstream models did not need a second business
design when the transport changed.

Transferable lesson: make source, event, and batch contracts explicit before
choosing how files move.

### 2. Delivery history, logical events, and current state are different grains

The raw table deliberately retains physical deliveries. Staging deduplicates a
stable `event_id`; the latest-state model chooses a winner per `document_id`
using source version and source time; the current model removes a document only
when its winning event is a tombstone.

The Milestone 2 fixtures in
`mutations.ts` prove that a duplicate file,
a repeated business event, and an older late event are not the same problem.
The transport-aware assertions in `dbt/tests` preserve that
distinction after both internal-stage and S3 deliveries exist.

Transferable lesson: define idempotency separately at the file, event, and
business-entity layers.

### 3. Grain and reconciliation made dbt trustworthy

The dbt graph changes one contract at a time:

```text
RAW envelope
  -> one typed row per event
  -> one winning event per document
  -> current documents only
  -> one answer per document/question
  -> response fact
  -> school/trust/period analytical marts
```

Tests check uniqueness, allowed domains, winner selection, withdrawal behavior,
source-to-fact reconciliation, aggregate numerator/denominator arithmetic,
suppression, and incremental/full-refresh equivalence. The mart keeps eligible,
answered, missing, and adverse counts beside each rate so an analyst can audit
the denominator.

Transferable lesson: write the “one row per …” sentence first, then test both
the key and the arithmetic at that grain.

### 4. Analysis was treated as a product contract

The project did more than chart a percentage. Catalogue seeds define indicator
labels, categories, answer order, direction, and interpretation notes. Marts add
coverage status, prior-period movement, weighted trust comparisons, category
summaries, distributions, and ranked change drivers.

`dashboard-data.ts` converts database
rows to typed product data, validates filter values against the tenant-visible
domain, and supplies the dashboard with trends, distributions, categories,
drivers, and freshness. The adverse-response and support-signal rules remain
explicitly non-diagnostic.

Transferable lesson: put definitions, denominators, interpretation, and
limitations in the data contract rather than leaving them to each chart author.

### 5. Privacy and tenant isolation were designed at the output boundary

The source contains sensitive survey material, but the curated scope selects 18
documented questions and introduces no real pupil identity. Fictional trust,
school, and time assignments are labelled as generated provenance. Cohorts
below ten suppress numerators and derived rates.

Snowflake roles and secure views separate north and south tenants. The browser
never receives Snowflake credentials and the server queries only fixed,
tenant-specific view names with bind parameters. Tests inspect every dashboard
query and reject filters outside the visible domain.

Transferable lesson: enforce sensitive-data rules before publication; hiding a
column in the UI is not an authorization boundary.

### 6. Operations were part of correctness

The final system separates loader, transformer, dashboard, and observer
workloads. It records pipeline attempts, freshness, failed loads/queries, and
warehouse usage. Recovery is tested from raw history and, optionally, from the
S3 landing boundary.

Milestone 6 exposed a real multi-system dependency: Terraform creates the AWS
bucket and role, Snowflake creates its integration and managed queue, and the
configuration script exchanges the resulting identifiers. The live gate then
creates a fresh timestamped object so a previous successful load cannot fake
an auto-ingest pass.

Transferable lesson: a green model build is not enough; prove identity,
failure visibility, replay, cost boundaries, and infrastructure ownership.

## End-to-End Execution Flow

```text
Kaggle CSV
  -> TypeScript validation and deterministic fictionalization
  -> manifest + immutable .ndjson.gz batch
  -> internal stage/COPY or S3/SQS/Snowpipe
  -> RAW delivery history
  -> dbt staging/latest/current/answers/fact
  -> analytical and operational marts
  -> tenant secure views
  -> Next.js API/dashboard and Power BI
```

The browser boundary ends at aggregate rows. Raw survey events and service
credentials stay behind the server/data boundary.

## What We Did Well

- Built a thin source-to-mart slice before adding mutations, a dashboard, or
  cloud infrastructure.
- Used deterministic fixtures so failures could be reproduced exactly.
- Preserved immutable raw evidence while making current-state behavior
  explicit and testable.
- Let tests evolve when a second physical transport made old exact-count
  assumptions incomplete.
- Kept derived wellbeing signals explainable and non-diagnostic.
- Added privacy suppression as a tested semantic rule, not a presentation
  convention.
- Kept browser credentials out of the client and used fixed tenant object
  allowlists plus bind parameters.
- Treated rejected files and stale data as observable outcomes rather than
  forcing every demonstration to appear healthy.
- Reused the same event contract when moving from local stage loading to AWS,
  demonstrating that architecture boundaries were real.
- Kept source data, generated rows, credentials, Terraform state, and handshake
  values out of Git.

## Honest Boundaries and Improvements

- Snowpipe loads raw automatically, but it does not run dbt. The complete
  mart-refresh path still needs a scheduler or job trigger.
- Several dbt models and dashboard queries use Snowflake-specific SQL. The
  business grains and tests transfer; the compiled SQL does not transfer
  unchanged.
- Snowflake secure views provide a stronger multi-user boundary than a local
  DuckDB file. The replacement must publish separate tenant-safe aggregates or
  use a managed authorization layer.
- Account Usage telemetry is useful but delayed. Immediate application/job
  audit records remain necessary.
- The Power BI artifact is not fully represented as code. The next project
  should record semantic-model fields, measures, refresh ownership, and a small
  visual acceptance checklist alongside the repository.
- Terraform state is currently local. Any retained AWS resources need one
  authoritative state owner before the new project modifies them.

## What the Tests Prove

The final live Milestone 6 run proved:

- local generator and dashboard tests pass;
- Terraform configuration is valid and deployed infrastructure has no drift;
- a fresh S3 object reaches raw through Snowpipe without manual `COPY`;
- retrying the same immutable S3 key is a no-op;
- repeated business events retain delivery lineage but remain one logical
  staging event;
- compatible optional JSON fields survive in raw without breaking typed models;
- incremental dbt and full-refresh dbt both pass all 116 nodes; and
- an intentionally malformed file loads zero rows and appears in
  `COPY_HISTORY` with an error.

It does not prove production scale, real school tenancy, clinical validity,
continuous dbt orchestration after every object, or DuckDB portability. Those
are explicit goals for the replacement project, not hidden claims.

## Snowflake Account Closure Checklist

Complete these steps before closing the account:

1. Merge or archive the final repository and retain this documentation.
2. Record non-sensitive evidence needed for the portfolio: architecture,
   passing test summaries, aggregate screenshots, and object names. Do not
   export respondent-level rows merely for evidence.
3. Preserve the ignored AWS Terraform state securely. It is required to manage
   the existing bucket without creating a second owner and may contain
   sensitive integration metadata.
4. Move the retained S3 bucket under the new project's Terraform state, or
   import it there, before applying replacement AWS infrastructure. Never let
   two Terraform roots manage the same bucket notification configuration.
5. Replace the S3 notification that targets Snowflake's managed SQS queue with
   a queue owned by your AWS account. The old queue is not a reusable AWS
   resource after Snowflake closes.
6. Remove the Snowflake-specific IAM trust/role after the replacement task role
   can read the landing prefix. Keep the bucket, versioning, encryption, public
   access block, and valid immutable objects.
7. Revoke or delete local Snowflake PAT files and connection entries after the
   final evidence/export is complete.
8. Remove local `.env` Snowflake settings and any cached credentials. Do not
   commit them as part of archival work.
9. Cancel the separate CoCo subscription, if active. CoCo billing is not the
   same as Snowflake warehouse/storage billing and should not be assumed to
   end with account closure.
10. For a trial, self-service, or last organization account, open a Snowflake
    Support case requesting cancellation; it cannot be dropped from that same
    account in Snowsight. Ask Support to confirm the cancellation date, final
    balance, and that no further charges will occur.
11. Confirm the AWS bucket still has a lifecycle policy and no dead event
    destination after the account is closed.

Official references: [trial cancellation](https://docs.snowflake.com/en/user-guide/admin-trial-account),
[Support cases](https://docs.snowflake.com/en/user-guide/ui-support), and
[account deletion constraints](https://docs.snowflake.com/en/user-guide/organizations-manage-accounts-delete).

The landing prefix also contains the deliberate
`batch_m6_02_rejected_file` fixture. A replacement loader must quarantine or
exclude that fixture rather than treating every historical `.ndjson.gz` object
as valid input.

## Try It Safely

After Snowflake closes, the repository still supports source-contract learning
without cloud access:

```bash
make test
node apps/generator/src/cli.ts --help
./scripts/verify-milestone-6.sh --local
```

Safe experiment for the replacement project: copy one manifest and its data
file to a temporary directory, predict which validation will fail, change only
the manifest row count, and run the new loader in validation-only mode. It
should stop before writing DuckDB or S3.

## Continuous-Learning Loop

1. Define the user-visible outcome.
2. Name the data grain and ownership boundary that enable it.
3. Implement the smallest complete path.
4. Prove it first with a deterministic local test, then with one live boundary.
5. Keep failure evidence and distinguish transport errors from business-state
   errors.
6. Record the lesson and carry the contract—not provider-specific wiring—into
   the next project.
