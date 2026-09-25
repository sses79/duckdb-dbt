import type { DashboardViewOptions } from '../../../src/dashboard/viewModel.ts';
import type { DashboardSelection } from '../../../src/dashboard/selection.ts';
import { formatPeriod } from '../lib/format.ts';

export function FilterForm({ options, selection }: { options: DashboardViewOptions; selection: DashboardSelection }) {
  return (
    <form method="get" action="/" className="dash-filter-form">
      <label className="dash-filter-field">
        <span className="dash-filter-label">Indicator</span>
        <select name="question" className="dash-filter-select" defaultValue={selection.question}>
          {options.categories.map((category) => (
            <optgroup key={category.code} label={category.label}>
              {options.questions
                .filter((question) => question.category === category.code)
                .map((question) => (
                  <option key={question.code} value={question.code}>
                    {question.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="dash-filter-field">
        <span className="dash-filter-label">Period</span>
        <select name="period" className="dash-filter-select" defaultValue={selection.period}>
          {options.periods.map((period) => (
            <option key={period} value={period}>
              {formatPeriod(period)}
            </option>
          ))}
        </select>
      </label>
      <label className="dash-filter-field">
        <span className="dash-filter-label">School</span>
        <select name="school" className="dash-filter-select" defaultValue={selection.school ?? ''}>
          <option value="">All schools</option>
          {options.schools.map((school) => (
            <option key={school.code} value={school.code}>
              {school.code} — {school.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="dash-filter-submit">
        Apply
      </button>
    </form>
  );
}
