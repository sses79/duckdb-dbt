import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { DASHBOARD_SCHEMA_VERSION } from '../../publication/dashboardJson.ts';
import type { DashboardRow } from '../../publication/dashboardJson.ts';
import { EXPORT_FILES } from '../../publication/exportTenants.ts';
import type { ExportFileSpec } from '../../publication/exportTenants.ts';
import { DASHBOARD_SECTIONS, readTenantDashboard } from '../reader.ts';
import type { DashboardSection, DashboardTenant } from '../reader.ts';
import { buildFixtureDashboard, FIXTURE_PERIODS, FIXTURE_RUN_ID, writeFixtureExports } from './dashboardFixture.ts';

const EXPECTED_TENANTS: readonly DashboardTenant[] = ['trust_north', 'trust_south'];
const [PREVIOUS_PERIOD, LATEST_PERIOD] = FIXTURE_PERIODS;

interface ExpectedSchool {
  readonly id: string;
  readonly classification: string;
}

const EXPECTED_SCHOOLS: Readonly<Record<DashboardTenant, readonly ExpectedSchool[]>> = {
  trust_north: [
    { id: 'school_n01', classification: 'Mixed source classifications' },
    { id: 'school_n02', classification: 'Primary' },
  ],
  trust_south: [
    { id: 'school_s01', classification: 'Mixed source classifications' },
    { id: 'school_s02', classification: 'Primary' },
  ],
};

interface ExpectedQuestion {
  readonly code: string;
  readonly category_code: string;
  readonly category_label: string;
  readonly indicator_label: string;
  readonly interpretation_note: string;
}

const EXPECTED_QUESTIONS: readonly ExpectedQuestion[] = [
  {
    code: 'feel_sad',
    category_code: 'emotional_wellbeing',
    category_label: 'Emotional wellbeing',
    indicator_label: 'Pupils who felt sad',
    interpretation_note: 'A higher rate indicates more pupils felt sad during the survey period.',
  },
  {
    code: 'feel_angry',
    category_code: 'emotional_wellbeing',
    category_label: 'Emotional wellbeing',
    indicator_label: 'Pupils who felt angry',
    interpretation_note: 'A higher rate indicates more pupils felt angry during the survey period.',
  },
  {
    code: 'bullying_frequency',
    category_code: 'relationships',
    category_label: 'Relationships',
    indicator_label: 'Pupils who were bullied at least weekly',
    interpretation_note: 'A higher rate indicates more pupils were bullied during the survey period.',
  },
];

const QUESTION_CATEGORY = new Map(
  EXPECTED_QUESTIONS.map((question) => [question.code, question.category_code] as const),
);

const ELIGIBLE_BY_SCHOOL_AND_PERIOD: readonly (readonly number[])[] = [
  [150, 120],
  [100, 15],
];
const ANSWERED_BY_SCHOOL_AND_PERIOD: readonly (readonly number[])[] = [
  [100, 100],
  [80, 6],
];
const ADVERSE_BY_SCHOOL_PERIOD_QUESTION: readonly (readonly (readonly number[])[])[] = [
  [
    [25, 12, 40],
    [30, 8, 45],
  ],
  [
    [16, 6, 24],
    [1, 1, 1],
  ],
];

interface ExpectedCohort {
  readonly school_id: string;
  readonly classification: string;
  readonly period: string;
  readonly question_code: string;
  readonly eligible: number;
  readonly answered: number;
  readonly adverse: number;
  readonly suppressed: boolean;
}

function expectedCohorts(tenant: DashboardTenant): readonly ExpectedCohort[] {
  const cohorts: ExpectedCohort[] = [];
  for (let schoolIndex = 0; schoolIndex < EXPECTED_SCHOOLS[tenant].length; schoolIndex += 1) {
    const school = EXPECTED_SCHOOLS[tenant][schoolIndex]!;
    for (let periodIndex = 0; periodIndex < FIXTURE_PERIODS.length; periodIndex += 1) {
      const period = FIXTURE_PERIODS[periodIndex]!;
      for (let questionIndex = 0; questionIndex < EXPECTED_QUESTIONS.length; questionIndex += 1) {
        const question = EXPECTED_QUESTIONS[questionIndex]!;
        cohorts.push({
          school_id: school.id,
          classification: school.classification,
          period,
          question_code: question.code,
          eligible: ELIGIBLE_BY_SCHOOL_AND_PERIOD[schoolIndex]![periodIndex]!,
          answered: ANSWERED_BY_SCHOOL_AND_PERIOD[schoolIndex]![periodIndex]!,
          adverse: ADVERSE_BY_SCHOOL_PERIOD_QUESTION[schoolIndex]![periodIndex]![questionIndex]!,
          suppressed: schoolIndex === 1 && periodIndex === 1,
        });
      }
    }
  }
  return cohorts;
}

