import { sql } from "drizzle-orm";
import type pg from "pg";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";

import { withTenant } from "../../database/tenant-context";
import { CredentialCryptoService } from "../../security/credential-crypto.service";
import { OnboardingLlmResolver } from "../onboarding/onboarding-llm-resolver";
import { AiAssistantSettingsService } from "./ai-assistant-settings.service";

/**
 * `F3.21` / ADR 0090 Amendment 1 A3 — `bms.organization_llm_settings` against
 * the real database (migration `0100`).
 *
 * The table holds an organization's LLM provider, model and API key (four
 * encrypted columns). It is a tenant table: `ENABLE` + `FORCE ROW LEVEL
 * SECURITY` with the strict `tenant_isolation` policy (`USING` and `WITH
 * CHECK`, no `IS NULL` disjunct). Three named CHECKs close the provider
 * vocabulary, require a model unless the provider is `off`, and keep the key
 * columns all NULL or all set.
 *
 * Assertions live here; `organization-llm-settings.rls.integration.test.ts`
 * owns the pools, the two scratch organizations and the `afterAll` delete
 * (ADR 0014). One exported function per claim, one `it()` each, run in this
 * file's order: the first writes organization A's row, which the next two
 * read and attack; the CHECK probes write to B, which has no row (the primary
 * key allows one per organization); the cascade case writes B's row last; the
 * lock-race cases (8–10, `F4.186`) rewrite A's row through the service while a
 * second connection holds it.
 *
 * **Counts run as `bms_fleet`, never `bms_owner`.** `FORCE` binds the owner,
 * so an owner count with no GUC answers 0 with rows present.
 *
 * **Every CHECK probe runs under the row's own organization.** The policy's
 * `WITH CHECK` runs before the CHECK constraints, so a probe with no GUC
 * answers 42501 and never reaches the constraint it means to test.
 */
export type LlmSettingsCtx = {
  /** `withTenant` runs on this — the `bms_tenant` role, bound by the policy. */
  tenantDb: BmsDb;
  /** Counts and fixture writes — `bms_fleet`, which bypasses RLS. */
  fleetPool: pg.Pool;
  /** `bms_owner` — the table owner, bound by the policy only through `FORCE`. */
  ownerPool: pg.Pool;
  orgA: string;
  orgB: string;
};

type PgLikeError = { code?: string; constraint?: string; message?: string };

/** The Postgres error, unwrapped from any driver wrapper that keeps it as `cause`. */
function pgErrorOf(err: unknown): PgLikeError {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const candidate = current as PgLikeError & { cause?: unknown };
    if (typeof candidate.code === "string") return candidate;
    current = candidate.cause;
  }
  return { message: err instanceof Error ? err.message : String(err) };
}

/** Runs `fn`, and returns the Postgres error it raised — or fails if it raised none. */
async function refusal(fn: () => Promise<unknown>, what: string): Promise<PgLikeError> {
  try {
    await fn();
  } catch (err) {
    return pgErrorOf(err);
  }
  throw new Error(`${what}: the write succeeded, and it must be refused`);
}

async function fleetCount(ctx: LlmSettingsCtx, organizationId: string): Promise<number> {
  const { rows } = await ctx.fleetPool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM bms.organization_llm_settings WHERE organization_id = $1",
    [organizationId],
  );
  return rows[0]?.n ?? -1;
}

/** A key blob in the shape `CredentialCryptoService` stores; the bytes are not a real ciphertext. */
const CIPHERTEXT = Buffer.from("not-a-real-ciphertext");
const IV = Buffer.from("twelve-bytes");

/** 1 — positive control: a tenant writes its own row, with all four key columns set. */
export async function aTenantWritesItsOwnRow(ctx: LlmSettingsCtx): Promise<void> {
  await withTenant(ctx.tenantDb, ctx.orgA, (tx) =>
    tx.execute(sql`
      INSERT INTO bms.organization_llm_settings
        (organization_id, provider, model, key_ciphertext, key_iv, key_version, key_last4)
      VALUES (${ctx.orgA}, 'openai', 'gpt-4o-mini', ${CIPHERTEXT}, ${IV}, 1, 'xyz9')`),
  );
  expect(await fleetCount(ctx, ctx.orgA), "bms_fleet counts the row the tenant wrote").toBe(1);
}

