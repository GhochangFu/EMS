import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import {
  assertAnInactiveRtuIsNotPlanned,
  assertCoalescePicksEachSidePerColumn,
  assertEveryRowCarriesResolvedMetadata,
  assertEveryRowCarriesTheOrganizationSwitch,
  assertKeyVersionArrivesAsAnInteger,
  assertThePayloadFormatJoin,
  assertTheOrganizationSwitchIsSelectedNotFiltered,
} from "./bindings.integration.spec.js";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate.js";

/**
 * `F2.7` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle.
 *
 * Run it against your own stack (docker-compose.override.yml remaps the
 * published port to 5433; 5432 is the committed default):
 *
 *   DATABASE_URL=postgres://bms_owner:bms_owner_dev@localhost:5433/bms \
 *     pnpm vitest run --project ingest apps/ingest/src/host/bindings.integration.test.ts
 */

const connectionString = requireIntegrationDb({
  item: "F2.7",
  label: "binding-query point-metadata tests",
  because:
    "they are the only check that BINDING_QUERY's five coalesced columns exist in the schema, " +
    "that the template_points join is a LEFT JOIN (an INNER one silently unbinds every " +
    "hand-created asset), and that Postgres returns them as JS numbers rather than strings.",
});

describe.skipIf(!connectionString)("F2.7 — resolved point metadata on the binding query", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F2.7");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("returns every binding with the five resolved columns, typed as the host reads them", async () => {
    await assertEveryRowCarriesResolvedMetadata(pool as pg.Pool);
  });

  it("resolves the template default and the asset override per column", async () => {
    await assertCoalescePicksEachSidePerColumn(pool as pg.Pool);
  });

  // `E8.4` / ADR 0062 decision 3. The suite's `describe` name predates it; this
  // case is about the credential key version, not the point metadata.
  it("returns key_version as a JS integer, null for an RTU with no config row", async () => {
    await assertKeyVersionArrivesAsAnInteger(pool as pg.Pool);
  });

  // `F4.330` / ADR 0115 decision 5.
  it("returns the organization code and switch on every row, typed as the host reads them", async () => {
    await assertEveryRowCarriesTheOrganizationSwitch(pool as pg.Pool);
  });

  it("selects a switched-off organization's rows rather than filtering them", async () => {
    await assertTheOrganizationSwitchIsSelectedNotFiltered(pool as pg.Pool);
  });

  // `F4.334` / ADR 0116 decision 4.
  it("joins the payload format catalog on the config's code, null for an unknown code", async () => {
    await assertThePayloadFormatJoin(pool as pg.Pool);
  });

  // `F4.339` / ADR 0117 decision 8.
  it("plans no row for an inactive RTU, and rows for the same RTU active", async () => {
    await assertAnInactiveRtuIsNotPlanned(pool as pg.Pool);
  });
});
