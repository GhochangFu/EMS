import { BadRequestException, ForbiddenException } from "@nestjs/common";

import { CredentialCryptoService } from "../../security/credential-crypto.service";
import type { LlmMessage, LlmToolDefinition, LlmProvider } from "../../llm/llm-port";
import { LlmResolver } from "../../llm/llm-resolver";
import { AiAssistantSettingsService, NO_ENCRYPTION_KEY_MESSAGE, VISION_PROBE_PNG } from "./ai-assistant-settings.service";

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

const ENV_NAMES = ["LLM_PROVIDER", "OPENROUTER_API_KEY", "OPENROUTER_MODEL", "OPENAI_API_KEY", "OPENAI_MODEL", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "LLM_VISION_MODEL", "CREDENTIAL_ENCRYPTION_KEY", "CREDENTIAL_ENCRYPTION_KEY_VERSION"];

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

type Built = { name: string; apiKey: string; model: string; tools?: readonly LlmToolDefinition[]; messages: readonly LlmMessage[] };

/**
 * The service over an in-memory row (the RLS integration suite covers the real
 * table), a recording audit writer, the real crypto and resolver, and a
 * factory that records what the Test button would call.
 */
function harness(
  opts: { row?: Row | null; inScope?: boolean; testError?: unknown; testErrorFor?: (model: string) => unknown; role?: string } = {},
) {
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
    // remove()'s `delete … returning` inside its write transaction: the deleted row, projected
    // onto the columns the service asks for, so a column left out of RETURNING is missing here too.
    delete: () => ({
      where: () => ({
        returning: async (projection: Record<string, unknown>) => {
          const deleted = store.row as Record<string, unknown> | null;
          writes.push({ kind: "delete" });
          store.row = null;
          return deleted ? [Object.fromEntries(Object.keys(projection).map((column) => [column, deleted[column]]))] : [];
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
        built.push({ name, ...options, tools: input.tools, messages: input.messages });
        if (opts.testError !== undefined) throw opts.testError;
        const failure = opts.testErrorFor?.(options.model);
        if (failure !== undefined) throw failure;
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
    visionModel: null,
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
    assert(JSON.stringify(Object.keys(entry.payload as object)) === '["provider","model","visionModel","keyChanged"]', "payload keys exactly");
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
      JSON.stringify(audits[0]?.payload) === JSON.stringify({ provider: row.provider, model: row.model, visionModel: row.visionModel, keyChanged: true }),
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
      JSON.stringify(audits[0]?.payload) === JSON.stringify({ provider: "openrouter", model: row.model, visionModel: null, keyChanged: false }),
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

// ---- ADR 0090 Amendment 3 C4 (F4.267): the vision model through PUT, GET, DELETE and Test ----

const VISION = "google/gemini-3-flash";

export async function assertPutStoresAndAuditsTheVisionModel(): Promise<void> {
  await withEnv({}, async () => {
    const { service, store, audits } = harness();
    const dto = await service.put(JWT, ORG, {
      provider: "openrouter",
      model: "z-ai/glm-5.3-flash",
      visionModel: VISION,
      apiKey: "sk-or-secret-key-4321",
    });
    assert(store.row?.visionModel === VISION, "the vision model is stored");
    assert(dto.visionModel === VISION, "and reported");
    const payload = audits[0]?.payload as Record<string, unknown>;
    assert(
      JSON.stringify(payload) ===
        JSON.stringify({ provider: "openrouter", model: "z-ai/glm-5.3-flash", visionModel: VISION, keyChanged: true }),
      `the audit names the vision model, got ${JSON.stringify(payload)}`,
    );
    const text = JSON.stringify(audits);
    assert(!text.includes("sk-or-secret") && !text.includes("4321"), "no key text");
  });
}

/** Plan D4: an omitted or null vision model stores NULL — a stored one is cleared, never kept. */
export async function assertPutWithoutAVisionModelClearsTheStoredOne(): Promise<void> {
  for (const visionModel of [undefined, null]) {
    await withEnv({}, async () => {
      const { service, store } = harness({ row: { ...storedRow(), visionModel: VISION } });
      await service.put(JWT, ORG, {
        provider: "openrouter",
        model: "z-ai/glm-5.3-flash",
        ...(visionModel === null ? { visionModel } : {}),
      });
      assert(store.row?.keyLast4 === "xyz9", "control: the stored key is kept, so the row was written over the old one");
      assert(store.row?.visionModel === null, `${visionModel === null ? "a null" : "an omitted"} vision model clears the stored one`);
    });
  }
}

export async function assertPutOffStoresNoVisionModel(): Promise<void> {
  await withEnv({}, async () => {
    const { service, store } = harness({ row: { ...storedRow(), visionModel: VISION } });
    await service.put(JWT, ORG, { provider: "off", visionModel: null });
    assert(store.row?.provider === "off" && store.row?.visionModel === null, "off stores no vision model");
  });
}

export async function assertGetReportsTheVisionModelAndThePlatformOne(): Promise<void> {
  await withEnv({ LLM_VISION_MODEL: "qwen/qwen3-vl" }, async () => {
    const own = await harness({ row: { ...storedRow(), visionModel: VISION } }).service.get(JWT, ORG);
    assert(own.visionModel === VISION, "a row reports its vision model");
    assert(own.platform.visionModel === "qwen/qwen3-vl", "and the platform block names the platform one");
    const platform = await harness().service.get(JWT, ORG);
    assert(platform.source === "platform" && platform.visionModel === "qwen/qwen3-vl", "no row reports the platform vision model");
  });
}

export async function assertDeleteAuditsTheVisionModel(): Promise<void> {
  await withEnv({}, async () => {
    const { service, audits } = harness({ row: { ...storedRow(), visionModel: VISION } });
    await service.remove(JWT, ORG);
    assert((audits[0]?.payload as { visionModel?: unknown })?.visionModel === VISION, "the delete audit names the deleted vision model");
  });
}

type ImagePart = { type: string; mediaType?: string; data?: Buffer };

function imagePartsOf(call: Built | undefined): ImagePart[] {
  const user = call?.messages.find((message) => message.role === "user");
  if (!user || user.role !== "user" || typeof user.content === "string") return [];
  return user.content.filter((part) => part.type === "image") as ImagePart[];
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export async function assertTestWithAVisionModelMakesASecondCallWithOneImage(): Promise<void> {
  await withEnv({}, async () => {
    const { service, built } = harness({ row: storedRow() });
    const result = await service.test(JWT, ORG, { provider: "openrouter", model: "moonshotai/kimi-k3", visionModel: VISION });
    assert(built.length === 2, `two billed calls, got ${built.length}`);
    assert(built[0]?.model === "moonshotai/kimi-k3" && imagePartsOf(built[0]).length === 0, "call 1 is the main model, text only");
    assert(built[1]?.model === VISION && built[1]?.apiKey === ORG_KEY, "call 2 is the vision model with the same key");
    const images = imagePartsOf(built[1]);
    assert(images.length === 1, `call 2 carries exactly one image part, got ${images.length}`);
    const data = images[0]?.data;
    assert(images[0]?.mediaType === "image/png", "the image is image/png");
    assert(data instanceof Buffer && data.subarray(0, 8).equals(PNG_SIGNATURE), "it sniffs as a PNG");
    assert(data instanceof Buffer && data.length < 200, `it is small, got ${data?.length}`);
    assert(JSON.stringify((built[1]?.tools ?? []).map((tool) => tool.name)) === '["ping"]', "call 2 sends the one ping tool");
    assert(JSON.stringify(result) === '{"status":"ok","visionStatus":"ok"}', `both checks answer, got ${JSON.stringify(result)}`);
  });
}

export async function assertTheVisionProbeIsARealPng(): Promise<void> {
  assert(VISION_PROBE_PNG.subarray(0, 8).equals(PNG_SIGNATURE), "the PNG signature");
  assert(VISION_PROBE_PNG.subarray(12, 16).toString("ascii") === "IHDR", "the first chunk is IHDR");
  assert(VISION_PROBE_PNG.readUInt32BE(16) === 1 && VISION_PROBE_PNG.readUInt32BE(20) === 1, "it is 1x1");
  assert(VISION_PROBE_PNG.subarray(-8, -4).toString("ascii") === "IEND", "it ends with IEND");
}

export async function assertTestWithoutAVisionModelMakesOneCallAndAnswersOnlyAStatus(): Promise<void> {
  await withEnv({}, async () => {
    const { service, built } = harness({ row: storedRow() });
    const result = await service.test(JWT, ORG, { provider: "openrouter", model: "moonshotai/kimi-k3" });
    assert(built.length === 1, "one billed call");
    assert(JSON.stringify(result) === '{"status":"ok"}', `no visionStatus key, got ${JSON.stringify(result)}`);
  });
}

/** Plan D2: the two statuses are independent — a vision refusal does not change the main one. */
export async function assertAVisionRefusalIsItsOwnStatus(): Promise<void> {
  await withEnv({}, async () => {
    const refusal = Object.assign(new Error(`404 No endpoints found that support image input ${ORG_KEY} openrouter.ai`), { status: 404 });
    const { service, built } = harness({ row: storedRow(), testErrorFor: (model) => (model === VISION ? refusal : undefined) });
    const result = await service.test(JWT, ORG, { provider: "openrouter", model: "moonshotai/kimi-k3", visionModel: VISION });
    assert(built.length === 2, "both calls were made");
    assert(JSON.stringify(result) === '{"status":"ok","visionStatus":"no_image_support"}', `got ${JSON.stringify(result)}`);
    assert(!JSON.stringify(result).includes(ORG_KEY) && !JSON.stringify(result).includes("openrouter"), "no key or provider text");
  });
}

/** Plan D2: the vision call is made even when the main call failed. */
export async function assertTheMainFailureDoesNotSkipTheVisionCall(): Promise<void> {
  await withEnv({}, async () => {
    const main = Object.assign(new Error("429"), { status: 429 });
    const { service, built } = harness({ row: storedRow(), testErrorFor: (model) => (model === VISION ? undefined : main) });
    const result = await service.test(JWT, ORG, { provider: "openrouter", model: "moonshotai/kimi-k3", visionModel: VISION });
    assert(built.length === 2, `the vision call is made after a failed main call, got ${built.length} calls`);
    assert(JSON.stringify(result) === '{"status":"rate_limited","visionStatus":"ok"}', `got ${JSON.stringify(result)}`);
  });
}

/** Without a stored key only the platform's own vision model may be tested with the platform key. */
export async function assertThePlatformKeyIsNeverSpentOnAnotherVisionModel(): Promise<void> {
  await withEnv({ LLM_VISION_MODEL: "qwen/qwen3-vl" }, async () => {
    const other = harness();
    const error = await rejection(other.service.test(JWT, ORG, { provider: "openrouter", model: "z-ai/glm-5.3-flash", visionModel: VISION }));
    assert(error instanceof BadRequestException, "another vision model on the platform key is a 400");
    assert(other.built.length === 0, "and nothing is called");
    const same = harness();
    await same.service.test(JWT, ORG, { provider: "openrouter", model: "z-ai/glm-5.3-flash", visionModel: "qwen/qwen3-vl" });
    assert(same.built.length === 2 && same.built[1]?.apiKey === PLATFORM_KEY, "the platform's own vision model is tested");
  });
  await withEnv({}, async () => {
    const unset = harness();
    const error = await rejection(unset.service.test(JWT, ORG, { provider: "openrouter", model: "z-ai/glm-5.3-flash", visionModel: VISION }));
    assert(error instanceof BadRequestException && unset.built.length === 0, "with no platform vision model, any vision model is a 400");
  });
}
