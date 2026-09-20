import { createHash } from 'node:crypto';

import type { QuestionCode } from './questions.ts';
import type { SourceResponse } from './source.ts';

export const SCHEMA_VERSION = 'wellbeing-submission/1';

export const SCHOOLS = [
  { schoolId: 'school_n01', trustId: 'trust_north' },
  { schoolId: 'school_n02', trustId: 'trust_north' },
  { schoolId: 'school_n03', trustId: 'trust_north' },
  { schoolId: 'school_s01', trustId: 'trust_south' },
  { schoolId: 'school_s02', trustId: 'trust_south' },
  { schoolId: 'school_s03', trustId: 'trust_south' },
] as const satisfies readonly { schoolId: string; trustId: string }[];

export const SURVEY_PERIODS = ['2018-autumn', '2019-spring'] as const;

const OPERATION = 'upsert' as const;
const SOURCE_VERSION = 1 as const;
const REGION = 'uk' as const;

const DOCUMENT_NAMESPACE = 'school-wellbeing-demo:document:';
const ASSIGNMENT_NAMESPACE = 'school-wellbeing-demo:assignment:';

const PERIOD_STARTS: Record<string, number> = {
  '2018-autumn': Date.parse('2018-10-01T00:00:00.000Z'),
  '2019-spring': Date.parse('2019-03-01T00:00:00.000Z'),
};

const DAY_SECONDS = 86_400;
const MAX_OFFSET_SECONDS = 50 * DAY_SECONDS;

export interface SubmissionUpsertEvent {
  event_id: string;
  document_id: string;
  operation: 'upsert';
  source_version: number;
  source_updated_at: string;
  extracted_at: string;
  schema_version: 'wellbeing-submission/1';
  batch_id: string;
  region: 'uk';
  payload: {
    trust_id: string;
    school_id: string;
    school_classification: string;
    year_group: string;
    local_authority: string;
    survey_period: '2018-autumn' | '2019-spring';
    answers: Record<QuestionCode, string | null>;
    provenance: {
      trust_id: 'generated_for_demo';
      school_id: 'generated_for_demo';
      survey_period: 'generated_for_demo';
      source_updated_at: 'generated_for_demo';
      document_id: 'generated_for_demo';
    };
  };
}

export interface SubmissionDeleteEvent {
  event_id: string;
  document_id: string;
  operation: 'delete';
  source_version: number;
  source_updated_at: string;
  extracted_at: string;
  schema_version: 'wellbeing-submission/1';
  batch_id: string;
  region: 'uk';
  payload: {
    trust_id: string;
    school_id: string;
    provenance: Record<string, string>;
  };
}

export type SubmissionEvent = SubmissionUpsertEvent | SubmissionDeleteEvent;

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function idFromHash(prefix: string, hash: string): string {
  return `${prefix}${hash.slice(0, 24)}`;
}

function intFromHex(hash: string, start: number, end: number): number {
  return parseInt(hash.slice(start, end), 16);
}

function periodStart(surveyPeriod: string): number {
  const start = PERIOD_STARTS[surveyPeriod];
  if (start === undefined) {
    throw new Error(`Unknown survey period: ${surveyPeriod}`);
  }
  return start;
}

export function buildSubmissionEvent(
  response: SourceResponse,
  options: { batchId: string; extractedAt: string },
): SubmissionUpsertEvent {
  const documentId = idFromHash('doc_', sha256Hex(`${DOCUMENT_NAMESPACE}${response.sourceId}`));
  const eventId = idFromHash('evt_', sha256Hex(`${documentId}:${SOURCE_VERSION}:${OPERATION}`));

  const assignmentHash = sha256Hex(`${ASSIGNMENT_NAMESPACE}${response.sourceId}`);
  const school = SCHOOLS[intFromHex(assignmentHash, 0, 8) % SCHOOLS.length];
  if (school === undefined) {
    throw new Error('No school assigned for response');
  }
  const surveyPeriod =
    SURVEY_PERIODS[intFromHex(assignmentHash, 8, 16) % SURVEY_PERIODS.length];
  if (surveyPeriod === undefined) {
    throw new Error('No survey period assigned for response');
  }
  const offsetSeconds = intFromHex(assignmentHash, 16, 24) % MAX_OFFSET_SECONDS;
  const sourceUpdatedAt = new Date(periodStart(surveyPeriod) + offsetSeconds * 1000).toISOString();

  return {
    event_id: eventId,
    document_id: documentId,
    operation: OPERATION,
    source_version: SOURCE_VERSION,
    source_updated_at: sourceUpdatedAt,
    extracted_at: options.extractedAt,
    schema_version: SCHEMA_VERSION,
    batch_id: options.batchId,
    region: REGION,
    payload: {
      trust_id: school.trustId,
      school_id: school.schoolId,
      school_classification: response.schoolClassification,
      year_group: response.yearGroup,
      local_authority: response.localAuthority,
      survey_period: surveyPeriod,
      answers: response.answers,
      provenance: {
        trust_id: 'generated_for_demo',
        school_id: 'generated_for_demo',
        survey_period: 'generated_for_demo',
        source_updated_at: 'generated_for_demo',
        document_id: 'generated_for_demo',
      },
    },
  };
}