/**
 * 2 — a tenant cannot read another organization's row: B selects A's row and
 * gets nothing while `bms_fleet` counts it. The owner half is what `FORCE`
 * adds: `bms_tenant` is not the table owner, so the policy binds it with or
 * without `FORCE`; `bms_owner` is bound only by `FORCE`, so a removed `FORCE`
 * is red at the owner's GUC-B read. The owner's GUC-A read is its control.
 */
export async function aTenantCannotReadAnotherOrganizationsRow(ctx: LlmSettingsCtx): Promise<void> {
  const seen = await withTenant(ctx.tenantDb, ctx.orgB, (tx) =>
    tx.execute<{ organization_id: string }>(
      sql`SELECT organization_id FROM bms.organization_llm_settings WHERE organization_id = ${ctx.orgA}`,
    ),
  );
  expect(seen.rows, "B's tenant transaction must not see A's row").toHaveLength(0);
  expect(await fleetCount(ctx, ctx.orgA), "the row is there — the 0 above is the policy").toBe(1);

  const client = await ctx.ownerPool.connect();
  try {
    const who = await client.query<{ u: string }>("SELECT current_user AS u");
    expect(who.rows[0]?.u, "the owner probe must run as the table owner").toBe("bms_owner");
    const ownerCount = async (organizationId: string): Promise<number> => {
      await client.query("BEGIN");
      try {
        await client.query("SELECT set_config('app.current_organization', $1, true)", [organizationId]);
        const { rows } = await client.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM bms.organization_llm_settings WHERE organization_id = $1",
          [ctx.orgA],
        );
        return rows[0]?.n ?? -1;
      } finally {
        await client.query("ROLLBACK");
      }
    };
    expect(await ownerCount(ctx.orgA), "control: the owner under A's GUC sees A's row").toBe(1);
    expect(
      await ownerCount(ctx.orgB),
      "the owner under B's GUC must see nothing — a 1 here means FORCE is off",
    ).toBe(0);
  } finally {
    client.release();
  }
}

/**
 * 3 — a tenant cannot write a row for another organization. No `RETURNING`:
 * under FORCE the insert fails on `WITH CHECK` rather than returning a row.
 * 42501 also means a missing grant, so the message must name row-level
 * security; case 1 is the proof the grant exists.
 */
export async function aTenantCannotWriteAnotherOrganizationsRow(ctx: LlmSettingsCtx): Promise<void> {
  const before = await fleetCount(ctx, ctx.orgA);
  const err = await refusal(
    () =>
      withTenant(ctx.tenantDb, ctx.orgB, (tx) =>
        tx.execute(sql`
          INSERT INTO bms.organization_llm_settings (organization_id, provider)
          VALUES (${ctx.orgA}, 'off')`),
      ),
    "B wrote a row for A",
  );
  expect(err.code, `expected 42501, got ${err.code}: ${err.message}`).toBe("42501");
  expect(err.message).toMatch(/row-level security/);
  expect(await fleetCount(ctx, ctx.orgA), "A's row count is unchanged").toBe(before);
}

/**
 * Inserts one row for B under B's own GUC and returns the refusal. A write
 * that wrongly succeeds is deleted before the failure propagates, so one
 * missing CHECK reddens its own case and not every later case that needs B
 * to have no row.
 */
async function refusedForB(
  ctx: LlmSettingsCtx,
  insert: ReturnType<typeof sql>,
  what: string,
): Promise<PgLikeError> {
  try {
    return await refusal(() => withTenant(ctx.tenantDb, ctx.orgB, (tx) => tx.execute(insert)), what);
  } catch (err) {
    await ctx.fleetPool.query("DELETE FROM bms.organization_llm_settings WHERE organization_id = $1", [
      ctx.orgB,
    ]);
    throw err;
  }
}

function expectCheck(err: PgLikeError, constraint: string): void {
  expect(err.code, `expected 23514, got ${err.code}: ${err.message}`).toBe("23514");
  expect(err.constraint).toBe(constraint);
}

