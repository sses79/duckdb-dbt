import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildSubmissionEvent } from './envelope.ts';
import type { SubmissionDeleteEvent, SubmissionEvent, SubmissionUpsertEvent } from './envelope.ts';
import { buildMutationDeliveries, MutationBaselineError } from './mutations.ts';
import { QUESTIONS } from './questions.ts';
import type { QuestionCode } from './questions.ts';
import { parseSurveySource } from './source.ts';
import { buildSyntheticSurveyCsv } from './testing/syntheticSurvey.ts';

const EXPECTED_BATCH_IDS = [
  'batch_m2_01_new_inserts',
  'batch_m2_02_correction_duplicate',
  'batch_m2_03_late_older_version',
  'batch_m2_04_withdrawal',
  'batch_m2_replay_late_older',
];

function buildBaseline(): SubmissionUpsertEvent[] {
  const csv = buildSyntheticSurveyCsv({ rows: 8, seed: 4242 });
  const survey = parseSurveySource(csv);
  return survey.responses.slice(0, 4).map((response, index) =>
    buildSubmissionEvent(response, {
      batchId: `baseline_batch_${index + 1}`,
      extractedAt: '2026-09-01T00:00:00.000Z',
    }),
  );
}

function requireDefined<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
}

function upsertEvent(value: SubmissionEvent | undefined, label: string): SubmissionUpsertEvent {
  const event = requireDefined(value, label);
  if (event.operation !== 'upsert') {
    throw new Error(`Expected ${label} to be an upsert event`);
  }
  return event;
}

