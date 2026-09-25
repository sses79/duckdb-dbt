import { describe, expect, it } from 'vitest';

import { buildFixtureDashboard } from './testing/dashboardFixture.ts';
import { DashboardReaderError } from './reader.ts';
import { DashboardRequestError } from './request.ts';
import type { DashboardQuery } from './request.ts';
import { resolveSelection } from './selection.ts';
import type { DashboardSelection } from './selection.ts';
import type { TenantDashboard } from '../publication/dashboardJson.ts';

function firstQuestionInCategory(document: TenantDashboard, category: string): string {
  const entry = document.filters.questions.find((candidate) =>
    document.indicator_analysis.some(
      (row) => row.question_code === candidate.code && row.category_code === category,
    ),
  );
  if (entry === undefined) {
    throw new Error(`No fixture question in category ${category}`);
  }
  return entry.code;
}

describe('resolveSelection', () => {
  const document = buildFixtureDashboard('trust_north');

  it('fills every default from the document', () => {
    expect(resolveSelection(document, {})).toEqual({
      category: 'emotional_wellbeing',
      question: firstQuestionInCategory(document, 'emotional_wellbeing'),
      period: '2019-spring',
      school: null,
    } satisfies DashboardSelection);
  });

  it('derives the category from a given question', () => {
    const selection = resolveSelection(document, { question: 'bullying_frequency' });
    expect(selection.category).toBe('relationships');
  });

  it('derives the question from a given category', () => {
    const selection = resolveSelection(document, { category: 'relationships' });
    expect(selection.question).toBe('bullying_frequency');
  });

  it('refuses a question that does not fit the category', () => {
    expect(() => resolveSelection(document, { category: 'relationships', question: 'feel_sad' })).toThrow(
      DashboardRequestError,
    );
  });

  const readerErrorCases: ReadonlyArray<{ name: string; query: DashboardQuery }> = [
    { name: 'an unknown school', query: { school: 'school_s01' } },
    { name: 'an unknown period', query: { period: '2017-summer' } },
    { name: 'an unknown question', query: { question: 'unknown' } },
  ];

  it.each(readerErrorCases)('refuses $name', ({ query }) => {
    expect(() => resolveSelection(document, query)).toThrow(DashboardReaderError);
  });

  it('keeps a given school and period', () => {
    const selection = resolveSelection(document, { school: 'school_n02', period: '2018-autumn' });
    expect(selection.school).toBe('school_n02');
    expect(selection.period).toBe('2018-autumn');
  });
});
