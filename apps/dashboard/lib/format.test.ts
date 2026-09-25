import { describe, expect, it } from 'vitest';
import {
  formatCount,
  formatPeriod,
  formatPp,
  formatRate,
  formatTimestamp,
} from './format.ts';

describe('formatRate', () => {
  it('renders a fraction as a percentage with one decimal', () => {
    expect(formatRate(0.07)).toBe('7.0%');
    expect(formatRate(0.1835)).toBe('18.4%');
    expect(formatRate(0)).toBe('0.0%');
  });

  it('renders Suppressed when the rate is null', () => {
    expect(formatRate(null)).toBe('Suppressed');
  });
});

describe('formatPp', () => {
  it('renders percentage points with two decimals and a sign for positives', () => {
    expect(formatPp(0.51)).toBe('+0.51 pp');
    expect(formatPp(-1.2)).toBe('-1.20 pp');
    expect(formatPp(0)).toBe('0.00 pp');
  });

  it('renders an em dash when the value is null', () => {
    expect(formatPp(null)).toBe('\u2014');
  });
});

describe('formatPeriod', () => {
  it('turns a YYYY-season string into Season YYYY', () => {
    expect(formatPeriod('2018-autumn')).toBe('Autumn 2018');
    expect(formatPeriod('2019-spring')).toBe('Spring 2019');
  });

  it('returns any other input unchanged', () => {
    expect(formatPeriod('term-3')).toBe('term-3');
  });
});

describe('formatCount', () => {
  it('renders counts with en-GB thousands separators', () => {
    expect(formatCount(1543)).toBe('1,543');
    expect(formatCount(0)).toBe('0');
  });

  it('renders an em dash when the count is null', () => {
    expect(formatCount(null)).toBe('\u2014');
  });
});

describe('formatTimestamp', () => {
  it('renders an ISO timestamp from its UTC fields', () => {
    expect(formatTimestamp('2026-09-25T08:24:27Z')).toBe('2026-09-25 08:24 UTC');
  });

  it('renders Not available for null or unparseable timestamps', () => {
    expect(formatTimestamp(null)).toBe('Not available');
    expect(formatTimestamp('not a date')).toBe('Not available');
  });
});
