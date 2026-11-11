import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../testing/integration-db-gate";
import {
  assertAServiceAccountIsNoAssignee,
  assertAServiceAccountIsNoCopilotOverrideTarget,
  assertTheIdentityLinkNeverTakesAServiceRow,
} from "./service-account-identity.integration.spec";

const connectionString = requireIntegrationDb({
  item: "F4.17",
  label: "the human-only users queries on a real database",
  because:
    "the kind = 'human' filters (ADR 0125 decision 10) are SQL predicates; only a real database " +
    "shows that a service row is refused by the exact query each one sits in, beside a human positive control.",
});

describe.skipIf(!connectionString)("F4.17 — a service account is never treated as a person (plan U9)", () => {
  let superPool: pg.Pool;
  let superDb: BmsDb;

  beforeAll(async () => {
    superPool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F4.17",
    );
    superDb = createDb(superPool);
  });

  afterAll(async () => {
    await superPool?.end();
  });

  it("the identity link never takes a service row, even for a verified matching email", async () => {
    await assertTheIdentityLinkNeverTakesAServiceRow(superDb);
  });

  it("a service account is no work-order assignee (a human of the same organization is)", async () => {
    await assertAServiceAccountIsNoAssignee(superDb);
  });

  it("a service account is no copilot override target (a human is)", async () => {
    await assertAServiceAccountIsNoCopilotOverrideTarget(superDb);
  });
});
