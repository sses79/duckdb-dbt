import { describe, expect, it } from 'vitest';
import {
  COHORT_COLUMNS,
  QUESTIONS,
  SOURCE_COLUMN_COUNT,
  questionByCode,
} from './questions.ts';

const CATEGORIES = new Set([
  'emotional_wellbeing',
  'relationships',
  'school_connection',
  'safety',
  'healthy_lifestyle',
]);

describe('question catalogue invariants', () => {
  it('contains exactly 18 questions', () => {
    expect(QUESTIONS).toHaveLength(18);
  });

  it('has unique question codes', () => {
    const codes = QUESTIONS.map((question) => question.questionCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('has unique source columns', () => {
    const columns = QUESTIONS.map((question) => question.sourceColumn);
    expect(new Set(columns).size).toBe(columns.length);
  });

  it('keeps every source column within the CSV width', () => {
    for (const question of QUESTIONS) {
      expect(question.sourceColumn).toBeGreaterThanOrEqual(1);
      expect(question.sourceColumn).toBeLessThanOrEqual(SOURCE_COLUMN_COUNT - 1);
    }
    for (const cohort of COHORT_COLUMNS) {
      expect(cohort.sourceColumn).toBeGreaterThanOrEqual(1);
      expect(cohort.sourceColumn).toBeLessThanOrEqual(SOURCE_COLUMN_COUNT - 1);
    }
  });

  it('does not collide with cohort columns', () => {
    const questionColumns = new Set(QUESTIONS.map((question) => question.sourceColumn));
    for (const cohort of COHORT_COLUMNS) {
      expect(questionColumns.has(cohort.sourceColumn)).toBe(false);
    }
  });

  it('uses only known categories', () => {
    for (const question of QUESTIONS) {
      expect(CATEGORIES.has(question.category)).toBe(true);
    }
  });

  it('keeps adverse answers within the answer domain', () => {
    for (const question of QUESTIONS) {
      for (const adverseAnswer of question.adverseAnswers) {
        expect(question.answers).toContain(adverseAnswer);
      }
    }
  });

  it('has no duplicate answers within a question', () => {
    for (const question of QUESTIONS) {
      expect(new Set(question.answers).size).toBe(question.answers.length);
    }
  });

  it('stores item labels with no leading or trailing whitespace', () => {
    for (const question of QUESTIONS) {
      expect(question.itemLabel.trim()).toBe(question.itemLabel);
    }
    for (const cohort of COHORT_COLUMNS) {
      expect(cohort.itemLabel.trim()).toBe(cohort.itemLabel);
    }
  });
});

describe('questionByCode', () => {
  it('returns the matching question for a known code', () => {
    for (const question of QUESTIONS) {
      expect(questionByCode(question.questionCode)).toBe(question);
    }
  });

  it('throws an Error naming an unknown code', () => {
    expect(() => questionByCode('not-a-real-question')).toThrow(
      'Unknown question code: not-a-real-question',
    );
  });
});
