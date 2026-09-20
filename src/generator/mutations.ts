import { createHash } from 'node:crypto';

import type { SubmissionDeleteEvent, SubmissionEvent, SubmissionUpsertEvent } from './envelope.ts';
import { QUESTIONS } from './questions.ts';
import type { Question } from './questions.ts';

const MIN_BASELINE_EVENTS = 4;

const NEW_INSERT_NAMESPACE = 'school-wellbeing-demo:mutation:new-insert:';
const DAY_SECONDS = 86_400;

const BATCH_NEW_INSERTS = 'batch_m2_01_new_inserts';
const BATCH_CORRECTION = 'batch_m2_02_correction_duplicate';
const BATCH_LATE_OLDER = 'batch_m2_03_late_older_version';
const BATCH_WITHDRAWAL = 'batch_m2_04_withdrawal';
const BATCH_REPLAY = 'batch_m2_replay_late_older';

const EXTRACTED_AT = {
  newInserts: '2026-09-20T06:00:00.000Z',
  correction: '2026-09-20T07:00:00.000Z',
  lateOlder: '2026-09-20T08:00:00.000Z',
  replay: '2026-09-20T09:00:00.000Z',
  withdrawal: '2026-09-20T10:00:00.000Z',
} as const;

export interface MutationDelivery {
  batchId: string;
  scenario: string;
  events: SubmissionEvent[];
  expected: Record<string, string | number>;
}

