import { Logger } from "@nestjs/common";

import { CredentialCryptoService } from "../security/credential-crypto.service";
import type { LlmProvider } from "./llm-port";
import { LlmResolver } from "./llm-resolver";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const KEY = Buffer.alloc(32, 0x01).toString("base64");

const LLM_VARS = [
  "LLM_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
] as const;

/** Sets the seven A2 variables (unset unless given) and the credential key, then restores them. */
async function withEnv<T>(vars: Partial<Record<(typeof LLM_VARS)[number], string>>, fn: () => Promise<T> | T): Promise<T> {
  const names = [...LLM_VARS, "CREDENTIAL_ENCRYPTION_KEY", "CREDENTIAL_ENCRYPTION_KEY_VERSION"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of LLM_VARS) {
    const value = vars[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  process.env.CREDENTIAL_ENCRYPTION_KEY = KEY;
  delete process.env.CREDENTIAL_ENCRYPTION_KEY_VERSION;
  try {
    return await fn();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

type Built = { name: string; apiKey: string; model: string };
type Row = Parameters<LlmResolver["decryptKey"]>[0];

/**
 * A resolver whose tenant read returns `row` and whose factory records what it
 * would build. The read itself is covered by the RLS integration suite.
 */
function resolver(row: Row | null): { r: LlmResolver; built: Built[]; decrypts: { n: number } } {
  const crypto = new CredentialCryptoService();
  const decrypts = { n: 0 };
  const r = new LlmResolver({} as never, crypto);
  r.readSetting = async () => row;
  const original = r.decryptKey.bind(r);
  r.decryptKey = (stored) => {
    decrypts.n += 1;
    return original(stored);
  };
  const built: Built[] = [];
  r.buildProvider = (name, options) => {
    built.push({ name, ...options });
    return { name } as LlmProvider;
  };
  return { r, built, decrypts };
}

function orgRow(overrides: Partial<Row> & { apiKey?: string } = {}): Row {
  const { apiKey, ...rest } = overrides;
  const base: Row = {
    organizationId: "org-1",
    provider: "openai",
    model: "gpt-4o",
    keyCiphertext: null,
    keyIv: null,
    keyVersion: null,
    keyLast4: null,
    updatedBy: null,
    updatedAt: new Date(),
  };
  if (apiKey !== undefined) {
    const enc = new CredentialCryptoService().encrypt({ apiKey });
    Object.assign(base, { keyCiphertext: enc.ciphertext, keyIv: enc.iv, keyVersion: enc.keyVersion, keyLast4: apiKey.slice(-4) });
  }
  return { ...base, ...rest };
}

export async function assertAnEmptyLlmProviderIsOff(): Promise<void> {
  await withEnv({ OPENAI_API_KEY: "plat-key" }, () => {
    const platform = resolver(null).r.platformDefault();
    assert(platform.state === "off", "an empty LLM_PROVIDER is off, even with a key set");
  });
}

export async function assertEachProviderNeedsItsKey(): Promise<void> {
  for (const [provider, variable] of [
    ["openai", "OPENAI_API_KEY"],
    ["openrouter", "OPENROUTER_API_KEY"],
    ["anthropic", "ANTHROPIC_API_KEY"],
  ] as const) {
    await withEnv({ LLM_PROVIDER: provider, OPENROUTER_MODEL: "z-ai/glm-5.3-flash" }, () => {
      const platform = resolver(null).r.platformDefault();
      assert(platform.state === "incomplete" && platform.missing === variable, `${provider} without its key names ${variable}`);
    });
  }
  await withEnv({ LLM_PROVIDER: "gemini" }, () => {
    const platform = resolver(null).r.platformDefault();
    assert(platform.state === "incomplete" && platform.missing === "LLM_PROVIDER", "an unknown provider names LLM_PROVIDER");
  });
}

export async function assertOpenRouterNeedsAModelAndTheOthersDefault(): Promise<void> {
  await withEnv({ LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: "or-key" }, () => {
    const platform = resolver(null).r.platformDefault();
    assert(platform.state === "incomplete" && platform.missing === "OPENROUTER_MODEL", "OpenRouter has no default model");
  });
  await withEnv({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "oa-key" }, () => {
    const platform = resolver(null).r.platformDefault();
    assert(platform.state === "ready" && platform.model === "gpt-4o-mini", "OpenAI defaults to gpt-4o-mini");
  });
  await withEnv({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "an-key" }, () => {
    const platform = resolver(null).r.platformDefault();
    assert(platform.state === "ready" && platform.model === "claude-sonnet-5-5", "Anthropic defaults to claude-sonnet-5-5");
  });
}

export async function assertTheBootWarningNamesTheVariableAndNoValue(): Promise<void> {
  const original = Logger.prototype.warn;
  const warned: unknown[][] = [];
  Logger.prototype.warn = function (...args: unknown[]) {
    warned.push(args);
  } as typeof Logger.prototype.warn;
  try {
    await withEnv({ LLM_PROVIDER: "openrouter", OPENROUTER_MODEL: "secret-model-value" }, () => {
      resolver(null).r.onModuleInit();
    });
  } finally {
    Logger.prototype.warn = original;
  }
  assert(warned.length === 1, `one warning, got ${warned.length}`);
  const [meta] = warned[0] as [{ variable?: string }];
  assert(meta.variable === "OPENROUTER_API_KEY", "the warning names the missing variable");
  assert(!JSON.stringify(warned).includes("secret-model-value"), "the warning carries no environment value");
}

export async function assertOffLogsNoWarning(): Promise<void> {
  const original = Logger.prototype.warn;
  let count = 0;
  Logger.prototype.warn = function () {
    count += 1;
  } as typeof Logger.prototype.warn;
  try {
    await withEnv({}, () => resolver(null).r.onModuleInit());
  } finally {
    Logger.prototype.warn = original;
  }
  assert(count === 0, "an off platform logs nothing");
}

export async function assertNoRowUsesThePlatformDefault(): Promise<void> {
  await withEnv({ LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: "plat-key", OPENROUTER_MODEL: "z-ai/glm-5.3-flash" }, async () => {
    const { r, built } = resolver(null);
    const resolved = await r.resolveForOrganization("org-1");
    assert(resolved.kind === "ready" && resolved.source === "platform", "no row resolves to the platform");
    assert(JSON.stringify(built) === JSON.stringify([{ name: "openrouter", apiKey: "plat-key", model: "z-ai/glm-5.3-flash" }]), "with the platform key and model");
  });
}

export async function assertAnOffRowIsGuidedMode(): Promise<void> {
  await withEnv({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "plat-key" }, async () => {
    const { r, built } = resolver(orgRow({ provider: "off", model: null }));
    const resolved = await r.resolveForOrganization("org-1");
    assert(resolved.kind === "guided" && resolved.reason === "organization_off", "an off row is the guided mode");
    assert(built.length === 0, "nothing is built, although the platform is ready");
  });
}

export async function assertACompleteRowBuildsThatProvider(): Promise<void> {
  await withEnv({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "plat-key" }, async () => {
    const { r, built } = resolver(orgRow({ provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "org-key" }));
    const resolved = await r.resolveForOrganization("org-1");
    assert(resolved.kind === "ready" && resolved.source === "organization", "a complete row resolves to the organization");
    assert(JSON.stringify(built) === JSON.stringify([{ name: "anthropic", apiKey: "org-key", model: "claude-sonnet-5-5" }]), "with its own key and model");
  });
}

export async function assertAnIncompleteRowNeverUsesThePlatformKey(): Promise<void> {
  const original = Logger.prototype.warn;
  let warnings = 0;
  Logger.prototype.warn = function () {
    warnings += 1;
  } as typeof Logger.prototype.warn;
  try {
    await withEnv({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "plat-key" }, async () => {
      const { r, built } = resolver(orgRow({ provider: "openai", model: "gpt-4o" }));
      const resolved = await r.resolveForOrganization("org-1");
      assert(resolved.kind === "guided" && resolved.reason === "organization_incomplete", "a row without a key is the guided mode");
      assert(built.length === 0, "the platform key is never used for an organization row");
    });
  } finally {
    Logger.prototype.warn = original;
  }
  assert(warnings === 1, `one warning, got ${warnings}`);
}

export async function assertTheKeyIsNotCached(): Promise<void> {
  await withEnv({}, async () => {
    const { r, decrypts } = resolver(orgRow({ provider: "openai", model: "gpt-4o", apiKey: "org-key" }));
    await r.resolveForOrganization("org-1");
    await r.resolveForOrganization("org-1");
    assert(decrypts.n === 2, `each turn decrypts again, got ${decrypts.n}`);
  });
}
