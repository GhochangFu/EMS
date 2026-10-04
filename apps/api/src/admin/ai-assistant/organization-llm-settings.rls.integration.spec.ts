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
 * lock-race cases (8–11, `F4.186`; 12–14, `F4.187`) rewrite or delete A's row
 * through the service while a second connection holds it, and 12–14 run last
 * because each leaves A with no row.
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
 * that records each entry the service hands it inside its write transaction, then
 * runs `inTransaction` (if given) on that transaction before it commits.
 */
function realService(
  ctx: LlmSettingsCtx,
  inTransaction?: (tx: BmsDb) => Promise<void>,
): { service: AiAssistantSettingsService; audits: RecordedAudit[] } {
  const crypto = new CredentialCryptoService();
  const resolver = new OnboardingLlmResolver(ctx.tenantDb, crypto);
  const access = {
    // A null actor keeps `updated_by` clear of the users FK; the gate is not under test.
    requireMasterDataUser: async () => ({ id: null, role: "admin" }),
    canManageOrganization: async () => true,
  };
  const audits: RecordedAudit[] = [];
  const audit = {
    write: async (input: RecordedAudit, tx: BmsDb) => {
      audits.push(input);
      if (inTransaction) await inTransaction(tx);
    },
  };
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

/**
 * Rewrites A's row as a keyless OpenAI setting, inserting it when an earlier
 * case left A with no row (cases 9, 11 and 13 delete it).
 */
async function plantKeylessOpenAiRow(ctx: LlmSettingsCtx): Promise<void> {
  const planted = await ctx.fleetPool.query(
    `INSERT INTO bms.organization_llm_settings (organization_id, provider, model)
     VALUES ($1, 'openai', 'gpt-4o-mini')
     ON CONFLICT (organization_id) DO UPDATE
        SET provider = EXCLUDED.provider, model = EXCLUDED.model,
            key_ciphertext = NULL, key_iv = NULL, key_version = NULL, key_last4 = NULL`,
    [ctx.orgA],
  );
  expect(planted.rowCount, "control: A's keyless OpenAI row was planted").toBe(1);
}

/** The model-only save cases 8–10 race: A keeps `openai`, moves to `gpt-4.1-mini`, enters no key. */
function modelOnlySave(ctx: LlmSettingsCtx): (service: AiAssistantSettingsService) => Promise<unknown> {
  return (service) => service.put({ sub: "kc-f4186" } as never, ctx.orgA, { provider: "openai", model: "gpt-4.1-mini" });
}

/** How long a case waits for the service to block on a lock before it fails by name. */
const BLOCK_WAIT_MS = 3_000;

/**
 * Polls until some backend waits on `pid` (`pg_blocking_pids`), and returns how
 * many do. Fails by `what` when none waits within `BLOCK_WAIT_MS`.
 */
async function pollUntilBlockedOn(ctx: LlmSettingsCtx, pid: number | undefined, what: string): Promise<number> {
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
    throw new Error(`${what}: never waited on the holder within ${BLOCK_WAIT_MS} ms`);
  }
  return blocked;
}

/**
 * Races a service call against a second writer. A fleet connection opens a
 * transaction and locks A's row (`SELECT … FOR UPDATE`); `operation` starts and
 * is polled until a backend waits on the holder; the holder then runs
 * `competing` and commits, and `operation` is awaited. `hit` is the competing
 * statement's row count and `blocked` the number of waiters the poll saw —
 * both positive controls that the race ran as described.
 */
