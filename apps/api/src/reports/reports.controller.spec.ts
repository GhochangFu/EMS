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

/** Collects what a handler sets on the response. Mirrors `audit.controller.spec.ts`. */
function stubResponse() {
  const headers: Record<string, string> = {};
  let sent: unknown = undefined;
  return {
    headers,
    get sent() {
      return sent;
    },
    res: {
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
      send(body: unknown) {
        sent = body;
      },
    },
  };
}

/**
 * ADR 0026 Amendment 2 (`F4.51`) — the xlsx route's headers.
 *
 * **This exists because the security review measured that the route had no gate
 * at all.** The metadata technique above cannot reach it: `energyXlsx` sets its
 * headers imperatively through `res.setHeader`, because the body is a `Buffer`
 * and the handler needs `@Res()`. Deleting `Cache-Control: no-store` from the
 * route passed every test in the repository.
 *
 * The header is the whole control against the shared-cache scope leak `F4.30`
 * closed for the CSV and `F4.14` for the audit export, and this response carries
 * the same asset codes, names and site names.
 *
 * This check is **stronger** than the metadata one beside it — it observes what
 * the handler actually sets, rather than what Nest recorded about it — and it is
 * still not a wire test. §4.6 applies unchanged.
 */
export async function runReportsXlsxHeaderTests(): Promise<void> {
  const body = Buffer.from("PK\u0003\u0004");
  const calls: unknown[] = [];
  const controller = new ReportsController(
    {
      energyXlsx: async (dto: unknown, ids: unknown) => {
        calls.push([dto, ids]);
        return body;
      },
    } as never,
    { readableAssetIds: async () => null } as never,
  );

  const out = stubResponse();
  await controller.energyXlsx(
    {} as never,
    { startDate: "2026-08-01", endDate: "2026-08-07" },
    out.res as never,
  );

  // The control: without this the three header assertions below could pass on a
  // handler that never ran its body. `F4.50` shipped a probe whose control could
  // not fire, three times, so this file states its own.
  assert(calls.length === 1, "the handler must have reached the service exactly once");
  assert(out.sent === body, "the workbook buffer is sent verbatim, not re-serialised");

  assert(
    out.headers["Content-Type"] ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    `the xlsx media type must be set, got ${out.headers["Content-Type"]}`,
  );
  assert(
    out.headers["Content-Disposition"] ===
      'attachment; filename="energy-consumption-report.xlsx"',
    `the disposition must name the file, got ${out.headers["Content-Disposition"]}`,
  );
  assert(
    out.headers["Cache-Control"] === "no-store",
    "the xlsx export is scope-filtered per user and must not be cached by a browser or " +
      "intermediary, or a shared-cache hit leaks one user's scope into another's response",
  );
}
