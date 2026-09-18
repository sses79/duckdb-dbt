import { describe, expect, it } from 'vitest';
import { parse } from 'csv-parse/sync';
import {
  COHORT_COLUMNS,
  QUESTIONS,
  SOURCE_COLUMN_COUNT,
} from '../questions.ts';
import { buildSyntheticSurveyCsv } from './syntheticSurvey.ts';

function cohortColumn(field: string): number {
  const cohort = COHORT_COLUMNS.find((entry) => entry.field === field);
  if (cohort === undefined) {
    throw new Error(`Unknown cohort field: ${field}`);
  }
  return cohort.sourceColumn;
}

const SCHOOL_CLASSIFICATIONS = ['Primary', 'Secondary', 'College'];
const YEAR_GROUPS = ['Year 5', 'Year 7', 'Year 9'];

describe('buildSyntheticSurveyCsv', () => {
  it('is byte-identical for the same rows and seed', () => {
    const first = buildSyntheticSurveyCsv({ rows: 20, seed: 42 });
    const second = buildSyntheticSurveyCsv({ rows: 20, seed: 42 });
    expect(second).toBe(first);
  });

  it('yields different answers for a different seed', () => {
    const first = parse(buildSyntheticSurveyCsv({ rows: 400, seed: 1 })) as string[][];
    const second = parse(buildSyntheticSurveyCsv({ rows: 400, seed: 2 })) as string[][];
    const questionColumns = QUESTIONS.map((question) => question.sourceColumn);
    const answerValues = (records: string[][]): string[] =>
      records
        .slice(2)
        .flatMap((record) => questionColumns.map((column) => record[column] ?? ''));
    expect(answerValues(second)).not.toEqual(answerValues(first));
  });

  it('emits rows + 2 lines each with exactly SOURCE_COLUMN_COUNT fields', () => {
    const rows = 25;
    const records = parse(buildSyntheticSurveyCsv({ rows, seed: 7 })) as string[][];
    expect(records).toHaveLength(rows + 2);
    for (const record of records) {
      expect(record).toHaveLength(SOURCE_COLUMN_COUNT);
    }
  });

  it('writes the two-level header', () => {
    const records = parse(buildSyntheticSurveyCsv({ rows: 5, seed: 9 })) as string[][];
    const groupHeader = records[0]!;
    const semanticHeader = records[1]!;
    expect(groupHeader[0]).toBe('index');
    for (let column = 1; column < SOURCE_COLUMN_COUNT; column++) {
      expect(groupHeader[column]).toBe(`Unnamed: ${column - 1}`);
    }
    expect(semanticHeader[0]).toBe('0');
    const labelledColumns = new Set([
      ...COHORT_COLUMNS.map((cohort) => cohort.sourceColumn),
      ...QUESTIONS.map((question) => question.sourceColumn),
    ]);
    for (let column = 1; column < SOURCE_COLUMN_COUNT; column++) {
      if (!labelledColumns.has(column)) {
        expect(semanticHeader[column]).toBe(`item_${column}`);
      }
    }
    for (const cohort of COHORT_COLUMNS) {
      expect(semanticHeader[cohort.sourceColumn]).toBe(cohort.itemLabel);
    }
    for (const question of QUESTIONS) {
      expect(semanticHeader[question.sourceColumn]).toBe(question.itemLabel);
    }
  });

  it('writes cohort values at columns looked up by field', () => {
    const records = parse(buildSyntheticSurveyCsv({ rows: 50, seed: 11 })) as string[][];
    const classificationColumn = cohortColumn('school_classification');
    const authorityColumn = cohortColumn('local_authority');
    const yearColumn = cohortColumn('year_group');
    for (const record of records.slice(2)) {
      expect(record[authorityColumn]).toBe('Leeds');
      expect(SCHOOL_CLASSIFICATIONS).toContain(record[classificationColumn]);
      expect(YEAR_GROUPS).toContain(record[yearColumn]);
    }
  });

  it('assigns unique sequential source IDs', () => {
    const rows = 30;
    const records = parse(buildSyntheticSurveyCsv({ rows, seed: 13 })) as string[][];
    const sourceIdColumn = cohortColumn('source_id');
    const ids = records.slice(2).map((record) => record[sourceIdColumn]);
    expect(new Set(ids).size).toBe(rows);
    ids.forEach((id, index) => {
      expect(id).toBe(String(10001 + index));
    });
  });

  it('keeps every non-blank answer within its question answers', () => {
    const records = parse(buildSyntheticSurveyCsv({ rows: 400, seed: 17 })) as string[][];
    for (const record of records.slice(2)) {
      for (const question of QUESTIONS) {
        const value = record[question.sourceColumn];
        if (value !== '') {
          expect(question.answers).toContain(value);
        }
      }
    }
  });

  it('leaves non-cohort and non-question response columns blank', () => {
    const records = parse(buildSyntheticSurveyCsv({ rows: 10, seed: 19 })) as string[][];
    const populatedColumns = new Set([
      0,
      ...COHORT_COLUMNS.map((cohort) => cohort.sourceColumn),
      ...QUESTIONS.map((question) => question.sourceColumn),
    ]);
    for (const record of records.slice(2)) {
      for (let column = 0; column < SOURCE_COLUMN_COUNT; column++) {
        if (!populatedColumns.has(column)) {
          expect(record[column]).toBe('');
        }
      }
    }
  });

  it('includes both fully blank and fully answered respondents at rows = 400', () => {
    const records = parse(buildSyntheticSurveyCsv({ rows: 400, seed: 1234 })) as string[][];
    const questionColumns = QUESTIONS.map((question) => question.sourceColumn);
    const respondents = records.slice(2);
    expect(
      respondents.some((record) =>
        questionColumns.every((column) => record[column] === ''),
      ),
    ).toBe(true);
    expect(
      respondents.some((record) =>
        questionColumns.every((column) => record[column] !== ''),
      ),
    ).toBe(true);
  });

  it('contains no carriage return or BOM and ends with a newline', () => {
    const text = buildSyntheticSurveyCsv({ rows: 10, seed: 23 });
    expect(text).not.toContain('\r');
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(text.endsWith('\n')).toBe(true);
  });
});
