import { HEADERS_METADATA } from "@nestjs/common/constants";

import { ReportsController } from "./reports.controller";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type HeaderMeta = { name: string; value: string };

/**
 * `F4.30` — the energy CSV export is scope-filtered per user through
 * `readableAssetIds` and carries asset codes, names and site names, so a
 * shared-cache hit across two differently-scoped users leaks data across
 * scopes: the same failure `F4.14` closed for the audit export with
 * `Cache-Control: no-store`.
 *
 * This route sets its headers with the declarative `@Header(...)` decorator
 * (unlike the audit export, which is imperative), so — unlike
 * `audit.controller.spec.ts`, which reads the values a stub `Response`
 * received — this reads the header metadata Nest attaches to the route
 * handler itself.
 *
 * **This is a static stand-in, not the gate** (AGENTS.md §4.6). It asserts the
 * metadata `RouterExecutionContext` reads, not a header on a real response:
 * a Nest module cannot be instantiated under Vitest here, because esbuild
 * emits no `design:paramtypes` and every injected dependency resolves to
 * `undefined` (`F4.20`). That the header actually reaches the wire was
 * verified **manually** — `curl -i` against a live API instance on port 4001,
 * which answered `200` carrying `Cache-Control: no-store` — and that manual
 * check, not this file, is what proves the fix. Re-run it by hand if the route
 * changes; this test would stay green through a regression that only broke
 * delivery.
 */
export function runReportsControllerHeaderTests(): void {
  const headers = Reflect.getMetadata(
    HEADERS_METADATA,
    ReportsController.prototype.energyCsv,
  ) as HeaderMeta[] | undefined;

  assert(headers !== undefined, "energyCsv must declare response headers");
  assert(
    headers!.some(
      (h) => h.name === "Content-Type" && h.value === "text/csv; charset=utf-8",
    ),
    "content type must still be set",
  );
  assert(
    headers!.some(
      (h) =>
        h.name === "Content-Disposition" &&
        h.value === 'attachment; filename="energy-consumption-report.csv"',
    ),
    "content disposition must still be set",
  );
  assert(
    headers!.some((h) => h.name === "Cache-Control" && h.value === "no-store"),
    "the energy export is scope-filtered per user and must not be cached by a browser or " +
      "intermediary, or a shared-cache hit leaks one user's scope into another's response",
  );
}
