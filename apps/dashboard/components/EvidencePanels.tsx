import type {
  DashboardDistribution,
  DashboardDriverRow,
  DashboardSignalRow,
} from '../../../src/dashboard/viewModel.ts';
import { formatPp, formatRate } from '../lib/format.ts';

export const NON_DIAGNOSTIC_NOTICE =
  "These signals summarise aggregate survey answers. They do not identify a condition, determine any individual pupil's need, or replace safeguarding and professional judgement.";

const BAR_MAX_WIDTH = 272;
const BAR_HEIGHT = 14;
const BAR_GAP = 6;
const SVG_WIDTH = 544;

export function DriversTable({
  rows,
  categoryLabel,
}: {
  rows: DashboardDriverRow[];
  categoryLabel: string;
}) {
  return (
    <table className="dash-table">
      <caption>Drivers for {categoryLabel}</caption>
      <thead>
        <tr>
          <th scope="col">School</th>
          <th scope="col">Question</th>
          <th scope="col">Rate</th>
          <th scope="col">Indicator change</th>
          <th scope="col">Contribution</th>
          <th scope="col">Rank</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.school}-${row.question}`}>
            <td>{row.school}</td>
            <td>{row.label}</td>
            <td>{formatRate(row.rate)}</td>
            <td>{formatPp(row.indicatorChangePp)}</td>
            <td>{formatPp(row.contributionPp)}</td>
            <td>{row.rank === null ? '\u2014' : String(row.rank)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DistributionChart({
  distribution,
  indicatorLabel,
}: {
  distribution: DashboardDistribution;
  indicatorLabel: string;
}) {
  if (distribution.suppressed) {
    return (
      <p className="dash-suppressed">
        This distribution is suppressed because fewer than 10 pupils answered.
      </p>
    );
  }
  const count = distribution.answers.length;
  const chartHeight = count === 0 ? 0 : count * (BAR_HEIGHT + BAR_GAP) - BAR_GAP;
  return (
    <figure className="dash-figure">
      <figcaption className="dash-heading">
        {indicatorLabel} · {distribution.school}
      </figcaption>
      <svg
        role="img"
        className="dash-distribution-chart"
        viewBox={`0 0 ${SVG_WIDTH} ${chartHeight}`}
      >
        <title>{indicatorLabel}</title>
        {distribution.answers.map((answer, index) => {
          const y = index * (BAR_HEIGHT + BAR_GAP);
          return (
            <g key={answer.label} className="dash-bar-group">
              <rect
                x={0}
                y={y}
                width={Math.max(0, (answer.rate ?? 0) * BAR_MAX_WIDTH)}
                height={BAR_HEIGHT}
                className="dash-bar"
              />
              <text
                x={BAR_MAX_WIDTH + 8}
                y={y + BAR_HEIGHT - 3}
                className="dash-bar-label"
              >
                {`${answer.label}: ${formatRate(answer.rate)}`}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="dash-distribution-list">
        {distribution.answers.map((answer) => (
          <li key={answer.label}>
            {answer.label}: {formatRate(answer.rate)}
          </li>
        ))}
      </ul>
    </figure>
  );
}

export function SignalsTable({ rows }: { rows: DashboardSignalRow[] }) {
  return (
    <>
      <table className="dash-table">
        <caption>Support signals</caption>
        <thead>
          <tr>
            <th scope="col">School</th>
            <th scope="col">Rate</th>
            <th scope="col">Signal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.school}>
              <td>
                {row.school}
                <span className="dash-secondary">{row.classification}</span>
              </td>
              <td>{formatRate(row.rate)}</td>
              <td>{row.level === null ? 'Suppressed' : capitalise(row.level)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="dash-notice">{NON_DIAGNOSTIC_NOTICE}</p>
    </>
  );
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
