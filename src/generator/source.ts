import { parse } from 'csv-parse/sync';

import {
  COHORT_COLUMNS,
  QUESTIONS,
  SOURCE_COLUMN_COUNT,
} from './questions.ts';
import type { QuestionCode } from './questions.ts';

export class SourceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceValidationError';
  }
}

export interface SourceResponse {
  sourceLineNumber: number;
  sourceId: string;
  schoolClassification: string;
  localAuthority: string;
  yearGroup: string;
  answers: Record<QuestionCode, string | null>;
}

export interface SurveySource {
  responses: SourceResponse[];
  summary: {
    responseRows: number;
    distinctSourceIds: number;
    localAuthorities: string[];
  };
}

function cohortColumnIndex(field: string): number {
  const cohort = COHORT_COLUMNS.find((entry) => entry.field === field);
  if (cohort === undefined) {
    throw new Error(`Unknown cohort field: ${field}`);
  }
  return cohort.sourceColumn;
}

function trimmedField(row: readonly string[], column: number): string {
  return row[column]?.trim() ?? '';
}

export function parseSurveySource(text: string): SurveySource {
  const records = parse(text, { relax_column_count: true }) as string[][];

  if (records.length < 2) {
    throw new SourceValidationError(
      `Source file has ${records.length} line${records.length === 1 ? '' : 's'}; expected at least 2`,
    );
  }

  for (let index = 0; index < records.length; index++) {
    const row = records[index];
    if (row === undefined) {
      continue;
    }
    if (row.length !== SOURCE_COLUMN_COUNT) {
      throw new SourceValidationError(
        `Line ${index + 1} has ${row.length} fields; expected ${SOURCE_COLUMN_COUNT}`,
      );
    }
  }

  const subheader = records[1];
  if (subheader === undefined) {
    throw new SourceValidationError('Source file is missing the semantic subheader');
  }
  for (const cohort of COHORT_COLUMNS) {
    const label = trimmedField(subheader, cohort.sourceColumn);
    if (label !== cohort.itemLabel) {
      throw new SourceValidationError(
        `Line 2 column ${cohort.sourceColumn} (${cohort.field}) has label '${label}'; expected '${cohort.itemLabel}'`,
      );
    }
  }
  for (const question of QUESTIONS) {
    const label = trimmedField(subheader, question.sourceColumn);
    if (label !== question.itemLabel) {
      throw new SourceValidationError(
        `Line 2 column ${question.sourceColumn} (${question.questionCode}) has label '${label}'; expected '${question.itemLabel}'`,
      );
    }
  }

  const sourceIdColumn = cohortColumnIndex('source_id');
  const classificationColumn = cohortColumnIndex('school_classification');
  const authorityColumn = cohortColumnIndex('local_authority');
  const yearGroupColumn = cohortColumnIndex('year_group');

  const responses: SourceResponse[] = [];
  const firstLineById = new Map<string, number>();
  const localAuthorities = new Set<string>();

  for (let index = 2; index < records.length; index++) {
    const row = records[index];
    if (row === undefined) {
      continue;
    }
    const sourceLineNumber = index + 1;
    const sourceId = trimmedField(row, sourceIdColumn);
    if (sourceId === '') {
      throw new SourceValidationError(`Source ID is blank on line ${sourceLineNumber}`);
    }
    const firstLine = firstLineById.get(sourceId);
    if (firstLine !== undefined) {
      throw new SourceValidationError(
        `Duplicate source ID on line ${firstLine} and line ${sourceLineNumber}`,
      );
    }
    firstLineById.set(sourceId, sourceLineNumber);

    const schoolClassification = trimmedField(row, classificationColumn);
    const localAuthority = trimmedField(row, authorityColumn);
    const yearGroup = trimmedField(row, yearGroupColumn);
    localAuthorities.add(localAuthority);

    const answers = {} as Record<QuestionCode, string | null>;
    for (const question of QUESTIONS) {
      const answer = trimmedField(row, question.sourceColumn);
      if (answer === '') {
        answers[question.questionCode] = null;
        continue;
      }
      if (!question.answers.includes(answer)) {
        throw new SourceValidationError(
          `Line ${sourceLineNumber} question ${question.questionCode} has undocumented answer '${answer}'`,
        );
      }
      answers[question.questionCode] = answer;
    }

    responses.push({
      sourceLineNumber,
      sourceId,
      schoolClassification,
      localAuthority,
      yearGroup,
      answers,
    });
  }

  return {
    responses,
    summary: {
      responseRows: responses.length,
      distinctSourceIds: firstLineById.size,
      localAuthorities: [...localAuthorities].sort(),
    },
  };
}
