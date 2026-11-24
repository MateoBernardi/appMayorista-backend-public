export function hasMaxDecimals(value: number, maxDecimals = 3): boolean {
  const factor = 10 ** maxDecimals;
  return Math.abs(Math.round(value * factor) - value * factor) < 1e-6;
}
