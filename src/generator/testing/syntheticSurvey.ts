import { COHORT_COLUMNS, QUESTIONS, SOURCE_COLUMN_COUNT } from '../questions.ts';

interface Rng {
  next(): number;
}

const NOT_ROUTED_PROBABILITY = 0.18;
const QUOTE = String.fromCharCode(34);
const NEWLINE = String.fromCharCode(10);
const SCHOOL_CLASSIFICATIONS = ['Primary', 'Secondary', 'College'] as const;
const YEAR_GROUPS = ['Year 5', 'Year 7', 'Year 9'] as const;

function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      t = (t ^ (t >>> 14)) >>> 0;
      return t / 4294967296;
    },
  };
}

function encodeCsvField(value: string): string {
  if (value.includes(',') || value.includes(QUOTE) || value.includes(NEWLINE)) {
    return QUOTE + value.split(QUOTE).join(QUOTE.repeat(2)) + QUOTE;
  }
  return value;
}

function renderLine(fields: readonly string[]): string {
  return fields.map(encodeCsvField).join(',');
}

function buildGroupHeader(): string {
  const fields = new Array<string>(SOURCE_COLUMN_COUNT).fill('');
  fields[0] = 'index';
  for (let column = 1; column < SOURCE_COLUMN_COUNT; column += 1) {
    fields[column] = `Unnamed: ${column - 1}`;
  }
  return renderLine(fields);
}

function buildSemanticSubheader(): string {
  const itemLabelByColumn = new Map<number, string>();
  for (const cohort of COHORT_COLUMNS) {
    itemLabelByColumn.set(cohort.sourceColumn, cohort.itemLabel);
  }
  for (const question of QUESTIONS) {
    itemLabelByColumn.set(question.sourceColumn, question.itemLabel);
  }
  const fields = new Array<string>(SOURCE_COLUMN_COUNT).fill('');
  fields[0] = '0';
  for (let column = 1; column < SOURCE_COLUMN_COUNT; column += 1) {
    fields[column] = itemLabelByColumn.get(column) ?? `item_${column}`;
  }
  return renderLine(fields);
}

function buildResponseLine(rowIndex: number, rng: Rng): string {
  const fields = new Array<string>(SOURCE_COLUMN_COUNT).fill('');
  fields[0] = String(rowIndex + 1);
  fields[1] = String(10001 + rowIndex);
  fields[2] = 'Leeds';
  fields[3] = SCHOOL_CLASSIFICATIONS[Math.floor(rng.next() * SCHOOL_CLASSIFICATIONS.length)] ?? '';
  fields[4] = YEAR_GROUPS[Math.floor(rng.next() * YEAR_GROUPS.length)] ?? '';
  if (rng.next() >= NOT_ROUTED_PROBABILITY) {
    for (const question of QUESTIONS) {
      const answers = question.answers;
      fields[question.sourceColumn] = answers[Math.floor(rng.next() * answers.length)] ?? '';
    }
  }
  return renderLine(fields);
}

export function buildSyntheticSurveyCsv(options: { rows: number; seed: number }): string {
  const { rows, seed } = options;
  const rng = mulberry32(seed);
  const lines = new Array<string>(rows + 2);
  lines[0] = buildGroupHeader();
  lines[1] = buildSemanticSubheader();
  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    lines[rowIndex + 2] = buildResponseLine(rowIndex, rng);
  }
  return lines.join(NEWLINE) + NEWLINE;
}
