import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildFixtureDashboard } from '../../../src/dashboard/testing/dashboardFixture.ts';
import { resolveSelection } from '../../../src/dashboard/selection.ts';
import { buildDashboardView, type DashboardDriverRow } from '../../../src/dashboard/viewModel.ts';
import { formatRate } from '../lib/format.ts';
import {
  NON_DIAGNOSTIC_NOTICE,
  DistributionChart,
  DriversTable,
  SignalsTable,
} from './EvidencePanels';

function buildDefaultView() {
  const document = buildFixtureDashboard('trust_north');
  return buildDashboardView(document, resolveSelection(document, {}));
}

function extractRow(html: string, school: string): string {
  const rows = html.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
  const row = rows.find((candidate) => candidate.includes(school));
  expect(row).toBeDefined();
  return row ?? '';
}

describe('fixture view', () => {
  it('selects feel_angry in emotional_wellbeing for 2019-spring', () => {
    const view = buildDefaultView();
    expect(view.selection).toEqual({
      category: 'emotional_wellbeing',
      question: 'feel_angry',
      period: '2019-spring',
      school: null,
    });
  });
});

describe('DriversTable', () => {
  it('shows an em dash for a null contribution and Suppressed for a null rate', () => {
    const rows: DashboardDriverRow[] = [
      {
        school: 'school_n01',
        question: 'feel_angry',
        label: 'Feeling angry',
        rate: null,
        indicatorChangePp: 0.02,
        contributionPp: null,
        rank: 1,
        suppressed: false,
      },
    ];
    const html = renderToStaticMarkup(
      <DriversTable rows={rows} categoryLabel="Emotional wellbeing" />,
    );
    expect(html).toContain('Drivers for Emotional wellbeing');
    expect(html).toContain('<th scope="col">School</th>');
    expect(html).toContain('<th scope="col">Question</th>');
    expect(html).toContain('<th scope="col">Rate</th>');
    expect(html).toContain('<th scope="col">Indicator change</th>');
    expect(html).toContain('<th scope="col">Contribution</th>');
    expect(html).toContain('<th scope="col">Rank</th>');
    expect(html).toContain('<td>Suppressed</td>');
    expect(html).toContain('<td>\u2014</td>');
    expect(html).toContain('<td>+0.02 pp</td>');
  });
});

describe('DistributionChart', () => {
  it('renders only the suppression notice when the distribution is suppressed', () => {
    const document = buildFixtureDashboard('trust_north');
    const view = buildDashboardView(
      document,
      resolveSelection(document, { school: 'school_n02' }),
    );
    const html = renderToStaticMarkup(
      <DistributionChart distribution={view.distribution} indicatorLabel={view.indicator.label} />,
    );
    expect(view.distribution.suppressed).toBe(true);
    expect(html).toContain(
      'This distribution is suppressed because fewer than 10 pupils answered.',
    );
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<rect');
  });

  it('renders one rect per answer for the default view', () => {
    const view = buildDefaultView();
    const html = renderToStaticMarkup(
      <DistributionChart distribution={view.distribution} indicatorLabel={view.indicator.label} />,
    );
    expect(view.distribution.suppressed).toBe(false);
    expect(view.distribution.school).toBe('school_n01');
    expect(html).toContain('role="img"');
    expect(html).toContain(`<title>${view.indicator.label}</title>`);
    expect(html).toContain('viewBox="0 0 544 ');
    expect(html).toContain(`${view.indicator.label} · school_n01`);
    const rects = html.match(/<rect/g) ?? [];
    expect(rects).toHaveLength(view.distribution.answers.length);
    for (const answer of view.distribution.answers) {
      expect(html).toContain(`${answer.label}: ${formatRate(answer.rate)}`);
    }
  });

  it('names school_n02 when it is selected in a non-suppressed period', () => {
    const document = buildFixtureDashboard('trust_north');
    const period = document.filters.periods.find((candidate) => {
      const candidateView = buildDashboardView(
        document,
        resolveSelection(document, { school: 'school_n02', period: candidate }),
      );
      return !candidateView.distribution.suppressed;
    });
    expect(period).toBeDefined();
    const view = buildDashboardView(
      document,
      resolveSelection(document, { school: 'school_n02', period: period! }),
    );
    const html = renderToStaticMarkup(
      <DistributionChart distribution={view.distribution} indicatorLabel={view.indicator.label} />,
    );
    expect(view.distribution.suppressed).toBe(false);
    expect(view.distribution.school).toBe('school_n02');
    expect(html).toContain(`${view.indicator.label} · school_n02`);
  });

  it('scales a rate of 0.5 to a 136-unit bar at one unit per pixel', () => {
    const html = renderToStaticMarkup(
      <DistributionChart
        distribution={{
          school: 'school_n01',
          suppressed: false,
          answers: [{ label: 'No', order: 1, count: 50, rate: 0.5 }],
        }}
        indicatorLabel="Feeling angry"
      />,
    );
    expect(html).toContain('viewBox="0 0 544 ');
    expect(html).toContain('width="136"');
  });
});

describe('SignalsTable', () => {
  it("shows 'Suppressed' for school_n02 and never shows a level for a suppressed row", () => {
    const view = buildDefaultView();
    const suppressedRow = view.signals.find((row) => row.school === 'school_n02');
    expect(suppressedRow).toBeDefined();
    expect(suppressedRow?.suppressed).toBe(true);
    expect(suppressedRow?.level).toBeNull();
    const html = renderToStaticMarkup(<SignalsTable rows={view.signals} />);
    const rowHtml = extractRow(html, 'school_n02');
    expect(rowHtml).toContain('<td>Suppressed</td>');
    expect(rowHtml).not.toContain('Elevated');
    expect(rowHtml).not.toContain('Watch');
    expect(rowHtml).not.toContain('Lower');
  });

  it('always renders the non-diagnostic notice, with or without rows', () => {
    const view = buildDefaultView();
    const htmlWithRows = renderToStaticMarkup(<SignalsTable rows={view.signals} />);
    const htmlWithoutRows = renderToStaticMarkup(<SignalsTable rows={[]} />);
    const escapedNotice = NON_DIAGNOSTIC_NOTICE.replace(/'/g, '&#x27;');
    expect(htmlWithRows).toContain(escapedNotice);
    expect(htmlWithoutRows).toContain(escapedNotice);
  });

  it('uses scope="col" headers', () => {
    const view = buildDefaultView();
    const html = renderToStaticMarkup(<SignalsTable rows={view.signals} />);
    expect(html).toContain('<th scope="col">School</th>');
    expect(html).toContain('<th scope="col">Rate</th>');
    expect(html).toContain('<th scope="col">Signal</th>');
  });
});
