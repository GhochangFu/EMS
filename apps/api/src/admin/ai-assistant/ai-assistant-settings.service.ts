import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { organizationLlmSettings } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AiAssistantSettingsDto, AiAssistantTestResultDto, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import { CredentialCryptoService } from "../../security/credential-crypto.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { classifyProviderError, createLlmProvider } from "../onboarding/onboarding-llm-factory";
import { OnboardingLlmResolver } from "../onboarding/onboarding-llm-resolver";
import type { PutAiAssistantSettingsBody, TestAiAssistantBody } from "./ai-assistant-settings.schema";

/** The Test button's one call may take this long (A5). */
export const TEST_CALL_DEADLINE_MS = 20_000;

export const NO_ENCRYPTION_KEY_MESSAGE =
  "CREDENTIAL_ENCRYPTION_KEY is not configured, so the key cannot be stored encrypted. Nothing was saved.";

type SettingRow = typeof organizationLlmSettings.$inferSelect;

/**
 * An organization's AI-assistant setting (`F3.21`, ADR 0090 Amendment 1 A5–A7).
 *
 * Every method calls `gate()` first: the role (`admin` or `organization_admin`,
 * security review H1) and then `canManageOrganization` (ruling 7). The key is
 * write-only: it is encrypted with `CredentialCryptoService` into the four
 * `key_*` columns, only its last four characters are ever returned, and it
 * never reaches a response, a log line, an audit row or an error (A7).
 */
@Injectable()
export class AiAssistantSettingsService {
  /** Replaced in specs to record what the Test button would call; production uses the factory. */
  buildProvider: typeof createLlmProvider = createLlmProvider;

  constructor(
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
    private readonly crypto: CredentialCryptoService,
    private readonly resolver: OnboardingLlmResolver,
  ) {}

