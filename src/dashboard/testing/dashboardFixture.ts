import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DASHBOARD_SCHEMA_VERSION } from '../../publication/dashboardJson.ts';
import type {
  DashboardRow,
  DashboardValue,
  TenantDashboard,
  TenantDashboardFilters,
  TenantFreshness,
} from '../../publication/dashboardJson.ts';
import { EXPORT_FILES } from '../../publication/exportTenants.ts';
import type { ExportFileSpec } from '../../publication/exportTenants.ts';
import { DASHBOARD_SECTIONS } from '../reader.ts';
import type { DashboardSection, DashboardTenant } from '../reader.ts';

export const FIXTURE_RUN_ID = 'run-fixture-1';
export const FIXTURE_PERIODS = ['2018-autumn', '2019-spring'] as const;
const [PREVIOUS_PERIOD, LATEST_PERIOD] = FIXTURE_PERIODS;

const DIRECTION = 'higher_is_worse';
const FIXTURE_RULE_VERSION = 'support-signal/1';

interface FixtureQuestion {
  readonly code: string;
  readonly indicator_label: string;
  readonly category_code: string;
  readonly category_label: string;
  readonly interpretation_note: string;
}

interface FixtureSchool {
  readonly id: string;
  readonly classification: string;
}

interface FixtureCohort {
  readonly school_id: string;
  readonly school_classification: string;
  readonly period: string;
  readonly question_code: string;
  readonly eligible: number;
  readonly answered: number;
  readonly adverse: number;
  readonly suppressed: boolean;
}

const FIXTURE_QUESTIONS: readonly FixtureQuestion[] = [
  {
    code: 'feel_sad',
    indicator_label: 'Pupils who felt sad',
    category_code: 'emotional_wellbeing',
    category_label: 'Emotional wellbeing',
    interpretation_note: 'A higher rate indicates more pupils felt sad during the survey period.',
  },
  {
    code: 'feel_angry',
    indicator_label: 'Pupils who felt angry',
    category_code: 'emotional_wellbeing',
    category_label: 'Emotional wellbeing',
    interpretation_note: 'A higher rate indicates more pupils felt angry during the survey period.',
  },
  {
    code: 'bullying_frequency',
    indicator_label: 'Pupils who were bullied at least weekly',
    category_code: 'relationships',
    category_label: 'Relationships',
    interpretation_note: 'A higher rate indicates more pupils were bullied during the survey period.',
  },
];

const FIXTURE_CATEGORY_CODES: readonly string[] = [
  ...new Set(FIXTURE_QUESTIONS.map((question) => question.category_code)),
].sort();

const FIXTURE_SCHOOLS: Readonly<Record<DashboardTenant, readonly FixtureSchool[]>> = {
  trust_north: [
    { id: 'school_n01', classification: 'Mixed source classifications' },
    { id: 'school_n02', classification: 'Primary' },
  ],
  trust_south: [
    { id: 'school_s01', classification: 'Mixed source classifications' },
    { id: 'school_s02', classification: 'Primary' },
  ],
};

const FIXTURE_ANSWERS: Readonly<Record<string, readonly string[]>> = {
  feel_sad: ['Not at all', 'Several days', 'More than half the days'],
  feel_angry: ['Never', 'Sometimes', 'Often'],
  bullying_frequency: ['Never', 'Sometimes', 'Often'],
};

// eligible and answered per (school index, period index); the second school's
// 2019-spring cohorts are the suppressed small-count cohorts.
const ELIGIBLE_BY_SCHOOL_PERIOD: readonly (readonly number[])[] = [
  [150, 120],
  [100, 15],
];
const ANSWERED_BY_SCHOOL_PERIOD: readonly (readonly number[])[] = [
  [100, 100],
  [80, 6],
];
// adverse per (school index, period index, question index); counts differ by
// school and period so the fixture exercises a range of rates.
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

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function questionOf(code: string): FixtureQuestion {
  const question = FIXTURE_QUESTIONS.find((entry) => entry.code === code);
  if (question === undefined) {
    throw new Error(`Missing fixture question ${code}`);
  }
  return question;
}

