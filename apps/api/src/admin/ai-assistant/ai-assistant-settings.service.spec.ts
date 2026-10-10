import { BadRequestException, ForbiddenException } from "@nestjs/common";

import { CredentialCryptoService } from "../../security/credential-crypto.service";
import type { LlmToolDefinition, LlmProvider } from "../../llm/llm-port";
import { LlmResolver } from "../../llm/llm-resolver";
import { AiAssistantSettingsService, NO_ENCRYPTION_KEY_MESSAGE } from "./ai-assistant-settings.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const JWT = { sub: "kc-1" } as never;
const ORG = "11111111-1111-4111-8111-111111111111";
const KEY = Buffer.alloc(32, 0x01).toString("base64");
const ORG_KEY = "sk-or-org-key-abcdxyz9";
const PLATFORM_KEY = "sk-platform-key-0000";

type Row = Parameters<LlmResolver["decryptKey"]>[0];

const ENV_NAMES = ["LLM_PROVIDER", "OPENROUTER_API_KEY", "OPENROUTER_MODEL", "OPENAI_API_KEY", "OPENAI_MODEL", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "CREDENTIAL_ENCRYPTION_KEY", "CREDENTIAL_ENCRYPTION_KEY_VERSION"];

/** The platform default is OpenRouter with a key and a model, and the credential key is set, unless `vars` says otherwise. */
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
  const values: Record<string, string | undefined> = {
    LLM_PROVIDER: "openrouter",
    OPENROUTER_API_KEY: PLATFORM_KEY,
    OPENROUTER_MODEL: "z-ai/glm-5.3-flash",
    CREDENTIAL_ENCRYPTION_KEY: KEY,
    ...vars,
  };
  for (const name of ENV_NAMES) {
    const value = values[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

type Built = { name: string; apiKey: string; model: string; tools?: readonly LlmToolDefinition[] };

/**
 * The service over an in-memory row (the RLS integration suite covers the real
 * table), a recording audit writer, the real crypto and resolver, and a
 * factory that records what the Test button would call.
 */
function harness(opts: { row?: Row | null; inScope?: boolean; testError?: unknown; role?: string } = {}) {
  const store: { row: Row | null } = { row: opts.row ?? null };
  const writes: { kind: "upsert" | "delete"; values?: Record<string, unknown> }[] = [];
  const audits: Record<string, unknown>[] = [];
  const tx = {
    execute: async () => undefined,
    // put()'s locked read (`select … for update`) inside its write transaction.
    select: () => ({
      from: () => ({
        where: () => ({
          for: async () => (store.row ? [{ ...store.row }] : []),
        }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: async () => {
          writes.push({ kind: "upsert", values });
          store.row = { ...(values as unknown as Row) };
        },
      }),
    }),
    // remove()'s `delete … returning` inside its write transaction: the deleted row, projected.
    delete: () => ({
      where: () => ({
        returning: async () => {
          const deleted = store.row;
          writes.push({ kind: "delete" });
          store.row = null;
          return deleted ? [{ provider: deleted.provider, model: deleted.model, keyCiphertext: deleted.keyCiphertext }] : [];
        },
      }),
    }),
  };
  const db = { transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx), execute: async () => undefined };
  const crypto = new CredentialCryptoService();
  const resolver = new LlmResolver(db as never, crypto);
  resolver.readSetting = async () => (store.row ? { ...store.row } : null);
  const access = {
    requireMasterDataUser: async () => ({ id: "user-1", role: opts.role ?? "organization_admin" }),
    canManageOrganization: async () => opts.inScope ?? true,
  };
  const audit = { write: async (input: Record<string, unknown>) => void audits.push(input) };
  const service = new AiAssistantSettingsService(db as never, access as never, audit as never, crypto, resolver);
  const built: Built[] = [];
  service.buildProvider = (name, options) => {
    const provider: LlmProvider = {
      name,
      complete: async (input) => {
        built.push({ name, ...options, tools: input.tools });
        if (opts.testError !== undefined) throw opts.testError;
        return { kind: "final", text: "ok" };
      },
    };
    return provider;
  };
  return { service, store, writes, audits, built, resolver };
}

/** F4.187: remove() decides from its own DELETE, so a read outside its transaction fails the case by name. */
function forbidReadOutsideTransaction(resolver: LlmResolver): void {
  resolver.readSetting = async () => {
    throw new Error("remove() must not read the row outside its transaction");
  };
}

/** Call inside `withEnv`, which sets the credential key the encryption needs. */
function storedRow(provider = "openrouter", apiKey: string | null = ORG_KEY): Row {
  const base: Row = {
    organizationId: ORG,
    provider,
    model: provider === "off" ? null : "moonshotai/kimi-k3",
    keyCiphertext: null,
    keyIv: null,
    keyVersion: null,
    keyLast4: null,
    updatedBy: "user-1",
    updatedAt: new Date("2026-10-03T10:00:00Z"),
  };
  if (apiKey !== null) {
    const enc = new CredentialCryptoService().encrypt({ apiKey });
    Object.assign(base, { keyCiphertext: enc.ciphertext, keyIv: enc.iv, keyVersion: enc.keyVersion, keyLast4: apiKey.slice(-4) });
  }
  return base;
}

async function rejection(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  return undefined;
}

export async function assertEveryMethodRefusesOutsideScope(): Promise<void> {
  await withEnv({}, async () => {
    const { service, writes, built } = harness({ inScope: false, row: storedRow() });
    const runs = [
      service.get(JWT, ORG),
      service.put(JWT, ORG, { provider: "off" }),
      service.remove(JWT, ORG),
      service.test(JWT, ORG, { provider: "openrouter", model: "z-ai/glm-5.3-flash" }),
    ];
    for (const run of runs) {
      assert((await rejection(run)) instanceof ForbiddenException, "outside its scope, every method is a 403");
    }
    assert(writes.length === 0 && built.length === 0, "nothing is written and nothing is called");
  });
}

export async function assertGetWithoutARowReportsThePlatform(): Promise<void> {
  await withEnv({}, async () => {
    const dto = await harness().service.get(JWT, ORG);
    assert(dto.source === "platform" && dto.provider === "openrouter" && dto.model === "z-ai/glm-5.3-flash", "the platform default");
    assert(dto.keySet === true && dto.keyLast4 === null && dto.updatedAt === null, "a platform key is set, never shown");
    assert(dto.platform.provider === "openrouter" && dto.platform.keySet === true, "the platform block is filled");
  });
}

export async function assertGetWithARowReportsSetAndLast4(): Promise<void> {
  await withEnv({}, async () => {
    const dto = await harness({ row: storedRow() }).service.get(JWT, ORG);
    assert(dto.source === "organization" && dto.provider === "openrouter" && dto.model === "moonshotai/kimi-k3", "the row");
    assert(dto.keySet === true && dto.keyLast4 === "xyz9", "key set, ends in xyz9");
    assert(dto.updatedAt === "2026-10-03T10:00:00.000Z", "with its date");
  });
}

export async function assertGetNeverCarriesTheKey(): Promise<void> {
  await withEnv({}, async () => {
    const row = storedRow();
    const text = JSON.stringify(await harness({ row }).service.get(JWT, ORG));
    assert(!text.includes(ORG_KEY) && !text.includes(PLATFORM_KEY), "no key, organization or platform");
    assert(!/ciphertext|keyIv/i.test(text) && !text.includes(row.keyCiphertext!.toString("base64")), "no ciphertext");
  });
}

export async function assertPutEncryptsAndStoresLast4(): Promise<void> {
  await withEnv({}, async () => {
    const { service, store } = harness();
    await service.put(JWT, ORG, { provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "sk-ant-secret-key-9999" });
    const row = store.row!;
    assert(row.keyCiphertext instanceof Buffer && row.keyIv instanceof Buffer && typeof row.keyVersion === "number", "the four key columns are set");
    assert(row.keyLast4 === "9999", "the last four are stored apart");
    assert(!row.keyCiphertext?.toString("utf8").includes("sk-ant-secret"), "the stored key is not plain text");
    assert(row.updatedBy === "user-1", "who changed it is recorded");
  });
}

export async function assertPutWithoutAKeyKeepsTheStoredOne(): Promise<void> {
  await withEnv({}, async () => {
    const row = storedRow();
    const { service, store } = harness({ row });
    await service.put(JWT, ORG, { provider: "openrouter", model: "z-ai/glm-5.3-flash" });
    assert(store.row?.keyCiphertext?.equals(row.keyCiphertext!) === true && store.row?.keyLast4 === "xyz9", "the stored key is kept");
    assert(store.row?.model === "z-ai/glm-5.3-flash", "the model changes");
  });
}

/** Not in the plan's list: a key belongs to the provider that issued it. */
export async function assertANewProviderWithoutAKeyClearsTheStoredKey(): Promise<void> {
  await withEnv({}, async () => {
    const { service, store, audits } = harness({ row: storedRow() });
    await service.put(JWT, ORG, { provider: "anthropic", model: "claude-sonnet-5-5" });
    assert(store.row?.keyCiphertext === null && store.row?.keyLast4 === null, "the old provider's key is cleared");
    assert((audits[0]?.payload as { keyChanged?: boolean })?.keyChanged === true, "and the audit says the key changed");
  });
}

export async function assertPutWithAKeyAndNoEncryptionKeyIs400AndWritesNothing(): Promise<void> {
  await withEnv({ CREDENTIAL_ENCRYPTION_KEY: undefined }, async () => {
    const { service, writes, audits } = harness();
    const error = await rejection(service.put(JWT, ORG, { provider: "openai", model: "gpt-4o-mini", apiKey: "sk-openai-0000" }));
    assert(error instanceof BadRequestException && error.message === NO_ENCRYPTION_KEY_MESSAGE, "a 400 that says why");
    assert(writes.length === 0 && audits.length === 0, "nothing is written");
  });
}

export async function assertPutResponseNeverCarriesTheKey(): Promise<void> {
  await withEnv({}, async () => {
    const dto = await harness().service.put(JWT, ORG, { provider: "openai", model: "gpt-4o-mini", apiKey: "sk-openai-secret-7777" });
    assert(dto.keySet === true && dto.keyLast4 === "7777", "the response says the key is set");
    assert(!JSON.stringify(dto).includes("sk-openai-secret"), "and never carries it");
  });
}

export async function assertPutAuditsProviderModelAndKeyChangedOnly(): Promise<void> {
  await withEnv({}, async () => {
    const { service, audits } = harness();
    await service.put(JWT, ORG, { provider: "openai", model: "gpt-4o-mini", apiKey: "sk-openai-secret-5555" });
    const entry = audits[0] ?? {};
    assert(entry.action === "master.organization.ai_assistant.update" && entry.organizationId === ORG, "one update audit row");
    assert(JSON.stringify(Object.keys(entry.payload as object)) === '["provider","model","keyChanged"]', "payload keys exactly");
    const text = JSON.stringify(entry);
    assert(!text.includes("sk-openai-secret") && !text.includes("5555"), "neither the key nor its last four");
  });
}

export async function assertDeleteRemovesAndAudits(): Promise<void> {
  await withEnv({}, async () => {
    const row = storedRow();
    const { service, store, audits, resolver } = harness({ row });
    forbidReadOutsideTransaction(resolver);
    const dto = await service.remove(JWT, ORG);
    assert(store.row === null, "the row is removed");
    assert(audits.length === 1 && audits[0]?.action === "master.organization.ai_assistant.delete", "one delete audit row");
    assert(
      JSON.stringify(audits[0]?.payload) === JSON.stringify({ provider: row.provider, model: row.model, keyChanged: true }),
      "the payload is the deleted row's provider, model and key state",
    );
    assert(dto.source === "platform", "the organization returns to the platform default");
  });
}

/** F4.187: deleting a row that stored no key audits `keyChanged: false` — no key was removed. */
export async function assertDeleteOfAKeylessRowAuditsNoKeyChange(): Promise<void> {
  await withEnv({}, async () => {
    const row = storedRow("openrouter", null);
    const { service, store, audits, resolver } = harness({ row });
    forbidReadOutsideTransaction(resolver);
    await service.remove(JWT, ORG);
    assert(store.row === null && audits.length === 1, "control: the row is removed and one audit row written");
    assert(
      JSON.stringify(audits[0]?.payload) === JSON.stringify({ provider: "openrouter", model: row.model, keyChanged: false }),
      "a keyless row's delete changes no key",
    );
  });
}

/** F4.187: a DELETE that removed no row writes no audit, and the answer is still the platform default. */
export async function assertDeleteOfNoRowWritesNoAuditAndReportsThePlatform(): Promise<void> {
  await withEnv({}, async () => {
    const { service, writes, audits, resolver } = harness();
    forbidReadOutsideTransaction(resolver);
    const dto = await service.remove(JWT, ORG);
    assert(JSON.stringify(writes) === '[{"kind":"delete"}]', "positive control: the DELETE ran");
    assert(audits.length === 0, "no row deleted, no audit");
    assert(dto.source === "platform", "the organization reports the platform default");
  });
}

export async function assertTestUsesTheGivenKeyFirst(): Promise<void> {
  await withEnv({}, async () => {
    const { service, built } = harness({ row: storedRow() });
    await service.test(JWT, ORG, { provider: "openrouter", model: "moonshotai/kimi-k3", apiKey: "sk-or-typed-key" });
    assert(built[0]?.apiKey === "sk-or-typed-key", "the typed key is used");
  });
}

export async function assertTestUsesTheStoredKeyForTheSameProvider(): Promise<void> {
  await withEnv({}, async () => {
    const { service, built } = harness({ row: storedRow() });
    await service.test(JWT, ORG, { provider: "openrouter", model: "moonshotai/kimi-k3" });
    assert(built[0]?.apiKey === ORG_KEY, "the organization's stored key is used");
  });
}

export async function assertTestWithNoStoredKeyIsRestrictedToThePlatformDefault(): Promise<void> {
  await withEnv({}, async () => {
    const other = harness();
    const error = await rejection(other.service.test(JWT, ORG, { provider: "openrouter", model: "moonshotai/kimi-k3" }));
    assert(error instanceof BadRequestException, "another model without a key is a 400");
    assert(other.built.length === 0, "and nothing is called");
    const same = harness();
    await same.service.test(JWT, ORG, { provider: "openrouter", model: "z-ai/glm-5.3-flash" });
    assert(same.built.length === 1 && same.built[0].apiKey === PLATFORM_KEY, "the platform pair is tested with the platform key");
  });
}

export async function assertTestNeverSpendsThePlatformKeyOnAnotherProvider(): Promise<void> {
  await withEnv({ OPENAI_API_KEY: "sk-openai-platform" }, async () => {
    const { service, built } = harness({ row: storedRow("openai", null) });
    const error = await rejection(service.test(JWT, ORG, { provider: "anthropic", model: "claude-sonnet-5-5" }));
    assert(error instanceof BadRequestException && built.length === 0, "no platform key reaches another provider");
  });
}

export async function assertTestAnswerIsOnlyAStatus(): Promise<void> {
  const failures: [unknown, string][] = [
    [Object.assign(new Error(`401 invalid key ${ORG_KEY}`), { status: 401 }), "invalid_key"],
    [Object.assign(new Error("404 No endpoints found that support tool use"), { status: 404 }), "no_tool_support"],
    [Object.assign(new Error("429"), { status: 429 }), "rate_limited"],
  ];
  for (const [failure, status] of failures) {
    await withEnv({}, async () => {
      const result = await harness({ row: storedRow(), testError: failure }).service.test(JWT, ORG, { provider: "openrouter", model: "moonshotai/kimi-k3" });
      assert(JSON.stringify(result) === JSON.stringify({ status }), `only {status: ${status}}, got ${JSON.stringify(result)}`);
    });
  }
  await withEnv({}, async () => {
    const ok = await harness({ row: storedRow() }).service.test(JWT, ORG, { provider: "openrouter", model: "moonshotai/kimi-k3" });
    assert(JSON.stringify(ok) === '{"status":"ok"}', "a reply is ok");
  });
}

export async function assertTestSendsOneTrivialToolWithAutoChoice(): Promise<void> {
  await withEnv({}, async () => {
    const { service, built } = harness({ row: storedRow() });
    await service.test(JWT, ORG, { provider: "openrouter", model: "moonshotai/kimi-k3" });
    const tools = built[0]?.tools ?? [];
    assert(tools.length === 1 && tools[0].name === "ping", "one trivial tool, so a model without tool support fails here");
    assert(built.length === 1, "exactly one billed call");
  });
}

/** A key belongs to the provider that issued it: the stored OpenRouter key never reaches Anthropic. */
export async function assertTestNeverSpendsAStoredKeyOnAnotherProvider(): Promise<void> {
  await withEnv({}, async () => {
    const { service, built } = harness({ row: storedRow("openrouter") });
    const error = await rejection(service.test(JWT, ORG, { provider: "anthropic", model: "claude-sonnet-5-5" }));
    assert(error instanceof BadRequestException && built.length === 0, "the stored key is not used for another provider");
  });
}

/**
 * Security review H1. `canManageOrganization` answers **true** here, so the
 * role check alone is what refuses: a `location_admin` passes that predicate for
 * every organization one of its locations belongs to.
 */
export async function assertALocationAdminIsRefusedEvenInScope(): Promise<void> {
  await withEnv({}, async () => {
    const { service, writes, built } = harness({ role: "location_admin", inScope: true, row: storedRow() });
    const runs = [
      service.get(JWT, ORG),
      service.put(JWT, ORG, { provider: "openrouter", model: "x/y", apiKey: "sk-or-attacker-key" }),
      service.remove(JWT, ORG),
      service.test(JWT, ORG, { provider: "openrouter", model: "moonshotai/kimi-k3" }),
    ];
    for (const run of runs) {
      assert((await rejection(run)) instanceof ForbiddenException, "a location_admin is refused by role");
    }
    assert(writes.length === 0 && built.length === 0, "nothing is written and nothing is called");
  });
  await withEnv({}, async () => {
    const admin = harness({ role: "admin", inScope: true });
    assert((await admin.service.get(JWT, ORG)).source === "platform", "positive control: a global admin passes");
  });
}

/** Security review L4: an organization with its own row never tests with the platform key. */
export async function assertAnOrganizationRowNeverTestsWithThePlatformKey(): Promise<void> {
  await withEnv({}, async () => {
    const { service, built } = harness({ row: storedRow("off", null) });
    const error = await rejection(service.test(JWT, ORG, { provider: "openrouter", model: "z-ai/glm-5.3-flash" }));
    assert(error instanceof BadRequestException && built.length === 0, "the platform pair is refused for an org with a row");
  });
}