/** 4 — `provider` is closed to the four values that have an adapter. */
export async function anUnknownProviderIsRefused(ctx: LlmSettingsCtx): Promise<void> {
  const err = await refusedForB(
    ctx,
    sql`INSERT INTO bms.organization_llm_settings (organization_id, provider, model)
        VALUES (${ctx.orgB}, 'gpt', 'gpt-4o-mini')`,
    "provider 'gpt'",
  );
  expectCheck(err, "organization_llm_settings_provider_check");
  expect(await fleetCount(ctx, ctx.orgB)).toBe(0);
}

/** 5 — a provider other than `off` needs a model. */
export async function aProviderWithoutAModelIsRefused(ctx: LlmSettingsCtx): Promise<void> {
  const err = await refusedForB(
    ctx,
    sql`INSERT INTO bms.organization_llm_settings (organization_id, provider)
        VALUES (${ctx.orgB}, 'openai')`,
    "provider 'openai' with no model",
  );
  expectCheck(err, "organization_llm_settings_model_check");
  expect(await fleetCount(ctx, ctx.orgB)).toBe(0);
}

/** 6 — the four key columns are all NULL or all set: a ciphertext without an IV is refused. */
export async function aHalfKeyIsRefused(ctx: LlmSettingsCtx): Promise<void> {
  const err = await refusedForB(
    ctx,
    sql`INSERT INTO bms.organization_llm_settings (organization_id, provider, key_ciphertext)
        VALUES (${ctx.orgB}, 'off', ${CIPHERTEXT})`,
    "key_ciphertext without key_iv",
  );
  expectCheck(err, "organization_llm_settings_key_check");
  expect(await fleetCount(ctx, ctx.orgB)).toBe(0);
}

/** 7 — deleting the organization deletes its row (`ON DELETE CASCADE`). Runs last: it deletes B. */
export async function deletingTheOrganizationCascades(ctx: LlmSettingsCtx): Promise<void> {
  await withTenant(ctx.tenantDb, ctx.orgB, (tx) =>
    tx.execute(sql`
      INSERT INTO bms.organization_llm_settings (organization_id, provider)
      VALUES (${ctx.orgB}, 'off')`),
  );
  expect(await fleetCount(ctx, ctx.orgB), "control: B's row exists before the delete").toBe(1);
  await ctx.fleetPool.query("DELETE FROM bms.organizations WHERE id = $1", [ctx.orgB]);
  expect(await fleetCount(ctx, ctx.orgB), "the row went with its organization").toBe(0);
}

type RecordedAudit = { action: string; payload: Record<string, unknown> };

/**
 * The real service on the tenant pool, with the gate open and an audit writer
 * that records each entry `put()` hands it inside its write transaction.
 */
function realService(ctx: LlmSettingsCtx): { service: AiAssistantSettingsService; audits: RecordedAudit[] } {
  const crypto = new CredentialCryptoService();
  const resolver = new OnboardingLlmResolver(ctx.tenantDb, crypto);
  const access = {
    // A null actor keeps `updated_by` clear of the users FK; the gate is not under test.
    requireMasterDataUser: async () => ({ id: null, role: "admin" }),
    canManageOrganization: async () => true,
  };
  const audits: RecordedAudit[] = [];
  const audit = { write: async (input: RecordedAudit) => void audits.push(input) };
  const service = new AiAssistantSettingsService(ctx.tenantDb, access as never, audit as never, crypto, resolver);
  return { service, audits };
}

/** Rewrites A's row as an OpenAI setting with the version-1 key, whatever an earlier case left. */
async function plantOpenAiRow(ctx: LlmSettingsCtx): Promise<void> {
  const planted = await ctx.fleetPool.query(
    `UPDATE bms.organization_llm_settings
        SET provider = 'openai', model = 'gpt-4o-mini',
            key_ciphertext = $2, key_iv = $3, key_version = 1, key_last4 = 'xyz9'
      WHERE organization_id = $1`,
    [ctx.orgA, CIPHERTEXT, IV],
  );
  expect(planted.rowCount, "control: A's OpenAI row with its version-1 key was planted").toBe(1);
}