  /**
   * The acting user's `bms.users` id, after the role and scope checks.
   *
   * Security review H1: `canManageOrganization` alone admits a
   * `location_admin` for every organization one of its locations belongs to.
   * Ruling 7 meant an admin of that organization, so the role is checked first,
   * as the onboarding chat does (`assertOnboardingAccess`).
   */
  private async gate(jwt: JwtPayload, organizationId: string): Promise<string> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    if (user.role !== "admin" && user.role !== "organization_admin") {
      throw new ForbiddenException("The AI assistant setting requires admin or organization_admin role");
    }
    if (!(await this.accessControl.canManageOrganization(jwt, organizationId))) {
      throw new ForbiddenException("Organization is outside your access scope");
    }
    return user.id;
  }

  private toDto(row: SettingRow | null): AiAssistantSettingsDto {
    const platform = this.resolver.platformSummary();
    if (!row) {
      return {
        source: "platform",
        provider: platform.provider,
        model: platform.model,
        keySet: platform.keySet,
        keyLast4: null,
        updatedAt: null,
        platform,
      };
    }
    return {
      source: "organization",
      provider: row.provider as AiAssistantSettingsDto["provider"],
      model: row.model,
      keySet: row.keyCiphertext !== null,
      keyLast4: row.keyLast4,
      updatedAt: row.updatedAt.toISOString(),
      platform,
    };
  }

  async get(jwt: JwtPayload, organizationId: string): Promise<AiAssistantSettingsDto> {
    await this.gate(jwt, organizationId);
    return this.toDto(await this.resolver.readSetting(organizationId));
  }

  async put(jwt: JwtPayload, organizationId: string, body: PutAiAssistantSettingsBody): Promise<AiAssistantSettingsDto> {
    const actorId = await this.gate(jwt, organizationId);
    // Checked before anything is written (ADR 0062 decision 8): no key, no false success.
    if (body.apiKey !== undefined && !CredentialCryptoService.isConfigured()) {
      throw new BadRequestException(NO_ENCRYPTION_KEY_MESSAGE);
    }
    const existing = await this.resolver.readSetting(organizationId);
    const hadKey = existing?.keyCiphertext != null;
    // An omitted key keeps the stored one only for the same provider: a key
    // belongs to the provider it was issued by. Off stores no key (ruling 14).
    const keepStored = body.apiKey === undefined && body.provider !== "off" && existing?.provider === body.provider;
    let key: Pick<SettingRow, "keyCiphertext" | "keyIv" | "keyVersion" | "keyLast4">;
    if (body.apiKey !== undefined) {
      const encrypted = this.crypto.encrypt({ apiKey: body.apiKey });
      key = {
        keyCiphertext: encrypted.ciphertext,
        keyIv: encrypted.iv,
        keyVersion: encrypted.keyVersion,
        keyLast4: body.apiKey.slice(-4),
      };
    } else if (keepStored && existing) {
      key = { keyCiphertext: existing.keyCiphertext, keyIv: existing.keyIv, keyVersion: existing.keyVersion, keyLast4: existing.keyLast4 };
    } else {
      key = { keyCiphertext: null, keyIv: null, keyVersion: null, keyLast4: null };
    }
    const keyChanged = body.apiKey !== undefined || (hadKey && key.keyCiphertext === null);
    const settings = {
      provider: body.provider,
      model: body.provider === "off" ? null : (body.model ?? null),
      updatedBy: actorId,
      updatedAt: new Date(),
    };
    const values = { ...settings, ...key };
    // F4.186 (security review M1, ADR 0062): `existing` was read outside this
    // transaction, so `rotate-credentials` may have re-encrypted the key since.
    // A kept key is therefore never written back on conflict — that would undo
    // the rotation. The insert still carries it, for a row deleted meanwhile.
    const set = keepStored ? settings : values;
    await withTenant(this.tenantDb, organizationId, async (tx) => {
      await tx
        .insert(organizationLlmSettings)
        .values({ organizationId, ...values })
        .onConflictDoUpdate({ target: organizationLlmSettings.organizationId, set });
      await this.audit.write(
        {
          actor: jwt,
          action: "master.organization.ai_assistant.update",
          entityType: "organization_llm_settings",
          entityId: organizationId,
          organizationId,
          payload: { provider: values.provider, model: values.model, keyChanged },
        },
        tx,
      );
    });
    return this.toDto(await this.resolver.readSetting(organizationId));
  }

  async remove(jwt: JwtPayload, organizationId: string): Promise<AiAssistantSettingsDto> {
    await this.gate(jwt, organizationId);
    const existing = await this.resolver.readSetting(organizationId);
    if (existing) {
      await withTenant(this.tenantDb, organizationId, async (tx) => {
        await tx.delete(organizationLlmSettings).where(eq(organizationLlmSettings.organizationId, organizationId));
        await this.audit.write(
          {
            actor: jwt,
            action: "master.organization.ai_assistant.delete",
            entityType: "organization_llm_settings",
            entityId: organizationId,
            organizationId,
            payload: { provider: existing.provider, model: existing.model, keyChanged: existing.keyCiphertext !== null },
          },
          tx,
        );
      });
    }
    return this.toDto(null);
  }

  /**
   * One minimal billed call (A5). The key is the one given, else the
   * organization's stored key for the same provider. With neither, only the
   * platform default exactly as configured may be tested — an org admin cannot
   * spend the platform key on another provider or model.
   */
  async test(jwt: JwtPayload, organizationId: string, body: TestAiAssistantBody): Promise<AiAssistantTestResultDto> {
    await this.gate(jwt, organizationId);
    let apiKey = body.apiKey;
    const row = apiKey === undefined ? await this.resolver.readSetting(organizationId) : null;
    if (apiKey === undefined && row) {
      if (row.provider === body.provider) {
        apiKey = this.resolver.decryptKey(row) ?? undefined;
      }
      // Security review L4: an organization with its own row never tests with
      // the platform key, as it never chats with it (A4).
      if (apiKey === undefined) {
        throw new BadRequestException("There is no key to test: enter one, or save one for this provider first.");
      }
    }
    if (apiKey === undefined) {
      const platform = this.resolver.platformDefault();
      if (platform.state !== "ready" || platform.provider !== body.provider || platform.model !== body.model) {
        throw new BadRequestException(
          platform.state === "ready"
            ? `Without a stored key the test can only check the platform default: ${platform.provider} / ${platform.model}`
            : "There is no key to test: enter one, or save one for this provider first.",
        );
      }
      apiKey = platform.apiKey;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TEST_CALL_DEADLINE_MS);
    try {
      await this.buildProvider(body.provider, { apiKey, model: body.model }).complete({
        messages: [
          { role: "system", content: "You are a connectivity check." },
          { role: "user", content: "Reply with the single word ok." },
        ],
        tools: [
          {
            name: "ping",
            description: "Confirms tool support.",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        ],
        signal: controller.signal,
      });
      return { status: "ok" };
    } catch (error) {
      return { status: classifyProviderError(error, controller.signal) };
    } finally {
      clearTimeout(timer);
    }
  }
}