export class MutationBaselineError extends Error {
  constructor(actual: number) {
    super(`Mutation baseline needs at least ${MIN_BASELINE_EVENTS} events; got ${actual}`);
    this.name = 'MutationBaselineError';
  }
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function idFromHash(prefix: string, hash: string): string {
  return `${prefix}${hash.slice(0, 24)}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function documentIdFrom(source: string): string {
  return idFromHash('doc_', sha256Hex(source));
}

function eventIdFrom(documentId: string, sourceVersion: number, operation: string): string {
  return idFromHash('evt_', sha256Hex(`${documentId}:${sourceVersion}:${operation}`));
}

function offsetTimestamp(from: string, offsetSeconds: number): string {
  return new Date(Date.parse(from) + offsetSeconds * 1000).toISOString();
}

function differingDocumentedAnswer(question: Question, excluded: readonly string[]): string {
  const answer = question.answers.find((candidate) => !excluded.includes(candidate));
  if (answer === undefined) {
    throw new Error(`No documented answer differs for question ${question.questionCode}`);
  }
  return answer;
}

function mutationAnswers(
  subject: SubmissionUpsertEvent,
): { question: Question; corrected: string; late: string } {
  for (const question of QUESTIONS) {
    const current = subject.payload.answers[question.questionCode];
    const corrected = differingDocumentedAnswer(question, current === null ? [] : [current]);
    const late = differingDocumentedAnswer(
      question,
      current === null ? [corrected] : [current, corrected],
    );
    return { question, corrected, late };
  }
  throw new Error('No question available for baseline mutation');
}

function buildNewInsert(
  template: SubmissionUpsertEvent,
  insertNumber: number,
): SubmissionUpsertEvent {
  const documentId = documentIdFrom(`${NEW_INSERT_NAMESPACE}${insertNumber}`);
  const event = clone(template);
  event.document_id = documentId;
  event.event_id = eventIdFrom(documentId, 1, 'upsert');
  event.operation = 'upsert';
  event.source_version = 1;
  event.source_updated_at = offsetTimestamp(template.source_updated_at, insertNumber * DAY_SECONDS);
  event.extracted_at = EXTRACTED_AT.newInserts;
  event.batch_id = BATCH_NEW_INSERTS;
  return event;
}

export function buildMutationDeliveries(
  baseline: readonly SubmissionUpsertEvent[],
): MutationDelivery[] {
  if (baseline.length < MIN_BASELINE_EVENTS) {
    throw new MutationBaselineError(baseline.length);
  }

  const subject = baseline[0];
  const withdrawalSubject = baseline[1];
  const insertTemplateOne = baseline[2];
  const insertTemplateTwo = baseline[3];
  if (
    subject === undefined ||
    withdrawalSubject === undefined ||
    insertTemplateOne === undefined ||
    insertTemplateTwo === undefined
  ) {
    throw new MutationBaselineError(baseline.length);
  }

  const mutation = mutationAnswers(subject);
  const correctedQuestionCode = mutation.question.questionCode;

  const newInsertOne = buildNewInsert(insertTemplateOne, 1);
  const newInsertTwo = buildNewInsert(insertTemplateTwo, 2);

  const correctedEvent = clone(subject);
  correctedEvent.event_id = eventIdFrom(subject.document_id, 3, 'upsert');
  correctedEvent.operation = 'upsert';
  correctedEvent.source_version = 3;
  correctedEvent.source_updated_at = offsetTimestamp(subject.source_updated_at, 2 * DAY_SECONDS);
  correctedEvent.extracted_at = EXTRACTED_AT.correction;
  correctedEvent.batch_id = BATCH_CORRECTION;
  correctedEvent.payload.answers[correctedQuestionCode] = mutation.corrected;

  const lateEvent = clone(subject);
  lateEvent.event_id = eventIdFrom(subject.document_id, 2, 'upsert');
  lateEvent.operation = 'upsert';
  lateEvent.source_version = 2;
  lateEvent.source_updated_at = offsetTimestamp(subject.source_updated_at, DAY_SECONDS);
  lateEvent.extracted_at = EXTRACTED_AT.lateOlder;
  lateEvent.batch_id = BATCH_LATE_OLDER;
  lateEvent.payload.answers[correctedQuestionCode] = mutation.late;

  const replayEvent = clone(lateEvent);
  replayEvent.batch_id = BATCH_REPLAY;
  replayEvent.extracted_at = EXTRACTED_AT.replay;

  const withdrawalEvent: SubmissionDeleteEvent = {
    event_id: eventIdFrom(withdrawalSubject.document_id, 2, 'delete'),
    document_id: withdrawalSubject.document_id,
    operation: 'delete',
    source_version: 2,
    source_updated_at: offsetTimestamp(withdrawalSubject.source_updated_at, 4 * DAY_SECONDS),
    extracted_at: EXTRACTED_AT.withdrawal,
    schema_version: withdrawalSubject.schema_version,
    batch_id: BATCH_WITHDRAWAL,
    region: withdrawalSubject.region,
    payload: {
      trust_id: withdrawalSubject.payload.trust_id,
      school_id: withdrawalSubject.payload.school_id,
      provenance: clone(withdrawalSubject.payload.provenance),
    },
  };

  return [
    {
      batchId: BATCH_NEW_INSERTS,
      scenario: 'Two synthetic new submissions inserted from baseline templates',
      events: [newInsertOne, newInsertTwo],
      expected: {
        new_insert_count: 2,
        new_document_1: newInsertOne.document_id,
        new_document_2: newInsertTwo.document_id,
      },
    },
    {
      batchId: BATCH_CORRECTION,
      scenario: 'Corrected answer duplicated at source_version 3',
      events: [clone(correctedEvent), clone(correctedEvent)],
      expected: {
        document_id: subject.document_id,
        winning_source_version: 3,
        corrected_question: correctedQuestionCode,
        corrected_answer: mutation.corrected,
      },
    },
    {
      batchId: BATCH_LATE_OLDER,
      scenario: 'Older corrected submission at source_version 2 loses to the correction',
      events: [lateEvent],
      expected: {
        document_id: subject.document_id,
        losing_source_version: 2,
        losing_question: correctedQuestionCode,
        losing_answer: mutation.late,
      },
    },
    {
      batchId: BATCH_WITHDRAWAL,
      scenario: 'Submission withdrawn with a delete at source_version 2',
      events: [withdrawalEvent],
      expected: {
        document_id: withdrawalSubject.document_id,
        deletion_source_version: 2,
      },
    },
    {
      batchId: BATCH_REPLAY,
      scenario: 'Replayed late older event deduplicated by event_id',
      events: [replayEvent],
      expected: {
        document_id: subject.document_id,
        replayed_source_version: 2,
        replay_of: BATCH_LATE_OLDER,
      },
    },
  ];
}
