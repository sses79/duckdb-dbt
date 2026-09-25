import type { DashboardTrend } from '../../../src/dashboard/viewModel.ts';
import { formatPeriod, formatRate } from '../lib/format.ts';

const PALETTE = ['#1d4ed8', '#ea580c', '#059669', '#dc2626', '#7c3aed', '#0e7490'];

const VIEWBOX_WIDTH = 640;
const VIEWBOX_HEIGHT = 280;
const MARGIN = { top: 16, right: 20, bottom: 40, left: 56 };
const PLOT_WIDTH = VIEWBOX_WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = VIEWBOX_HEIGHT - MARGIN.top - MARGIN.bottom;

function colourFor(index: number): string {
  return PALETTE[index % PALETTE.length]!;
}

function yMaxInTenths(trend: DashboardTrend): number {
  let largest = 0;
  for (const value of trend.benchmark) {
    if (value !== null && value > largest) {
      largest = value;
    }
  }
  for (const series of trend.series) {
    for (const value of series.rates) {
      if (value !== null && value > largest) {
        largest = value;
      }
    }
  }
  return Math.max(1, Math.ceil(largest * 10 - 1e-9));
}

function runsOf(values: readonly (number | null)[]): number[][] {
  const runs: number[][] = [];
  let current: number[] = [];
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === null) {
      if (current.length > 0) {
        runs.push(current);
        current = [];
      }
    } else {
      current.push(index);
    }
  }
  if (current.length > 0) {
    runs.push(current);
  }
  return runs;
}

function linePath(
  values: readonly (number | null)[],
  points: readonly number[],
  x: (index: number) => number,
  y: (value: number) => number,
): string {
  const parts = points.map((index) => `${x(index).toFixed(1)} ${y(values[index]!).toFixed(1)}`);
  return `M ${parts.join(' L ')}`;
}

export function TrendChart({ trend, indicatorLabel }: { trend: DashboardTrend; indicatorLabel: string }) {
  const tenths = yMaxInTenths(trend);
  const yMax = tenths / 10;
  const periods = trend.periods;
  const x = (index: number): number =>
    periods.length <= 1
      ? MARGIN.left + PLOT_WIDTH / 2
      : MARGIN.left + (index / (periods.length - 1)) * PLOT_WIDTH;
  const y = (value: number): number => MARGIN.top + PLOT_HEIGHT - (value / yMax) * PLOT_HEIGHT;
  const ticks = Array.from({ length: tenths + 1 }, (_, index) => index / 10);

  const benchmarkPoints: number[] = [];
  for (let index = 0; index < trend.benchmark.length; index += 1) {
    if (trend.benchmark[index] !== null) {
      benchmarkPoints.push(index);
    }
  }
  const benchmarkPath =
    benchmarkPoints.length >= 2 ? linePath(trend.benchmark, benchmarkPoints, x, y) : null;

  return (
    <div className="dash-trend-chart">
      <svg
        className="dash-trend-chart-svg"
        viewBox="0 0 640 280"
        role="img"
        aria-labelledby="dash-trend-chart-title"
      >
        <title id="dash-trend-chart-title">{indicatorLabel}</title>
        {ticks.map((tick) => (
          <g key={tick} className="dash-tick">
            <line
              className="dash-grid-line"
              x1={MARGIN.left}
              x2={MARGIN.left + PLOT_WIDTH}
              y1={y(tick)}
              y2={y(tick)}
            />
            <text
              className="dash-axis-label dash-axis-label-y"
              x={MARGIN.left - 8}
              y={y(tick) + 4}
              textAnchor="end"
            >
              {formatRate(tick)}
            </text>
          </g>
        ))}
        {periods.map((period, index) => (
          <text
            key={period}
            className="dash-axis-label dash-axis-label-period"
            x={x(index)}
            y={VIEWBOX_HEIGHT - 12}
            textAnchor="middle"
          >
            {formatPeriod(period)}
          </text>
        ))}
        {benchmarkPath !== null && (
          <path
            key="benchmark"
            className="dash-benchmark-line"
            d={benchmarkPath}
            fill="none"
            stroke="#6b7280"
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        )}
        {trend.series.map((series, seriesIndex) => {
          const colour = colourFor(seriesIndex);
          const runs = runsOf(series.rates).filter((run) => run.length >= 2);
          return (
            <g key={series.school}>
              {runs.map((run) => (
                <path
                  key={`${series.school}-${run[0]!}`}
                  className="dash-series-line"
                  d={linePath(series.rates, run, x, y)}
                  fill="none"
                  stroke={colour}
                  strokeWidth={2}
                />
              ))}
              {series.rates.map((value, index) =>
                value === null ? null : (
                  <circle
                    key={`${series.school}-${index}`}
                    className="dash-series-point"
                    cx={x(index)}
                    cy={y(value)}
                    r={3.5}
                    fill={colour}
                    stroke="#ffffff"
                    strokeWidth={1}
                  />
                ),
              )}
            </g>
          );
        })}
      </svg>
      <ul className="dash-legend">
        <li key="benchmark" className="dash-legend-item">
          <span className="dash-legend-swatch dash-legend-swatch-benchmark" aria-hidden="true" />
          <span className="dash-legend-label">Trust benchmark</span>
        </li>
        {trend.series.map((series, seriesIndex) => (
          <li key={series.school} className="dash-legend-item">
            <span
              className="dash-legend-swatch"
              style={{ backgroundColor: colourFor(seriesIndex) }}
              aria-hidden="true"
            />
            <span className="dash-legend-label">{series.school}</span>
            <span className="dash-legend-secondary">{series.label}</span>
          </li>
        ))}
      </ul>
      <table className="dash-alternative">
        <caption className="dash-alternative-caption">{indicatorLabel} by period</caption>
        <thead>
          <tr>
            <th scope="col" className="dash-alternative-header">
              School
            </th>
            {periods.map((period) => (
              <th key={period} scope="col" className="dash-alternative-header">
                {formatPeriod(period)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr key="benchmark">
            <th scope="row" className="dash-alternative-school">
              Trust benchmark
            </th>
            {trend.benchmark.map((value, index) => (
              <td key={periods[index]!} className="dash-alternative-value">
                {formatRate(value)}
              </td>
            ))}
          </tr>
          {trend.series.map((series) => (
            <tr key={series.school}>
              <th scope="row" className="dash-alternative-school">
                <span className="dash-alternative-code">{series.school}</span>
                <span className="dash-alternative-secondary">{series.label}</span>
              </th>
              {series.rates.map((value, index) => (
                <td key={periods[index]!} className="dash-alternative-value">
                  {formatRate(value)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
