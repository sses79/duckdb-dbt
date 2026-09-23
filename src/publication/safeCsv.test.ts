import { describe, expect, it } from 'vitest';
import { SafeCsvError, safeCsvCell, toSafeCsv } from './safeCsv.js';
import type { SafeCsvValue } from './safeCsv.js';

describe('safeCsvCell', () => {
  it('prefixes strings beginning with =, +, -, @, a tab or a carriage return with a single quote', () => {
    expect(safeCsvCell('=1+1')).toBe("'=1+1");
    expect(safeCsvCell('+44')).toBe("'+44");
    expect(safeCsvCell('-1.25')).toBe("'-1.25");
    expect(safeCsvCell('@import')).toBe("'@import");
    expect(safeCsvCell('\tleading tab')).toBe("'\tleading tab");
    expect(safeCsvCell('\rleading return')).toBe("\"'\rleading return\"");
  });

  it('renders numbers as String(value) without a prefix', () => {
    expect(safeCsvCell(-1.25)).toBe('-1.25');
    expect(safeCsvCell(0)).toBe('0');
    expect(safeCsvCell(12.5)).toBe('12.5');
  });

  it('throws SafeCsvError for NaN and Infinity', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => safeCsvCell(value)).toThrow(SafeCsvError);
    }
  });

  it('renders null as an empty cell and booleans as true or false', () => {
    expect(safeCsvCell(null)).toBe('');
    expect(safeCsvCell(true)).toBe('true');
    expect(safeCsvCell(false)).toBe('false');
  });

  it('wraps cells containing commas, double quotes or line breaks in double quotes', () => {
    expect(safeCsvCell('a,b')).toBe('"a,b"');
    expect(safeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(safeCsvCell('line 1\nline 2')).toBe('"line 1\nline 2"');
    expect(safeCsvCell('line 1\rline 2')).toBe('"line 1\rline 2"');
  });
});

describe('toSafeCsv', () => {
  it('writes a header row followed by one line per row in the declared column order', () => {
    const rows: ReadonlyArray<Record<string, SafeCsvValue>> = [
      { id: 1, name: 'alice', ignored: '=leak' },
      { id: 2, name: 'bob' },
    ];
    expect(toSafeCsv(['id', 'name'], rows)).toBe('id,name\n1,alice\n2,bob\n');
  });

  it('returns the header line alone when there are no rows', () => {
    expect(toSafeCsv(['id', 'name'], [])).toBe('id,name\n');
  });

  it('throws SafeCsvError naming a missing declared column', () => {
    expect(() => toSafeCsv(['id', 'name'], [{ id: 1 }])).toThrow(SafeCsvError);
    expect(() => toSafeCsv(['id', 'name'], [{ id: 1 }])).toThrow(/name/);
  });

  it('ignores keys beyond the declared columns', () => {
    const output = toSafeCsv(['id'], [{ id: 1, secret: '=leak' }]);
    expect(output).toBe('id\n1\n');
    expect(output).not.toContain('leak');
  });

  it('applies the same string rules to header names', () => {
    expect(toSafeCsv(['=id', 'full, name'], [])).toBe("'=id,\"full, name\"\n");
  });
});
