import { parse } from 'csv-parse/sync';
import { describe, expect, it } from 'vitest';

import {
  COHORT_COLUMNS,
  QUESTIONS,
  SOURCE_COLUMN_COUNT,
} from './questions.ts';
import type { Question } from './questions.ts';
import { parseSurveySource, SourceValidationError } from './source.ts';
import { buildSyntheticSurveyCsv } from './testing/syntheticSurvey.ts';

const RESPONSE_ROWS = 50;
const SEED = 1;
const DOUBLE_QUOTE = '"';

function syntheticSurveyCsv(): string {
  return buildSyntheticSurveyCsv({ rows: RESPONSE_ROWS, seed: SEED });
}

function quoteField(value: string): string {
  if (value.includes(',') || value.includes('\n') || value.includes(DOUBLE_QUOTE)) {
    return (
      DOUBLE_QUOTE +
      value.split(DOUBLE_QUOTE).join(DOUBLE_QUOTE + DOUBLE_QUOTE) +
      DOUBLE_QUOTE
    );
  }
  return value;
}

function withEditedRecord(
  text: string,
  lineNumber: number,
  edit: (fields: string[]) => string[],
): string {
  const records = parse(text, { relax_column_count: true }) as string[][];
  const index = lineNumber - 1;
  const record = records[index];
  if (record === undefined) {
    throw new Error(`No record for line ${lineNumber}`);
  }
  records[index] = edit(record);
  return records.map((row) => row.map(quoteField).join(',')).join('\n') + '\n';
}

function cohortColumnIndex(field: string): number {
  const cohort = COHORT_COLUMNS.find((entry) => entry.field === field);
  if (cohort === undefined) {
    throw new Error(`Unknown cohort field: ${field}`);
  }
  return cohort.sourceColumn;
}

function questionByCode(code: string): Question {
  const question = QUESTIONS.find((entry) => entry.questionCode === code);
  if (question === undefined) {
    throw new Error(`Missing question: ${code}`);
  }
  return question;
}

function captureError(action: () => unknown): Error {
  try {
    action();
  } catch (caught) {
    if (caught instanceof Error) {
      return caught;
    }
    throw new Error('Expected an Error to be thrown');
  }
  throw new Error('Expected an error to be thrown');
}

describe('parseSurveySource', () => {
  it('parses a synthetic 50-row survey', () => {
    const source = parseSurveySource(syntheticSurveyCsv());
    expect(source.responses).toHaveLength(RESPONSE_ROWS);
    expect(source.responses[0]?.sourceLineNumber).toBe(3);
    expect(source.summary.responseRows).toBe(RESPONSE_ROWS);
    expect(source.summary.distinctSourceIds).toBe(RESPONSE_ROWS);
    expect(source.summary.localAuthorities).toEqual(['Leeds']);
  });

  it('maps every answer to null for a respondent with blank question columns', () => {
    const edited = withEditedRecord(syntheticSurveyCsv(), 3, (fields) => {
      for (const question of QUESTIONS) {
        fields[question.sourceColumn] = '';
      }
      return fields;
    });
    const source = parseSurveySource(edited);
    const respondent = source.responses[0];
    expect(respondent?.sourceLineNumber).toBe(3);
    for (const question of QUESTIONS) {
      expect(respondent?.answers[question.questionCode]).toBeNull();
    }
  });

  it('keeps every non-null answer equal to the source cell', () => {
    const csv = syntheticSurveyCsv();
    const source = parseSurveySource(csv);
    const records = parse(csv, { relax_column_count: true }) as string[][];
    for (const response of source.responses) {
      const row = records[response.sourceLineNumber - 1];
      expect(row).toBeDefined();
      for (const question of QUESTIONS) {
        const cell = (row?.[question.sourceColumn] ?? '').trim();
        if (cell === '') {
          expect(response.answers[question.questionCode]).toBeNull();
        } else {
          expect(response.answers[question.questionCode]).toBe(cell);
        }
      }
    }
  });

  it('refuses a line with the wrong field count', () => {
    const targetLineNumber = 7;
    const edited = withEditedRecord(syntheticSurveyCsv(), targetLineNumber, (fields) => {
      fields.pop();
      return fields;
    });
    const error = captureError(() => parseSurveySource(edited));
    expect(error).toBeInstanceOf(SourceValidationError);
    expect(error.message).toContain(`Line ${targetLineNumber}`);
    expect(error.message).toContain(String(SOURCE_COLUMN_COUNT));
  });

  it('refuses a changed line-2 label for a question column', () => {
    const question = questionByCode('feel_sad');
    const edited = withEditedRecord(syntheticSurveyCsv(), 2, (fields) => {
      fields[question.sourceColumn] = `${question.itemLabel} changed`;
      return fields;
    });
    const error = captureError(() => parseSurveySource(edited));
    expect(error).toBeInstanceOf(SourceValidationError);
    expect(error.message).toContain(question.questionCode);
    expect(error.message).toContain(question.itemLabel);
  });

  it('refuses a duplicate source ID naming both line numbers without the ID', () => {
    const csv = syntheticSurveyCsv();
    const sourceIdColumn = cohortColumnIndex('source_id');
    const firstLineNumber = 3;
    const secondLineNumber = 8;
    const records = parse(csv, { relax_column_count: true }) as string[][];
    const firstId = records[firstLineNumber - 1]?.[sourceIdColumn] ?? '';
    expect(firstId).not.toBe('');
    const edited = withEditedRecord(csv, secondLineNumber, (fields) => {
      fields[sourceIdColumn] = firstId;
      return fields;
    });
    const error = captureError(() => parseSurveySource(edited));
    expect(error).toBeInstanceOf(SourceValidationError);
    expect(error.message).toContain(`line ${firstLineNumber}`);
    expect(error.message).toContain(`line ${secondLineNumber}`);
    expect(error.message).not.toContain(firstId);
  });

  it('refuses an undocumented answer naming the question code', () => {
    const question = questionByCode('feel_sad');
    const targetLineNumber = 6;
    const edited = withEditedRecord(syntheticSurveyCsv(), targetLineNumber, (fields) => {
      fields[question.sourceColumn] = 'Sometimes';
      return fields;
    });
    const error = captureError(() => parseSurveySource(edited));
    expect(error).toBeInstanceOf(SourceValidationError);
    expect(error.message).toContain(question.questionCode);
    expect(error.message).toContain(`Line ${targetLineNumber}`);
  });

  it('refuses a source with fewer than 2 lines', () => {
    expect(captureError(() => parseSurveySource(''))).toBeInstanceOf(SourceValidationError);
    expect(captureError(() => parseSurveySource('index,Unnamed: 0\n'))).toBeInstanceOf(
      SourceValidationError,
    );
  });
});
