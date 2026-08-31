import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F4.73` — the simulator reads `bms.assets` inside a tenant context.
 *
 * **The defect this guards was silent in the worst way.** `bms.assets` has
 * carried a `tenant_isolation` policy since migration `0047`, and the simulator
 * connects as `bms_owner`, which `FORCE ROW LEVEL SECURITY` binds. A `SELECT`
 * with no `app.current_organization` therefore returns **zero rows rather than
 * an error**, and the process reported that as `No assets in bms.assets — run
 * pnpm db:seed`. Nothing in the repository failed: not the type checker, not a
 * test, not CI. The simulator simply stopped writing telemetry, and the demo
 * database has held no fresh sample since.
 *
 * A static check is the right gate precisely because of that. `apps/sim` is not
 * a Vitest project and the only behavioural proof is "run it against a policied
 * database and see rows", which no suite does. What follows reads the source.
 *
 * The rules held here are ADR 0043 decision 10's, and each one has a failure
 * that looks like something else:
 *
 *  - **A context is set at all.** Without it the read is empty and blames the seed.
 *  - **`is_local = true`, inside a transaction.** `set_config(..., true)` outside
 *    a transaction sets the value for the whole *session*, which on a pooled
 *    connection leaks one tenant's context into the next caller — and works
 *    perfectly until a second organization exists.
 *  - **A bind parameter, never a concatenated `SET LOCAL`.** The same rule
 *    `withTenant` follows.
 *  - **Every `bms.assets` read is inside the per-organization helper.** A second
 *    read added later outside it reintroduces the whole defect for one caller.
 *  - **No `limit` inside the per-organization query.** `SIM_ASSET_COUNT` means
 *    "the first N assets by code"; a limit inside the loop means N *per tenant*,
 *    so the simulator's load would grow with every organization added.
 */

const simEntry = fileURLToPath(new URL("../apps/sim/src/index.js", import.meta.url));

/**
 * Comments are stripped first, on `tests/adr-0043-database-url-guard.test.ts`'s
 * precedent: this file's own subject appears in the simulator's prose, and a
 * check that a docblock satisfies would be no check at all.
 *
 * The `[^:]` guard keeps `http://` and `:${port}/metrics` intact.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const code = stripComments(readFileSync(simEntry, "utf8"));

/** A top-level `async function`'s text, up to its column-0 closing brace. */
function bodyOf(name: string): string {
  const start = code.indexOf(`async function ${name}(`);
  expect(start, `${name}() is missing from apps/sim/src/index.js`).toBeGreaterThanOrEqual(0);
  const end = code.indexOf("\n}\n", start);
  expect(end, `${name}() has no closing brace at column 0`).toBeGreaterThan(start);
  return code.slice(start, end);
}

describe("F4.73 — the simulator sets a tenant context before reading bms.assets", () => {
  it("sets app.current_organization as a bind parameter, local to the transaction", () => {
    const body = bodyOf("loadAssetsForOrganization");
    expect(body).toContain("select set_config('app.current_organization', $1, true)");
    expect(code).not.toMatch(/SET\s+LOCAL/i);
  });

  it("opens the transaction before setting the context, not after", () => {
    const body = bodyOf("loadAssetsForOrganization");
    const begin = body.indexOf('"begin"');
    const setConfig = body.indexOf("set_config");
    expect(begin, "no begin in loadAssetsForOrganization").toBeGreaterThanOrEqual(0);
    expect(setConfig).toBeGreaterThan(begin);
  });

  it("reads bms.assets nowhere but inside that helper", () => {
    // `from`/`join`, not the bare table name: the failure message in `main()`
    // names the table too, and that mention is not a read.
    const reads = /\b(from|join)\s+bms\.assets\b/gi;
    const everywhere = code.match(reads) ?? [];
    const inHelper = bodyOf("loadAssetsForOrganization").match(reads) ?? [];
    expect(everywhere.length).toBeGreaterThan(0);
    expect(everywhere.length).toBe(inHelper.length);
  });

  it("caps assets across organizations rather than inside the per-tenant query", () => {
    expect(bodyOf("loadAssetsForOrganization")).not.toMatch(/\blimit\b/i);
    expect(bodyOf("loadAssets")).toContain("assetLimit");
  });
});
