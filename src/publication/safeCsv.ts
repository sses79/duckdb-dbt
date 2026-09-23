export type SafeCsvValue = string | number | boolean | null;

export class SafeCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SafeCsvError';
  }
}

const FORMULA_INTRODUCERS = new Set(['=', '+', '-', '@', '\t', '\r']);

function startsWithFormulaIntro(value: string): boolean {
  return FORMULA_INTRODUCERS.has(value[0] ?? '');
}

function needsQuoting(value: string): boolean {
  return value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r');
}

export function safeCsvCell(value: SafeCsvValue): string {
  if (value === null) {
    return '';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new SafeCsvError(`Cannot write non-finite number ${String(value)} to a CSV cell`);
    }
    return String(value);
  }
  let cell = value;
  if (startsWithFormulaIntro(cell)) {
    cell = `'${cell}`;
  }
  if (needsQuoting(cell)) {
    cell = `"${cell.replaceAll('"', '""')}"`;
  }
  return cell;
}

export function toSafeCsv(
  columns: readonly string[],
  rows: readonly Readonly<Record<string, SafeCsvValue>>[],
): string {
  const lines = [columns.map((column) => safeCsvCell(column)).join(',')];
  for (const row of rows) {
    const cells: string[] = [];
    for (const column of columns) {
      const value = row[column];
      if (value === undefined) {
        throw new SafeCsvError(`Row is missing a value for column ${column}`);
      }
      cells.push(safeCsvCell(value));
    }
    lines.push(cells.join(','));
  }
  return `${lines.join('\n')}\n`;
}
