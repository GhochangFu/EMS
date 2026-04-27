/** Matches `DashboardService.estimatePue` in `apps/api` (prototype heuristic). */
export function estimatePue(totalKw: number): number {
  if (totalKw <= 0) {
    return 1;
  }
  const raw = 1.22 + Math.min(0.45, totalKw / 12_000);
  return Math.round(raw * 100) / 100;
}
