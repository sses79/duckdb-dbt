import { readFileSync } from 'node:fs';

import { parse } from 'csv-parse/sync';
import { describe, expect, it } from 'vitest';

import { QUESTIONS } from './questions.ts';

const expectedRows = QUESTIONS.flatMap((question) =>
  question.answers.map((answer, index) => ({
    question_code: question.questionCode,
    question_label: question.itemLabel,
    category: question.category,
    answer_label: answer,
    answer_order: String(index + 1),
    is_adverse: question.adverseAnswers.includes(answer) ? 'true' : 'false',
  })),
);

describe('indicator answer catalogue seed', () => {
  it('matches QUESTIONS exactly', () => {
    const csv = readFileSync('dbt/seeds/indicator_answer_catalog.csv', 'utf8');
    const rows = parse(csv, { columns: true }) as Array<Record<string, string>>;
    expect(rows).toEqual(expectedRows);
  });
});
