import { expect } from "vitest";

import {
  ROLE_PROVISIONING_SQL,
  buildRolePasswordStatements,
  resolveProvisioningUrl,
} from "./roles";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

export function assertOneEntryPerRoleWhenAllFourAreSet(): void {
  expect(
    buildRolePasswordStatements({
      BMS_OWNER_PASSWORD: "o",
      BMS_TENANT_PASSWORD: "t",
      BMS_FLEET_PASSWORD: "f",
      BMS_AUTH_PASSWORD: "a",
    }),
  ).toEqual([
    { role: "bms_owner", password: "o" },
    { role: "bms_tenant", password: "t" },
    { role: "bms_fleet", password: "f" },
    { role: "bms_auth", password: "a" },
  ]);
}

export function assertNamesEveryMissingVariableAtOnce(): void {
  expect(() => buildRolePasswordStatements({ BMS_FLEET_PASSWORD: "f" })).toThrow(
    "BMS_OWNER_PASSWORD, BMS_TENANT_PASSWORD, BMS_AUTH_PASSWORD",
  );
}

export function assertRefusesAnEmptyPassword(): void {
  expect(() =>
    buildRolePasswordStatements({
      BMS_OWNER_PASSWORD: "o",
      BMS_TENANT_PASSWORD: "",
      BMS_FLEET_PASSWORD: "f",
      BMS_AUTH_PASSWORD: "a",
    }),
  ).toThrow("BMS_TENANT_PASSWORD");
}

/**
 * ADR 0045 decision 1. `bms_owner` shipping `NOLOGIN` is the failure this
 * catches: every `DATABASE_URL` connection — migrate, seed, sim, ingest and
 * every integration fixture — fails to authenticate, and it fails after the
 * roles step reports success.
 */
export function assertTheOwnerIsProvisionedFirst(): void {
  const [first] = buildRolePasswordStatements({
    BMS_OWNER_PASSWORD: "o",
    BMS_TENANT_PASSWORD: "t",
    BMS_FLEET_PASSWORD: "f",
    BMS_AUTH_PASSWORD: "a",
  });
  expect(first.role).toBe("bms_owner");
}

/**
 * ADR 0045 decision 3 / Amendment 1. `db:roles` runs as the provisioning
 * superuser, and it is the only thing besides `migrate` that may. A silent
 * fallback to `DATABASE_URL` would make it run as the constrained owner, where
 * `CREATE ROLE` and `ALTER ROLE ... BYPASSRLS` both fail — but only after the
 * ordering change of decision 6 has already put it ahead of `db:migrate`.
 */
export function assertProvisioningDemandsTheSuperuserUrl(): void {
  expect(resolveProvisioningUrl({ DATABASE_URL_SUPERUSER: "postgres://s/db" })).toBe(
    "postgres://s/db",
  );
  expect(() => resolveProvisioningUrl({ DATABASE_URL: "postgres://owner/db" })).toThrow(
    "DATABASE_URL_SUPERUSER",
  );
}

/**
 * ADR 0045 decision 6: `db:roles` absorbs the role creation and the fleet
 * bypass from migration `0039`, so a fresh deployment has every role before
 * `db:migrate` runs.
 */
export function assertProvisioningCreatesEveryNonBootstrapRole(): void {
  const sql = ROLE_PROVISIONING_SQL.join("\n");
  for (const role of ["bms_owner", "bms_tenant", "bms_fleet", "bms_auth", "bms_rollup"]) {
    expect(sql).toContain(`CREATE ROLE ${role} NOLOGIN`);
  }
  // `bms_app` is created by initdb from `POSTGRES_USER` and is a pinned role
  // (oid 10). Creating it here would fail, and demoting it would contradict
  // decision 2, which keeps it a superuser on purpose.
  expect(sql).not.toContain("CREATE ROLE bms_app");
}

/**
 * ADR 0043 decision 12: the fleet bypass is a role attribute, and `FORCE ROW
 * LEVEL SECURITY` does not restrain it. `bms_owner` carrying `BYPASSRLS` would
 * make the whole of `E7.1a` a no-op while every test still passed.
 */
