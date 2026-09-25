import type { DashboardRow, TenantDashboard } from '../publication/dashboardJson.ts';
import type { DashboardSelection } from './selection.ts';

export interface DashboardOptionSchool {
  code: string;
  label: string;
}

export interface DashboardOptionCategory {
  code: string;
  label: string;
}

export interface DashboardOptionQuestion {
  code: string;
  label: string;
  category: string;
}

export interface DashboardViewOptions {
  schools: DashboardOptionSchool[];
  categories: DashboardOptionCategory[];
  questions: DashboardOptionQuestion[];
  periods: string[];
}

export interface DashboardIndicator {
  code: string;
  label: string;
  categoryLabel: string;
  interpretationNote: string;
}

export interface DashboardFreshness {
  lastLoadedAt: string | null;
  latestSourceUpdatedAt: string | null;
  logicalEventCount: number | null;
}

export interface DashboardLargestTrustGap {
  school: string;
  gapPp: number;
}

export interface DashboardHeadline {
  schoolsWorsening: number;
  largestTrustGap: DashboardLargestTrustGap | null;
  answeredResponses: number;
  suppressedCohorts: number;
  limitedCohorts: number;
}

export interface DashboardTrendSeries {
  school: string;
  label: string;
  rates: (number | null)[];
}

export interface DashboardTrend {
  periods: string[];
  benchmark: (number | null)[];
  series: DashboardTrendSeries[];
}

export interface DashboardRankingRow {
  school: string;
  classification: string;
  rate: number | null;
  changePp: number | null;
  trustGapPp: number | null;
  movement: string;
  coverage: string;
  suppressed: boolean;
}

export interface DashboardCategoryRow {
  school: string;
  classification: string;
  rate: number | null;
  changePp: number | null;
  trustGapPp: number | null;
  missingRate: number | null;
  suppressed: boolean;
}

export interface DashboardDriverRow {
  school: string;
  question: string;
  label: string;
  rate: number | null;
  indicatorChangePp: number | null;
  contributionPp: number | null;
  rank: number | null;
  suppressed: boolean;
}

export interface DashboardDistributionAnswer {
  label: string;
  order: number | null;
  count: number | null;
  rate: number | null;
}

export interface DashboardDistribution {
  school: string;
  suppressed: boolean;
  answers: DashboardDistributionAnswer[];
}

export interface DashboardSignalRow {
  school: string;
  classification: string;
  rate: number | null;
  level: string | null;
  suppressed: boolean;
}

export interface DashboardView {
  tenant: string;
  runId: string;
  selection: DashboardSelection;
  options: DashboardViewOptions;
  indicator: DashboardIndicator;
  freshness: DashboardFreshness | null;
  headline: DashboardHeadline;
  trend: DashboardTrend;
  ranking: DashboardRankingRow[];
  categoryRows: DashboardCategoryRow[];
  drivers: DashboardDriverRow[];
  distribution: DashboardDistribution;
  signals: DashboardSignalRow[];
}

