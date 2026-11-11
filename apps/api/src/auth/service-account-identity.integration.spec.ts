import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";

import { CopilotAccessService } from "../copilot/copilot-access.service";
import type { BmsTx } from "../database/tenant-context";
import { withRollback } from "../testing/with-rollback";
import { readActiveOrganizationUser } from "../work-orders/assignee";
import { linkIdentity } from "./identity-resolver";

/**
 * `F4.17` / ADR 0125 decision 10, plan U9 — the human-only filters by
 * behaviour, on a real database (code review of PR 3, false green 4: a text
 * count proves the literal exists, not which query it sits in). Each case
 * inserts one service row and one human row of the same organization inside
 * a rolled-back transaction, and the human row is the positive control: the
 * same call that answers `null` for the service row answers the human one.
 */

type Pair = { organizationId: string; serviceId: string; serviceEmail: string; humanId: string };

async function aServiceAndAHuman(tx: Pick<BmsDb, "execute">): Promise<Pair> {
  const run = randomUUID().slice(0, 8);
  const org = (await tx.execute(sql`SELECT id FROM bms.organizations ORDER BY created_at, code LIMIT 1`)) as unknown as {
    rows: Array<{ id: string }>;
  };
  const organizationId = org.rows[0]?.id;
  if (!organizationId) throw new Error("F4.17: needs a seeded organization — run pnpm db:seed.");
  const serviceId = randomUUID();
  const humanId = randomUUID();
  const serviceEmail = `svc-${run}@service-account.invalid`;
  await tx.execute(sql`
    INSERT INTO bms.users (id, organization_id, email, display_name, role, kind)
    VALUES (${serviceId}::uuid, ${organizationId}::uuid, ${serviceEmail}, 'F4.17 service', 'operator', 'service'),
           (${humanId}::uuid, ${organizationId}::uuid, ${`human-${run}@bms.local`}, 'F4.17 human', 'operator', 'human')
  `);
  return { organizationId, serviceId, serviceEmail, humanId };
}

/** As `bms_auth`: an IdP account whose verified email equals a service row's links nothing. */
export async function assertTheIdentityLinkNeverTakesAServiceRow(superDb: BmsDb): Promise<void> {
  let linked: unknown = "unset";
  let subjectAfter: unknown = "unset";
  await withRollback(superDb, async (tx) => {
    const pair = await aServiceAndAHuman(tx);
    await tx.execute(sql`SET LOCAL ROLE bms_auth`);
    linked = await linkIdentity(tx, { sub: `f4.17-${randomUUID()}`, email: pair.serviceEmail, emailVerified: true });
    const after = (await tx.execute(
      sql`SELECT oidc_subject FROM bms.users WHERE id = ${pair.serviceId}::uuid`,
    )) as unknown as { rows: Array<{ oidc_subject: string | null }> };
    subjectAfter = after.rows[0]?.oidc_subject;
    tx.rollback();
  });
  expect(linked).toBeNull();
  expect(subjectAfter).toBeNull();
}

/** In the organization's tenant transaction: a service account is no work-order assignee. */
export async function assertAServiceAccountIsNoAssignee(superDb: BmsDb): Promise<void> {
  let service: unknown = "unset";
  let human: unknown = "unset";
  await withRollback(superDb, async (tx) => {
    const pair = await aServiceAndAHuman(tx);
    await tx.execute(sql`SELECT set_config('app.current_organization', ${pair.organizationId}, true)`);
    await tx.execute(sql`SET LOCAL ROLE bms_tenant`);
    service = await readActiveOrganizationUser(tx as unknown as BmsTx, pair.serviceId, pair.organizationId);
    human = await readActiveOrganizationUser(tx as unknown as BmsTx, pair.humanId, pair.organizationId);
    tx.rollback();
  });
  expect(service).toBeNull();
  expect(human).toEqual(expect.objectContaining({ displayName: "F4.17 human" }));
}

/** As `bms_auth`: a service account is no copilot override target. */
export async function assertAServiceAccountIsNoCopilotOverrideTarget(superDb: BmsDb): Promise<void> {
  let service: unknown = "unset";
  let human: unknown = "unset";
  await withRollback(superDb, async (tx) => {
    const pair = await aServiceAndAHuman(tx);
    await tx.execute(sql`SET LOCAL ROLE bms_auth`);
    const access = new CopilotAccessService(
      undefined as unknown as BmsDb,
      tx as unknown as BmsDb,
      undefined as never,
      undefined as never,
    );
    service = await access.loadOverrideTarget(pair.serviceId);
    human = await access.loadOverrideTarget(pair.humanId);
    tx.rollback();
  });
  expect(service).toBeNull();
  expect(human).toEqual(expect.objectContaining({ role: "operator" }));
}