function categoryLabelFor(code: string): string {
  const question = FIXTURE_QUESTIONS.find((entry) => entry.category_code === code);
  if (question === undefined) {
    throw new Error(`Missing fixture category ${code}`);
  }
  return question.category_label;
}

function answersFor(questionCode: string): readonly string[] {
  const answers = FIXTURE_ANSWERS[questionCode];
  if (answers === undefined) {
    throw new Error(`Missing fixture answers for question ${questionCode}`);
  }
  return answers;
}

function cohortsFor(tenant: DashboardTenant): readonly FixtureCohort[] {
  const schools = FIXTURE_SCHOOLS[tenant];
  const cohorts: FixtureCohort[] = [];
  for (let schoolIndex = 0; schoolIndex < schools.length; schoolIndex += 1) {
    const school = schools[schoolIndex]!;
    for (let periodIndex = 0; periodIndex < FIXTURE_PERIODS.length; periodIndex += 1) {
      const period = FIXTURE_PERIODS[periodIndex]!;
      for (let questionIndex = 0; questionIndex < FIXTURE_QUESTIONS.length; questionIndex += 1) {
        const question = FIXTURE_QUESTIONS[questionIndex]!;
        cohorts.push({
          school_id: school.id,
          school_classification: school.classification,
          period,
          question_code: question.code,
          eligible: ELIGIBLE_BY_SCHOOL_PERIOD[schoolIndex]![periodIndex]!,
          answered: ANSWERED_BY_SCHOOL_PERIOD[schoolIndex]![periodIndex]!,
          adverse: ADVERSE_BY_SCHOOL_PERIOD_QUESTION[schoolIndex]![periodIndex]![questionIndex]!,
          suppressed: schoolIndex === 1 && periodIndex === 1,
        });
      }
    }
  }
  return cohorts;
}

function rateOf(cohort: FixtureCohort): number | null {
  if (cohort.suppressed) {
    return null;
  }
  return roundTo(cohort.adverse / cohort.answered, 4);
}

interface TrustAggregate {
  readonly answered: number;
  readonly adverse: number;
  readonly rate: number;
}

function trustQuestionAggregates(tenant: DashboardTenant): ReadonlyMap<string, TrustAggregate> {
  const aggregates = new Map<string, TrustAggregate>();
  for (const period of FIXTURE_PERIODS) {
    for (const question of FIXTURE_QUESTIONS) {
      let answered = 0;
      let adverse = 0;
      for (const cohort of cohortsFor(tenant)) {
        if (cohort.period === period && cohort.question_code === question.code) {
          answered += cohort.answered;
          if (!cohort.suppressed) {
            adverse += cohort.adverse;
          }
        }
      }
      aggregates.set(`${period}:${question.code}`, {
        answered,
        adverse,
        rate: roundTo(adverse / answered, 4),
      });
    }
  }
  return aggregates;
}

function trustCategoryAggregates(tenant: DashboardTenant): ReadonlyMap<string, TrustAggregate> {
  const aggregates = new Map<string, TrustAggregate>();
  for (const period of FIXTURE_PERIODS) {
    for (const categoryCode of FIXTURE_CATEGORY_CODES) {
      let answered = 0;
      let adverse = 0;
      for (const cohort of cohortsFor(tenant)) {
        if (cohort.period === period && questionOf(cohort.question_code).category_code === categoryCode) {
          answered += cohort.answered;
          if (!cohort.suppressed) {
            adverse += cohort.adverse;
          }
        }
      }
      aggregates.set(`${period}:${categoryCode}`, {
        answered,
        adverse,
        rate: roundTo(adverse / answered, 4),
      });
    }
  }
  return aggregates;
}

interface CategoryAggregate {
  readonly category_code: string;
  readonly category_label: string;
  readonly eligible: number;
  readonly answered: number;
  readonly missing: number;
  readonly adverse: number;
  readonly rate: number;
  readonly suppressed: boolean;
}

