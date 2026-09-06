import { BadRequestException, ConflictException } from "@nestjs/common";
import { expect } from "vitest";

import { sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { withTenant } from "../database/tenant-context";
import type { EscalationProfilesService } from "./escalation-profiles.service";

/**
 * `F3.10` U8 (ADR 0057 decision 7, plan D6) — the `0066` policies on the four
 * escalation tables, driven against a real `bms_tenant` connection.
 *
 * Three of the four tables are junction-shaped and carry **no
 * `organization_id` of their own** (the `rule_notifications` precedent):
 * `alarm_escalation_steps` polices through its profile, and
 * `alarm_escalation_step_channels` through step → profile. A policy that reads
 * through a parent is exactly the kind that passes a `fleetDb` CRUD test
 * whether or not it exists, so the discriminating assertions below are the
 * tenant-side zeros on a second organization's GUC.
 *
 * **`alarm_escalation_defaults` carries a parent leg as well as its own
 * column**, and that leg is the one worth a real database: a foreign key is
 * checked with row security **off** (`0056:279-291`), so `profile_id
 * REFERENCES alarm_escalation_profiles(id)` on its own would happily let a
 * tenant map its severity to another tenant's profile. Nothing in the type
 * system, and nothing in a unit spec with a fake `BmsDb`, can see that.
 *
 * The service's own refusal is asserted here too, and it is a different claim
 * from the policy's: under `withTenant(orgB)` the parent leg answers with a
 * row-level-security error (SQLSTATE 42501), which no SQLSTATE translation
 * catches and which reaches an operator as "Internal server error". The
 * service asks first, under the same GUC, so the answer is a 400 that names
 * the profile — with the policy still underneath it as the floor.
 */

/** A profile in org A is invisible to org B and to a bare tenant connection. */
export async function assertProfileIsolatedFromOtherTenant(
  tenantDb: BmsDb,
  fleetDb: BmsDb,
  profileIdA: string,
  profileIdB: string,
  orgBId: string,
): Promise<void> {
  // Fail-closed with no context at all: `app.current_organization` is unset, so
  // the policy's `current_org` is NULL and no row satisfies `USING`.
  const noContext = await tenantDb.execute(
    sql`SELECT id FROM bms.alarm_escalation_profiles WHERE id IN (${profileIdA}, ${profileIdB})`,
  );
  expect(noContext.rows).toHaveLength(0);

  await withTenant(tenantDb, orgBId, async (tx) => {
    const seen = await tx.execute(
      sql`SELECT id FROM bms.alarm_escalation_profiles WHERE id IN (${profileIdA}, ${profileIdB})`,
    );
    expect(
      seen.rows.map((row) => (row as { id: string }).id),
      "under org B's GUC only org B's profile is visible — and the positive control is what " +
        "stops this passing because the tenant role simply cannot read the table at all",
    ).toEqual([profileIdB]);

    // Unmodifiable as well as unreadable: an UPDATE under FORCE matches zero
    // rows silently rather than raising, which is the failure mode a service
    // that trusted the row count would mistake for success.
    const updated = await tx.execute(
      sql`UPDATE bms.alarm_escalation_profiles SET name = 'tenant B must not reach this'
           WHERE id = ${profileIdA}`,
    );
    expect(updated.rowCount ?? 0).toBe(0);
  });

  // `bms_fleet` (BYPASSRLS) is the connection the lifecycle sweep reads the
  // catalogue on (D13), so it must see every tenant's profiles.
  const onFleet = await fleetDb.execute(
    sql`SELECT id FROM bms.alarm_escalation_profiles WHERE id IN (${profileIdA}, ${profileIdB})`,
  );
  expect(onFleet.rows).toHaveLength(2);
}

/**
 * A step and its channel join are invisible to another tenant **even when the
 * channel is fleet-wide**.
 *
 * The channel's organization is deliberately NOT in the `step_channels` policy
 * (D6) — a `NULL`-org channel is a legitimate target for any tenant, exactly as
 * `rule_notifications` treats one. So the isolation has to come from the step's
 * profile, and a fleet-wide channel is the case where a policy written against
 * the channel instead would silently let the row through.
 */
export async function assertStepAndChannelJoinIsolatedFromOtherTenant(
  tenantDb: BmsDb,
  fleetDb: BmsDb,
  stepIdA: string,
  fleetChannelId: string,
  orgAId: string,
  orgBId: string,
): Promise<void> {
  const fleetChannel = await fleetDb.execute(
    sql`SELECT organization_id FROM bms.notification_channels WHERE id = ${fleetChannelId}`,
  );
  expect(
    (fleetChannel.rows[0] as { organization_id: string | null }).organization_id,
    "sanity: this assertion is only meaningful while the channel really is fleet-wide",
  ).toBeNull();

  // The positive control, and it is not decoration: with no `SELECT` privilege
  // on these two tables at all, the org-B zeros below would hold for a reason
  // that has nothing to do with the policy reading through step → profile.
  await withTenant(tenantDb, orgAId, async (tx) => {
    const steps = await tx.execute(
      sql`SELECT id FROM bms.alarm_escalation_steps WHERE id = ${stepIdA}`,
    );
    expect(steps.rows, "org A's own step is visible under org A's GUC").toHaveLength(1);
    const links = await tx.execute(
      sql`SELECT channel_id FROM bms.alarm_escalation_step_channels WHERE step_id = ${stepIdA}`,
    );
    expect(links.rows, "and so is its fleet-wide channel join").toHaveLength(1);
  });

  await withTenant(tenantDb, orgBId, async (tx) => {
    const steps = await tx.execute(
      sql`SELECT id FROM bms.alarm_escalation_steps WHERE id = ${stepIdA}`,
    );
    expect(steps.rows, "org A's step is invisible to org B").toHaveLength(0);

    const links = await tx.execute(
      sql`SELECT channel_id FROM bms.alarm_escalation_step_channels WHERE step_id = ${stepIdA}`,
    );
    expect(
      links.rows,
      "the step-channel row is invisible to org B even though the channel is fleet-wide",
    ).toHaveLength(0);
  });

  const onFleet = await fleetDb.execute(
    sql`SELECT channel_id FROM bms.alarm_escalation_step_channels WHERE step_id = ${stepIdA}`,
  );
  expect(onFleet.rows).toHaveLength(1);
}

/**
 * Org B cannot map a severity to org A's profile — the parent leg — while the
 * same insert naming its own profile lands.
 *
 * The positive control is what makes the negative one mean something: without
 * it, a missing `INSERT` privilege on the table would produce the same "no row"
 * verdict and the parent leg could be absent entirely.
 */
export async function assertDefaultsParentLegRefusesAForeignProfile(
  tenantDb: BmsDb,
  fleetDb: BmsDb,
  orgBId: string,
  foreignProfileId: string,
  ownProfileId: string,
  severity: string,
): Promise<void> {
  // Positive control first: org B's own profile is accepted.
  await withTenant(tenantDb, orgBId, (tx) =>
    tx.execute(
      sql`INSERT INTO bms.alarm_escalation_defaults (organization_id, severity, profile_id)
          VALUES (${orgBId}, ${severity}, ${ownProfileId})`,
    ),
  );
  const own = await fleetDb.execute(
    sql`SELECT profile_id FROM bms.alarm_escalation_defaults
         WHERE organization_id = ${orgBId} AND severity = ${severity}`,
  );
  expect(
    (own.rows[0] as { profile_id: string } | undefined)?.profile_id,
    "the positive control must land, or the negative one below proves only a missing grant",
  ).toBe(ownProfileId);

  await withTenant(tenantDb, orgBId, (tx) =>
    tx.execute(
      sql`DELETE FROM bms.alarm_escalation_defaults
           WHERE organization_id = ${orgBId} AND severity = ${severity}`,
    ),
  );

  // The claim: org A's profile does not land, whether the policy refuses it
  // outright or the row simply never matches. The plan asks for "either way it
  // does NOT land", so the verdict is read back on the fleet connection rather
  // than inferred from how it failed.
  let refused = false;
  try {
    await withTenant(tenantDb, orgBId, (tx) =>
      tx.execute(
        sql`INSERT INTO bms.alarm_escalation_defaults (organization_id, severity, profile_id)
            VALUES (${orgBId}, ${severity}, ${foreignProfileId})`,
      ),
    );
  } catch {
    refused = true;
  }
  const landed = await fleetDb.execute(
    sql`SELECT profile_id FROM bms.alarm_escalation_defaults
         WHERE organization_id = ${orgBId} AND severity = ${severity}`,
  );
  expect(
    landed.rows,
    `org B mapped ${severity} to org A's profile and the row landed — the 0066 parent leg on ` +
      "alarm_escalation_defaults.profile_id is missing or wrong. A foreign key alone cannot " +
      "catch this: it is checked with row security off.",
  ).toHaveLength(0);
  expect(refused, "the policy refuses the write rather than quietly dropping it").toBe(true);
}

/**
 * A profile a severity still maps to cannot be deleted, and the refusal is a
 * 409.
 *
 * **This is the only place the constraint NAME is checked against Postgres.**
 * The unit spec drives `translate`'s branches with a fake error carrying
 * `constraint: "alarm_escalation_defaults_profile_id_fk"`, which asserts that
 * the service's constant matches the service's own fake and nothing more. The
 * name was read out of `0066_alarm_lifecycle.sql`, but a `CONSTRAINT … FK`
 * clause and what `pg_constraint` ends up holding are two different facts, and
 * a mismatch here would surface as "Internal server error" on the admin screen
 * — the exact incident `ChannelsService.remove` already carries.
 *
 * `setDefaults` writes the mapping, so the happy path of the severity map is
 * proven against the real policy on the way past.
 */
export async function assertAMappedProfileCannotBeDeleted(
  service: EscalationProfilesService,
  fleetDb: BmsDb,
  jwt: JwtPayload,
  orgBId: string,
  profileIdB: string,
  severity: string,
): Promise<void> {
  const written = await service.setDefaults(jwt, {
    organizationId: orgBId,
    items: [{ severity, profileId: profileIdB }],
  });
  expect(
    written.items.map((item) => `${item.severity}=${item.profileCode}`),
    "the severity map round-trips through the real policy, profile code and all",
  ).toHaveLength(1);

  let caught: unknown;
  try {
    await service.remove(jwt, profileIdB);
  } catch (err) {
    caught = err;
  }
  expect(
    caught instanceof ConflictException,
    `deleting a mapped profile must be a 409 — Postgres named the constraint something the ` +
      `service does not translate: ${String(caught)}`,
  ).toBe(true);

  const survived = await fleetDb.execute(
    sql`SELECT id FROM bms.alarm_escalation_profiles WHERE id = ${profileIdB}`,
  );
  expect(survived.rows, "and the profile is still there — NO ACTION means no delete").toHaveLength(1);

  // Leave the map empty so the delete order in `afterAll` is not load-bearing.
  const cleared = await service.setDefaults(jwt, { organizationId: orgBId, items: [] });
  expect(cleared.items, "an empty items array is how a severity is unmapped").toHaveLength(0);
}

/**
 * `setDefaults` answers 400 for a profile the target organization cannot see,
 * rather than letting the policy's 42501 surface as a 500.
 */
export async function assertSetDefaultsRefusesAForeignProfileWith400(
  service: EscalationProfilesService,
  jwt: JwtPayload,
  orgBId: string,
  foreignProfileId: string,
  severity: string,
): Promise<void> {
  let caught: unknown;
  try {
    await service.setDefaults(jwt, {
      organizationId: orgBId,
      items: [{ severity, profileId: foreignProfileId }],
    });
  } catch (err) {
    caught = err;
  }
  expect(
    caught instanceof BadRequestException,
    `mapping another organization's profile must be a 400, not whatever the policy raises: ${String(caught)}`,
  ).toBe(true);
  expect((caught as Error).message).toContain(foreignProfileId);
}