/** How long a case waits for `put()` to block on the holder's lock before it fails by name. */
const BLOCK_WAIT_MS = 3_000;

/**
 * Races `put()` against a second writer. A fleet connection opens a transaction
 * and locks A's row (`SELECT … FOR UPDATE`); `put()` starts and is polled until
 * a backend waits on the holder (`pg_blocking_pids`); the holder then runs
 * `competing` and commits, and `put()` is awaited. `hit` is the competing
 * statement's row count and `blocked` the number of waiters the poll saw —
 * both positive controls that the race ran as described.
 */
async function putRacingALockHolder(
  ctx: LlmSettingsCtx,
  competing: (holder: pg.PoolClient) => Promise<number | null>,
): Promise<{ hit: number | null; blocked: number; audits: RecordedAudit[] }> {
  const { service, audits } = realService(ctx);
  const holder = await ctx.fleetPool.connect();
  let open = false;
  let settled: Promise<unknown> | undefined;
  try {
    await holder.query("BEGIN");
    open = true;
    const pid = (await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]?.pid;
    const locked = await holder.query(
      "SELECT 1 FROM bms.organization_llm_settings WHERE organization_id = $1 FOR UPDATE",
      [ctx.orgA],
    );
    expect(locked.rowCount, "control: the holder locked A's row").toBe(1);

    const pending = service.put({ sub: "kc-f4186" } as never, ctx.orgA, { provider: "openai", model: "gpt-4.1-mini" });
    settled = pending.then(
      () => undefined,
      () => undefined,
    );

    let blocked = 0;
    const deadline = Date.now() + BLOCK_WAIT_MS;
    while (blocked === 0 && Date.now() < deadline) {
      const { rows } = await ctx.fleetPool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
        [pid],
      );
      blocked = rows[0]?.n ?? 0;
      if (blocked === 0) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (blocked === 0) {
      throw new Error(`putRacingALockHolder: put() never waited on the holder's row lock within ${BLOCK_WAIT_MS} ms`);
    }

    const hit = await competing(holder);
    await holder.query("COMMIT");
    open = false;
    await pending;
    return { hit, blocked, audits };
  } finally {
    if (open) await holder.query("ROLLBACK").catch(() => undefined);
    holder.release();
    await settled;
  }
}

type StoredKeyRow = {
  provider: string;
  model: string | null;
  key_ciphertext: Buffer | null;
  key_iv: Buffer | null;
  key_version: number | null;
  key_last4: string | null;
};

async function storedKeyRow(ctx: LlmSettingsCtx, organizationId: string): Promise<StoredKeyRow | undefined> {
  const { rows } = await ctx.fleetPool.query<StoredKeyRow>(
    `SELECT provider, model, key_ciphertext, key_iv, key_version, key_last4
       FROM bms.organization_llm_settings WHERE organization_id = $1`,
    [organizationId],
  );
  return rows[0];
}

/**
 * 8 — `F4.186`, security review M1: a model-only save never writes back a key
 * that was rotated while it waited. `rotate-credentials` holds A's row and
 * re-encrypts the key (version 2) while `put()` waits on that row; the save
 * must change the model and leave the key at version 2. A write-back of the
 * version-1 bytes would be reported as rotated and then fall to the guided mode
 * once the previous key is unset (ADR 0062).
 */
