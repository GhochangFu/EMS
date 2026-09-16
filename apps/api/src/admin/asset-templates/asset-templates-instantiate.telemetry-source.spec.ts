import { expect } from "vitest";

import { readRepoFile } from "../../testing/repo-root";
import { methodBody } from "../../testing/source-scan";

/**
 * `F4.139` (second pass) — a **source scan** proving that the RTU flags the
 * `telemetrySource` predicate needs are read on the tenant transaction, and
 * nowhere else in `asset-templates-instantiate.service.ts`.
 *
 * Why a scan and not a behavioural case. The defect is *which connection* read
 * `bms.rtus`: `resolveTarget` runs on `fleetDb` before `withTenant` opens the
 * transaction, so a batch was derived half from a snapshot taken before the
 * write began (`ingest_enabled`, `source_type`) and half from inside it
 * (`rtu_connection_configs`). Reproducing that split from a service test would
 * need a second connection to commit a flag change *between* the two reads,
 * inside one `instantiate` call, and the service offers no seam to interleave
 * on: an integration case can only flip the flag before the call, where both
 * reads see the same value and the old code passes. The sibling
 * `…integration.spec.ts` case I4 is therefore a tripwire, and this is the gate.
 *
 * Assertions live here; `asset-templates-instantiate.telemetry-source.test.ts`
 * is the Vitest entry point (§4.6 / ADR 0014). Text scans have precedent in
 * this repository (`asset-images-write.controller.spec.ts`), and `methodBody`
 * anchors on a declaration at a line start so a docblock quoting a name cannot
 * satisfy the scan.
 */
const SERVICE = "apps/api/src/admin/asset-templates/asset-templates-instantiate.service.ts";

/** The column reference the predicate needs; `source_type` travels with it. */
const FLAG = "rtus.ingestEnabled";

function source(): string {
  return readRepoFile(SERVICE);
}

/** `deriveTelemetrySource` runs from its declaration to the next method's. */
function derivationBody(text: string): string {
  return methodBody(
    text,
    "private async deriveTelemetrySource(",
    "private async assertCatalogActive(",
  );
}

/**
 * The service names `rtus.ingestEnabled` exactly once.
 *
 * A count rather than an absence test on `resolveTarget` alone: the flag may be
 * read in exactly one place, and a second `fleetDb` select that re-widened any
 * other query would be the same defect wearing a different method name. The
 * `resolveTarget` half is the positive control in the same `expect` — it must
 * still select the RTU it resolves, so a scan that passed because the whole
 * branch had been deleted is not a pass.
 */
export function assertTheRtuFlagIsNamedOnlyOnce(): void {
  const text = source();
  const occurrences = text.split(FLAG).length - 1;
  const resolveTarget = methodBody(
    text,
    "private async resolveTarget(",
    "private async deriveTelemetrySource(",
  );
  expect({ occurrences, resolveTargetStillSelectsTheRtu: resolveTarget.includes("rtus.id") }).toEqual(
    { occurrences: 1, resolveTargetStillSelectsTheRtu: true },
  );
}

/**
 * And that one occurrence is inside `deriveTelemetrySource`, which selects on
 * `tx`.
 *
 * `await tx` and the flag in the same method body is what "the whole predicate
 * reads one snapshot" reduces to in text: `resolveTelemetrySource` already reads
 * `rtu_connection_configs` on the `tx` it is handed, and this method supplies
 * the other half from the same transaction.
 */
export function assertTheDerivationReadsTheFlagOnTheTenantTransaction(): void {
  const body = derivationBody(source());
  expect({ readsTheFlag: body.includes(FLAG), onTx: body.includes("await tx") }).toEqual({
    readsTheFlag: true,
    onTx: true,
  });
}
