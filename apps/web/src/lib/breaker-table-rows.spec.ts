import type { BreakerRowState } from "./breaker-table-rows";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `F3.74` review nit — `sld.tsx`'s two status chains (`Breaker`'s circle and text, the feed's
 * stroke) name `offline`, `open`, `critical` and `warning`, and send every other status to the
 * closed (accent) style. A rule-derived state is never `tripped` or `unknown` — those come from a
 * breaker's state keys (`breaker-site-rows.ts`) — so `BreakerRowState.status` excludes both, and a
 * page that one day derives them must widen the type and meet those chains at compile time.
 *
 * The claim is the compiler's: this file is type-checked through its `.test.ts` import, and each
 * `@ts-expect-error` is itself an error ("Unused '@ts-expect-error' directive") once the type
 * admits the value again. Mutation: widen `status` back to `BreakerVisualStatus` => `tsc` red.
 */
export function rowStateExcludesTrippedAndUnknown(): void {
  const tripped: BreakerRowState = {
    // @ts-expect-error — a rule-derived state is never tripped.
    status: "tripped",
    matchedRule: null,
    stale: false,
  };
  const unknown: BreakerRowState = {
    // @ts-expect-error — a rule-derived state is never unknown.
    status: "unknown",
    matchedRule: null,
    stale: false,
  };
  const closed: BreakerRowState = { status: "normal", matchedRule: null, stale: false };
  assert(
    [tripped.status, unknown.status, closed.status].join(",") === "tripped,unknown,normal",
    "the fixtures keep their statuses at run time; the claim is the compile-time one above",
  );
}
