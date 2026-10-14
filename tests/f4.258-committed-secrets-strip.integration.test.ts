import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F4.258` / ADR 0099 Amendment 2 — what migration `0108` does to real rows.
 * The static twin `tests/f4.258-committed-secrets-strip.test.ts` asserts the
 * file's text and its journal entry; this executes the file's own bytes.
 *
 * The `tests/f3.32f-carried-fixes.integration.test.ts` lifecycle: a superuser
 * pool, one held client, every case inside a transaction that is always rolled
 * back — nothing commits. Each case writes a fixture organization and three
 * sessions as the superuser, with **no tenant GUC**, then runs the migration
 * text as the superuser — the role the migrator runs it as. A file that put the
 * UPDATE inside `SET ROLE bms_owner` would meet FORCE row security with no GUC,
 * strip nothing, and redden M1.
 *
 * `ctid` is the no-op proof: an UPDATE writes a new tuple version, so a row
 * whose `ctid` is unchanged was not updated, even inside one transaction.
 *
 * **Assertions inline, no `.spec` sibling** — the top-level `tests/` carve-out
 * (§4.6).
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F4.258",
  label: "migration 0108 strips committed onboarding secrets",
  because:
    "which rows the 0108 UPDATE reaches depends on row security and the role it runs as, " +
    "so only a real database can show it strips the committed row and spares the open draft.",
});

const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const MIGRATION_SQL = readFileSync(
  join(repoRoot, "packages/db/drizzle/0108_onboarding_committed_secrets_strip.sql"),
  "utf8",
);

const SECRETS = { "RTU-1": { c: "Y2lwaGVy", iv: "aXY=", v: 1 } };
const LOCATION = { code: `F4258-${RUN}`, name: "F4.258 fixture" };

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type Rows = { rows: Array<Record<string, unknown>> };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};

/** The three fixture sessions, by role in the case. */
type Fixture = { committedWith: string; draftWith: string; committedWithout: string };

describe.skipIf(!has)("F4.258 — migration 0108 against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F4.258",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  /** Writes the fixture, runs `body`, and always rolls back. */
  const inTx = async (body: (run: Run, fx: Fixture) => Promise<void>): Promise<void> => {
    const run: Run = (sql, params) => client.query(sql, params);
    await client.query("BEGIN");
    try {
      const org = (
        await run(
          `INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id`,
          [`F4258${RUN}`.toUpperCase(), `F4.258 fixture ${RUN}`],
        )
      ).rows[0]?.id as string;
      const session = async (status: string, draft: unknown): Promise<string> =>
        (
          await run(
            `INSERT INTO bms.onboarding_sessions (organization_id, status, current_phase, draft)
             VALUES ($1, $2, 'review', $3::jsonb) RETURNING id`,
            [org, status, JSON.stringify(draft)],
          )
        ).rows[0]?.id as string;
      const fx: Fixture = {
        committedWith: await session("committed", { location: LOCATION, _secrets: SECRETS }),
        draftWith: await session("draft", { location: LOCATION, _secrets: SECRETS }),
        committedWithout: await session("committed", { location: LOCATION }),
      };
      await body(run, fx);
    } finally {
      await client.query("ROLLBACK");
    }
  };

  const rowOf = async (run: Run, id: string): Promise<{ draft: unknown; ctid: unknown }> => {
    const row = (await run("SELECT draft, ctid::text AS ctid FROM bms.onboarding_sessions WHERE id = $1", [id]))
      .rows[0];
    return { draft: row?.draft, ctid: row?.ctid };
  };

  it("M1 a committed session's draft loses _secrets and keeps the rest", async () => {
    await inTx(async (run, fx) => {
      await run(MIGRATION_SQL);
      expect((await rowOf(run, fx.committedWith)).draft).toEqual({ location: LOCATION });
    });
  });

  it("M2 an open draft keeps its _secrets", async () => {
    await inTx(async (run, fx) => {
      await run(MIGRATION_SQL);
      expect((await rowOf(run, fx.draftWith)).draft).toEqual({ location: LOCATION, _secrets: SECRETS });
    });
  });

  it("M3 a committed session without _secrets is not updated", async () => {
    await inTx(async (run, fx) => {
      const before = await rowOf(run, fx.committedWithout);
      await run(MIGRATION_SQL);
      expect(await rowOf(run, fx.committedWithout)).toEqual(before);
    });
  });

  it("M4 a second run updates none of the three rows", async () => {
    await inTx(async (run, fx) => {
      await run(MIGRATION_SQL);
      const ids = [fx.committedWith, fx.draftWith, fx.committedWithout];
      const before = await Promise.all(ids.map((id) => rowOf(run, id)));
      await run(MIGRATION_SQL);
      expect(await Promise.all(ids.map((id) => rowOf(run, id)))).toEqual(before);
    });
  });

  /**
   * The only-copy guard: a committed session whose RTU (`result.rtuIds`, by
   * position against `draft.rtus`) has a blob in `_secrets` but no stored
   * ciphertext keeps its `_secrets` — the blob is the only copy. Three
   * sessions over two real RTUs: one whose config holds a ciphertext, one whose
   * config holds NULL (a commit made with no key loaded), and one id with no
   * config row at all. Each run of the file must also not raise: the DO check
   * uses the UPDATE's own predicate.
   */
  type GuardFixture = { copied: string; nullCopy: string; noConfig: string };
  const inGuardTx = async (body: (run: Run, fx: GuardFixture) => Promise<void>): Promise<void> => {
    const run: Run = (sql, params) => client.query(sql, params);
    await client.query("BEGIN");
    try {
      const org = (
        await run(
          `INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id`,
          [`G4258${RUN}`.toUpperCase(), `F4.258 guard fixture ${RUN}`],
        )
      ).rows[0]?.id as string;
      const loc = (
        await run(
          `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
           VALUES ($1, $2, $2, 'F4.258 guard', 'pump_station', 0, 0) RETURNING id`,
          [org, `g4258-${RUN}`],
        )
      ).rows[0]?.id as string;
      const rtu = async (code: string, ciphertext: Buffer | null): Promise<string> => {
        const id = (
          await run(
            `INSERT INTO bms.rtus (organization_id, location_id, code, display_name) VALUES ($1, $2, $3, $3) RETURNING id`,
            [org, loc, code],
          )
        ).rows[0]?.id as string;
        await run(
          `INSERT INTO bms.rtu_connection_configs (rtu_id, organization_id, protocol, credentials_ciphertext, credentials_iv)
           VALUES ($1, $2, 'mqtt', $3, $4)`,
          [id, org, ciphertext, ciphertext === null ? null : Buffer.from("iv")],
        );
        return id;
      };
      const withCipher = await rtu(`G-${RUN}-A`, Buffer.from("cipher"));
      const withNull = await rtu(`G-${RUN}-B`, null);
      // The draft names the RTU `RTU-1` with a padded code; the guard trims, as
      // `readEncryptedCredentials` does. The RTU row's own code differs on
      // purpose: the guard joins by position, not by `rtus.code`.
      const draft = { location: LOCATION, rtus: [{ code: " RTU-1 " }], _secrets: SECRETS };
      const session = async (rtuId: string): Promise<string> =>
        (
          await run(
            `INSERT INTO bms.onboarding_sessions (organization_id, status, current_phase, draft, result)
             VALUES ($1, 'committed', 'review', $2::jsonb, $3::jsonb) RETURNING id`,
            [org, JSON.stringify(draft), JSON.stringify({ rtuIds: [rtuId] })],
          )
        ).rows[0]?.id as string;
      const fx: GuardFixture = {
        copied: await session(withCipher),
        nullCopy: await session(withNull),
        noConfig: await session(randomUUID()),
      };
      await body(run, fx);
    } finally {
      await client.query("ROLLBACK");
    }
  };

  const hasSecrets = async (run: Run, id: string): Promise<unknown> =>
    (await run("SELECT draft ? '_secrets' AS has FROM bms.onboarding_sessions WHERE id = $1", [id])).rows[0]?.has;

  it("M5 a committed session whose RTU config holds the ciphertext loses _secrets", async () => {
    await inGuardTx(async (run, fx) => {
      await run(MIGRATION_SQL);
      expect(await hasSecrets(run, fx.copied)).toBe(false);
    });
  });

  it("M6 a committed session whose RTU config holds a NULL ciphertext keeps _secrets", async () => {
    await inGuardTx(async (run, fx) => {
      await run(MIGRATION_SQL);
      expect(await hasSecrets(run, fx.nullCopy)).toBe(true);
    });
  });

  it("M7 a committed session whose RTU has no config row keeps _secrets", async () => {
    await inGuardTx(async (run, fx) => {
      await run(MIGRATION_SQL);
      expect(await hasSecrets(run, fx.noConfig)).toBe(true);
    });
  });
});
