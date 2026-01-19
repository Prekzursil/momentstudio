export function parseMoney(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const num = Number(value.trim());
    return Number.isFinite(num) ? num : 0;
  }
  if (typeof value === 'bigint') {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }
  return 0;
}

