import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";

import { onboardingSessions, rtuConnectionConfigs, rtus } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { CopyOnboardingCredentialsBody, JwtPayload, OnboardingDraft, OnboardingSessionDto } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import { CredentialCryptoService } from "../../security/credential-crypto.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { brokerOf, copyBlobToTargets, sameBroker, type MqttBroker } from "./onboarding-credential-copy";
import { draftHash } from "./onboarding-commit-proposal";
import { assertSessionUnlocked, assertTurnStillBound, lockSession } from "./onboarding-locked-writes";
import { blobBoundTo, ownBlobAt, rtuSecretKey, type EncryptedBlob } from "./onboarding-redaction";
import { OnboardingService } from "./onboarding.service";

/** `F4.339`: the 503 when no key is loaded — the `setCredentials` rule, so a copy never reports a success it cannot serve. */
export const COPY_NEEDS_KEY = "CREDENTIAL_ENCRYPTION_KEY is not configured, so a credential cannot be copied. Nothing was copied.";
/** `F4.339` (R7): the 409 of a blob at a key version this API cannot read now. */
export const COPY_KEY_VERSION =
  "The source credential is encrypted under a key version that is no longer loaded. Re-enter it with Add credentials.";
/** `F4.339`: the 404 of a committed source the caller's organization does not have, or an inactive one. */
export const COPY_SOURCE_NOT_FOUND = "RTU not found";
/** `F4.339`: the 403 of a committed source outside the caller's location scope. */
export const COPY_SOURCE_OUT_OF_SCOPE = "You cannot manage the location of the source RTU.";

export const copySourceHasNoCredential = (code: string): string => `RTU ${code} has no stored credential to copy.`;
export const copySourceNotMqtt = (code: string): string => `RTU ${code} is not an MQTT RTU; only MQTT credentials are copied.`;
export const copyTargetNotSameBroker = (code: string): string =>
  `Draft RTU ${code} is not an MQTT RTU on the same broker (host, port and TLS) as the source. Nothing was copied.`;
export const copyTargetsHoldCredentials = (codes: readonly string[]): string =>
  `Draft RTU ${codes.join(", ")} already has a credential. Send replace: true to overwrite it. Nothing was copied.`;
export const COPY_TARGET_IS_SOURCE = "The source RTU cannot be its own target.";
export const copyTargetHasNoCode = (indexes: readonly number[]): string =>
  `Draft RTU at index ${indexes.join(", ")} has no code, or another RTU in this draft claims the same code. Give each RTU a distinct code first.`;

type Source = { blob: EncryptedBlob; broker: MqttBroker; draftCode: string | null; audit: Record<string, string> };

/**
 * `F4.339` (ADR 0117 decision 7, plan R7, T7.2) — copies one RTU's encrypted
 * credential to other MQTT RTUs of a draft on the same broker. The blob is
 * copied as stored and never decrypted (owner ruling Q4); the response is the
 * redacted session (ADR 0022). Kept out of `OnboardingService`, which is at the
 * line cap.
 */