function schoolCategoryAggregate(
  tenant: DashboardTenant,
  schoolId: string,
  period: string,
  categoryCode: string,
): CategoryAggregate {
  const cohorts = cohortsFor(tenant).filter(
    (cohort) =>
      cohort.school_id === schoolId &&
      cohort.period === period &&
      questionOf(cohort.question_code).category_code === categoryCode,
  );
  if (cohorts.length === 0) {
    throw new Error(`Missing fixture cohorts for ${tenant} ${schoolId} ${period} ${categoryCode}`);
  }
  let eligible = 0;
  let answered = 0;
  let adverse = 0;
  for (const cohort of cohorts) {
    eligible += cohort.eligible;
    answered += cohort.answered;
    adverse += cohort.adverse;
  }
  return {
    category_code: categoryCode,
    category_label: categoryLabelFor(categoryCode),
    eligible,
    answered,
    missing: eligible - answered,
    adverse,
    rate: roundTo(adverse / answered, 4),
    suppressed: cohorts.every((cohort) => cohort.suppressed),
  };
}

function driverRanks(tenant: DashboardTenant): ReadonlyMap<string, number> {
  const ranks = new Map<string, number>();
  for (const school of FIXTURE_SCHOOLS[tenant]) {
    for (const period of FIXTURE_PERIODS) {
      const ordered = [...FIXTURE_QUESTIONS].sort(
        (a, b) => a.category_code.localeCompare(b.category_code) || a.code.localeCompare(b.code),
      );
      ordered.forEach((question, index) => {
        ranks.set(`${school.id}:${period}:${question.code}`, index + 1);
      });
    }
  }
  return ranks;
}

function answerCounts(answered: number): readonly [number, number, number] {
  const first = Math.floor(answered * 0.5);
  const second = Math.floor(answered * 0.3);
  return [first, second, answered - first - second];
}

interface CohortContext {
  readonly tenant: DashboardTenant;
  readonly cohort: FixtureCohort;
  readonly question: FixtureQuestion;
  readonly rate: number | null;
  readonly missing: number;
  readonly missingRate: number | null;
  readonly previousRate: number | null;
  readonly previousAdverse: number | null;
  readonly previousAnswered: number | null;
  readonly trustAnswered: number;
  readonly trustAdverse: number;
  readonly trustRate: number;
  readonly category: CategoryAggregate;
  readonly previousCategory: CategoryAggregate | null;
  readonly trustCategoryRate: number;
  readonly answers: readonly [number, number, number];
  readonly driverRank: number;
}

function cohortContexts(tenant: DashboardTenant): readonly CohortContext[] {
  const trustQuestions = trustQuestionAggregates(tenant);
  const trustCategories = trustCategoryAggregates(tenant);
  const cohorts = cohortsFor(tenant);
  const cohortsByKey = new Map(
    cohorts.map((cohort) => [`${cohort.school_id}:${cohort.period}:${cohort.question_code}`, cohort] as const),
  );
  const ranks = driverRanks(tenant);
  return cohorts.map((cohort) => {
    const question = questionOf(cohort.question_code);
    const previousCohort =
      cohort.period === LATEST_PERIOD
        ? cohortsByKey.get(`${cohort.school_id}:${PREVIOUS_PERIOD}:${cohort.question_code}`)
        : undefined;
    const trust = trustQuestions.get(`${cohort.period}:${cohort.question_code}`);
    if (trust === undefined) {
      throw new Error(`Missing fixture trust aggregate for ${tenant} ${cohort.period} ${cohort.question_code}`);
    }
    const trustCategory = trustCategories.get(`${cohort.period}:${question.category_code}`);
    if (trustCategory === undefined) {
      throw new Error(
        `Missing fixture trust category aggregate for ${tenant} ${cohort.period} ${question.category_code}`,
      );
    }
    const driverRank = ranks.get(`${cohort.school_id}:${cohort.period}:${cohort.question_code}`);
    if (driverRank === undefined) {
      throw new Error(
        `Missing fixture driver rank for ${tenant} ${cohort.school_id} ${cohort.period} ${cohort.question_code}`,
      );
    }
    return {
      tenant,
      cohort,
      question,
      rate: rateOf(cohort),
      missing: cohort.eligible - cohort.answered,
      missingRate: cohort.suppressed
        ? null
        : roundTo((cohort.eligible - cohort.answered) / cohort.eligible, 4),
      previousRate: previousCohort === undefined ? null : rateOf(previousCohort),
      previousAdverse: previousCohort === undefined ? null : previousCohort.adverse,
      previousAnswered: previousCohort === undefined ? null : previousCohort.answered,
      trustAnswered: trust.answered,
      trustAdverse: trust.adverse,
      trustRate: trust.rate,
      category: schoolCategoryAggregate(tenant, cohort.school_id, cohort.period, question.category_code),
      previousCategory:
        cohort.period === LATEST_PERIOD
          ? schoolCategoryAggregate(tenant, cohort.school_id, PREVIOUS_PERIOD, question.category_code)
          : null,
      trustCategoryRate: trustCategory.rate,
      answers: answerCounts(cohort.answered),
      driverRank,
    };
  });
}

