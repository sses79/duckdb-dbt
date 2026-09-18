import { parse } from 'csv-parse/sync';
import { describe, expect, it } from 'vitest';
import { COHORT_COLUMNS, QUESTIONS, SOURCE_COLUMN_COUNT } from '../questions.ts';
import { buildSyntheticSurveyCsv } from './syntheticSurvey.ts';

const SCHOOL_CLASSIFICATIONS = ['Primary', 'Secondary', 'College'];
const YEAR_GROUPS = ['Year 5', 'Year 7', 'Year 9'];
const SHAPE_ROWS = 400;
const SHAPE_SEED = 20260918;

function parseCsv(text: string): string[][] {
  return parse(text) as string[][];
}

describe('buildSyntheticSurveyCsv', () => {
  it('is deterministic for the same rows and seed', () => {
    const first = buildSyntheticSurveyCsv({ rows: 50, seed: 42 });
    const second = buildSyntheticSurveyCsv({ rows: 50, seed: 42 });
    expect(second).toBe(first);
  });

  it('changes answers when the seed changes', () => {
    const first = buildSyntheticSurveyCsv({ rows: 50, seed: 42 });
    const different = buildSyntheticSurveyCsv({ rows: 50, seed: 43 });
    expect(different).not.toBe(first);
  });

  it('emits plain newline-terminated lines with the source width', () => {
    const csv = buildSyntheticSurveyCsv({ rows: SHAPE_ROWS, seed: SHAPE_SEED });
    expect(csv).not.toContain('\r');
    expect(csv.startsWith('\uFEFF')).toBe(false);
    expect(csv.endsWith('\n')).toBe(true);

    const records = parseCsv(csv);
    expect(records).toHaveLength(SHAPE_ROWS + 2);
    for (const record of records) {
      expect(record).toHaveLength(SOURCE_COLUMN_COUNT);
    }
  });

  it('writes the two-level header with item labels at their source columns', () => {
    const records = parseCsv(buildSyntheticSurveyCsv({ rows: 10, seed: 7 }));
    const header = records[0] as string[];
    expect(header[0]).toBe('index');
    for (let column = 1; column < SOURCE_COLUMN_COUNT; column += 1) {
      expect(header[column]).toBe(`Unnamed: ${column - 1}`);
    }

    const subheader = records[1] as string[];
    expect(subheader[0]).toBe('0');
    const itemLabelByColumn = new Map<number, string>();
    for (const cohort of COHORT_COLUMNS) {
      itemLabelByColumn.set(cohort.sourceColumn, cohort.itemLabel);
    }
    for (const question of QUESTIONS) {
      itemLabelByColumn.set(question.sourceColumn, question.itemLabel);
    }
    for (let column = 1; column < SOURCE_COLUMN_COUNT; column += 1) {
      expect(subheader[column]).toBe(itemLabelByColumn.get(column) ?? `item_${column}`);
    }
  });

  it('keeps cohort fields and answers within their allowed domains', () => {
    const records = parseCsv(buildSyntheticSurveyCsv({ rows: SHAPE_ROWS, seed: SHAPE_SEED }));
    const responseRows = records.slice(2);
    const sourceIds = new Set<string>();
    for (let i = 0; i < responseRows.length; i += 1) {
      const record = responseRows[i] as string[];
      expect(record[0]).toBe(String(i + 1));
      const sourceId = record[1];
      expect(sourceId).toBe(String(10001 + i));
      expect(sourceIds.has(sourceId as string)).toBe(false);
      sourceIds.add(sourceId as string);
      expect(record[2]).toBe('Leeds');
      expect(SCHOOL_CLASSIFICATIONS).toContain(record[3]);
      expect(YEAR_GROUPS).toContain(record[4]);
      for (const question of QUESTIONS) {
        const value = record[question.sourceColumn];
        if (value !== undefined && value !== '') {
          expect(question.answers).toContain(value);
        }
      }
    }
  });

  it('includes both fully blank and fully answered respondents', () => {
    const records = parseCsv(buildSyntheticSurveyCsv({ rows: SHAPE_ROWS, seed: SHAPE_SEED }));
    const responseRows = records.slice(2);
    const questionColumns = QUESTIONS.map((question) => question.sourceColumn);
    let fullyBlank = 0;
    let fullyAnswered = 0;
    for (const record of responseRows) {
      const values = questionColumns.map((column) => record[column]);
      if (values.every((value) => value === '')) {
        fullyBlank += 1;
      }
      if (values.every((value) => value !== undefined && value !== '')) {
        fullyAnswered += 1;
      }
    }
    expect(fullyBlank).toBeGreaterThanOrEqual(1);
    expect(fullyAnswered).toBeGreaterThanOrEqual(1);
  });
});