function num(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function indicatorRowsFor(
  document: TenantDashboard,
  question: string,
  period: string,
): readonly DashboardRow[] {
  return document.indicator_analysis.filter(
    (row) => str(row.question_code) === question && str(row.survey_period) === period,
  );
}

function buildOptions(document: TenantDashboard): DashboardViewOptions {
  const categoryByQuestion = new Map<string, string>();
  for (const row of document.indicator_analysis) {
    const code = str(row.question_code);
    const category = str(row.category_code);
    if (code !== '' && category !== '' && !categoryByQuestion.has(code)) {
      categoryByQuestion.set(code, category);
    }
  }
  return {
    schools: document.filters.schools.map((school) => ({ code: school.code, label: school.label })),
    categories: document.filters.categories.map((category) => ({ code: category.code, label: category.label })),
    questions: document.filters.questions.map((question) => ({
      code: question.code,
      label: question.label,
      category: categoryByQuestion.get(question.code) ?? '',
    })),
    periods: [...document.filters.periods],
  };
}

function buildIndicator(document: TenantDashboard, selection: DashboardSelection): DashboardIndicator {
  const row = document.indicator_analysis.find((candidate) => str(candidate.question_code) === selection.question);
  if (row !== undefined) {
    return {
      code: selection.question,
      label: str(row.indicator_label),
      categoryLabel: str(row.category_label),
      interpretationNote: str(row.interpretation_note),
    };
  }
  const question = document.filters.questions.find((candidate) => candidate.code === selection.question);
  return {
    code: selection.question,
    label: question?.label ?? '',
    categoryLabel: '',
    interpretationNote: question?.interpretation_note ?? '',
  };
}

function buildFreshness(document: TenantDashboard): DashboardFreshness | null {
  const freshness = document.freshness;
  if (freshness === null) {
    return null;
  }
  return {
    lastLoadedAt: freshness.last_loaded_at,
    latestSourceUpdatedAt: freshness.latest_source_updated_at,
    logicalEventCount: freshness.logical_event_count,
  };
}

function buildHeadline(document: TenantDashboard, selection: DashboardSelection): DashboardHeadline {
  let schoolsWorsening = 0;
  let largestTrustGap: DashboardLargestTrustGap | null = null;
  let answeredResponses = 0;
  let suppressedCohorts = 0;
  let limitedCohorts = 0;
  for (const row of indicatorRowsFor(document, selection.question, selection.period)) {
    if (str(row.movement_status) === 'worsening') {
      schoolsWorsening += 1;
    }
    const gap = num(row.trust_gap_pp);
    if (gap !== null && (largestTrustGap === null || gap > largestTrustGap.gapPp)) {
      largestTrustGap = { school: str(row.school_id), gapPp: gap };
    }
    answeredResponses += num(row.answered_response_count) ?? 0;
    if (row.is_suppressed === true) {
      suppressedCohorts += 1;
    }
    if (str(row.coverage_status) === 'limited') {
      limitedCohorts += 1;
    }
  }
  return { schoolsWorsening, largestTrustGap, answeredResponses, suppressedCohorts, limitedCohorts };
}

function buildTrend(document: TenantDashboard, selection: DashboardSelection): DashboardTrend {
  const periods = [...document.filters.periods];
  const questionRows = document.indicator_analysis.filter((row) => str(row.question_code) === selection.question);
  const schools =
    selection.school === null
      ? document.filters.schools
      : document.filters.schools.filter((school) => school.code === selection.school);
  const series = schools.map((school) => ({
    school: school.code,
    label: school.label,
    rates: periods.map((period) => {
      const row = questionRows.find(
        (candidate) => str(candidate.school_id) === school.code && str(candidate.survey_period) === period,
      );
      return row === undefined ? null : num(row.adverse_response_rate);
    }),
  }));
  const benchmark = periods.map((period) => {
    for (const row of questionRows) {
      if (str(row.survey_period) === period) {
        const rate = num(row.trust_adverse_response_rate);
        if (rate !== null) {
          return rate;
        }
      }
    }
    return null;
  });
  return { periods, benchmark, series };
}

function compareRanking(a: DashboardRankingRow, b: DashboardRankingRow): number {
  if (a.changePp === null || b.changePp === null) {
    if (a.changePp === b.changePp) {
      return a.school.localeCompare(b.school);
    }
    return a.changePp === null ? 1 : -1;
  }
  return b.changePp - a.changePp || a.school.localeCompare(b.school);
}

function buildRanking(document: TenantDashboard, selection: DashboardSelection): DashboardRankingRow[] {
  return indicatorRowsFor(document, selection.question, selection.period)
    .map((row) => ({
      school: str(row.school_id),
      classification: str(row.school_classification),
      rate: num(row.adverse_response_rate),
      changePp: num(row.period_change_pp),
      trustGapPp: num(row.trust_gap_pp),
      movement: str(row.movement_status),
      coverage: str(row.coverage_status),
      suppressed: row.is_suppressed === true,
    }))
    .sort(compareRanking);
}

function buildCategoryRows(document: TenantDashboard, selection: DashboardSelection): DashboardCategoryRow[] {
  return document.category_analysis
    .filter(
      (row) => str(row.category_code) === selection.category && str(row.survey_period) === selection.period,
    )
    .map((row) => ({
      school: str(row.school_id),
      classification: str(row.school_classification),
      rate: num(row.adverse_question_response_rate),
      changePp: num(row.period_change_pp),
      trustGapPp: num(row.trust_gap_pp),
      missingRate: num(row.missing_question_response_rate),
      suppressed: row.is_suppressed === true,
    }))
    .sort((a, b) => a.school.localeCompare(b.school));
}

function compareDrivers(a: DashboardDriverRow, b: DashboardDriverRow): number {
  if (a.rank === null || b.rank === null) {
    if (a.rank === b.rank) {
      return a.school.localeCompare(b.school);
    }
    return a.rank === null ? 1 : -1;
  }
  return a.rank - b.rank || a.school.localeCompare(b.school);
}

function buildDrivers(document: TenantDashboard, selection: DashboardSelection): DashboardDriverRow[] {
  return document.change_drivers
    .filter(
      (row) =>
        str(row.category_code) === selection.category &&
        str(row.survey_period) === selection.period &&
        (selection.school === null || str(row.school_id) === selection.school),
    )
    .map((row) => ({
      school: str(row.school_id),
      question: str(row.question_code),
      label: str(row.indicator_label),
      rate: num(row.adverse_response_rate),
      indicatorChangePp: num(row.indicator_change_pp),
      contributionPp: num(row.category_change_contribution_pp),
      rank: num(row.driver_rank),
      suppressed: row.is_suppressed === true,
    }))
    .sort(compareDrivers);
}

function compareAnswers(a: DashboardDistributionAnswer, b: DashboardDistributionAnswer): number {
  if (a.order === null || b.order === null) {
    if (a.order === b.order) {
      return 0;
    }
    return a.order === null ? 1 : -1;
  }
  return a.order - b.order;
}

function buildDistribution(document: TenantDashboard, selection: DashboardSelection): DashboardDistribution {
  const school = selection.school ?? document.filters.schools[0]?.code ?? '';
  const rows = document.question_response_distribution.filter(
    (row) =>
      str(row.question_code) === selection.question &&
      str(row.survey_period) === selection.period &&
      str(row.school_id) === school,
  );
  const answers = rows
    .map((row) => ({
      label: str(row.answer_label),
      order: num(row.answer_order),
      count: num(row.response_count),
      rate: num(row.response_rate),
    }))
    .sort(compareAnswers);
  return { school, suppressed: rows.some((row) => row.is_suppressed === true), answers };
}

function buildSignals(document: TenantDashboard, selection: DashboardSelection): DashboardSignalRow[] {
  return document.support_signal_summary
    .filter(
      (row) => str(row.question_code) === selection.question && str(row.survey_period) === selection.period,
    )
    .map((row) => {
      const suppressed = row.is_suppressed === true;
      return {
        school: str(row.school_id),
        classification: str(row.school_classification),
        rate: num(row.adverse_response_rate),
        level: suppressed ? null : str(row.signal_level),
        suppressed,
      };
    })
    .sort((a, b) => a.school.localeCompare(b.school));
}

export function buildDashboardView(document: TenantDashboard, selection: DashboardSelection): DashboardView {
  return {
    tenant: document.tenant,
    runId: document.run_id,
    selection: { ...selection },
    options: buildOptions(document),
    indicator: buildIndicator(document, selection),
    freshness: buildFreshness(document),
    headline: buildHeadline(document, selection),
    trend: buildTrend(document, selection),
    ranking: buildRanking(document, selection),
    categoryRows: buildCategoryRows(document, selection),
    drivers: buildDrivers(document, selection),
    distribution: buildDistribution(document, selection),
    signals: buildSignals(document, selection),
  };
}