interface CategoryContext {
  readonly tenant: DashboardTenant;
  readonly school: FixtureSchool;
  readonly period: string;
  readonly aggregate: CategoryAggregate;
  readonly previous: CategoryAggregate | null;
  readonly trust: TrustAggregate;
  readonly indicatorCount: number;
}

function categoryContexts(tenant: DashboardTenant): readonly CategoryContext[] {
  const trustCategories = trustCategoryAggregates(tenant);
  const contexts: CategoryContext[] = [];
  for (const school of FIXTURE_SCHOOLS[tenant]) {
    for (const period of FIXTURE_PERIODS) {
      for (const categoryCode of FIXTURE_CATEGORY_CODES) {
        const trust = trustCategories.get(`${period}:${categoryCode}`);
        if (trust === undefined) {
          throw new Error(`Missing fixture trust category aggregate for ${tenant} ${period} ${categoryCode}`);
        }
        contexts.push({
          tenant,
          school,
          period,
          aggregate: schoolCategoryAggregate(tenant, school.id, period, categoryCode),
          previous:
            period === LATEST_PERIOD ? schoolCategoryAggregate(tenant, school.id, PREVIOUS_PERIOD, categoryCode) : null,
          trust,
          indicatorCount: FIXTURE_QUESTIONS.filter((question) => question.category_code === categoryCode).length,
        });
      }
    }
  }
  return contexts;
}

function rowFor(spec: ExportFileSpec, values: Readonly<Record<string, DashboardValue>>): DashboardRow {
  const row: Record<string, DashboardValue> = {};
  for (const column of spec.columns) {
    const value = values[column];
    if (value === undefined) {
      throw new Error(`Missing fixture value for ${spec.fileName} column ${column}`);
    }
    row[column] = value;
  }
  return row;
}

function exportSpecFor(section: DashboardSection): ExportFileSpec {
  const spec = EXPORT_FILES.find((file) => file.fileName === `${section}.csv`);
  if (spec === undefined) {
    throw new Error(`Missing export file spec for dashboard section ${section}`);
  }
  return spec;
}

function coverageStatusOf(ctx: CohortContext): 'suppressed' | 'limited' | 'adequate' {
  if (ctx.cohort.suppressed) {
    return 'suppressed';
  }
  if (ctx.missingRate !== null && ctx.missingRate >= 0.2) {
    return 'limited';
  }
  return 'adequate';
}

function movementStatusOf(ctx: CohortContext): 'worsening' | 'improving' | 'stable' | 'no_comparison' {
  if (ctx.rate === null || ctx.previousRate === null) {
    return 'no_comparison';
  }
  const changePp = 100 * (ctx.rate - ctx.previousRate);
  if (changePp >= 1) {
    return 'worsening';
  }
  if (changePp <= -1) {
    return 'improving';
  }
  return 'stable';
}