function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function rateOf(cohort: ExpectedCohort): number | null {
  if (cohort.suppressed) {
    return null;
  }
  return round4(cohort.adverse / cohort.answered);
}

function cohortByKey(tenant: DashboardTenant): ReadonlyMap<string, ExpectedCohort> {
  const map = new Map<string, ExpectedCohort>();
  for (const cohort of expectedCohorts(tenant)) {
    map.set(`${cohort.school_id}:${cohort.period}:${cohort.question_code}`, cohort);
  }
  return map;
}

function cohortKey(row: DashboardRow): string {
  return `${String(row.school_id)}:${String(row.survey_period)}:${String(row.question_code)}`;
}

function trustAggregate(
  tenant: DashboardTenant,
  period: string,
  questionCode: string,
): { readonly answered: number; readonly adverse: number; readonly rate: number } {
  let answered = 0;
  let adverse = 0;
  for (const cohort of expectedCohorts(tenant)) {
    if (cohort.period === period && cohort.question_code === questionCode) {
      answered += cohort.answered;
      if (!cohort.suppressed) {
        adverse += cohort.adverse;
      }
    }
  }
  return { answered, adverse, rate: round4(adverse / answered) };
}

function trustCategoryAggregate(
  tenant: DashboardTenant,
  period: string,
  categoryCode: string,
): { readonly answered: number; readonly adverse: number; readonly rate: number } {
  let answered = 0;
  let adverse = 0;
  for (const cohort of expectedCohorts(tenant)) {
    if (cohort.period === period && QUESTION_CATEGORY.get(cohort.question_code) === categoryCode) {
      answered += cohort.answered;
      if (!cohort.suppressed) {
        adverse += cohort.adverse;
      }
    }
  }
  return { answered, adverse, rate: round4(adverse / answered) };
}

function exportSpec(section: DashboardSection): ExportFileSpec {
  const spec = EXPORT_FILES.find((file) => file.fileName === `${section}.csv`);
  if (spec === undefined) {
    throw new Error(`Missing export file spec for dashboard section ${section}`);
  }
  return spec;
}

function movementStatusFor(
  rate: number | null,
  previous: number | null,
): 'worsening' | 'improving' | 'stable' | 'no_comparison' {
  if (rate === null || previous === null) {
    return 'no_comparison';
  }
  const changePp = 100 * (rate - previous);
  if (changePp >= 1) {
    return 'worsening';
  }
  if (changePp <= -1) {
    return 'improving';
  }
  return 'stable';
}

function signalLevelFor(rate: number): 'elevated' | 'watch' | 'lower' {
  if (rate >= 0.2) {
    return 'elevated';
  }
  if (rate >= 0.1) {
    return 'watch';
  }
  return 'lower';
}

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.length = 0;
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dashboard-fixture-'));
  tempRoots.push(root);
  return root;
}

