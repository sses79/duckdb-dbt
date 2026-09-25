import { DashboardRequestError } from './request.ts';
import type { DashboardQuery } from './request.ts';
import { selectDashboard } from './reader.ts';
import type { TenantDashboard } from '../publication/dashboardJson.ts';

export interface DashboardSelection {
  category: string;
  question: string;
  period: string;
  school: string | null;
}

function categoryOfQuestion(document: TenantDashboard, questionCode: string): string {
  const row = document.indicator_analysis.find((candidate) => candidate.question_code === questionCode);
  if (row === undefined || typeof row.category_code !== 'string') {
    throw new DashboardRequestError(`Question ${questionCode} has no category in the dashboard document`);
  }
  return row.category_code;
}

function firstCategory(document: TenantDashboard): string {
  const entry = document.filters.categories[0];
  if (entry === undefined) {
    throw new DashboardRequestError('Dashboard has no category filters');
  }
  return entry.code;
}

function firstQuestionForCategory(document: TenantDashboard, category: string): string {
  const entry = document.filters.questions.find(
    (candidate) => categoryOfQuestion(document, candidate.code) === category,
  );
  if (entry === undefined) {
    throw new DashboardRequestError(`No question available for category ${category}`);
  }
  return entry.code;
}

function lastPeriod(document: TenantDashboard): string {
  const period = document.filters.periods[document.filters.periods.length - 1];
  if (period === undefined) {
    throw new DashboardRequestError('Dashboard has no period filters');
  }
  return period;
}

export function resolveSelection(document: TenantDashboard, query: DashboardQuery): DashboardSelection {
  selectDashboard(document, query);

  const questionCategory = query.question === undefined ? undefined : categoryOfQuestion(document, query.question);
  if (query.question !== undefined && query.category !== undefined && questionCategory !== query.category) {
    throw new DashboardRequestError(
      `Question ${query.question} does not belong to category ${query.category}`,
    );
  }

  const category =
    query.category ?? (query.question === undefined ? firstCategory(document) : questionCategory!);
  const question = query.question ?? firstQuestionForCategory(document, category);
  const period = query.period ?? lastPeriod(document);

  return {
    category,
    question,
    period,
    school: query.school ?? null,
  };
}
