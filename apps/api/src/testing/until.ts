/**
 * `F3.7` — a bounded poll for an effect a spec cannot await.
 *
 * ADR 0041 decision 1 makes `NotificationsService.dispatch` fire-and-forget
 * from both raise paths: `notifyOnRaise` (`rules/rule-actions.ts`) starts the
 * promise and returns without it, so nothing a spec can `await` resolves when
 * the ledger row lands. The spec waits for the *effect* instead — a recorded
 * call, a `bms.notification_deliveries` row — and this is the one bounded way
 * to do that. A bare `setTimeout` guesses a duration; an unbounded loop hangs
 * the runner when the effect never comes, which is exactly the failure the
 * spec exists to catch.
 *
 * A `check` that throws is a spec bug, not a timeout, and propagates as-is.
 */
export class UntilTimeoutError extends Error {
  constructor(timeoutMs: number, label: string | undefined) {
    super(`until(${label ?? "condition"}) did not hold within ${timeoutMs} ms`);
    this.name = "UntilTimeoutError";
  }
}

export async function until(
  check: () => boolean | Promise<boolean>,
  {
    timeoutMs = 5_000,
    intervalMs = 50,
    label,
  }: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new UntilTimeoutError(timeoutMs, label);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
}
