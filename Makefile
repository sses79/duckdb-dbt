SOURCE ?= data/school-survey-2018-19-1.csv
BATCH_ID ?= batch_initial_2019
BATCH_DIR ?= generated-data/$(BATCH_ID)
DUCKDB_PATH ?= warehouse/wellbeing.duckdb
EXPORT_ROOT ?= exports
RUN_ID ?= $(shell date -u +%Y%m%dT%H%M%SZ)
DBT ?= $(or $(DBT_EXECUTABLE),dbt)

.PHONY: help check generate load build export all

help:
	@echo "help: list the available targets"
	@echo "check: run typecheck, tests and the pipeline check"
	@echo "generate: create $(BATCH_DIR)/manifest.json from $(SOURCE)"
	@echo "load: load the batch into $(DUCKDB_PATH)"
	@echo "build: run dbt build over the warehouse"
	@echo "export: write tenant exports under $(EXPORT_ROOT)"
	@echo "all: run generate, load, build and export"

check:
	pnpm run typecheck
	pnpm run test
	pnpm run pipeline

$(BATCH_DIR)/manifest.json:
	node src/generator/cli.ts --source $(SOURCE) --out $(BATCH_DIR) --batch-id $(BATCH_ID)

generate: $(BATCH_DIR)/manifest.json

load: generate
	node src/warehouse/cli.ts load --batch $(BATCH_DIR) --db $(DUCKDB_PATH)

build: load
	DUCKDB_PATH=$(DUCKDB_PATH) $(DBT) build --project-dir dbt --profiles-dir dbt

export: build
	node src/warehouse/cli.ts export --run-id $(RUN_ID) --export-root $(EXPORT_ROOT) --db $(DUCKDB_PATH)

all: export
