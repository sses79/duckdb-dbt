export function formatRate(value: number | null): string {
  if (value === null) {
    return 'Suppressed';
  }
  const percentage = Math.round(value * 1000) / 10;
  return `${percentage.toFixed(1)}%`;
}

export function formatPp(value: number | null): string {
  if (value === null) {
    return '\u2014';
  }
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)} pp`;
}

export function formatPeriod(period: string): string {
  const match = /^(\d{4})-([a-z]+)$/.exec(period);
  if (match === null) {
    return period;
  }
  const season = capitalise(match[2]!);
  const year = match[1]!;
  return `${season} ${year}`;
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function formatCount(value: number | null): string {
  if (value === null) {
    return '\u2014';
  }
  return value.toLocaleString('en-GB');
}

export function formatTimestamp(value: string | null): string {
  if (value === null) {
    return 'Not available';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Not available';
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
}