export async function aModelOnlySaveKeepsAKeyRotatedWhileItWaited(ctx: LlmSettingsCtx): Promise<void> {
  await plantOpenAiRow(ctx);
  const rotated = Buffer.from("rotated-v2-ciphertext");
  const rotatedIv = Buffer.from("rotated-iv12");

  const { hit, blocked, audits } = await putRacingALockHolder(ctx, async (holder) => {
    const { rowCount } = await holder.query(
      `UPDATE bms.organization_llm_settings
          SET key_ciphertext = $2, key_iv = $3, key_version = 2, key_last4 = 'rot2'
        WHERE organization_id = $1`,
      [ctx.orgA, rotated, rotatedIv],
    );
    return rowCount;
  });

  expect(blocked, "control: put() waited on the holder's lock").toBeGreaterThan(0);
  expect(hit, "control: the rotation rewrote A's row").toBe(1);
  const row = await storedKeyRow(ctx, ctx.orgA);
  expect(row?.model, "control: the save landed").toBe("gpt-4.1-mini");
  expect(row?.key_version, "the rotated key version stays").toBe(2);
  expect(row?.key_ciphertext?.equals(rotated), "the rotated ciphertext stays").toBe(true);
  expect(row?.key_iv?.equals(rotatedIv), "the rotated IV stays").toBe(true);
  expect(row?.key_last4).toBe("rot2");
  expect(audits.map((a) => a.payload.keyChanged), "a kept key is not a key change").toEqual([false]);
}

/**
 * 9 — `F4.186`, security re-review L-a: a model-only save never brings back a
 * key that another admin deleted while it waited. The holder deletes A's row
 * (`remove()`, perhaps because the key leaked) while `put()` waits on it; the
 * save then inserts a fresh row, and that row must carry no key at all.
 */
export async function aModelOnlySaveAfterADeleteStoresNoKey(ctx: LlmSettingsCtx): Promise<void> {
  await plantOpenAiRow(ctx);

  const { hit, blocked } = await putRacingALockHolder(ctx, async (holder) => {
    const { rowCount } = await holder.query("DELETE FROM bms.organization_llm_settings WHERE organization_id = $1", [
      ctx.orgA,
    ]);
    return rowCount;
  });

  expect(blocked, "control: put() waited on the holder's lock").toBeGreaterThan(0);
  expect(hit, "control: the holder deleted A's row").toBe(1);
  const row = await storedKeyRow(ctx, ctx.orgA);
  expect(row?.provider, "control: the save wrote a row").toBe("openai");
  expect(row?.model).toBe("gpt-4.1-mini");
  expect(
    [row?.key_ciphertext, row?.key_iv, row?.key_version, row?.key_last4],
    "the deleted key must not come back",
  ).toEqual([null, null, null, null]);
}

/**
 * 10 — `F4.186`, security re-review L-b: a kept key never lands under a
 * provider it was not issued by, and the audit says the key went. Admin B
 * saves `anthropic` with an Anthropic key while admin A's `openai` save with
 * no key waits on the row. Keeping the stored columns would leave `openai`
 * holding B's Anthropic key, and the next chat turn would send it to OpenAI;
 * they must be cleared (A3: a key belongs to the provider it was issued by),
 * and A's audit entry must report `keyChanged: true`, because it removed one.
 */
export async function aProviderChangeWhileItWaitedClearsTheKeyAndSaysSo(ctx: LlmSettingsCtx): Promise<void> {
  await plantOpenAiRow(ctx);

  const { hit, blocked, audits } = await putRacingALockHolder(ctx, async (holder) => {
    const { rowCount } = await holder.query(
      `UPDATE bms.organization_llm_settings
          SET provider = 'anthropic', model = 'claude-haiku-4-5',
              key_ciphertext = $2, key_iv = $3, key_version = 1, key_last4 = 'anth'
        WHERE organization_id = $1`,
      [ctx.orgA, Buffer.from("anthropic-issued-key"), Buffer.from("anthrop-iv12")],
    );
    return rowCount;
  });

  expect(blocked, "control: put() waited on the holder's lock").toBeGreaterThan(0);
  expect(hit, "control: B's Anthropic save rewrote A's row").toBe(1);
  const row = await storedKeyRow(ctx, ctx.orgA);
  expect(row?.provider, "control: A's save landed").toBe("openai");
  expect(row?.model).toBe("gpt-4.1-mini");
  expect(
    [row?.key_ciphertext, row?.key_iv, row?.key_version, row?.key_last4],
    "B's Anthropic key must not stay under openai",
  ).toEqual([null, null, null, null]);
  expect(audits.map((a) => a.action), "control: put() wrote one audit entry").toEqual([
    "master.organization.ai_assistant.update",
  ]);
  expect(audits[0]?.payload.keyChanged, "the audit must say the key was cleared").toBe(true);
}
