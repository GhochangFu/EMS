import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F4.17` / ADR 0125 decisions 10 and 17, plan U8 — what migration `0144`
 * guarantees against a real database. `tests/f4.17-service-accounts-schema.test.ts`
 * asserts the text; this asserts what Postgres enforces.
 *
 * The `tests/e7.2-edge-gateways-schema.integration.test.ts` lifecycle: one
 * held superuser client, every case inside `BEGIN … ROLLBACK`, a pool role
 * reached by `SET LOCAL ROLE` plus the tenant GUC, and a `SAVEPOINT`-protected
 * probe per refusal that names the code it expects. Nothing commits.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F4.17",
  label: "service-account schema tests",
  because:
    "the kind CHECKs, the composite key and kind trigger, FORCE row level security, the " +
    "hidden token_hash column and bms_auth's narrow reach are all things Postgres enforces, " +
    "so a green run without a database asserts nothing about any of them.",
});

const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";

type Rows = { rows: Array<Record<string, unknown>> };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};

const HASH_32 = "cd".repeat(32);

describe.skipIf(!has)("F4.17 — service-account schema against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let eskom = "";
  let phewb = "";

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F4.17",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
    const orgs = await client.query(`SELECT id, code FROM bms.organizations WHERE code IN ('ESKOM', 'PHEWB')`);
    eskom = orgs.rows.find((r) => r.code === "ESKOM")?.id as string;
    phewb = orgs.rows.find((r) => r.code === "PHEWB")?.id as string;
    if (!eskom || !phewb) throw new Error("F4.17: needs the seeded ESKOM and PHEWB organizations — run pnpm db:seed.");
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  /** One rolled-back transaction; `role` `null` stays the superuser. `org` `""` leaves the GUC empty. */
  const inTx = async (role: string | null, org: string, body: (run: Run) => Promise<void>): Promise<void> => {
    await client.query("BEGIN");
    try {
      await client.query(`SELECT set_config('app.current_organization', $1, true)`, [org]);
      if (role !== null) await client.query(`SET LOCAL ROLE ${role}`);
      await body((sql, params) => client.query(sql, params));
    } finally {
      await client.query("ROLLBACK");
    }
  };

  const probe = async (run: Run, sql: string, params: unknown[] = []) => {
    await run("SAVEPOINT probe");
    let code: string | undefined;
    let message = "";
    let rows: Array<Record<string, unknown>> = [];
    try {
      rows = (await run(sql, params)).rows;
    } catch (err) {
      code = (err as NodeJS.ErrnoException | undefined)?.code;
      message = err instanceof Error ? err.message : String(err);
    }
    await run("ROLLBACK TO SAVEPOINT probe");
    return { code, message, rows };
  };

  /** $1 org, $2 email, $3 role, $4 kind, $5 password_hash (nullable). */
  const INSERT_USER = `INSERT INTO bms.users (organization_id, email, display_name, role, kind, password_hash)
    VALUES ($1, $2, 'F4.17 fixture', $3, $4, $5) RETURNING id`;

  const serviceUser = async (run: Run, org: string, tag: string, role = "operator"): Promise<string> => {
    const r = await run(INSERT_USER, [org, `svc-${RUN}-${tag}@service-account.invalid`, role, "service", null]);
    return r.rows[0]?.id as string;
  };

  /** $1 org, $2 account, $3 token id, $4 expires-in interval. */
  const INSERT_TOKEN = `INSERT INTO bms.service_account_tokens
      (organization_id, service_account_id, token_id, token_hash, name, expires_at)
    VALUES ($1, $2, $3, decode('${HASH_32}', 'hex'), 'F4.17 fixture', now() + $4::interval)
    RETURNING id`;

  const tokenId = (tag: string): string => `T${RUN}${tag}`.replace(/[^A-Za-z0-9]/g, "").padEnd(12, "0").slice(0, 12);

  it("FORCE row level security is on for service_account_tokens", async () => {
    const r = await client.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'bms.service_account_tokens'::regclass`,
    );
    expect(r.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("users.kind is NOT NULL with default 'human', and a row inserted without it reads human", async () => {
    // Reads the column definition, not the rows: a database holding service
    // accounts must not turn this red (code review, false green 1).
    const col = await client.query(
      `SELECT column_default, is_nullable FROM information_schema.columns
        WHERE table_schema = 'bms' AND table_name = 'users' AND column_name = 'kind'`,
    );
    expect(col.rows[0]).toEqual({ column_default: "'human'::character varying", is_nullable: "NO" });
    await inTx(null, "", async (run) => {
      const r = await run(
        `INSERT INTO bms.users (organization_id, email, display_name, role) VALUES ($1, $2, 'F4.17', 'viewer') RETURNING kind`,
        [eskom, `default-${RUN}@bms.local`],
      );
      expect(r.rows[0]?.kind).toBe("human");
    });
  });

  it("a service row with a password hash, a master-data role or no organization is refused", async () => {
    await inTx(null, "", async (run) => {
      const withHash = await probe(run, INSERT_USER, [eskom, `svc-${RUN}-h@service-account.invalid`, "viewer", "service", "x"]);
      expect(withHash.code).toBe("23514");
      expect(withHash.message).toContain("users_service_account_check");

      const orgAdmin = await probe(run, INSERT_USER, [eskom, `svc-${RUN}-o@service-account.invalid`, "organization_admin", "service", null]);
      expect(orgAdmin.code).toBe("23514");
      expect(orgAdmin.message).toContain("users_service_account_check");

      const ok = await probe(run, INSERT_USER, [eskom, `svc-${RUN}-k@service-account.invalid`, "operator", "service", null]);
      expect(ok.message).toBe("");

      const badKind = await probe(run, INSERT_USER, [eskom, `svc-${RUN}-b@service-account.invalid`, "viewer", "robot", null]);
      expect(badKind.code).toBe("23514");
      expect(badKind.message).toContain("users_kind_check");
    });
  });

  it("a token for a human row is refused by the kind trigger", async () => {
    await inTx(null, "", async (run) => {
      const human = await run(INSERT_USER, [eskom, `human-${RUN}@bms.local`, "viewer", "human", null]);
      const r = await probe(run, INSERT_TOKEN, [eskom, human.rows[0]?.id, tokenId("h"), "30 days"]);
      expect(r.code).toBe("23000");
      expect(r.message).toContain("kind = 'service'");
    });
  });

  it("a token cannot hang on another organization's account: the trigger refuses, and the composite key behind it", async () => {
    await inTx(null, "", async (run) => {
      const phewbAccount = await serviceUser(run, phewb, "p");
      const byTrigger = await probe(run, INSERT_TOKEN, [eskom, phewbAccount, tokenId("x"), "30 days"]);
      expect(byTrigger.code).toBe("23000");
      // With the trigger off, the composite key alone must refuse it
      // (code review, false green 2) — this is what pins the key's shape.
      await run(`ALTER TABLE bms.service_account_tokens DISABLE TRIGGER service_account_tokens_guard_kind`);
      const byKey = await probe(run, INSERT_TOKEN, [eskom, phewbAccount, tokenId("y"), "30 days"]);
      expect(byKey.code).toBe("23503");
      expect(byKey.message).toContain("service_account_tokens_service_account_fkey");
    });
  });

  it("a service account holding tokens cannot be moved to another organization", async () => {
    await inTx(null, "", async (run) => {
      const account = await serviceUser(run, eskom, "m");
      await run(INSERT_TOKEN, [eskom, account, tokenId("m"), "30 days"]);
      const move = await probe(run, `UPDATE bms.users SET organization_id = $1 WHERE id = $2`, [phewb, account]);
      expect(move.code).toBe("23503");
      expect(move.message).toContain("service_account_tokens_service_account_fkey");
    });
  });

  it("refuses an expiry over 365 days and a malformed token id", async () => {
    await inTx(null, "", async (run) => {
      const account = await serviceUser(run, eskom, "e");
      const tooLong = await probe(run, INSERT_TOKEN, [eskom, account, tokenId("l"), "366 days"]);
      expect(tooLong.code).toBe("23514");
      expect(tooLong.message).toContain("service_account_tokens_expiry_check");
      const badId = await probe(run, INSERT_TOKEN, [eskom, account, "short-id!", "30 days"]);
      expect(badId.code).toBe("23514");
    });
  });

  it("a service row's email must be the synthetic svc-…@service-account.invalid", async () => {
    await inTx(null, "", async (run) => {
      const realEmail = await probe(run, INSERT_USER, [eskom, `person-${RUN}@example.com`, "viewer", "service", null]);
      expect(realEmail.code).toBe("23514");
      expect(realEmail.message).toContain("users_service_account_check");
    });
  });

  it("a disabled account is issued no token", async () => {
    await inTx(null, "", async (run) => {
      const account = await serviceUser(run, eskom, "d");
      await run(`UPDATE bms.users SET disabled_at = now() WHERE id = $1`, [account]);
      const r = await probe(run, INSERT_TOKEN, [eskom, account, tokenId("d"), "30 days"]);
      expect(r.code).toBe("23000");
    });
  });

  it("created_at is now() whatever the caller writes, so the 365-day cap cannot be dodged", async () => {
    await inTx(null, "", async (run) => {
      const account = await serviceUser(run, eskom, "c");
      const r = await probe(
        run,
        `INSERT INTO bms.service_account_tokens
           (organization_id, service_account_id, token_id, token_hash, name, created_at, expires_at)
         VALUES ($1, $2, $3, decode('${HASH_32}', 'hex'), 'F4.17 fixture', now() + interval '10 years', now() + interval '10 years 30 days')`,
        [eskom, account, tokenId("c")],
      );
      expect(r.code).toBe("23514");
      expect(r.message).toContain("service_account_tokens_expiry_check");
      // And a fresh row's revocation and last-used columns start empty.
      const ok = await run(
        `INSERT INTO bms.service_account_tokens
           (organization_id, service_account_id, token_id, token_hash, name, expires_at, revoked_at, last_used_at)
         VALUES ($1, $2, $3, decode('${HASH_32}', 'hex'), 'F4.17 fixture', now() + interval '30 days', now(), now())
         RETURNING revoked_at, last_used_at, created_at <= now() AS stamped`,
        [eskom, account, tokenId("c2")],
      );
      expect(ok.rows[0]).toEqual({ revoked_at: null, last_used_at: null, stamped: true });
    });
  });

  it("revocation is final, even for bms_tenant", async () => {
    await client.query("BEGIN");
    try {
      const account = await serviceUser((s, p) => client.query(s, p), eskom, "f");
      await client.query(INSERT_TOKEN, [eskom, account, tokenId("f"), "30 days"]);
      await client.query(`SELECT set_config('app.current_organization', $1, true)`, [eskom]);
      await client.query("SET LOCAL ROLE bms_tenant");
      const run: Run = (s, p) => client.query(s, p);
      const revoke = await probe(
        run,
        `UPDATE bms.service_account_tokens SET revoked_at = now() - interval '1 day' WHERE token_id = $1 RETURNING revoked_at > now() - interval '1 minute' AS stamped_now`,
        [tokenId("f")],
      );
      expect(revoke.message).toBe("");
      await run(`UPDATE bms.service_account_tokens SET revoked_at = now() WHERE token_id = $1`, [tokenId("f")]);
      const unrevoke = await probe(run, `UPDATE bms.service_account_tokens SET revoked_at = NULL WHERE token_id = $1`, [tokenId("f")]);
      expect(unrevoke.code).toBe("23000");
      expect(unrevoke.message).toContain("stays revoked");
      const rewrite = await probe(run, `UPDATE bms.service_account_tokens SET revoked_at = now() + interval '1 day' WHERE token_id = $1`, [tokenId("f")]);
      expect(rewrite.code).toBe("23000");
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("bms_auth cannot see a revoked token (the lookup fails closed)", async () => {
    await client.query("BEGIN");
    try {
      const account = await serviceUser((s, p) => client.query(s, p), phewb, "r");
      await client.query(INSERT_TOKEN, [phewb, account, tokenId("r"), "30 days"]);
      await client.query(`UPDATE bms.service_account_tokens SET revoked_at = now() WHERE token_id = $1`, [tokenId("r")]);
      await client.query(`SELECT set_config('app.current_organization', '', true)`);
      await client.query("SET LOCAL ROLE bms_auth");
      const r = await client.query(`SELECT id FROM bms.service_account_tokens WHERE token_id = $1`, [tokenId("r")]);
      expect(r.rows).toHaveLength(0);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("bms_tenant: inserts and revokes its own, never sees another organization's, never reads the hash or deletes", async () => {
    let phewbToken = "";
    let eskomAccount = "";
    await client.query("BEGIN");
    try {
      // Fixtures as the superuser, inside the same rolled-back transaction.
      const phewbAccount = await serviceUser((s, p) => client.query(s, p), phewb, "tp");
      phewbToken = (await client.query(INSERT_TOKEN, [phewb, phewbAccount, tokenId("tp"), "30 days"])).rows[0]?.id as string;
      eskomAccount = await serviceUser((s, p) => client.query(s, p), eskom, "te");

      await client.query(`SELECT set_config('app.current_organization', $1, true)`, [eskom]);
      await client.query("SET LOCAL ROLE bms_tenant");
      const run: Run = (s, p) => client.query(s, p);

      const inserted = await probe(run, INSERT_TOKEN, [eskom, eskomAccount, tokenId("te"), "90 days"]);
      expect(inserted.message).toBe("");

      const otherOrg = await probe(run, `SELECT id FROM bms.service_account_tokens WHERE id = $1`, [phewbToken]);
      expect(otherOrg.rows).toHaveLength(0);

      const hash = await probe(run, `SELECT token_hash FROM bms.service_account_tokens LIMIT 1`);
      expect(hash.code).toBe("42501");

      const del = await probe(run, `DELETE FROM bms.service_account_tokens WHERE organization_id = $1`, [eskom]);
      expect(del.code).toBe("42501");

      const extend = await probe(run, `UPDATE bms.service_account_tokens SET expires_at = now() + interval '1 day' WHERE organization_id = $1`, [eskom]);
      expect(extend.code).toBe("42501");

      await run(INSERT_TOKEN, [eskom, eskomAccount, tokenId("tr"), "90 days"]);
      const revoke = await probe(
        run,
        `UPDATE bms.service_account_tokens SET revoked_at = now() WHERE token_id = $1 RETURNING id`,
        [tokenId("tr")],
      );
      expect(revoke.message).toBe("");
      expect(revoke.rows).toHaveLength(1);

      // The BEFORE trigger runs as bms_tenant and cannot see another
      // organization's account under RLS, so it refuses first (23000).
      const crossOrgInsert = await probe(run, INSERT_TOKEN, [phewb, phewbAccount, tokenId("tx"), "30 days"]);
      expect(crossOrgInsert.code).toBe("23000");

      const kindFlip = await probe(run, `UPDATE bms.users SET kind = 'human' WHERE id = $1`, [eskomAccount]);
      expect(kindFlip.code).toBe("42501");
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("bms_tenant: the token table's own WITH CHECK refuses another organization's row (trigger off)", async () => {
    await client.query("BEGIN");
    try {
      const phewbAccount = await serviceUser((s, p) => client.query(s, p), phewb, "w");
      await client.query(`ALTER TABLE bms.service_account_tokens DISABLE TRIGGER service_account_tokens_guard_kind`);
      await client.query(`SELECT set_config('app.current_organization', $1, true)`, [eskom]);
      await client.query("SET LOCAL ROLE bms_tenant");
      const run: Run = (s, p) => client.query(s, p);
      const r = await probe(run, INSERT_TOKEN, [phewb, phewbAccount, tokenId("w"), "30 days"]);
      expect(r.code).toBe("42501");
      expect(r.message).toContain("row-level security");
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("bms_auth: finds a token in any organization, touches last_used_at only", async () => {
    await client.query("BEGIN");
    try {
      const account = await serviceUser((s, p) => client.query(s, p), phewb, "a");
      await client.query(INSERT_TOKEN, [phewb, account, tokenId("a"), "30 days"]);

      await client.query(`SELECT set_config('app.current_organization', '', true)`);
      await client.query("SET LOCAL ROLE bms_auth");
      const run: Run = (s, p) => client.query(s, p);

      const found = await probe(
        run,
        `SELECT service_account_id, octet_length(token_hash) AS len, revoked_at FROM bms.service_account_tokens WHERE token_id = $1`,
        [tokenId("a")],
      );
      expect(found.message).toBe("");
      expect(found.rows).toEqual([{ service_account_id: account, len: 32, revoked_at: null }]);

      const touch = await probe(
        run,
        `UPDATE bms.service_account_tokens SET last_used_at = now() WHERE token_id = $1 RETURNING id`,
        [tokenId("a")],
      );
      expect(touch.message).toBe("");
      expect(touch.rows).toHaveLength(1);

      const unrevoke = await probe(run, `UPDATE bms.service_account_tokens SET revoked_at = NULL WHERE token_id = $1`, [tokenId("a")]);
      expect(unrevoke.code).toBe("42501");

      const insert = await probe(run, INSERT_TOKEN, [phewb, account, tokenId("ai"), "30 days"]);
      expect(insert.code).toBe("42501");

      const kind = await probe(run, `SELECT kind FROM bms.users WHERE id = $1`, [account]);
      expect(kind.rows).toEqual([{ kind: "service" }]);
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
