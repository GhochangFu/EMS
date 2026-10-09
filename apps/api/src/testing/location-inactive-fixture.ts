import { HttpException } from "@nestjs/common";
import type pg from "pg";
import { expect } from "vitest";

import { locationWriteRefusalSchema } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import { jwtFor, rememberSubject } from "./seeded-subjects";

/**
 * `F2.10` Unit E — the per-run fixture the `assertLocationActive`, asset and
 * RTU inactive-location suites share, and the 409 `location_inactive` check.
 *
 * Every fixture is committed inside one organization the run creates
 * (`F210E-<prefix>-<run>`) and deleted by `dropInactiveFixture`, never inside
 * a seeded one: an `UPDATE … SET active` on a location fires the tree-guard
 * trigger, which takes an advisory lock per organization, and a fixture in a
 * seeded organization would serialize sibling suites.
 *
 * Kept out of the `assertLocationActive` spec, which rolls its transactions
 * back: the cleanup here deletes from `bms.assets`, and
 * `tests/integration-fixture-isolation.test.ts` refuses that text in a
 * rollback-isolated spec.
 */

function fail(message: string): never {
  throw new Error(message);
}

export type InactiveFixture = {
  readonly run: string;
  readonly organizationId: string;
  readonly orgAdmin: JwtPayload;
  /** A root location, committed on the superuser pool. */
  node(tag: string, options?: { active?: boolean }): Promise<string>;
  /** An asset on `locationId`, committed on the superuser pool. */
  asset(tag: string, locationId: string, options?: { active?: boolean }): Promise<string>;
  /** An RTU on `locationId`, committed on the superuser pool. */
  rtu(tag: string, locationId: string, options?: { active?: boolean }): Promise<string>;
  /** `UPDATE bms.locations SET active = $2`, committed. */
  setLocationActive(locationId: string, active: boolean): Promise<void>;
  /** An active asset domain code. */
  readonly domain: string;
};

/** Builds the run's organization and its organization admin on the superuser pool. */
export async function buildInactiveFixture(superPool: pg.Pool, prefix: string, run: string): Promise<InactiveFixture> {
  const orgCode = `F210E-${prefix}-${run}`;
  const { rows: orgRows } = await superPool.query<{ id: string }>(
    `INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id`,
    [orgCode, `F2.10 E ${orgCode}`],
  );
  const organizationId = orgRows[0]?.id ?? fail(`organization ${orgCode} was not inserted`);

  const email = `f210e-${prefix.toLowerCase()}-org-${run}@integration.invalid`;
  const { rows: userRows } = await superPool.query<{ id: string }>(
    `INSERT INTO bms.users (organization_id, email, password_hash, display_name, role)
     VALUES ($1, $2, 'not-a-usable-hash', 'F2.10 E organization admin', 'organization_admin') RETURNING id`,
    [organizationId, email],
  );
  const userId = userRows[0]?.id ?? fail(`user ${email} was not inserted`);
  await superPool.query(`INSERT INTO bms.user_organization_access (user_id, organization_id) VALUES ($1, $2)`, [
    userId,
    organizationId,
  ]);
  rememberSubject(email, userId);
  const orgAdmin = jwtFor(email, "organization_admin");

  const { rows: domainRows } = await superPool.query<{ code: string }>(
    "SELECT code FROM bms.asset_domains WHERE active = true ORDER BY code LIMIT 1",
  );
  const domain = domainRows[0]?.code ?? fail("bms.asset_domains has no active row — run pnpm db:seed");

  let seq = 0;
  const code = (tag: string): string => {
    seq += 1;
    return `F210E-${prefix}-${run}-${tag}-${seq}`;
  };
  return {
    run,
    organizationId,
    orgAdmin,
    domain,
    async node(tag, options = {}) {
      const c = code(tag);
      const { rows } = await superPool.query<{ id: string }>(
        `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, active)
         VALUES ($1, $2, $3, $4, 'campus', 0, 0, $5) RETURNING id`,
        [organizationId, c, c.toLowerCase(), `F2.10 E ${tag}`, options.active ?? true],
      );
      return rows[0]?.id ?? fail(`location ${c} was not inserted`);
    },
    async asset(tag, locationId, options = {}) {
      const c = code(tag);
      const { rows } = await superPool.query<{ id: string }>(
        `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain, active)
         VALUES ($1, $2, $3, $4, 'F2.10 E site', $5, $6) RETURNING id`,
        [organizationId, locationId, c, `F2.10 E asset ${tag}`, domain, options.active ?? true],
      );
      return rows[0]?.id ?? fail(`asset ${c} was not inserted`);
    },
    async rtu(tag, locationId, options = {}) {
      const c = code(tag);
      const { rows } = await superPool.query<{ id: string }>(
        `INSERT INTO bms.rtus (organization_id, location_id, code, display_name, source_type, active)
         VALUES ($1, $2, $3, $4, 'catalog', $5) RETURNING id`,
        [organizationId, locationId, c, `F2.10 E RTU ${tag}`, options.active ?? true],
      );
      return rows[0]?.id ?? fail(`RTU ${c} was not inserted`);
    },
    async setLocationActive(locationId, active) {
      await superPool.query("UPDATE bms.locations SET active = $2 WHERE id = $1", [locationId, active]);
    },
  };
}

/**
 * Deletes everything run `run` committed under `prefix`, children of every
 * foreign key first. Keyed by the organization code and the user email, so a
 * `beforeAll` that failed half-way is cleaned too.
 */
export async function dropInactiveFixture(superPool: pg.Pool, prefix: string, run: string): Promise<void> {
  const { rows } = await superPool.query<{ id: string }>("SELECT id FROM bms.organizations WHERE code = $1", [
    `F210E-${prefix}-${run}`,
  ]);
  const orgs = rows.map((r) => r.id);
  const users = "(SELECT id FROM bms.users WHERE organization_id = ANY($1::uuid[]) OR email = $2)";
  const userArgs = [orgs, `f210e-${prefix.toLowerCase()}-org-${run}@integration.invalid`];
  await superPool.query(`DELETE FROM bms.audit_log WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  await superPool.query(`DELETE FROM bms.user_organization_access WHERE user_id IN ${users}`, userArgs);
  await superPool.query(`DELETE FROM bms.users WHERE id IN ${users}`, userArgs);
  await superPool.query(`DELETE FROM bms.assets WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  await superPool.query(`DELETE FROM bms.rtus WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  await superPool.query(`DELETE FROM bms.locations WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  await superPool.query(`DELETE FROM bms.organizations WHERE id = ANY($1::uuid[])`, [orgs]);
}

/** The exception `run` rejected with; fails when it resolved. */
export async function thrown(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  return fail("expected the call to be refused, and it succeeded");
}

/** `err` is the 409 `{ message, reason: "location_inactive" }` refusal. */
export function expectLocationInactive(err: unknown): void {
  expect(err).toBeInstanceOf(HttpException);
  const http = err as HttpException;
  const body = http.getResponse();
  expect(http.getStatus(), JSON.stringify(body)).toBe(409);
  expect(locationWriteRefusalSchema.strict().safeParse(body).success, JSON.stringify(body)).toBe(true);
  expect((body as { reason: string }).reason).toBe("location_inactive");
}
