import { MAX_EXPORT_ROWS, assertWithinExportCap } from "./audit.limits";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function capturedMessage(run: () => void): string | null {
  try {
    run();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return null;
}

/** ADR 0021 decision 5 — the export row ceiling. */
export function runAuditLimitsTests(): void {
  // --- under and at the ceiling ---------------------------------------------
  assert(capturedMessage(() => assertWithinExportCap(0)) === null, "an empty export passes");
  assert(
    capturedMessage(() => assertWithinExportCap(MAX_EXPORT_ROWS)) === null,
    "exactly the cap passes — the comparison is `>`, not `>=`",
  );

  // --- one row over ---------------------------------------------------------
  const over = capturedMessage(() => assertWithinExportCap(MAX_EXPORT_ROWS + 1));
  assert(over !== null, "one row above the cap is refused");
  assert(
    (over ?? "").includes(String(MAX_EXPORT_ROWS + 1)),
    "the refusal names the matched count, so the caller knows how much to narrow by",
  );
  assert((over ?? "").includes(String(MAX_EXPORT_ROWS)), "the refusal names the limit too");

  // --- an injectable cap, so the rule is exercised without 50,000 rows ------
  assert(capturedMessage(() => assertWithinExportCap(2, 2)) === null, "custom cap: at the limit");
  const customOver = capturedMessage(() => assertWithinExportCap(3, 2));
  assert(customOver !== null, "custom cap: one over is refused");
  assert((customOver ?? "").includes("3 rows"), "custom refusal names the count");
  assert((customOver ?? "").includes("2 row limit"), "custom refusal names the cap");

  // The cap must never be satisfied by truncation — there is no code path that
  // returns a partial file, so the only observable outcomes are all or refuse.
  assert(MAX_EXPORT_ROWS === 50_000, "the measured cap is 50,000 (ADR 0021 decision 5)");
}
