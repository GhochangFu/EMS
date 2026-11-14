/**
 * `F4.364` (ADR 0133 decision 4) — the kW figure's text. The summary's `totalKw` is `null` when
 * energy is not shown or no asset has a `kw` value, and that reads `—`, never `0.0`.
 */
export function kwText(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}