function signalLevelOf(ctx: CohortContext): 'elevated' | 'watch' | 'lower' | null {
  if (ctx.cohort.suppressed || ctx.rate === null) {
    return null;
  }
  if (ctx.rate >= 0.2) {
    return 'elevated';
  }
  if (ctx.rate >= 0.1) {
    return 'watch';
  }
  return 'lower';
}

function periodChangePp(ctx: CohortContext): number | null {
  if (ctx.rate === null || ctx.previousRate === null) {
    return null;
  }
  return roundTo(100 * (ctx.rate - ctx.previousRate), 2);
}

function trustGapPp(ctx: CohortContext): number | null {
  if (ctx.rate === null) {
    return null;
  }
  return roundTo(100 * (ctx.rate - ctx.trustRate), 2);
}

function indicatorChangePp(ctx: CohortContext): number | null {
  if (ctx.rate === null || ctx.previousRate === null) {
    return null;
  }
  return roundTo(100 * (ctx.rate - ctx.previousRate), 2);
}

function categoryChangePp(ctx: CohortContext): number | null {
  if (ctx.category.suppressed || ctx.previousCategory === null) {
    return null;
  }
  return roundTo(100 * (ctx.category.rate - ctx.previousCategory.rate), 2);
}

function categoryChangeContributionPp(ctx: CohortContext): number | null {
  if (ctx.cohort.suppressed || ctx.previousRate === null || ctx.rate === null) {
    return null;
  }
  if (ctx.category.answered === 0) {
    return null;
  }
  const change = roundTo(100 * (ctx.rate - ctx.previousRate), 2);
  return roundTo((ctx.cohort.answered / ctx.category.answered) * change, 2);
}

function indicatorRow(spec: ExportFileSpec, ctx: CohortContext): DashboardRow {
  const values: Record<string, DashboardValue> = {
    trust_id: ctx.tenant,
    school_id: ctx.cohort.school_id,
    school_classification: ctx.cohort.school_classification,
    survey_period: ctx.cohort.period,
    question_code: ctx.cohort.question_code,
    indicator_label: ctx.question.indicator_label,
    category_code: ctx.question.category_code,
    category_label: ctx.question.category_label,
    direction: DIRECTION,
    interpretation_note: ctx.question.interpretation_note,
    eligible_submission_count: ctx.cohort.eligible,
    answered_response_count: ctx.cohort.answered,
    missing_response_count: ctx.missing,
    is_suppressed: ctx.cohort.suppressed,
    adverse_response_count: ctx.cohort.suppressed ? null : ctx.cohort.adverse,
    adverse_response_rate: ctx.rate,
    missing_response_rate: ctx.missingRate,
    trust_answered_response_count: ctx.trustAnswered,
    trust_adverse_response_count: ctx.trustAdverse,
    trust_adverse_response_rate: ctx.trustRate,
    previous_adverse_response_count: ctx.previousAdverse,
    previous_answered_response_count: ctx.previousAnswered,
    previous_adverse_response_rate: ctx.previousRate,
    period_change_pp: periodChangePp(ctx),
    trust_gap_pp: trustGapPp(ctx),
    coverage_status: coverageStatusOf(ctx),
    movement_status: movementStatusOf(ctx),
  };
  return rowFor(spec, values);
}