async function racingALockHolder(
  ctx: LlmSettingsCtx,
  what: string,
  operation: (service: AiAssistantSettingsService) => Promise<unknown>,
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

    const pending = operation(service);
    settled = pending.then(
      () => undefined,
      () => undefined,
    );

    const blocked = await pollUntilBlockedOn(ctx, pid, what);

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

  const { hit, blocked, audits } = await racingALockHolder(ctx, "aModelOnlySaveKeepsAKeyRotatedWhileItWaited", modelOnlySave(ctx), async (holder) => {
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

  const { hit, blocked } = await racingALockHolder(ctx, "aModelOnlySaveAfterADeleteStoresNoKey", modelOnlySave(ctx), async (holder) => {
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

  const { hit, blocked, audits } = await racingALockHolder(ctx, "aProviderChangeWhileItWaitedClearsTheKeyAndSaysSo", modelOnlySave(ctx), async (holder) => {
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

const CREDENTIAL_ENV = ["CREDENTIAL_ENCRYPTION_KEY", "CREDENTIAL_ENCRYPTION_KEY_PREVIOUS", "CREDENTIAL_ENCRYPTION_KEY_VERSION"];

/** Runs `fn` with a fixed credential key (no previous key, no version), then restores the environment. */
async function withCredentialKeyEnv(fn: () => Promise<void>): Promise<void> {
  const previousEnv = Object.fromEntries(CREDENTIAL_ENV.map((name) => [name, process.env[name]]));
  for (const name of CREDENTIAL_ENV) delete process.env[name];
  process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 0x2a).toString("base64");
  try {
    await fn();
  } finally {
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/** The key save X enters in cases 11 and 14. */
const X_KEY = "sk-x-first-save-key-k3y9";

type PausedFirstSave = {
  /** Save X's backend, which holds its transaction open after its upsert. */
  pid: number;
  audits: RecordedAudit[];
  /** Lets save X write its audit entry and commit. */
  release: () => void;
  pending: Promise<unknown>;
  /** `pending` with its rejection swallowed, for a `finally`. */
  settled: Promise<unknown>;
};

/**
 * Starts save X — a first save of an OpenAI key for A, which has no row — and
 * holds it inside its transaction after its upsert: its audit write waits on a
 * gate. Resolves once X has paused, with X's backend pid. Fails by `what` if X
 * commits without pausing or never pauses within `BLOCK_WAIT_MS`.
 */
async function startPausedFirstSave(ctx: LlmSettingsCtx, what: string): Promise<PausedFirstSave> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let paused: (pid: number) => void = () => undefined;
  const xPaused = new Promise<number>((resolve) => {
    paused = resolve;
  });
  const x = realService(ctx, async (tx) => {
    const { rows } = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
    paused(Number(rows[0]?.pid));
    await gate;
  });
  const pending = x.service.put({ sub: "kc-f4186-x" } as never, ctx.orgA, {
    provider: "openai",
    model: "gpt-4o-mini",
    apiKey: X_KEY,
  });
  const settled = pending.then(
    () => undefined,
    () => undefined,
  );
  try {
    const pid = await Promise.race([
      xPaused,
      pending.then(() => {
        throw new Error(`${what}: save X committed without pausing`);
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${what}: save X never paused within ${BLOCK_WAIT_MS} ms`)), BLOCK_WAIT_MS),
      ),
    ]);
    return { pid, audits: x.audits, release, pending, settled };
  } catch (err) {
    release();
    await settled;
    throw err;
  }
}

/**
 * 11 — `F4.186`, security re-review L-c: two concurrent FIRST saves for one
 * organization. Save X enters an OpenAI key; save Y, for the same provider,
 * enters none. Neither sees a row, so `FOR UPDATE` locks nothing. X is held
 * inside its transaction after its upsert (its audit write waits on a gate);
 * Y starts and is polled until it waits on X's backend; X is released. Y must
 * then decide on X's committed row and keep X's key — without serialization,
 * Y decided "no row, no key" and its ON CONFLICT cleared X's key while its
 * audit said `keyChanged: false`.
 */
export async function aConcurrentFirstSaveKeepsTheOtherSavesKey(ctx: LlmSettingsCtx): Promise<void> {
  const emptied = await ctx.fleetPool.query("DELETE FROM bms.organization_llm_settings WHERE organization_id = $1", [
    ctx.orgA,
  ]);
  expect(emptied.rowCount, "control: A's row was removed, so both saves are first saves").toBe(1);

  await withCredentialKeyEnv(async () => {
    const x = await startPausedFirstSave(ctx, "aConcurrentFirstSaveKeepsTheOtherSavesKey");
    const y = realService(ctx);
    let ySettled: Promise<unknown> | undefined;
    try {
      const yPending = y.service.put({ sub: "kc-f4186-y" } as never, ctx.orgA, { provider: "openai", model: "gpt-4.1-mini" });
      ySettled = yPending.then(
        () => undefined,
        () => undefined,
      );

      const blocked = await pollUntilBlockedOn(ctx, x.pid, "aConcurrentFirstSaveKeepsTheOtherSavesKey: save Y");

      x.release();
      await x.pending;
      await yPending;

      expect(blocked, "control: save Y waited on save X's transaction").toBeGreaterThan(0);
      expect(x.audits.map((a) => a.payload.keyChanged), "control: save X entered a key").toEqual([true]);
      const row = await storedKeyRow(ctx, ctx.orgA);
      expect(row?.provider).toBe("openai");
      expect(row?.model, "control: save Y landed last").toBe("gpt-4.1-mini");
      expect(row?.key_ciphertext, "save X's key must not be cleared by save Y").not.toBeNull();
      expect(row?.key_last4, "the stored key is save X's").toBe(X_KEY.slice(-4));
      expect(y.audits.map((a) => a.payload.keyChanged), "save Y kept the key, so it changed none").toEqual([false]);
    } finally {
      x.release();
      await x.settled;
      await ySettled;
    }
  });
}

/** The `remove()` the cases 12–14 race. */
function removeA(ctx: LlmSettingsCtx): (service: AiAssistantSettingsService) => Promise<unknown> {
  return (service) => service.remove({ sub: "kc-f4187" } as never, ctx.orgA);
}

/**
 * 12 — `F4.187`, security re-review I-3: `remove()` audits the row it deleted,
 * not a row it read before it waited. A's row is a keyless OpenAI setting; the
 * holder locks it, `remove()` waits, and the holder saves Anthropic with a key
 * and commits. The delete then removes the Anthropic row, so the audit entry
 * must say `anthropic` and `keyChanged: true`. The `blocked` control passes
 * with and without the fix — the old stale read is a plain SELECT that no row
 * lock blocks, and its DELETE waits as this one does — so only the audit
 * assertion gates the fix.
 */
export async function aRemoveAuditsTheRowItDeletedNotTheRowItRead(ctx: LlmSettingsCtx): Promise<void> {
  await plantKeylessOpenAiRow(ctx);

  const { hit, blocked, audits } = await racingALockHolder(
    ctx,
    "aRemoveAuditsTheRowItDeletedNotTheRowItRead",
    removeA(ctx),
    async (holder) => {
      const { rowCount } = await holder.query(
        `UPDATE bms.organization_llm_settings
            SET provider = 'anthropic', model = 'claude-haiku-4-5',
                key_ciphertext = $2, key_iv = $3, key_version = 1, key_last4 = 'anth'
          WHERE organization_id = $1`,
        [ctx.orgA, Buffer.from("anthropic-issued-key"), Buffer.from("anthrop-iv12")],
      );
      return rowCount;
    },
  );

  expect(blocked, "control: remove() waited on the holder's lock").toBeGreaterThan(0);
  expect(hit, "control: the holder's Anthropic save rewrote A's row").toBe(1);
  expect(await storedKeyRow(ctx, ctx.orgA), "the row is gone").toBeUndefined();
  expect(audits, "the audit must describe the row that was deleted, not the row read before the lock").toEqual([
    {
      action: "master.organization.ai_assistant.delete",
      entityType: "organization_llm_settings",
      entityId: ctx.orgA,
      organizationId: ctx.orgA,
      actor: { sub: "kc-f4187" },
      payload: { provider: "anthropic", model: "claude-haiku-4-5", keyChanged: true },
    },
  ]);
}

/**
 * 13 — `F4.187`: a `remove()` that deleted no row writes no audit. The holder
 * deletes A's row (another admin's `remove()`) while this one waits on it; the
 * DELETE then matches nothing, and an audit entry would record a delete that
 * did not happen.
 */
export async function aRemoveThatDeletedNothingWritesNoAudit(ctx: LlmSettingsCtx): Promise<void> {
  await plantKeylessOpenAiRow(ctx);

  const { hit, blocked, audits } = await racingALockHolder(
    ctx,
    "aRemoveThatDeletedNothingWritesNoAudit",
    removeA(ctx),
    async (holder) => {
      const { rowCount } = await holder.query("DELETE FROM bms.organization_llm_settings WHERE organization_id = $1", [
        ctx.orgA,
      ]);
      return rowCount;
    },
  );

  expect(blocked, "control: remove() waited on the holder's lock").toBeGreaterThan(0);
  expect(hit, "control: the holder deleted A's row").toBe(1);
  expect(audits, "a remove() that deleted no row must write no audit").toEqual([]);
}

/**
 * 14 — `F4.187`: `remove()` waits for a first save that has not committed. Save
 * X (an OpenAI key, A has no row) is held inside its transaction after its
 * upsert; `remove()` starts and must wait on X's backend. A row lock alone
 * cannot do this — the DELETE's snapshot does not see X's uncommitted row, so
 * it deletes nothing and returns, and X then commits a row the admin just
 * removed. **This is the only case that gates the advisory lock in
 * `remove()`**: without it, the poll fails by name. After X is released,
 * `remove()` deletes X's row and audits it.
 */
export async function aRemoveWaitsForAPausedFirstSave(ctx: LlmSettingsCtx): Promise<void> {
  // Case 13 may already have left A with no row, so the count is not asserted.
  await ctx.fleetPool.query("DELETE FROM bms.organization_llm_settings WHERE organization_id = $1", [ctx.orgA]);

  await withCredentialKeyEnv(async () => {
    const x = await startPausedFirstSave(ctx, "aRemoveWaitsForAPausedFirstSave");
    const remover = realService(ctx);
    let removeSettled: Promise<unknown> | undefined;
    try {
      const removePending = removeA(ctx)(remover.service);
      removeSettled = removePending.then(
        () => undefined,
        () => undefined,
      );

      const blocked = await pollUntilBlockedOn(ctx, x.pid, "aRemoveWaitsForAPausedFirstSave: remove()");

      x.release();
      await x.pending;
      await removePending;

      expect(blocked, "remove() must wait on the uncommitted first save").toBeGreaterThan(0);
      expect(x.audits.map((a) => a.payload.keyChanged), "control: save X entered a key").toEqual([true]);
      expect(await storedKeyRow(ctx, ctx.orgA), "remove() deleted save X's row after X committed").toBeUndefined();
      expect(
        remover.audits.map((a) => [a.action, a.payload]),
        "the audit describes save X's row",
      ).toEqual([["master.organization.ai_assistant.delete", { provider: "openai", model: "gpt-4o-mini", keyChanged: true }]]);
    } finally {
      x.release();
      await x.settled;
      await removeSettled;
    }
  });
}