export function assertOnlyTheFleetRoleBypassesRowLevelSecurity(): void {
  const sql = ROLE_PROVISIONING_SQL.join("\n");
  expect(sql).toContain("ALTER ROLE bms_fleet BYPASSRLS");
  for (const role of ["bms_owner", "bms_tenant", "bms_auth", "bms_rollup"]) {
    expect(sql).toContain(`ALTER ROLE ${role} NOBYPASSRLS`);
  }
  expect(sql).not.toContain("ALTER ROLE bms_owner BYPASSRLS");
}

/**
 * `E7.1a`. `bms_rollup` owns the four ADR 0023 continuous aggregates and nothing
 * else, and `refresh_continuous_aggregate` needs *ownership* — no GRANT
 * substitutes. Three roles must be able to become it: `bms_owner` for
 * `pnpm db:refresh-aggregates`, and `bms_tenant`/`bms_fleet` for the post-commit
 * refresh in `TelemetryWriteService` and `CalcWriteService`.
 *
 * The negative half is the load-bearing one. Granting `bms_owner` to the pool
 * roles would also make the refresh work, and would hand the API full DDL over
 * both schemas — undoing the separation this whole item builds, while every test
 * stayed green.
 */
export function assertTheRollupRoleIsTheOnlyOneGranted(): void {
  const sql = ROLE_PROVISIONING_SQL.join("\n");
  expect(sql).toContain("GRANT bms_rollup TO bms_owner, bms_tenant, bms_fleet");
  expect(sql).not.toMatch(/GRANT bms_owner TO/);
  expect(sql).not.toMatch(/GRANT bms_fleet TO/);
}

/**
 * TimescaleDB's background workers connect **as the job owner**, so once the
 * four ADR 0023 refresh policies and the aggregates' compression and retention
 * jobs follow the aggregates to `bms_rollup`, the role needs `LOGIN` or every
 * one of them dies with `FATAL: role "bms_rollup" is not permitted to log in`.
 *
 * Measured rather than predicted, and this is why it is pinned: the failure is
 * invisible where you would look for it. `timescaledb_information.job_errors`
 * records only "failed to execute job", and the real message appears solely in
 * the server log. It is the exact quiet failure ADR 0045 names — a retention
 * policy that stops running looks like nothing at all for days.
 *
 * The negative half matters as much: `bms_rollup` must have **no password**, and
 * must stay out of `ROLE_ENV`. A background worker authenticates through none,
 * and under `scram-sha-256` a network client cannot authenticate as a role that
 * has none — so the attribute buys the scheduler its connection and an attacker
 * nothing. Giving it a password would quietly turn it into a reachable account
 * that can drop every rollup.
 */
export function assertTheRollupRoleCanRunBackgroundJobsButNotLogInRemotely(): void {
  const sql = ROLE_PROVISIONING_SQL.join("\n");
  expect(sql).toContain("ALTER ROLE bms_rollup LOGIN");
  expect(sql).not.toMatch(/bms_rollup[^\n]*PASSWORD/i);

  const roles = buildRolePasswordStatements({
    BMS_OWNER_PASSWORD: "o",
    BMS_TENANT_PASSWORD: "t",
    BMS_FLEET_PASSWORD: "f",
    BMS_AUTH_PASSWORD: "a",
  }).map((r) => r.role);
  expect(roles).not.toContain("bms_rollup");
}

/**
 * `db:roles` now runs before `db:migrate` on a fresh database, where neither
 * schema exists yet. Anything schema-scoped belongs in a migration, not here.
 */
export function assertProvisioningTouchesNoSchemaObject(): void {
  const sql = ROLE_PROVISIONING_SQL.join("\n");
  // A role-membership `GRANT <role> TO <role>` is permitted and is checked by
  // `assertTheRollupRoleIsTheOnlyOneGranted`. What must not appear is anything
  // scoped to a schema or a relation — on a fresh database neither `bms` nor
  // `telemetry` exists yet when this runs.
  for (const forbidden of [
    "REVOKE",
    "bms.",
    "telemetry.",
    "CREATE SCHEMA",
    "ON SCHEMA",
    "ON TABLE",
    "ON ALL",
    "DEFAULT PRIVILEGES",
  ]) {
    expect(sql).not.toContain(forbidden);
  }
}