@Injectable()
export class OnboardingCredentialCopyService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
    private readonly sessions: OnboardingService,
  ) {}

  async copy(jwt: JwtPayload, sessionId: string, body: CopyOnboardingCredentialsBody): Promise<OnboardingSessionDto> {
    const session = await this.sessions.loadSession(jwt, sessionId);
    if (session.status !== "draft") {
      throw new ForbiddenException("Session is not editable");
    }
    assertSessionUnlocked(session);
    if (!CredentialCryptoService.isConfigured()) {
      throw new ServiceUnavailableException(COPY_NEEDS_KEY);
    }
    const draft = session.draft as OnboardingDraft;
    const draftRtus = Array.isArray(draft.rtus) ? draft.rtus : [];
    for (const index of body.toRtuIndexes) {
      if (!draftRtus[index]) throw new BadRequestException(`No RTU at index ${index} in this draft`);
    }
    const source = await this.sourceOf(jwt, session.organizationId, draft, body.from);
    if (!CredentialCryptoService.canReadVersion(source.blob.v ?? 1)) {
      throw new ConflictException(COPY_KEY_VERSION);
    }
    for (const index of body.toRtuIndexes) {
      const target = draftRtus[index]!;
      if (target.protocol !== "mqtt" || !sameBroker(source.broker, brokerOf(target.config))) {
        throw new ConflictException(copyTargetNotSameBroker(String(target.code ?? "")));
      }
    }

    const expectedHash = draftHash(session.draft);
    const replace = body.replace === true;
    await withTenant(this.tenantDb, session.organizationId, async (tx) => {
      const locked = await lockSession(tx, sessionId);
      assertTurnStillBound(locked, expectedHash);
      // Review H1: the copy is bound to the broker it was checked against; a later host, port or TLS edit drops it.
      const bound = { ...source.blob, b: source.broker };
      const out = copyBlobToTargets(locked.draft as OnboardingDraft, bound, source.draftCode, body.toRtuIndexes, replace);
      if (!("draft" in out)) {
        if (out.refused === "has-credential") throw new ConflictException(copyTargetsHoldCredentials(out.codes));
        if (out.refused === "self") throw new BadRequestException(COPY_TARGET_IS_SOURCE);
        throw new BadRequestException(copyTargetHasNoCode(out.indexes));
      }
      await tx
        .update(onboardingSessions)
        .set({ draft: out.draft, updatedAt: sql`now()` })
        .where(and(eq(onboardingSessions.id, sessionId), eq(onboardingSessions.status, "draft")));
      await this.audit.write(
        {
          actor: jwt,
          action: "onboarding.credentials.copy",
          entityType: "onboarding_session",
          entityId: sessionId,
          organizationId: session.organizationId,
          // Codes and the flag only — never a blob (ADR 0022).
          payload: { from: source.audit, to: body.toRtuIndexes.map((i) => rtuSecretKey(out.draft, i)), replace },
        },
        tx,
      );
    });
    return this.sessions.getSession(jwt, sessionId);
  }

  private async sourceOf(
    jwt: JwtPayload,
    organizationId: string,
    draft: OnboardingDraft,
    from: CopyOnboardingCredentialsBody["from"],
  ): Promise<Source> {
    if ("rtuIndex" in from) {
      const rtu = Array.isArray(draft.rtus) ? draft.rtus[from.rtuIndex] : undefined;
      if (!rtu) throw new BadRequestException(`No RTU at index ${from.rtuIndex} in this draft`);
      const code = rtuSecretKey(draft, from.rtuIndex);
      if (code === null) throw new BadRequestException(copyTargetHasNoCode([from.rtuIndex]));
      if (rtu.protocol !== "mqtt") throw new ConflictException(copySourceNotMqtt(code));
      const blob = ownBlobAt(draft, from.rtuIndex);
      // A bound blob its RTU no longer serves is no credential to copy (review H1 follow-up).
      if (blob === null || !blobBoundTo(blob, rtu)) throw new ConflictException(copySourceHasNoCredential(code));
      return { blob, broker: brokerOf(rtu.config), draftCode: code, audit: { rtuCode: code } };
    }
    // RLS (the tenant transaction) shows this organization's rows only: another organization's RTU is a 404.
    const [row] = await withTenant(this.tenantDb, organizationId, (tx) =>
      tx
        .select({
          code: rtus.code,
          locationId: rtus.locationId,
          protocol: rtuConnectionConfigs.protocol,
          config: rtuConnectionConfigs.config,
          ciphertext: rtuConnectionConfigs.credentialsCiphertext,
          iv: rtuConnectionConfigs.credentialsIv,
          keyVersion: rtuConnectionConfigs.keyVersion,
        })
        .from(rtus)
        .innerJoin(rtuConnectionConfigs, eq(rtuConnectionConfigs.rtuId, rtus.id))
        // Review L1: an inactive RTU is no source (a decommissioned credential stays retired).
        .where(and(eq(rtus.id, from.rtuId), eq(rtus.organizationId, organizationId), eq(rtus.active, true)))
        .limit(1),
    );
    if (!row) throw new NotFoundException(COPY_SOURCE_NOT_FOUND);
    if (!(await this.accessControl.canManageLocation(jwt, row.locationId))) {
      throw new ForbiddenException(COPY_SOURCE_OUT_OF_SCOPE);
    }
    if (row.protocol !== "mqtt") throw new ConflictException(copySourceNotMqtt(row.code));
    if (row.ciphertext === null || row.iv === null) throw new ConflictException(copySourceHasNoCredential(row.code));
    return {
      blob: { c: Buffer.from(row.ciphertext).toString("base64"), iv: Buffer.from(row.iv).toString("base64"), v: row.keyVersion },
      broker: brokerOf(row.config),
      draftCode: null,
      audit: { rtuId: from.rtuId, rtuCode: row.code },
    };
  }
}