describe('buildFixtureDashboard', () => {
  it('exports the fixture identifiers', () => {
    expect(FIXTURE_RUN_ID).toBe('run-fixture-1');
    expect([...FIXTURE_PERIODS]).toEqual(['2018-autumn', '2019-spring']);
  });

  it('builds a document with the configured metadata, filters and freshness', () => {
    for (const tenant of EXPECTED_TENANTS) {
      const document = buildFixtureDashboard(tenant);
      expect(document.schema_version).toBe(DASHBOARD_SCHEMA_VERSION);
      expect(document.tenant).toBe(tenant);
      expect(document.run_id).toBe(FIXTURE_RUN_ID);
      expect(document.freshness).toEqual({
        trust_id: tenant,
        last_loaded_at: '2026-09-01T10:00:00Z',
        latest_source_updated_at: '2019-04-19T23:33:31Z',
        logical_event_count: 1234,
      });
      expect(document.filters.periods).toEqual([...FIXTURE_PERIODS]);
      const schools = EXPECTED_SCHOOLS[tenant]
        .map((school) => ({ code: school.id, label: school.classification }))
        .sort((a, b) => a.code.localeCompare(b.code));
      expect(document.filters.schools).toEqual(schools);
      const categories = [...new Set(EXPECTED_QUESTIONS.map((question) => question.category_code))]
        .map((code) => ({
          code,
          label: EXPECTED_QUESTIONS.find((question) => question.category_code === code)!.category_label,
        }))
        .sort((a, b) => a.code.localeCompare(b.code));
      expect(document.filters.categories).toEqual(categories);
      const questions = [...EXPECTED_QUESTIONS]
        .map((question) => ({
          code: question.code,
          label: question.indicator_label,
          interpretation_note: question.interpretation_note,
        }))
        .sort((a, b) => a.code.localeCompare(b.code));
      expect(document.filters.questions).toEqual(questions);
    }
  });

  it('gives every row exactly the spec columns and the document tenant', () => {
    for (const tenant of EXPECTED_TENANTS) {
      const document = buildFixtureDashboard(tenant);
      for (const section of DASHBOARD_SECTIONS) {
        const spec = exportSpec(section);
        expect(document[section].length).toBeGreaterThan(0);
        for (const row of document[section]) {
          expect(Object.keys(row)).toEqual([...spec.columns]);
          expect(row.trust_id).toBe(tenant);
        }
      }
    }
  });

  it('nulls exactly the suppressed columns while keeping counts numeric', () => {
    for (const tenant of EXPECTED_TENANTS) {
      const document = buildFixtureDashboard(tenant);
      for (const section of DASHBOARD_SECTIONS) {
        const spec = exportSpec(section);
        const suppressedRows = document[section].filter((row) => row.is_suppressed === true);
        expect(suppressedRows.length).toBeGreaterThan(0);
        for (const row of suppressedRows) {
          for (const column of spec.suppressedColumns) {
            expect(row[column]).toBeNull();
          }
          for (const column of spec.columns.filter(
            (name) => name.endsWith('_count') && !spec.suppressedColumns.includes(name),
          )) {
            expect(typeof row[column]).toBe('number');
          }
        }
      }
    }
  });
});