function deleteEvent(value: SubmissionEvent | undefined, label: string): SubmissionDeleteEvent {
  const event = requireDefined(value, label);
  if (event.operation !== 'delete') {
    throw new Error(`Expected ${label} to be a delete event`);
  }
  return event;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function expectedEventId(documentId: string, sourceVersion: number, operation: string): string {
  return `evt_${sha256Hex(`${documentId}:${sourceVersion}:${operation}`).slice(0, 24)}`;
}

function differingQuestionCodes(
  before: SubmissionUpsertEvent,
  after: SubmissionUpsertEvent,
): QuestionCode[] {
  return QUESTIONS.map((question) => question.questionCode).filter(
    (code) => before.payload.answers[code] !== after.payload.answers[code],
  );
}

function singleChangedCode(
  before: SubmissionUpsertEvent,
  after: SubmissionUpsertEvent,
): QuestionCode {
  const changed = differingQuestionCodes(before, after);
  expect(changed).toHaveLength(1);
  const code = changed[0];
  if (code === undefined) {
    throw new Error('Expected exactly one changed question code');
  }
  return code;
}

function questionFor(code: QuestionCode) {
  const question = QUESTIONS.find((entry) => entry.questionCode === code);
  if (question === undefined) {
    throw new Error(`Unknown question code: ${code}`);
  }
  return question;
}

describe('buildMutationDeliveries', () => {
  it('returns the five deliveries in the documented order', () => {
    const deliveries = buildMutationDeliveries(buildBaseline());
    expect(deliveries.map((delivery) => delivery.batchId)).toEqual(EXPECTED_BATCH_IDS);
  });

  it('is deterministic and never shares references with the baseline', () => {
    const baseline = buildBaseline();
    const firstCall = buildMutationDeliveries(baseline);
    const secondCall = buildMutationDeliveries(baseline);
    expect(firstCall).toEqual(secondCall);

    const snapshot = structuredClone(baseline);
    const firstQuestion = requireDefined(QUESTIONS[0], 'first question');
    for (const delivery of firstCall) {
      for (const event of delivery.events) {
        event.batch_id = 'mutated';
        event.source_updated_at = '2099-01-01T00:00:00.000Z';
        event.extracted_at = '2099-01-01T00:00:00.000Z';
        if (event.operation === 'upsert') {
          event.payload.answers[firstQuestion.questionCode] = 'mutated';
        }
      }
    }
    expect(baseline).toEqual(snapshot);
    expect(secondCall).toEqual(buildMutationDeliveries(baseline));
  });

  it('builds two new inserts that do not appear in the baseline', () => {
    const baseline = buildBaseline();
    const delivery = requireDefined(buildMutationDeliveries(baseline)[0], 'new-inserts delivery');
    const baselineIds = new Set(baseline.map((event) => event.document_id));
    expect(delivery.events).toHaveLength(2);
    const first = upsertEvent(delivery.events[0], 'first new insert');
    const second = upsertEvent(delivery.events[1], 'second new insert');
    expect(first.operation).toBe('upsert');
    expect(first.source_version).toBe(1);
    expect(second.operation).toBe('upsert');
    expect(second.source_version).toBe(1);
    expect(first.document_id).not.toBe(second.document_id);
    expect(baselineIds.has(first.document_id)).toBe(false);
    expect(baselineIds.has(second.document_id)).toBe(false);
    expect(first.event_id).toBe(expectedEventId(first.document_id, 1, 'upsert'));
    expect(second.event_id).toBe(expectedEventId(second.document_id, 1, 'upsert'));
  });

  it('builds a duplicated corrected event at source_version 3 with one documented change', () => {
    const baseline = buildBaseline();
    const subject = requireDefined(baseline[0], 'baseline subject');
    const delivery = requireDefined(buildMutationDeliveries(baseline)[1], 'correction delivery');
    expect(delivery.events).toHaveLength(2);
    const first = upsertEvent(delivery.events[0], 'correction event');
    const second = upsertEvent(delivery.events[1], 'correction duplicate');
    expect(first).toEqual(second);
    expect(first.event_id).toBe(second.event_id);
    expect(first.document_id).toBe(subject.document_id);
    expect(first.source_version).toBe(3);
    expect(first.event_id).toBe(expectedEventId(subject.document_id, 3, 'upsert'));

    const code = singleChangedCode(subject, first);
    const answer = first.payload.answers[code];
    if (answer === null) {
      throw new Error(`Correction answer for ${code} must not be null`);
    }
    expect(questionFor(code).answers).toContain(answer);
    expect(answer).not.toBe(subject.payload.answers[code]);
    expect(delivery.expected).toEqual({
      document_id: subject.document_id,
      winning_source_version: 3,
      corrected_question: code,
      corrected_answer: answer,
    });
  });

  it('builds a late older version that loses to the correction with a distinct answer', () => {
    const baseline = buildBaseline();
    const subject = requireDefined(baseline[0], 'baseline subject');
    const deliveries = buildMutationDeliveries(baseline);
    const correctionEvent = upsertEvent(
      requireDefined(deliveries[1], 'correction delivery').events[0],
      'correction event',
    );
    const delivery = requireDefined(deliveries[2], 'late delivery');
    expect(delivery.events).toHaveLength(1);
    const lateEvent = upsertEvent(delivery.events[0], 'late event');
    expect(lateEvent.document_id).toBe(subject.document_id);
    expect(lateEvent.source_version).toBe(2);
    expect(lateEvent.source_version).toBeLessThan(correctionEvent.source_version);
    expect(lateEvent.event_id).toBe(expectedEventId(subject.document_id, 2, 'upsert'));

    const code = singleChangedCode(subject, lateEvent);
    const answer = lateEvent.payload.answers[code];
    if (answer === null) {
      throw new Error(`Late answer for ${code} must not be null`);
    }
    expect(questionFor(code).answers).toContain(answer);
    expect(answer).not.toBe(subject.payload.answers[code]);
    expect(answer).not.toBe(correctionEvent.payload.answers[code]);
  });

  it('builds a replay identical to the late event except batch_id and extracted_at', () => {
    const deliveries = buildMutationDeliveries(buildBaseline());
    const lateEvent = upsertEvent(
      requireDefined(deliveries[2], 'late delivery').events[0],
      'late event',
    );
    const replayDelivery = requireDefined(deliveries[4], 'replay delivery');
    expect(replayDelivery.events).toHaveLength(1);
    const replayEvent = upsertEvent(replayDelivery.events[0], 'replay event');
    expect(replayEvent.batch_id).toBe('batch_m2_replay_late_older');
    expect(replayEvent.event_id).toBe(lateEvent.event_id);
    expect(replayEvent.extracted_at).not.toBe(lateEvent.extracted_at);
    expect(replayEvent).toEqual({
      ...lateEvent,
      batch_id: replayEvent.batch_id,
      extracted_at: replayEvent.extracted_at,
    });
  });

  it('builds a withdrawal delete on the second baseline subject', () => {
    const baseline = buildBaseline();
    const subject = requireDefined(baseline[1], 'withdrawal subject');
    const delivery = requireDefined(buildMutationDeliveries(baseline)[3], 'withdrawal delivery');
    expect(delivery.events).toHaveLength(1);
    const event = deleteEvent(delivery.events[0], 'withdrawal event');
    expect(event.document_id).toBe(subject.document_id);
    expect(event.source_version).toBe(2);
    expect(Object.keys(event.payload).sort()).toEqual(['provenance', 'school_id', 'trust_id']);
    expect(event.payload.trust_id).toBe(subject.payload.trust_id);
    expect(event.payload.school_id).toBe(subject.payload.school_id);
    expect(event.payload.provenance).toEqual(subject.payload.provenance);
  });

  it('keeps every expected block to string or number values', () => {
    const deliveries = buildMutationDeliveries(buildBaseline());
    for (const delivery of deliveries) {
      for (const [key, value] of Object.entries(delivery.expected)) {
        expect(key.length).toBeGreaterThan(0);
        expect(typeof value === 'string' || typeof value === 'number').toBe(true);
      }
    }
  });

  it('throws a named error when the baseline has fewer than four events', () => {
    const baseline = buildBaseline();
    for (let count = 0; count < 4; count++) {
      let caught: unknown;
      try {
        buildMutationDeliveries(baseline.slice(0, count));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(MutationBaselineError);
      expect((caught as Error).name).toBe('MutationBaselineError');
      expect((caught as Error).message).toContain('at least 4');
      expect((caught as Error).message).toContain(`got ${count}`);
    }
  });
});
