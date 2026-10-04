import { expect } from "vitest";

import { readRepoFile } from "../../testing/repo-root";

/**
 * `F4.139` (second pass) — a **source scan** proving that the RTU flags the
 * `telemetrySource` predicate needs are read on the tenant transaction, and
 * nowhere else in the instantiate path.
 *
 * Why a scan and not a behavioural case. The defect is *which connection* read
 * `bms.rtus`: `resolveTarget` used to run on `fleetDb` before `withTenant` opened
 * the transaction, so a batch was derived half from a snapshot taken before the
 * write began (`ingest_enabled`, `source_type`) and half from inside it
 * (`rtu_connection_configs`). Reproducing that split from a service test would
 * need a second connection to commit a flag change *between* the two reads,
 * inside one `instantiate` call, and the service offers no seam to interleave
 * on: an integration case can only flip the flag before the call, where both
 * reads see the same value and the old code passes. The sibling
 * `…integration.spec.ts` case I4 is therefore a tripwire, and this is the gate.
 *
 * **The instantiate path is three files since `F3.22` PR 1** (ADR 0091 decision
 * 1): the service (the `withTenant` wrapper), `asset-templates-instantiate-guards.ts`
 * and `asset-templates-instantiate-core.ts`, which holds `resolveTarget` and
 * `deriveTelemetrySource` as top-level functions. The count runs across all
 * three together, so "nowhere else" keeps its meaning after the split.
 *
 * Assertions live here; `asset-templates-instantiate.telemetry-source.test.ts`
 * is the Vitest entry point (§4.6 / ADR 0014). Each slice is anchored on a
 * declaration at the **start of a line**, so a docblock quoting a name cannot
 * satisfy the scan.
 */
const CORE = "apps/api/src/admin/asset-templates/asset-templates-instantiate-core.ts";
const PATH = [
  "apps/api/src/admin/asset-templates/asset-templates-instantiate.service.ts",
  "apps/api/src/admin/asset-templates/asset-templates-instantiate-guards.ts",
  CORE,
];

/** The column reference the predicate needs; `source_type` travels with it. */
const FLAG = "rtus.ingestEnabled";

/**
 * One top-level function: from `async function <name>(` (optionally exported) at
 * a line start, to the next line that begins at column 0 with anything but `}`
 * or `)` — the next top-level declaration or its docblock. Fails loudly when the
 * anchor is missing, so a rename cannot turn an assertion vacuous.
 */
function topLevelFunction(text: string, name: string): string {
  const anchor = new RegExp(`^(?:export )?async function ${name}\\(`, "m").exec(text);
  expect(anchor, `the instantiate core must declare a top-level async function ${name}(`).not.toBeNull();
  const from = (anchor as RegExpExecArray).index;
  // From the line after the declaration's first line, so the signature's own
  // remainder cannot count as "the next line at column 0".
  const bodyFrom = text.indexOf("\n", from) + 1;
  const next = /^[^\s})]/m.exec(text.slice(bodyFrom));
  return text.slice(from, next ? bodyFrom + next.index : text.length);
}

/**
 * The instantiate path names `rtus.ingestEnabled` exactly once.
 *
 * A count rather than an absence test on `resolveTarget` alone: the flag may be
 * read in exactly one place, and a second `fleetDb` select that re-widened any
 * other query — the target probe included — would be the same defect wearing a
 * different function name. The `resolveTarget` half is the positive control in
 * the same `expect` — it must still select the RTU it resolves, so a scan that
 * passed because the whole branch had been deleted is not a pass.
 */
export function assertTheRtuFlagIsNamedOnlyOnce(): void {
  const occurrences = PATH.map((rel) => readRepoFile(rel).split(FLAG).length - 1).reduce(
    (sum, n) => sum + n,
    0,
  );
  const resolveTarget = topLevelFunction(readRepoFile(CORE), "resolveTarget");
  expect({ occurrences, resolveTargetStillSelectsTheRtu: resolveTarget.includes("rtus.id") }).toEqual(
    { occurrences: 1, resolveTargetStillSelectsTheRtu: true },
  );
}

/**
 * And that one occurrence is inside `deriveTelemetrySource`, which selects on
 * `tx`.
 *
 * `await tx` and the flag in the same function body is what "the whole predicate
 * reads one snapshot" reduces to in text: `resolveTelemetrySource` already reads
 * `rtu_connection_configs` on the `tx` it is handed, and this function supplies
 * the other half from the same transaction.
 */
export function assertTheDerivationReadsTheFlagOnTheTenantTransaction(): void {
  const body = topLevelFunction(readRepoFile(CORE), "deriveTelemetrySource");
  expect({ readsTheFlag: body.includes(FLAG), onTx: body.includes("await tx") }).toEqual({
    readsTheFlag: true,
    onTx: true,
  });
}
