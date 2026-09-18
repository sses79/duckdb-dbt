import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('repository guard rails', () => {
  it('keeps survey data out of Git', () => {
    const ignored = readFileSync('.gitignore', 'utf8').split('\n');
    expect(ignored).toContain('/data/*');
    expect(ignored).toContain('!/data/README.md');
    expect(ignored).toContain('/warehouse/');
    expect(ignored).toContain('/exports/');
  });

  it('anchors data directory patterns to the root so source directories stay tracked', () => {
    const ignored = readFileSync('.gitignore', 'utf8').split('\n');
    for (const name of ['data', 'generated-data', 'warehouse', 'exports']) {
      expect(ignored).not.toContain(`${name}/`);
      expect(ignored).not.toContain(`${name}/*`);
    }
  });
});
