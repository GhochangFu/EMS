import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";

import { organizationLlmSettings } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AiAssistantSettingsDto, AiAssistantTestResultDto, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { TENANT_DRIZZLE } from "../../database/database.tokens";
import { type BmsTx, withTenant } from "../../database/tenant-context";
import { CredentialCryptoService } from "../../security/credential-crypto.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { classifyProviderError, createLlmProvider } from "../../llm/llm-factory";
import { LlmResolver } from "../../llm/llm-resolver";
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
    private readonly resolver: LlmResolver,
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

  /**
   * The per-organization lock `put()` and `remove()` take as their first
   * statement after `withTenant` sets the tenant context, so the two serialize
   * for one organization — including when there is no row for `FOR UPDATE` or
   * a DELETE to lock. One helper, so the two cannot drift onto different keys.
   */
  private async lockSetting(tx: BmsTx, organizationId: string): Promise<void> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`organization_llm_settings:${organizationId}`}, 0))`,
    );
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
    type StoredKey = Pick<SettingRow, "keyCiphertext" | "keyIv" | "keyVersion" | "keyLast4">;
    let entered: StoredKey | null = null;
    if (body.apiKey !== undefined) {
      const encrypted = this.crypto.encrypt({ apiKey: body.apiKey });
      entered = {
        keyCiphertext: encrypted.ciphertext,
        keyIv: encrypted.iv,
        keyVersion: encrypted.keyVersion,
        keyLast4: body.apiKey.slice(-4),
      };
    }
    await withTenant(this.tenantDb, organizationId, async (tx) => {
      // F4.186 (security review M1, re-review L-a, L-b and L-c): the decision
      // is made on the committed row, never on an earlier read. The advisory
      // lock serializes put() and remove() calls for one organization,
      // including the no-row path where FOR UPDATE locks nothing — so a
      // concurrent first save commits before this one reads, and `keyChanged`
      // is exact on every path. A remove() that committed first means no row,
      // so no key is kept (F4.187). FOR UPDATE handles the writer that takes
      // no advisory lock: a concurrent `rotate-credentials` either committed
      // before this read, or holds the row and this read waits for it to
      // commit — either way the kept bytes are its rotated ones — or it waits
      // on this read's lock, and its compare-and-set then still matches the
      // kept bytes, so it rotates after this commit. A provider change is seen, so its key is
      // not kept.
      await this.lockSetting(tx, organizationId);
      const [existing] = await tx
        .select()
        .from(organizationLlmSettings)
        .where(eq(organizationLlmSettings.organizationId, organizationId))
        .for("update");
      const hadKey = existing?.keyCiphertext != null;
      // An omitted key keeps the stored one only for the same provider: a key
      // belongs to the provider it was issued by. Off stores no key (ruling 14).
      const keepStored = body.apiKey === undefined && body.provider !== "off" && existing?.provider === body.provider;
      let key: StoredKey;
      if (entered) {
        key = entered;
      } else if (keepStored && existing) {
        key = { keyCiphertext: existing.keyCiphertext, keyIv: existing.keyIv, keyVersion: existing.keyVersion, keyLast4: existing.keyLast4 };
      } else {
        key = { keyCiphertext: null, keyIv: null, keyVersion: null, keyLast4: null };
      }
      const keyChanged = body.apiKey !== undefined || (hadKey && key.keyCiphertext === null);
      const values = {
        provider: body.provider,
        model: body.provider === "off" ? null : (body.model ?? null),
        updatedBy: actorId,
        updatedAt: new Date(),
        ...key,
      };
      await tx
        .insert(organizationLlmSettings)
        .values({ organizationId, ...values })
        .onConflictDoUpdate({ target: organizationLlmSettings.organizationId, set: values });
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

  /**
   * F4.187 (security re-review I-3): the audit payload comes from
   * `DELETE … RETURNING` inside the locked transaction, never from a read
   * before it. Under READ COMMITTED a DELETE that waits on a row lock deletes
   * the row as the other writer committed it, and RETURNING reports that row.
   * The advisory lock orders this call after a `put()` whose row is not yet
   * committed (a first save), which a row lock cannot see. No row deleted, no
   * audit.
   */
  async remove(jwt: JwtPayload, organizationId: string): Promise<AiAssistantSettingsDto> {
    await this.gate(jwt, organizationId);
    await withTenant(this.tenantDb, organizationId, async (tx) => {
      await this.lockSetting(tx, organizationId);
      const [deleted] = await tx
        .delete(organizationLlmSettings)
        .where(eq(organizationLlmSettings.organizationId, organizationId))
        .returning({
          provider: organizationLlmSettings.provider,
          model: organizationLlmSettings.model,
          keyCiphertext: organizationLlmSettings.keyCiphertext,
        });
      if (!deleted) return;
      await this.audit.write(
        {
          actor: jwt,
          action: "master.organization.ai_assistant.delete",
          entityType: "organization_llm_settings",
          entityId: organizationId,
          organizationId,
          payload: { provider: deleted.provider, model: deleted.model, keyChanged: deleted.keyCiphertext !== null },
        },
        tx,
      );
    });
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
