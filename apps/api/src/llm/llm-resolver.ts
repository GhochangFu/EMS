import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { organizationLlmSettings } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { LlmProviderName } from "@bms/shared";

import { TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import { CredentialCryptoService } from "../security/credential-crypto.service";
import { createLlmProvider } from "./llm-factory";
import type { LlmProvider } from "./llm-port";

/** Amendment 1 A2 / ruling 3: the model a provider uses when its `*_MODEL` is empty. */
export const DEFAULT_MODELS: Readonly<Record<LlmProviderName, string | null>> = {
  openai: "gpt-4o-mini",
  openrouter: null,
  anthropic: "claude-sonnet-5-5",
};

const KEY_VARIABLE: Readonly<Record<LlmProviderName, string>> = {
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

const MODEL_VARIABLE: Readonly<Record<LlmProviderName, string>> = {
  openai: "OPENAI_MODEL",
  openrouter: "OPENROUTER_MODEL",
  anthropic: "ANTHROPIC_MODEL",
};

function isProviderName(value: string): value is LlmProviderName {
  return value === "openai" || value === "openrouter" || value === "anthropic";
}

export type PlatformLlmDefault =
  | { readonly state: "off" }
  | { readonly state: "incomplete"; readonly provider: LlmProviderName | null; readonly missing: string }
  | { readonly state: "ready"; readonly provider: LlmProviderName; readonly model: string; readonly apiKey: string };

export type ResolvedLlm =
  | { readonly kind: "ready"; readonly provider: LlmProvider; readonly source: "organization" | "platform" }
  | {
      readonly kind: "guided";
      /** `organization_incomplete` is the one reason the chat states to the user (plan ruling 13). */
      readonly reason: "organization_off" | "organization_incomplete" | "platform_off" | "platform_incomplete";
    };

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

/**
 * Chooses the provider for one chat turn (ADR 0090 Amendment 1 A2 and A4).
 *
 * An organization's own row wins: `off` means the guided mode, a complete row
 * builds its provider with its own key, and an incomplete row means the guided
 * mode and one warning — **never the platform key** (A4). With no row, the
 * `.env` platform default applies.
 *
 * This class is the only reader of the seven A2 variables; the adapters read
 * none. They are read on every call, so a spec can change them per case. The
 * decrypted key lives in the provider instance for one turn and is not cached.
 */
@Injectable()
export class LlmResolver implements OnModuleInit {
  private readonly logger = new Logger(LlmResolver.name);

  /** Replaced in specs to record what would be built; production uses the factory. */
  buildProvider: typeof createLlmProvider = createLlmProvider;

  constructor(
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly crypto: CredentialCryptoService,
  ) {}

  /** One boot warning when the platform default names a provider it cannot build. Names a variable, never a value. */
  onModuleInit(): void {
    const platform = this.platformDefault();
    if (platform.state === "incomplete") {
      this.logger.warn(
        { variable: platform.missing },
        "LLM platform default is incomplete; the onboarding agent is off unless an organization sets its own provider",
      );
    }
  }

  platformDefault(): PlatformLlmDefault {
    const selected = env("LLM_PROVIDER");
    if (!selected) {
      return { state: "off" };
    }
    if (!isProviderName(selected)) {
      return { state: "incomplete", provider: null, missing: "LLM_PROVIDER" };
    }
    const apiKey = env(KEY_VARIABLE[selected]);
    if (!apiKey) {
      return { state: "incomplete", provider: selected, missing: KEY_VARIABLE[selected] };
    }
    const model = env(MODEL_VARIABLE[selected]) || DEFAULT_MODELS[selected];
    if (!model) {
      return { state: "incomplete", provider: selected, missing: MODEL_VARIABLE[selected] };
    }
    return { state: "ready", provider: selected, model, apiKey };
  }

  /**
   * What the settings page shows of the platform default (A5): the provider,
   * its model, and whether its key is set — never the key.
   */
  platformSummary(): { provider: LlmProviderName | "off"; model: string | null; keySet: boolean } {
    const selected = env("LLM_PROVIDER");
    if (!isProviderName(selected)) {
      return { provider: "off", model: null, keySet: false };
    }
    return {
      provider: selected,
      model: env(MODEL_VARIABLE[selected]) || DEFAULT_MODELS[selected],
      keySet: env(KEY_VARIABLE[selected]) !== "",
    };
  }

  /** The organization's stored row, or `null`. A tenant read, so it runs inside a transaction (§4.4). */
  async readSetting(organizationId: string): Promise<typeof organizationLlmSettings.$inferSelect | null> {
    const [row] = await withTenant(this.tenantDb, organizationId, (tx) =>
      tx
        .select()
        .from(organizationLlmSettings)
        .where(eq(organizationLlmSettings.organizationId, organizationId))
        .limit(1),
    );
    return row ?? null;
  }

  /** The stored key in plain text, or `null` when the row has none or it cannot be decrypted. */
  decryptKey(row: typeof organizationLlmSettings.$inferSelect): string | null {
    if (!row.keyCiphertext || !row.keyIv) {
      return null;
    }
    try {
      const plain = this.crypto.decrypt(row.keyCiphertext, row.keyIv, row.keyVersion);
      return typeof plain.apiKey === "string" && plain.apiKey ? plain.apiKey : null;
    } catch {
      return null;
    }
  }

  async resolveForOrganization(organizationId: string): Promise<ResolvedLlm> {
    const row = await this.readSetting(organizationId);
    if (row) {
      if (row.provider === "off") {
        return { kind: "guided", reason: "organization_off" };
      }
      const apiKey = this.decryptKey(row);
      if (!isProviderName(row.provider) || !row.model || !apiKey) {
        this.logger.warn(
          { organizationId, provider: row.provider },
          "organization LLM setting is incomplete; the guided mode answers",
        );
        return { kind: "guided", reason: "organization_incomplete" };
      }
      return {
        kind: "ready",
        provider: this.buildProvider(row.provider, { apiKey, model: row.model }),
        source: "organization",
      };
    }
    const platform = this.platformDefault();
    if (platform.state === "off") {
      return { kind: "guided", reason: "platform_off" };
    }
    if (platform.state === "incomplete") {
      return { kind: "guided", reason: "platform_incomplete" };
    }
    return {
      kind: "ready",
      provider: this.buildProvider(platform.provider, { apiKey: platform.apiKey, model: platform.model }),
      source: "platform",
    };
  }
}
