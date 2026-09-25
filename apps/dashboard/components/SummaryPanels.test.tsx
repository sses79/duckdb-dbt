import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { resolveSelection } from '../../../src/dashboard/selection.ts';
import { buildFixtureDashboard } from '../../../src/dashboard/testing/dashboardFixture.ts';
import { buildDashboardView } from '../../../src/dashboard/viewModel.ts';
import type { DashboardHeadline } from '../../../src/dashboard/viewModel.ts';
import { CategoryTable, HeadlineCards, RankingTable } from './SummaryPanels.tsx';

function schoolRow(html: string, school: string): string {
  const row = html.split('<tr').find((fragment) => fragment.includes(school));
  if (row === undefined) {
    throw new Error(`No table row found for ${school}`);
  }
  return row;
}

describe('SummaryPanels', () => {
  const document = buildFixtureDashboard('trust_north');
  const view = buildDashboardView(document, resolveSelection(document, {}));

  it('builds the expected fixture view', () => {
    expect(view.selection.question).toBe('feel_angry');
    expect(view.selection.period).toBe('2019-spring');
    const suppressed = view.ranking.find((row) => row.school === 'school_n02');
    expect(suppressed?.suppressed).toBe(true);
  });

  it('renders headline cards and the descriptive note', () => {
    const html = renderToStaticMarkup(
      <HeadlineCards headline={view.headline} indicatorLabel={view.indicator.label} />,
    );
    expect(html).toContain('Schools worsening');
    expect(html).toContain('Largest trust gap');
    expect(html).toContain('Answered responses');
    expect(html).toContain('Suppressed or limited cohorts');
    expect(html).toContain('not a significance test');
  });

  it("shows 'None' for a missing largest trust gap", () => {
    const headline: DashboardHeadline = { ...view.headline, largestTrustGap: null };
    const html = renderToStaticMarkup(<HeadlineCards headline={headline} indicatorLabel="Indicator" />);
    expect(html).toContain('None');
  });

  it('marks suppressed ranking rows without fabricating figures', () => {
    const html = renderToStaticMarkup(<RankingTable rows={view.ranking} />);
    const row = schoolRow(html, 'school_n02');
    expect(row).toContain('Suppressed');
    expect(row).toContain('\u2014');
    expect(row).not.toContain('0.0%');
    expect(row).not.toContain('0.00');
  });

  it('marks suppressed category rows without fabricating a rate', () => {
    const html = renderToStaticMarkup(
      <CategoryTable rows={view.categoryRows} categoryLabel={view.indicator.categoryLabel} />,
    );
    const row = schoolRow(html, 'school_n02');
    expect(row).toContain('Suppressed');
  });

  it('gives every table a caption and column headers', () => {
    const ranking = renderToStaticMarkup(<RankingTable rows={view.ranking} />);
    const category = renderToStaticMarkup(
      <CategoryTable rows={view.categoryRows} categoryLabel={view.indicator.categoryLabel} />,
    );
    for (const html of [ranking, category]) {
      expect(html).toMatch(/<caption/);
      expect(html).toMatch(/<th scope="col">/);
    }
  });
});
