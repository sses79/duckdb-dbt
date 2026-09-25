import { describe, expect, it } from 'vitest';

import { buildFixtureDashboard, FIXTURE_RUN_ID } from './testing/dashboardFixture.ts';
import type { DashboardSelection } from './selection.ts';
import { buildDashboardView } from './viewModel.ts';
import type { DashboardView } from './viewModel.ts';

const FEEL_SAD_2019_SPRING: DashboardSelection = {
  category: 'emotional_wellbeing',
  question: 'feel_sad',
  period: '2019-spring',
  school: null,
};

function viewFor(selection: DashboardSelection = FEEL_SAD_2019_SPRING): DashboardView {
  return buildDashboardView(buildFixtureDashboard('trust_north'), selection);
}

describe('buildDashboardView', () => {
  it('carries the tenant, run id and selection', () => {
    const view = viewFor();
    expect(view.tenant).toBe('trust_north');
    expect(view.runId).toBe(FIXTURE_RUN_ID);
    expect(view.selection).toEqual(FEEL_SAD_2019_SPRING);
  });

  it('builds options from the document filters', () => {
    const { options } = viewFor();
    expect(options.schools).toEqual([
      { code: 'school_n01', label: 'Mixed source classifications' },
      { code: 'school_n02', label: 'Primary' },
    ]);
    expect(options.categories).toEqual([
      { code: 'emotional_wellbeing', label: 'Emotional wellbeing' },
      { code: 'relationships', label: 'Relationships' },
    ]);
    expect(options.questions).toEqual([
      { code: 'bullying_frequency', label: 'Pupils who were bullied at least weekly', category: 'relationships' },
      { code: 'feel_angry', label: 'Pupils who felt angry', category: 'emotional_wellbeing' },
      { code: 'feel_sad', label: 'Pupils who felt sad', category: 'emotional_wellbeing' },
    ]);
    expect(options.periods).toEqual(['2018-autumn', '2019-spring']);
  });

  it('builds the selected indicator', () => {
    expect(viewFor().indicator).toEqual({
      code: 'feel_sad',
      label: 'Pupils who felt sad',
      categoryLabel: 'Emotional wellbeing',
      interpretationNote: 'A higher rate indicates more pupils felt sad during the survey period.',
    });
  });

  it('carries freshness values without a trust id', () => {
    expect(viewFor().freshness).toEqual({
      lastLoadedAt: '2026-09-01T10:00:00Z',
      latestSourceUpdatedAt: '2019-04-19T23:33:31Z',
      logicalEventCount: 1234,
    });
  });

  it('builds the headline across all schools for the selected question and period', () => {
    expect(viewFor().headline).toEqual({
      schoolsWorsening: 1,
      largestTrustGap: { school: 'school_n01', gapPp: 1.7 },
      answeredResponses: 106,
      suppressedCohorts: 1,
      limitedCohorts: 0,
    });
  });

  it('recomputes headline metrics for another question', () => {
    const view = viewFor({ ...FEEL_SAD_2019_SPRING, question: 'feel_angry' });
    expect(view.headline).toEqual({
      schoolsWorsening: 0,
      largestTrustGap: { school: 'school_n01', gapPp: 0.45 },
      answeredResponses: 106,
      suppressedCohorts: 1,
      limitedCohorts: 0,
    });
  });

  it('builds the trend aligned to the filter periods', () => {
    const view = viewFor();
    expect(view.trend.periods).toEqual(['2018-autumn', '2019-spring']);
    expect(view.trend.benchmark).toEqual([0.2278, 0.283]);
    expect(view.trend.series).toEqual([
      { school: 'school_n01', label: 'Mixed source classifications', rates: [0.25, 0.3] },
      { school: 'school_n02', label: 'Primary', rates: [0.2, null] },
    ]);
  });

  it('limits the trend series to the selected school', () => {
    const view = viewFor({ ...FEEL_SAD_2019_SPRING, school: 'school_n02' });
    expect(view.trend.series).toEqual([{ school: 'school_n02', label: 'Primary', rates: [0.2, null] }]);
  });

  it('ranks every school by changePp descending with nulls last', () => {
    expect(viewFor().ranking).toEqual([
      {
        school: 'school_n01',
        classification: 'Mixed source classifications',
        rate: 0.3,
        changePp: 5,
        trustGapPp: 1.7,
        movement: 'worsening',
        coverage: 'adequate',
        suppressed: false,
      },
      {
        school: 'school_n02',
        classification: 'Primary',
        rate: null,
        changePp: null,
        trustGapPp: null,
        movement: 'no_comparison',
        coverage: 'suppressed',
        suppressed: true,
      },
    ]);
  });

  it('keeps suppressed ranking values as null rather than zero', () => {
    const schoolN02 = viewFor().ranking.find((row) => row.school === 'school_n02');
    expect(schoolN02?.rate).toBeNull();
    expect(schoolN02?.changePp).toBeNull();
    expect(schoolN02?.trustGapPp).toBeNull();
  });

  it('falls back to school order when every change is null', () => {
    const view = viewFor({ ...FEEL_SAD_2019_SPRING, period: '2018-autumn' });
    expect(view.ranking.map((row) => row.school)).toEqual(['school_n01', 'school_n02']);
    expect(view.ranking[0]).toMatchObject({ rate: 0.25, changePp: null, trustGapPp: 2.22 });
  });

  it('builds category rows sorted by school', () => {
    expect(viewFor().categoryRows).toEqual([
      {
        school: 'school_n01',
        classification: 'Mixed source classifications',
        rate: 0.19,
        changePp: 0.5,
        trustGapPp: 1.08,
        missingRate: 0.1667,
        suppressed: false,
      },
      {
        school: 'school_n02',
        classification: 'Primary',
        rate: null,
        changePp: null,
        trustGapPp: null,
        missingRate: null,
        suppressed: true,
      },
    ]);
  });

  it('builds drivers sorted by rank then school', () => {
    expect(viewFor().drivers).toEqual([
      {
        school: 'school_n01',
        question: 'feel_angry',
        label: 'Pupils who felt angry',
        rate: 0.08,
        indicatorChangePp: -4,
        contributionPp: -2,
        rank: 1,
        suppressed: false,
      },
      {
        school: 'school_n02',
        question: 'feel_angry',
        label: 'Pupils who felt angry',
        rate: null,
        indicatorChangePp: null,
        contributionPp: null,
        rank: 1,
        suppressed: true,
      },
      {
        school: 'school_n01',
        question: 'feel_sad',
        label: 'Pupils who felt sad',
        rate: 0.3,
        indicatorChangePp: 5,
        contributionPp: 2.5,
        rank: 2,
        suppressed: false,
      },
      {
        school: 'school_n02',
        question: 'feel_sad',
        label: 'Pupils who felt sad',
        rate: null,
        indicatorChangePp: null,
        contributionPp: null,
        rank: 2,
        suppressed: true,
      },
    ]);
  });

  it('limits drivers to the selected school', () => {
    const view = viewFor({ ...FEEL_SAD_2019_SPRING, school: 'school_n01' });
    expect(view.drivers.map((row) => [row.school, row.question])).toEqual([
      ['school_n01', 'feel_angry'],
      ['school_n01', 'feel_sad'],
    ]);
  });

  it('builds the distribution for the selected question, period and school', () => {
    const view = viewFor({ ...FEEL_SAD_2019_SPRING, school: 'school_n01' });
    expect(view.distribution).toEqual({
      school: 'school_n01',
      suppressed: false,
      answers: [
        { label: 'Not at all', order: 1, count: 50, rate: 0.5 },
        { label: 'Several days', order: 2, count: 30, rate: 0.3 },
        { label: 'More than half the days', order: 3, count: 20, rate: 0.2 },
      ],
    });
  });

  it('defaults the distribution to the first school in the options', () => {
    const view = viewFor();
    expect(view.distribution.school).toBe('school_n01');
    expect(view.distribution.answers.map((answer) => answer.order)).toEqual([1, 2, 3]);
  });

  it('flags a suppressed distribution and keeps its counts null', () => {
    const view = viewFor({ ...FEEL_SAD_2019_SPRING, school: 'school_n02' });
    expect(view.distribution).toEqual({
      school: 'school_n02',
      suppressed: true,
      answers: [
        { label: 'Not at all', order: 1, count: null, rate: null },
        { label: 'Several days', order: 2, count: null, rate: null },
        { label: 'More than half the days', order: 3, count: null, rate: null },
      ],
    });
  });

  it('builds signals sorted by school with a null level when suppressed', () => {
    expect(viewFor().signals).toEqual([
      {
        school: 'school_n01',
        classification: 'Mixed source classifications',
        rate: 0.3,
        level: 'elevated',
        suppressed: false,
      },
      {
        school: 'school_n02',
        classification: 'Primary',
        rate: null,
        level: null,
        suppressed: true,
      },
    ]);
  });

  it('serializes without trust or row-level identifiers', () => {
    const serialized = JSON.stringify(viewFor());
    expect(serialized).not.toContain('trust_id');
    expect(serialized).not.toContain('document_id');
    expect(serialized).not.toContain('school_id');
    expect(serialized).not.toContain('event_id');
    expect(serialized).not.toContain('source_id');
  });
});
