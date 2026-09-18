import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { writeBatch } from './batch.ts';
import { buildSubmissionEvent } from './envelope.ts';
import { parseSurveySource } from './source.ts';

const DEFAULT_EXTRACTED_AT = '2019-07-31T00:00:00.000Z';

export async function main(argv: string[]): Promise<number> {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        source: { type: 'string' },
        out: { type: 'string' },
        'batch-id': { type: 'string' },
        'extracted-at': { type: 'string', default: DEFAULT_EXTRACTED_AT },
      },
    });

    const source = values.source;
    const out = values.out;
    const batchId = values['batch-id'];
    if (typeof source !== 'string') {
      throw new Error('Missing required option: --source');
    }
    if (typeof out !== 'string') {
      throw new Error('Missing required option: --out');
    }
    if (typeof batchId !== 'string') {
      throw new Error('Missing required option: --batch-id');
    }

    const extractedAt = values['extracted-at'];
    if (typeof extractedAt !== 'string') {
      throw new Error('Missing required option: --extracted-at');
    }

    const csv = await readFile(source, 'utf8');
    const survey = parseSurveySource(csv);
    const events = survey.responses.map((response) =>
      buildSubmissionEvent(response, { batchId, extractedAt }),
    );

    const manifest = await writeBatch({
      events,
      outputDir: out,
      batchId,
      scenario: 'initial_load',
      expected: { current_documents: survey.responses.length },
    });

    console.log(manifest.batch_id);
    console.log(manifest.row_count);
    console.log(manifest.data_file_sha256);

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