function categoryRow(spec: ExportFileSpec, ctx: CategoryContext): DashboardRow {
  const aggregate = ctx.aggregate;
  const values: Record<string, DashboardValue> = {
    trust_id: ctx.tenant,
    school_id: ctx.school.id,
    school_classification: ctx.school.classification,
    survey_period: ctx.period,
    category_code: aggregate.category_code,
    category_label: aggregate.category_label,
    eligible_submission_count: aggregate.eligible,
    answering_submission_count: aggregate.answered,
    indicator_count: ctx.indicatorCount,
    answered_question_response_count: aggregate.answered,
    missing_question_response_count: aggregate.missing,
    is_suppressed: aggregate.suppressed,
    adverse_question_response_count: aggregate.suppressed ? null : aggregate.adverse,
    adverse_question_response_rate: aggregate.suppressed ? null : aggregate.rate,
    missing_question_response_rate: aggregate.suppressed ? null : roundTo(aggregate.missing / aggregate.eligible, 4),
    trust_answering_submission_count: ctx.trust.answered,
    trust_answered_question_response_count: ctx.trust.answered,
    trust_adverse_question_response_count: ctx.trust.adverse,
    trust_adverse_question_response_rate: ctx.trust.rate,
    previous_adverse_question_response_count: ctx.previous === null ? null : ctx.previous.adverse,
    previous_answered_question_response_count: ctx.previous === null ? null : ctx.previous.answered,
    previous_adverse_question_response_rate: ctx.previous === null ? null : ctx.previous.rate,
    period_change_pp:
      aggregate.suppressed || ctx.previous === null ? null : roundTo(100 * (aggregate.rate - ctx.previous.rate), 2),
    trust_gap_pp: aggregate.suppressed ? null : roundTo(100 * (aggregate.rate - ctx.trust.rate), 2),
  };
  return rowFor(spec, values);
}

function changeDriverRow(spec: ExportFileSpec, ctx: CohortContext): DashboardRow {
  const values: Record<string, DashboardValue> = {
    trust_id: ctx.tenant,
    school_id: ctx.cohort.school_id,
    school_classification: ctx.cohort.school_classification,
    survey_period: ctx.cohort.period,
    category_code: ctx.question.category_code,
    category_label: ctx.question.category_label,
    question_code: ctx.cohort.question_code,
    indicator_label: ctx.question.indicator_label,
    interpretation_note: ctx.question.interpretation_note,
    eligible_submission_count: ctx.cohort.eligible,
    is_suppressed: ctx.cohort.suppressed,
    adverse_response_rate: ctx.cohort.suppressed ? null : roundTo(ctx.cohort.adverse / ctx.cohort.answered, 4),
    previous_adverse_response_rate: ctx.previousRate,
    indicator_change_pp: indicatorChangePp(ctx),
    category_change_pp: categoryChangePp(ctx),
    category_change_contribution_pp: categoryChangeContributionPp(ctx),
    driver_rank: ctx.driverRank,
  };
  return rowFor(spec, values);
}

function distributionRows(spec: ExportFileSpec, ctx: CohortContext): readonly DashboardRow[] {
  const answers = answersFor(ctx.cohort.question_code);
  return ctx.answers.map((count, answerIndex) => {
    const answerLabel = answers[answerIndex];
    if (answerLabel === undefined) {
      throw new Error(`Missing fixture answer label for question ${ctx.cohort.question_code}`);
    }
    const suppressed = ctx.cohort.suppressed;
    const values: Record<string, DashboardValue> = {
      trust_id: ctx.tenant,
      school_id: ctx.cohort.school_id,
      school_classification: ctx.cohort.school_classification,
      survey_period: ctx.cohort.period,
      question_code: ctx.cohort.question_code,
      indicator_label: ctx.question.indicator_label,
      category_code: ctx.question.category_code,
      category_label: ctx.question.category_label,
      answer_label: answerLabel,
      answer_order: answerIndex + 1,
      answered_response_count: ctx.cohort.answered,
      is_suppressed: suppressed,
      response_count: suppressed ? null : count,
      response_rate: suppressed ? null : roundTo(count / ctx.cohort.answered, 4),
    };
    return rowFor(spec, values);
  });
}

