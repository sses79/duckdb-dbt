import { loadDashboardPage } from '../../../src/dashboard/pageLoader.ts';
import { FilterForm } from '../components/FilterForm.tsx';
import {
  DistributionChart,
  DriversTable,
  SignalsTable,
} from '../components/EvidencePanels.tsx';
import { CategoryTable, HeadlineCards, RankingTable } from '../components/SummaryPanels.tsx';
import { TrendChart } from '../components/TrendChart.tsx';
import { formatCount, formatTimestamp } from '../lib/format.ts';

export const dynamic = 'force-dynamic';

type DashboardView = Extract<Awaited<ReturnType<typeof loadDashboardPage>>, { kind: 'ok' }>['view'];

const EXPORT_SECTIONS = [
  ['indicator_analysis', 'Indicator analysis'],
  ['category_analysis', 'Category analysis'],
  ['change_drivers', 'Change drivers'],
  ['question_response_distribution', 'Response distribution'],
  ['support_signal_summary', 'Support signals'],
] as const;

function exportHref(section: string, period: string): string {
  const params = new URLSearchParams({ section, period });
  return `/api/export?${params.toString()}`;
}

function freshnessDetail(view: DashboardView): string {
  return [
    `Trust ${view.tenant}`,
    `Loaded ${formatTimestamp(view.freshness?.lastLoadedAt ?? null)}`,
    `Source updated ${formatTimestamp(view.freshness?.latestSourceUpdatedAt ?? null)}`,
    `${formatCount(view.freshness?.logicalEventCount ?? null)} logical events`,
  ].join(' · ');
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const result = await loadDashboardPage(await searchParams, process.env);

  if (result.kind === 'invalid-query') {
    return (
      <main className="dash-page">
        <h1>School Wellbeing Signals</h1>
        <p>That selection is not available.</p>
        <a href="/">Back to the dashboard</a>
      </main>
    );
  }

  if (result.kind === 'unavailable') {
    return (
      <main className="dash-page">
        <h1>School Wellbeing Signals</h1>
        <p>Dashboard data is temporarily unavailable.</p>
      </main>
    );
  }

  const { view } = result;
  return (
    <main className="dash-page">
      <header className="dash-header">
        <h1>School Wellbeing Signals</h1>
        <p className="dash-header-meta">{freshnessDetail(view)}</p>
      </header>
      <FilterForm options={view.options} selection={view.selection} />
      <HeadlineCards headline={view.headline} indicatorLabel={view.indicator.label} />
      <p className="dash-interpretation-note">{view.indicator.interpretationNote}</p>
      <TrendChart trend={view.trend} indicatorLabel={view.indicator.label} />
      <RankingTable rows={view.ranking} />
      <CategoryTable rows={view.categoryRows} categoryLabel={view.indicator.categoryLabel} />
      <DriversTable rows={view.drivers} categoryLabel={view.indicator.categoryLabel} />
      <DistributionChart distribution={view.distribution} indicatorLabel={view.indicator.label} />
      <SignalsTable rows={view.signals} />
      <section className="dash-export" aria-labelledby="dash-export-heading">
        <h2 id="dash-export-heading" className="dash-heading">
          Export
        </h2>
        <ul className="dash-export-list">
          {EXPORT_SECTIONS.map(([section, label]) => (
            <li key={section}>
              <a className="dash-export-link" href={exportHref(section, view.selection.period)}>
                {label}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
