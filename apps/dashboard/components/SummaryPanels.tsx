import type { DashboardCategoryRow, DashboardHeadline, DashboardRankingRow } from '../../../src/dashboard/viewModel.ts';
import { formatCount, formatPp, formatRate } from '../lib/format.ts';

const EM_DASH = '\u2014';

const WORSENING_NOTE =
  'Worsening means the adverse-response rate rose by at least 1 percentage point. ' +
  'It is a descriptive rule, not a significance test.';

function formatMovement(value: string): string {
  if (value === 'worsening') {
    return 'Worsening';
  }
  if (value === 'improving') {
    return 'Improving';
  }
  if (value === 'stable') {
    return 'Stable';
  }
  return 'No comparison';
}

function formatCoverage(value: string): string {
  if (value === 'limited') {
    return 'Limited';
  }
  if (value === 'suppressed') {
    return 'Suppressed';
  }
  return 'Adequate';
}

function schoolCell(school: string, classification: string) {
  return (
    <td className="dash-school-cell">
      <span className="dash-school-code">{school}</span>
      <span className="dash-school-classification">{classification}</span>
    </td>
  );
}

export function HeadlineCards({
  headline,
  indicatorLabel,
}: {
  headline: DashboardHeadline;
  indicatorLabel: string;
}) {
  const largestTrustGap =
    headline.largestTrustGap === null
      ? 'None'
      : `${formatPp(headline.largestTrustGap.gapPp)} \u00b7 ${headline.largestTrustGap.school}`;

  const cards = [
    { key: 'schools-worsening', label: 'Schools worsening', value: String(headline.schoolsWorsening) },
    { key: 'largest-trust-gap', label: 'Largest trust gap', value: largestTrustGap },
    { key: 'answered-responses', label: 'Answered responses', value: formatCount(headline.answeredResponses) },
    {
      key: 'suppressed-or-limited-cohorts',
      label: 'Suppressed or limited cohorts',
      value: String(headline.suppressedCohorts + headline.limitedCohorts),
    },
  ];

  return (
    <section className="dash-headline-panels" aria-label={indicatorLabel}>
      <ul className="dash-headline-cards">
        {cards.map((card) => (
          <li className="dash-headline-card" key={card.key}>
            <span className="dash-headline-card-label">{card.label}</span>
            <span className="dash-headline-card-value">{card.value}</span>
          </li>
        ))}
      </ul>
      <p className="dash-headline-note">{WORSENING_NOTE}</p>
    </section>
  );
}

export function RankingTable({ rows }: { rows: DashboardRankingRow[] }) {
  return (
    <table className="dash-table dash-ranking-table">
      <caption className="dash-table-caption">School ranking</caption>
      <thead>
        <tr>
          <th scope="col">School</th>
          <th scope="col">Rate</th>
          <th scope="col">Change</th>
          <th scope="col">Trust gap</th>
          <th scope="col">Movement</th>
          <th scope="col">Coverage</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr className="dash-ranking-row" key={row.school}>
            {schoolCell(row.school, row.classification)}
            <td className="dash-number-cell">{row.suppressed ? 'Suppressed' : formatRate(row.rate)}</td>
            <td className="dash-number-cell">{row.suppressed ? EM_DASH : formatPp(row.changePp)}</td>
            <td className="dash-number-cell">{row.suppressed ? EM_DASH : formatPp(row.trustGapPp)}</td>
            <td>{formatMovement(row.movement)}</td>
            <td>{formatCoverage(row.coverage)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CategoryTable({ rows, categoryLabel }: { rows: DashboardCategoryRow[]; categoryLabel: string }) {
  return (
    <table className="dash-table dash-category-table">
      <caption className="dash-table-caption">{categoryLabel}</caption>
      <thead>
        <tr>
          <th scope="col">School</th>
          <th scope="col">Rate</th>
          <th scope="col">Change</th>
          <th scope="col">Trust gap</th>
          <th scope="col">Missing</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr className="dash-category-row" key={row.school}>
            {schoolCell(row.school, row.classification)}
            <td className="dash-number-cell">{row.suppressed ? 'Suppressed' : formatRate(row.rate)}</td>
            <td className="dash-number-cell">{row.suppressed ? EM_DASH : formatPp(row.changePp)}</td>
            <td className="dash-number-cell">{row.suppressed ? EM_DASH : formatPp(row.trustGapPp)}</td>
            <td className="dash-number-cell">{row.suppressed ? 'Suppressed' : formatRate(row.missingRate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