describe('indicator_analysis', () => {
  it('derives rates, missing counts and trust aggregates from the cohort table', () => {
    for (const tenant of EXPECTED_TENANTS) {
      const rows = buildFixtureDashboard(tenant).indicator_analysis;
      const cohorts = cohortByKey(tenant);
      expect(rows).toHaveLength(
        EXPECTED_SCHOOLS[tenant].length * FIXTURE_PERIODS.length * EXPECTED_QUESTIONS.length,
      );
      for (const row of rows) {
        const cohort = cohorts.get(cohortKey(row))!;
        expect(row.school_classification).toBe(cohort.classification);
        expect(row.eligible_submission_count).toBe(cohort.eligible);
        expect(row.answered_response_count).toBe(cohort.answered);
        expect(row.missing_response_count).toBe(cohort.eligible - cohort.answered);
        expect(row.is_suppressed).toBe(cohort.suppressed);
        const trust = trustAggregate(tenant, cohort.period, cohort.question_code);
        expect(row.trust_answered_response_count).toBe(trust.answered);
        expect(row.trust_adverse_response_count).toBe(trust.adverse);
        expect(row.trust_adverse_response_rate).toBe(trust.rate);
        if (cohort.suppressed) {
          expect(row.adverse_response_count).toBeNull();
          expect(row.adverse_response_rate).toBeNull();
        } else {
          expect(row.adverse_response_count).toBe(cohort.adverse);
          expect(row.adverse_response_rate).toBe(rateOf(cohort));
          expect(row.trust_gap_pp).toBe(round2(100 * (rateOf(cohort)! - trust.rate)));
        }
      }
    }
  });

  it('carries the previous period into movement status and change', () => {
    for (const tenant of EXPECTED_TENANTS) {
      const rows = buildFixtureDashboard(tenant).indicator_analysis;
      const cohorts = cohortByKey(tenant);
      for (const row of rows) {
        const cohort = cohorts.get(cohortKey(row))!;
        const previous =
          cohort.period === LATEST_PERIOD
            ? cohorts.get(`${cohort.school_id}:${PREVIOUS_PERIOD}:${cohort.question_code}`)
            : undefined;
        if (previous === undefined) {
          expect(row.previous_adverse_response_count).toBeNull();
          expect(row.previous_answered_response_count).toBeNull();
          expect(row.previous_adverse_response_rate).toBeNull();
          expect(row.period_change_pp).toBeNull();
          expect(row.movement_status).toBe('no_comparison');
        } else {
          expect(row.previous_adverse_response_count).toBe(previous.adverse);
          expect(row.previous_answered_response_count).toBe(previous.answered);
          expect(row.previous_adverse_response_rate).toBe(rateOf(previous));
          const rate = rateOf(cohort);
          expect(row.movement_status).toBe(movementStatusFor(rate, rateOf(previous)));
          if (rate === null) {
            expect(row.period_change_pp).toBeNull();
          } else {
            expect(row.period_change_pp).toBe(round2(100 * (rate - rateOf(previous)!)));
          }
        }
      }
    }
  });

  it('derives coverage_status from the missing response rate', () => {
    for (const tenant of EXPECTED_TENANTS) {
      const rows = buildFixtureDashboard(tenant).indicator_analysis;
      const cohorts = cohortByKey(tenant);
      for (const row of rows) {
        const cohort = cohorts.get(cohortKey(row))!;
        const missingRate = cohort.suppressed
          ? null
          : round4((cohort.eligible - cohort.answered) / cohort.eligible);
        expect(row.missing_response_rate).toBe(missingRate);
        if (cohort.suppressed) {
          expect(row.coverage_status).toBe('suppressed');
        } else {
          expect(row.coverage_status).toBe(missingRate! >= 0.2 ? 'limited' : 'adequate');
        }
      }
    }
  });
});

describe('category_analysis', () => {
  it('derives category rows from the cohort table', () => {
    for (const tenant of EXPECTED_TENANTS) {
      for (const row of buildFixtureDashboard(tenant).category_analysis) {
        const categoryCode = String(row.category_code);
        const categoryQuestions = EXPECTED_QUESTIONS.filter(
          (question) => question.category_code === categoryCode,
        );
        const cohorts = expectedCohorts(tenant).filter(
          (cohort) =>
            cohort.school_id === row.school_id &&
            cohort.period === row.survey_period &&
            QUESTION_CATEGORY.get(cohort.question_code) === categoryCode,
        );
        const eligible = cohorts.reduce((sum, cohort) => sum + cohort.eligible, 0);
        const answered = cohorts.reduce((sum, cohort) => sum + cohort.answered, 0);
        const adverse = cohorts.reduce((sum, cohort) => sum + cohort.adverse, 0);
        const suppressed = cohorts.length > 0 && cohorts.every((cohort) => cohort.suppressed);
        expect(row.eligible_submission_count).toBe(eligible);
        expect(row.answering_submission_count).toBe(answered);
        expect(row.indicator_count).toBe(categoryQuestions.length);
        expect(row.answered_question_response_count).toBe(answered);
        expect(row.missing_question_response_count).toBe(eligible - answered);
        expect(row.is_suppressed).toBe(suppressed);
        const trust = trustCategoryAggregate(tenant, String(row.survey_period), categoryCode);
        expect(row.trust_answering_submission_count).toBe(trust.answered);
        expect(row.trust_answered_question_response_count).toBe(trust.answered);
        expect(row.trust_adverse_question_response_count).toBe(trust.adverse);
        expect(row.trust_adverse_question_response_rate).toBe(trust.rate);
        if (suppressed) {
          expect(row.adverse_question_response_count).toBeNull();
          expect(row.adverse_question_response_rate).toBeNull();
          expect(row.missing_question_response_rate).toBeNull();
          expect(row.period_change_pp).toBeNull();
          expect(row.trust_gap_pp).toBeNull();
        } else {
          const categoryRate = round4(adverse / answered);
          expect(row.adverse_question_response_count).toBe(adverse);
          expect(row.adverse_question_response_rate).toBe(categoryRate);
          expect(row.missing_question_response_rate).toBe(round4((eligible - answered) / eligible));
          expect(row.trust_gap_pp).toBe(round2(100 * (categoryRate - trust.rate)));
        }
        if (String(row.survey_period) === LATEST_PERIOD) {
          const previousCohorts = expectedCohorts(tenant).filter(
            (cohort) =>
              cohort.school_id === row.school_id &&
              cohort.period === PREVIOUS_PERIOD &&
              QUESTION_CATEGORY.get(cohort.question_code) === categoryCode,
          );
          const previousAnswered = previousCohorts.reduce((sum, cohort) => sum + cohort.answered, 0);
          const previousAdverse = previousCohorts.reduce((sum, cohort) => sum + cohort.adverse, 0);
          const previousRate = round4(previousAdverse / previousAnswered);
          expect(row.previous_answered_question_response_count).toBe(previousAnswered);
          expect(row.previous_adverse_question_response_count).toBe(previousAdverse);
          expect(row.previous_adverse_question_response_rate).toBe(previousRate);
          if (!suppressed) {
            expect(row.period_change_pp).toBe(round2(100 * (round4(adverse / answered) - previousRate)));
          }
        } else {
          expect(row.previous_answered_question_response_count).toBeNull();
          expect(row.previous_adverse_question_response_count).toBeNull();
          expect(row.previous_adverse_question_response_rate).toBeNull();
        }
      }
    }
  });
});