function supportSignalRow(spec: ExportFileSpec, ctx: CohortContext): DashboardRow {
  const values: Record<string, DashboardValue> = {
    trust_id: ctx.tenant,
    school_id: ctx.cohort.school_id,
    school_classification: ctx.cohort.school_classification,
    survey_period: ctx.cohort.period,
    question_code: ctx.cohort.question_code,
    indicator_label: ctx.question.indicator_label,
    category_code: ctx.question.category_code,
    category_label: ctx.question.category_label,
    rule_version: FIXTURE_RULE_VERSION,
    eligible_submission_count: ctx.cohort.eligible,
    answered_response_count: ctx.cohort.answered,
    missing_response_count: ctx.missing,
    is_suppressed: ctx.cohort.suppressed,
    adverse_response_count: ctx.cohort.suppressed ? null : ctx.cohort.adverse,
    adverse_response_rate: ctx.rate,
    signal_level: signalLevelOf(ctx),
  };
  return rowFor(spec, values);
}

function buildSections(tenant: DashboardTenant): Record<DashboardSection, readonly DashboardRow[]> {
  const cohortRows = cohortContexts(tenant);
  const categoryRows = categoryContexts(tenant);
  const sections = {} as Record<DashboardSection, readonly DashboardRow[]>;
  for (const section of DASHBOARD_SECTIONS) {
    const spec = exportSpecFor(section);
    switch (section) {
      case 'indicator_analysis':
        sections[section] = cohortRows.map((ctx) => indicatorRow(spec, ctx));
        break;
      case 'category_analysis':
        sections[section] = categoryRows.map((ctx) => categoryRow(spec, ctx));
        break;
      case 'change_drivers':
        sections[section] = cohortRows.map((ctx) => changeDriverRow(spec, ctx));
        break;
      case 'question_response_distribution':
        sections[section] = cohortRows.flatMap((ctx) => distributionRows(spec, ctx));
        break;
      case 'support_signal_summary':
        sections[section] = cohortRows.map((ctx) => supportSignalRow(spec, ctx));
        break;
    }
  }
  return sections;
}

function buildFilters(tenant: DashboardTenant): TenantDashboardFilters {
  const schools = FIXTURE_SCHOOLS[tenant]
    .map((school) => ({ code: school.id, label: school.classification }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const categories = FIXTURE_CATEGORY_CODES.map((code) => ({ code, label: categoryLabelFor(code) })).sort((a, b) =>
    a.code.localeCompare(b.code),
  );
  const questions = [...FIXTURE_QUESTIONS]
    .map((question) => ({
      code: question.code,
      label: question.indicator_label,
      interpretation_note: question.interpretation_note,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
  return {
    periods: [...FIXTURE_PERIODS],
    schools,
    categories,
    questions,
  };
}

function buildFreshness(tenant: DashboardTenant): TenantFreshness {
  return {
    trust_id: tenant,
    last_loaded_at: '2026-09-01T10:00:00Z',
    latest_source_updated_at: '2019-04-19T23:33:31Z',
    logical_event_count: 1234,
  };
}

export function buildFixtureDashboard(tenant: DashboardTenant): TenantDashboard {
  const sections = buildSections(tenant);
  return {
    schema_version: DASHBOARD_SCHEMA_VERSION,
    tenant,
    run_id: FIXTURE_RUN_ID,
    freshness: buildFreshness(tenant),
    filters: buildFilters(tenant),
    indicator_analysis: sections.indicator_analysis,
    category_analysis: sections.category_analysis,
    change_drivers: sections.change_drivers,
    question_response_distribution: sections.question_response_distribution,
    support_signal_summary: sections.support_signal_summary,
  };
}

export function writeFixtureExports(exportRoot: string, documents: readonly TenantDashboard[]): void {
  const tenants: Record<string, string> = {};
  for (const document of documents) {
    const pointer = `run_id=${document.run_id}/tenant=${document.tenant}`;
    tenants[document.tenant] = pointer;
    const directory = join(exportRoot, `run_id=${document.run_id}`, `tenant=${document.tenant}`);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'dashboard.json'), `${JSON.stringify(document, null, 2)}\n`);
  }
  const current = {
    run_id: FIXTURE_RUN_ID,
    published_at: '2026-09-01T10:00:00.000Z',
    tenants,
  };
  writeFileSync(join(exportRoot, 'current.json'), `${JSON.stringify(current, null, 2)}\n`);
}
