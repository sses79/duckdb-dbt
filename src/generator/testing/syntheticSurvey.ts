import {
  COHORT_COLUMNS,
  QUESTIONS,
  SOURCE_COLUMN_COUNT,
} from '../questions.ts';

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function escapeField(value: string): string {
  if (/[",\\n]/.test(value)) {
    return `\"${value.replace(/\"/g, '\"\"')}\"`;
  }
  return value;
}

function groupHeaderRow(): string[] {
  const fields = new Array<string>(SOURCE_COLUMN_COUNT).fill('');
  fields[0] = 'index';
  for (let column = 1; column < SOURCE_COLUMN_COUNT; column++) {
    fields[column] = `Unnamed: ${column - 1}`;
  }
  return fields;
}

function semanticSubheaderRow(): string[] {
  const fields = new Array<string>(SOURCE_COLUMN_COUNT).fill('');
  fields[0] = '0';
  for (let column = 1; column < SOURCE_COLUMN_COUNT; column++) {
    fields[column] = `item_${column}`;
  }
  for (const cohort of COHORT_COLUMNS) {
    fields[cohort.sourceColumn] = cohort.itemLabel;
  }
  for (const question of QUESTIONS) {
    fields[question.sourceColumn] = question.itemLabel;
  }
  return fields;
}

function cohortColumn(field: string): number {
  const cohort = COHORT_COLUMNS.find((entry) => entry.field === field);
  if (cohort === undefined) {
    throw new Error(`Unknown cohort field: ${field}`);
  }
  return cohort.sourceColumn;
}

function pick<T>(choices: readonly T[], draw: () => number): T {
  const choice = choices[Math.floor(draw() * choices.length)];
  if (choice === undefined) {
    throw new Error('Synthetic survey pick returned an out-of-range value');
  }
  return choice;
}

const SCHOOL_CLASSIFICATIONS = ['Primary', 'Secondary', 'College'];
const YEAR_GROUPS = ['Year 5', 'Year 7', 'Year 9'];
const ROUTE_OUT_PROBABILITY = 0.18;

function responseRow(index: number, draw: () => number): string[] {
  const fields = new Array<string>(SOURCE_COLUMN_COUNT).fill('');
  fields[0] = String(index + 1);
  const routedToQuestionnaire = draw() >= ROUTE_OUT_PROBABILITY;
  fields[cohortColumn('source_id')] = String(10001 + index);
  fields[cohortColumn('school_classification')] = pick(SCHOOL_CLASSIFICATIONS, draw);
  fields[cohortColumn('local_authority')] = 'Leeds';
  fields[cohortColumn('year_group')] = pick(YEAR_GROUPS, draw);
  if (routedToQuestionnaire) {
    for (const question of QUESTIONS) {
      fields[question.sourceColumn] = pick(question.answers, draw);
    }
  }
  return fields;
}

export function buildSyntheticSurveyCsv(options: { rows: number; seed: number }): string {
  const draw = mulberry32(options.seed);
  const lines: string[][] = [groupHeaderRow(), semanticSubheaderRow()];
  for (let index = 0; index < options.rows; index++) {
    lines.push(responseRow(index, draw));
  }
  return lines.map((row) => row.map(escapeField).join(',')).join('\n') + '\n';
}
