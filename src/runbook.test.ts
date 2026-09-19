import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MAKE_TARGETS = ['help', 'check', 'generate', 'load', 'build', 'export', 'all'] as const;

describe('local runbook', () => {
  it('declares exactly the runbook targets as .PHONY', () => {
    const makefile = readFileSync('Makefile', 'utf8');
    const phonyLine = makefile.split('\n').find((line) => line.startsWith('.PHONY:'));
    expect(phonyLine).toBeDefined();
    expect(phonyLine!.slice('.PHONY:'.length).trim().split(/\s+/)).toEqual([...MAKE_TARGETS]);
  });

  it('names every make target in README.md', () => {
    const readme = readFileSync('README.md', 'utf8');
    for (const target of MAKE_TARGETS) {
      expect(readme).toContain(`make ${target}`);
    }
  });

  it('states that no survey data is committed', () => {
    const readme = readFileSync('README.md', 'utf8');
    expect(readme).toContain('No survey data is committed');
  });

  it('does not indent recipe lines with spaces', () => {
    const makefile = readFileSync('Makefile', 'utf8');
    for (const line of makefile.split('\n')) {
      expect(line).not.toMatch(/^ +[^ ]/);
    }
  });
});
