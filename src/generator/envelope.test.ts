import { describe, expect, it } from 'vitest';

import {
  SCHEMA_VERSION,
  SCHOOLS,
  SURVEY_PERIODS,
  buildSubmissionEvent,
} from './envelope.ts';
import { parseSurveySource } from './source.ts';
import type { SourceResponse } from './source.ts';
import { buildSyntheticSurveyCsv } from './testing/syntheticSurvey.ts';

const OPTIONS = {
  batchId: 'batch-demo-2026-09-18',
  extractedAt: '2026-09-18T09:30:00.000Z',
};

const PERIOD_STARTS: Record<string, number> = {
  '2018-autumn': Date.parse('2018-10-01T00:00:00.000Z'),
  '2019-spring': Date.parse('2019-03-01T00:00:00.000Z'),
};

const ROW_COUNT = 320;
const SEED = 11;

function syntheticResponses(): SourceResponse[] {
  return parseSurveySource(
    buildSyntheticSurveyCsv({ rows: ROW_COUNT, seed: SEED }),
  ).responses;
}

function first<T>(entries: readonly T[]): T {
  const entry = entries[0];
  if (entry === undefined) {
    throw new Error('Expected a non-empty list');
  }
  return entry;
}

function keyNames(value: unknown): string[] {
  if (value === null || typeof value !== 'object') {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(keyNames);
  }
  return Object.entries(value).flatMap(([key, child]) => [key, ...keyNames(child)]);
}

function stringValues(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (value === null || typeof value !== 'object') {
    return [];
  }
  const entries = Array.isArray(value) ? value : Object.values(value);
  return entries.flatMap(stringValues);
}

describe('buildSubmissionEvent', () => {
  it('is deterministic and JSON-serialisable', () => {
    const response = first(syntheticResponses());
    const event = buildSubmissionEvent(response, OPTIONS);
    expect(buildSubmissionEvent(response, OPTIONS)).toEqual(event);
    expect(JSON.parse(JSON.stringify(event))).toEqual(event);
  });

  it('fills envelope metadata', () => {
    const response = first(syntheticResponses());
    const event = buildSubmissionEvent(response, OPTIONS);
    expect(event.event_id).toMatch(/^evt_[0-9a-f]{24}$/);
    expect(event.document_id).toMatch(/^doc_[0-9a-f]{24}$/);
    expect(event.operation).toBe('upsert');
    expect(event.source_version).toBe(1);
    expect(event.extracted_at).toBe(OPTIONS.extractedAt);
    expect(event.schema_version).toBe(SCHEMA_VERSION);
    expect(event.schema_version).toBe('wellbeing-submission/1');
    expect(event.batch_id).toBe(OPTIONS.batchId);
    expect(event.region).toBe('uk');
    expect(event.payload.school_classification).toBe(response.schoolClassification);
    expect(event.payload.local_authority).toBe(response.localAuthority);
    expect(event.payload.year_group).toBe(response.yearGroup);
  });

  it('derives distinct document and event ids for different responses', () => {
    const events = syntheticResponses().map((response) =>
      buildSubmissionEvent(response, OPTIONS),
    );
    expect(new Set(events.map((event) => event.document_id)).size).toBe(events.length);
    expect(new Set(events.map((event) => event.event_id)).size).toBe(events.length);
  });

  it('never exposes the raw source id or source line number', () => {
    for (const response of syntheticResponses()) {
      const event = buildSubmissionEvent(response, OPTIONS);
      const keys = keyNames(event);
      expect(keys).not.toContain('source_id');
      expect(keys).not.toContain('sourceId');
      expect(keys).not.toContain('source_line_number');
      expect(keys).not.toContain('sourceLineNumber');
      for (const value of stringValues(event)) {
        expect(value).not.toBe(response.sourceId);
        expect(value).not.toBe(String(response.sourceLineNumber));
      }
    }
  });

  it('covers both trusts, all six schools and both survey periods', () => {
    const events = syntheticResponses().map((response) =>
      buildSubmissionEvent(response, OPTIONS),
    );
    expect(new Set(events.map((event) => event.payload.trust_id))).toEqual(
      new Set(SCHOOLS.map((school) => school.trustId)),
    );
    expect(new Set(events.map((event) => event.payload.school_id))).toEqual(
      new Set(SCHOOLS.map((school) => school.schoolId)),
    );
    expect(new Set(events.map((event) => event.payload.survey_period))).toEqual(
      new Set(SURVEY_PERIODS),
    );
  });

  it('assigns each school to exactly one trust', () => {
    const trustBySchoolId = new Map<string, string>();
    for (const school of SCHOOLS) {
      expect(trustBySchoolId.get(school.schoolId)).toBeUndefined();
      trustBySchoolId.set(school.schoolId, school.trustId);
    }
    for (const event of syntheticResponses().map((response) =>
      buildSubmissionEvent(response, OPTIONS),
    )) {
      expect(event.payload.trust_id).toBe(trustBySchoolId.get(event.payload.school_id));
      expect(['trust_north', 'trust_south']).toContain(event.payload.trust_id);
    }
  });

  it('keeps source_updated_at within 50 days of the period start', () => {
    for (const event of syntheticResponses().map((response) =>
      buildSubmissionEvent(response, OPTIONS),
    )) {
      const start = PERIOD_STARTS[event.payload.survey_period];
      if (start === undefined) {
        throw new Error(`Unknown survey period: ${event.payload.survey_period}`);
      }
      const updatedAt = Date.parse(event.source_updated_at);
      expect(Number.isNaN(updatedAt)).toBe(false);
      expect(event.source_updated_at).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
      expect(updatedAt).toBeGreaterThanOrEqual(start);
      expect(updatedAt - start).toBeLessThan(50 * 86_400 * 1_000);
    }
  });

  it('preserves every answer including nulls', () => {
    const events = syntheticResponses().map((response) => ({
      event: buildSubmissionEvent(response, OPTIONS),
      response,
    }));
    expect(
      events.some(({ response }) => Object.values(response.answers).includes(null)),
    ).toBe(true);
    for (const { event, response } of events) {
      expect(event.payload.answers).toEqual(response.answers);
    }
  });

  it('marks every generated field as generated_for_demo', () => {
    const event = buildSubmissionEvent(first(syntheticResponses()), OPTIONS);
    expect(event.payload.provenance).toEqual({
      trust_id: 'generated_for_demo',
      school_id: 'generated_for_demo',
      survey_period: 'generated_for_demo',
      source_updated_at: 'generated_for_demo',
      document_id: 'generated_for_demo',
    });
    expect(
      Object.values(event.payload.provenance).every(
        (value) => value === 'generated_for_demo',
      ),
    ).toBe(true);
  });
});
