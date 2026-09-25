import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildFixtureDashboard } from '../../../src/dashboard/testing/dashboardFixture.ts';
import { buildDashboardView } from '../../../src/dashboard/viewModel.ts';
import { resolveSelection } from '../../../src/dashboard/selection.ts';
import { FilterForm } from './FilterForm.tsx';

interface RenderedOption {
  value: string;
  selected: boolean;
  text: string;
}

interface RenderedOptgroup {
  label: string;
  options: RenderedOption[];
}

function renderForm(query: { school?: string } = {}) {
  const document = buildFixtureDashboard('trust_north');
  const view = buildDashboardView(document, resolveSelection(document, query));
  return {
    view,
    html: renderToStaticMarkup(createElement(FilterForm, { options: view.options, selection: view.selection })),
  };
}

function decodeText(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .trim();
}

function selectInner(html: string, name: string): string {
  const pattern = new RegExp(`<select name="${name}"[^>]*>([\\s\\S]*?)</select>`);
  const match = pattern.exec(html);
  if (match === null) {
    throw new Error(`No <select name="${name}"> found`);
  }
  return match[1] ?? '';
}

function optionsOf(inner: string): RenderedOption[] {
  const options: RenderedOption[] = [];
  const optionPattern = /<option\b([^>]*)>([\s\S]*?)<\/option>/g;
  let match: RegExpExecArray | null;
  while ((match = optionPattern.exec(inner)) !== null) {
    const attributes = match[1] ?? '';
    const valueMatch = /value="([^"]*)"/.exec(attributes);
    options.push({
      value: valueMatch === null ? '' : valueMatch[1] ?? '',
      selected: /selected/.test(attributes),
      text: decodeText(match[2] ?? ''),
    });
  }
  return options;
}

function optgroupsOf(inner: string): RenderedOptgroup[] {
  const groups: RenderedOptgroup[] = [];
  const groupPattern = /<optgroup\b([^>]*)>([\s\S]*?)<\/optgroup>/g;
  let match: RegExpExecArray | null;
  while ((match = groupPattern.exec(inner)) !== null) {
    const attributes = match[1] ?? '';
    const labelMatch = /label="([^"]*)"/.exec(attributes);
    groups.push({
      label: labelMatch === null ? '' : labelMatch[1] ?? '',
      options: optionsOf(match[2] ?? ''),
    });
  }
  return groups;
}

describe('FilterForm', () => {
  it('resolves the default fixture view to feel_angry in emotional_wellbeing for 2019-spring', () => {
    const { view } = renderForm({});
    expect(view.selection).toEqual({
      category: 'emotional_wellbeing',
      question: 'feel_angry',
      period: '2019-spring',
      school: null,
    });
  });

  it('renders a GET form with only question, period and school fields', () => {
    const { html } = renderForm({});
    expect(html).toContain('<form');
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/"');
    expect(html).toContain('name="question"');
    expect(html).toContain('name="period"');
    expect(html).toContain('name="school"');
    expect(html).not.toContain('name="category"');
    expect(html).not.toContain('name="tenant"');
    expect(html).not.toContain('name="trust_id"');
    expect(html).not.toMatch(/<input/i);
  });

  it('groups indicator questions by category, one optgroup per category', () => {
    const { view, html } = renderForm({});
    const groups = optgroupsOf(selectInner(html, 'question'));
    expect(groups).toHaveLength(view.options.categories.length);
    for (const group of groups) {
      const category = view.options.categories.find((candidate) => candidate.label === group.label);
      expect(category).toBeDefined();
      const expected = view.options.questions
        .filter((question) => question.category === category!.code)
        .map((question) => question.code);
      expect(group.options.map((option) => option.value)).toEqual(expected);
    }
  });

  it('selects feel_angry for the default view', () => {
    const { html } = renderForm({});
    const selected = optionsOf(selectInner(html, 'question')).filter((option) => option.selected);
    expect(selected).toHaveLength(1);
    expect(selected[0]!.value).toBe('feel_angry');
  });

  it('labels periods with formatPeriod and marks the selected period', () => {
    const { view, html } = renderForm({});
    const options = optionsOf(selectInner(html, 'period'));
    expect(options.map((option) => option.value)).toEqual(view.options.periods);
    expect(options.find((option) => option.value === view.selection.period)?.selected).toBe(true);
    expect(options.find((option) => option.value === '2019-spring')?.text).toBe('Spring 2019');
  });

  it('offers All schools first and selects it when no school is chosen', () => {
    const { html } = renderForm({});
    const options = optionsOf(selectInner(html, 'school'));
    expect(options[0]).toEqual({ value: '', selected: true, text: 'All schools' });
    const selected = options.filter((option) => option.selected);
    expect(selected).toHaveLength(1);
    expect(selected[0]!.value).toBe('');
  });

  it('selects the requested school and shows its code with classification', () => {
    const { view, html } = renderForm({ school: 'school_n02' });
    const options = optionsOf(selectInner(html, 'school'));
    const selected = options.filter((option) => option.selected);
    expect(selected).toHaveLength(1);
    expect(selected[0]!.value).toBe('school_n02');
    const school = view.options.schools.find((candidate) => candidate.code === 'school_n02');
    expect(school).toBeDefined();
    const option = options.find((candidate) => candidate.value === 'school_n02');
    expect(option).toBeDefined();
    expect(option!.text).toContain('school_n02');
    expect(option!.text).toContain(school!.label);
  });

  it('uses only option codes or the empty string as option values', () => {
    const { view, html } = renderForm({});
    const validValues = new Set<string>([
      '',
      ...view.options.questions.map((question) => question.code),
      ...view.options.periods,
      ...view.options.schools.map((school) => school.code),
    ]);
    for (const name of ['question', 'period', 'school']) {
      for (const option of optionsOf(selectInner(html, name))) {
        expect(validValues.has(option.value)).toBe(true);
      }
    }
  });
});
