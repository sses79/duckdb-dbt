import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { resolveSelection } from '../../../src/dashboard/selection.ts';
import { buildFixtureDashboard } from '../../../src/dashboard/testing/dashboardFixture.ts';
import { buildDashboardView, type DashboardTrend } from '../../../src/dashboard/viewModel.ts';
import { formatRate } from '../lib/format.ts';
import { TrendChart } from './TrendChart';

function tagCount(markup: string, tag: string): number {
  return (markup.match(new RegExp(`<${tag} `, 'g')) ?? []).length;
}

describe('TrendChart', () => {
  it('draws no path and exactly two circles when no run of points has two points', () => {
    const trend: DashboardTrend = {
      periods: ['2018-autumn', '2019-spring', '2019-summer'],
      benchmark: [null, null, null],
      series: [{ school: 'school_n01', label: 'School One', rates: [0.1, null, 0.3] }],
    };

    const markup = renderToStaticMarkup(
      <TrendChart trend={trend} indicatorLabel="Feeling angry" />,
    );

    expect(tagCount(markup, 'circle')).toBe(2);
    expect(tagCount(markup, 'path')).toBe(0);
  });

  it('renders one circle per non-null rate from the trust_north view and none for school_n02 in 2019-spring', () => {
    const document = buildFixtureDashboard('trust_north');
    const selection = resolveSelection(document, {});
    const view = buildDashboardView(document, selection);

    expect(selection.category).toBe('emotional_wellbeing');
    expect(selection.question).toBe('feel_angry');
    expect(selection.period).toBe('2019-spring');

    const expectedCircles = view.trend.series.reduce(
      (total, series) => total + series.rates.filter((rate) => rate !== null).length,
      0,
    );
    const markup = renderToStaticMarkup(
      <TrendChart trend={view.trend} indicatorLabel={view.indicator.label} />,
    );

    expect(tagCount(markup, 'circle')).toBe(expectedCircles);

    const suppressedSeries = view.trend.series.find((series) => series.school === 'school_n02');
    const springIndex = view.trend.periods.indexOf('2019-spring');
    expect(suppressedSeries).toBeDefined();
    expect(suppressedSeries?.rates[springIndex]).toBeNull();
  });

  it('shows Suppressed and formatted rates in the text alternative and dashes the benchmark', () => {
    const document = buildFixtureDashboard('trust_north');
    const view = buildDashboardView(document, resolveSelection(document, {}));
    const markup = renderToStaticMarkup(
      <TrendChart trend={view.trend} indicatorLabel={view.indicator.label} />,
    );

    expect(markup).toContain('Suppressed');
    for (const series of view.trend.series) {
      for (const rate of series.rates) {
        expect(markup).toContain(formatRate(rate));
      }
    }
    expect(markup).toContain('stroke-dasharray');
  });

  it('marks the chart as an image with a title naming the indicator', () => {
    const document = buildFixtureDashboard('trust_north');
    const view = buildDashboardView(document, resolveSelection(document, {}));
    const markup = renderToStaticMarkup(
      <TrendChart trend={view.trend} indicatorLabel={view.indicator.label} />,
    );

    expect(markup).toContain('role="img"');
    expect(markup).toContain(`<title id="dash-trend-chart-title">${view.indicator.label}</title>`);
  });
});