describe('change_drivers', () => {
  it('has one row per school, period, category and question with ranks starting at 1', () => {
    for (const tenant of EXPECTED_TENANTS) {
      const rows = buildFixtureDashboard(tenant).change_drivers;
      expect(rows).toHaveLength(
        EXPECTED_SCHOOLS[tenant].length * FIXTURE_PERIODS.length * EXPECTED_QUESTIONS.length,
      );
      const seen = new Set<string>();
      for (const row of rows) {
        const key = `${String(row.school_id)}:${String(row.survey_period)}:${String(
          row.category_code,
        )}:${String(row.question_code)}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      for (const school of EXPECTED_SCHOOLS[tenant]) {
        for (const period of FIXTURE_PERIODS) {
          const group = rows.filter(
            (row) => row.school_id === school.id && row.survey_period === period,
          );
          const ranks = group.map((row) => Number(row.driver_rank)).sort((a, b) => a - b);
          expect(ranks).toEqual([1, 2, 3]);
        }
      }
    }
  });

  it('carries the school rates and previous period rates', () => {
    for (const tenant of EXPECTED_TENANTS) {
      const rows = buildFixtureDashboard(tenant).change_drivers;
      const cohorts = cohortByKey(tenant);
      for (const row of rows) {
        const cohort = cohorts.get(
          `${String(row.school_id)}:${String(row.survey_period)}:${String(row.question_code)}`,
        )!;
        expect(row.eligible_submission_count).toBe(cohort.eligible);
        expect(row.is_suppressed).toBe(cohort.suppressed);
        expect(row.adverse_response_rate).toBe(round4(cohort.adverse / cohort.answered));
        const previous =
          cohort.period === LATEST_PERIOD
            ? cohorts.get(`${cohort.school_id}:${PREVIOUS_PERIOD}:${cohort.question_code}`)
            : undefined;
        expect(row.previous_adverse_response_rate).toBe(previous === undefined ? null : rateOf(previous));
        if (row.category_change_pp !== null) {
          expect(typeof row.category_change_pp).toBe('number');
        }
        if (row.category_change_contribution_pp !== null) {
          expect(typeof row.category_change_contribution_pp).toBe('number');
        }
      }
    }
  });
});

describe('question_response_distribution', () => {
  it('gives three answers per cohort summing to answered_response_count', () => {
    for (const tenant of EXPECTED_TENANTS) {
      const rows = buildFixtureDashboard(tenant).question_response_distribution;
      expect(rows).toHaveLength(
        EXPECTED_SCHOOLS[tenant].length * FIXTURE_PERIODS.length * EXPECTED_QUESTIONS.length * 3,
      );
      for (const cohort of expectedCohorts(tenant)) {
        const cohortRows = rows.filter(
          (row) =>
            row.school_id === cohort.school_id &&
            row.survey_period === cohort.period &&
            row.question_code === cohort.question_code,
        );
        expect(cohortRows).toHaveLength(3);
        expect(cohortRows.map((row) => row.answer_order)).toEqual([1, 2, 3]);
        for (const row of cohortRows) {
          expect(row.answered_response_count).toBe(cohort.answered);
          expect(row.is_suppressed).toBe(cohort.suppressed);
          expect(typeof row.answer_label).toBe('string');
        }
        if (cohort.suppressed) {
          for (const row of cohortRows) {
            expect(row.response_count).toBeNull();
            expect(row.response_rate).toBeNull();
          }
        } else {
          const counts = cohortRows.map((row) => Number(row.response_count));
          expect(counts.reduce((sum, count) => sum + count, 0)).toBe(cohort.answered);
          for (const [answerIndex, row] of cohortRows.entries()) {
            expect(row.response_rate).toBe(round4(counts[answerIndex]! / cohort.answered));
          }
        }
      }
    }
  });
});

describe('support_signal_summary', () => {
  it('derives counts and signal levels from the cohort table', () => {
    for (const tenant of EXPECTED_TENANTS) {
      const rows = buildFixtureDashboard(tenant).support_signal_summary;
      expect(rows).toHaveLength(
        EXPECTED_SCHOOLS[tenant].length * FIXTURE_PERIODS.length * EXPECTED_QUESTIONS.length,
      );
      const cohorts = cohortByKey(tenant);
      for (const row of rows) {
        const cohort = cohorts.get(cohortKey(row))!;
        expect(row.eligible_submission_count).toBe(cohort.eligible);
        expect(row.answered_response_count).toBe(cohort.answered);
        expect(row.missing_response_count).toBe(cohort.eligible - cohort.answered);
        expect(row.is_suppressed).toBe(cohort.suppressed);
        const rate = rateOf(cohort);
        if (cohort.suppressed) {
          expect(row.adverse_response_count).toBeNull();
          expect(row.adverse_response_rate).toBeNull();
          expect(row.signal_level).toBeNull();
        } else {
          expect(row.adverse_response_count).toBe(cohort.adverse);
          expect(row.adverse_response_rate).toBe(rate);
          expect(row.signal_level).toBe(signalLevelFor(rate!));
        }
      }
    }
  });
});

describe('writeFixtureExports', () => {
  it('round-trips both trusts through readTenantDashboard', async () => {
    const root = makeRoot();
    const documents = EXPECTED_TENANTS.map((tenant) => buildFixtureDashboard(tenant));
    writeFixtureExports(root, documents);
    for (const tenant of EXPECTED_TENANTS) {
      await expect(readTenantDashboard(root, tenant)).resolves.toEqual(buildFixtureDashboard(tenant));
    }
  });

  it('writes current.json and per-tenant dashboard.json files', () => {
    const root = makeRoot();
    const documents = EXPECTED_TENANTS.map((tenant) => buildFixtureDashboard(tenant));
    writeFixtureExports(root, documents);
    const current = JSON.parse(readFileSync(join(root, 'current.json'), 'utf8')) as {
      run_id: string;
      published_at: string;
      tenants: Record<string, string>;
    };
    expect(current.run_id).toBe(FIXTURE_RUN_ID);
    expect(typeof current.published_at).toBe('string');
    expect(current.tenants).toEqual({
      trust_north: `run_id=${FIXTURE_RUN_ID}/tenant=trust_north`,
      trust_south: `run_id=${FIXTURE_RUN_ID}/tenant=trust_south`,
    });
    for (const tenant of EXPECTED_TENANTS) {
      const path = join(root, `run_id=${FIXTURE_RUN_ID}`, `tenant=${tenant}`, 'dashboard.json');
      const document = JSON.parse(readFileSync(path, 'utf8'));
      expect(document).toEqual(buildFixtureDashboard(tenant));
    }
  });
});
