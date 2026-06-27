import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { eq, sql } from "drizzle-orm";

import {
  assetPoints,
  assets,
  locations,
  onboardingSessions,
  organizations,
  pointKeys,
  rtuConnectionConfigs,
  rtus,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  JwtPayload,
  OnboardingCommitResponseDto,
  OnboardingDraft,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { DRIZZLE } from "../../database/database.tokens";
import { CredentialCryptoService } from "../../security/credential-crypto.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { readEncryptedCredentials } from "./onboarding-redaction";
import { OnboardingValidateService } from "./onboarding-validate.service";

/** Maps onboarding protocol to RTU source_type column. */
function protocolToSourceType(protocol: string): "mqtt" | "simulator" | "catalog" {
  if (protocol === "mqtt") {
    return "mqtt";
  }
  if (protocol === "simulator") {
    return "simulator";
  }
  return "catalog";
}

/** Persists onboarding draft as master-data rows in one transaction. */
@Injectable()
export class OnboardingCommitService {
  constructor(
    @Inject(DRIZZLE) private readonly db: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
    private readonly validateService: OnboardingValidateService,
  ) {}

  /** Commits a draft session when validation passes. */
  async commit(jwt: JwtPayload, sessionId: string): Promise<OnboardingCommitResponseDto> {
    await this.accessControl.requireMasterDataUser(jwt);
    if (!(await this.canUseOnboarding(jwt))) {
      throw new ForbiddenException("Onboarding requires admin or organization_admin role");
    }

    const [session] = await this.db
      .select()
      .from(onboardingSessions)
      .where(eq(onboardingSessions.id, sessionId))
      .limit(1);
    if (!session) {
      throw new NotFoundException("Onboarding session not found");
    }
    if (session.status === "committed") {
      throw new BadRequestException("Session already committed");
    }
    if (!(await this.accessControl.canManageOrganization(jwt, session.organizationId))) {
      throw new ForbiddenException("Organization is outside your access scope");
    }

    const draft = session.draft as OnboardingDraft;
    const validation = this.validateService.validate(draft);
    if (!validation.readyToCommit) {
      throw new BadRequestException({
        message: "Draft is not ready to commit",
        errors: validation.errors,
      });
    }

    return this.db.transaction(async (tx) => {
      const loc = draft.location!;
      const [locationRow] = await tx
        .insert(locations)
        .values({
          organizationId: session.organizationId,
          code: loc.code,
          slug: loc.slug,
          name: loc.name,
          type: loc.type,
          province: loc.province ?? null,
          capital: loc.capital ?? null,
          latitude: loc.latitude,
          longitude: loc.longitude,
          active: true,
          meta: loc.meta ?? null,
          updatedAt: sql`now()`,
        })
        .returning();

      const pointKeyIds: string[] = [];
      for (const pk of draft.pointKeys ?? []) {
        const [existing] = await tx
          .select({ id: pointKeys.id })
          .from(pointKeys)
          .where(
            sql`${pointKeys.organizationId} = ${session.organizationId} AND ${pointKeys.code} = ${pk.code}`,
          )
          .limit(1);
        if (existing) {
          pointKeyIds.push(existing.id);
          continue;
        }
        const [created] = await tx
          .insert(pointKeys)
          .values({
            organizationId: session.organizationId,
            code: pk.code,
            name: pk.name,
            domain: pk.domain ?? null,
            unit: pk.unit ?? null,
            description: pk.description ?? null,
            active: true,
          })
          .returning();
        pointKeyIds.push(created.id);
      }

      const rtuIds: string[] = [];
      for (let i = 0; i < (draft.rtus ?? []).length; i++) {
        const rtuDraft = draft.rtus![i];
        const config = rtuDraft.config ?? {};
        const mqttTopic =
          (typeof config.topic === "string" ? config.topic : null) ??
          (typeof config.mqttTopic === "string" ? config.mqttTopic : null);

        const [rtuRow] = await tx
          .insert(rtus)
          .values({
            locationId: locationRow.id,
            code: rtuDraft.code,
            displayName: rtuDraft.displayName,
            sourceType: protocolToSourceType(rtuDraft.protocol),
            domain: rtuDraft.domain ?? null,
            externalRtuId: rtuDraft.externalRtuId ?? null,
            rtuCode: rtuDraft.rtuCode ?? null,
            mqttTopic,
            stationCode: rtuDraft.stationCode ?? null,
            stationName: rtuDraft.stationName ?? null,
            ingestEnabled:
              rtuDraft.protocol === "mqtt" ? (rtuDraft.ingestEnabled ?? false) : false,
            active: true,
            meta: rtuDraft.meta ?? null,
          })
          .returning();
        rtuIds.push(rtuRow.id);

        const enc = readEncryptedCredentials(session.draft, i);
        let credentialsCiphertext: Buffer | null = null;
        let credentialsIv: Buffer | null = null;
        if (enc && CredentialCryptoService.isConfigured()) {
          credentialsCiphertext = enc.ciphertext;
          credentialsIv = enc.iv;
        }

        await tx.insert(rtuConnectionConfigs).values({
          rtuId: rtuRow.id,
          protocol: rtuDraft.protocol,
          config,
          credentialsCiphertext,
          credentialsIv,
          keyVersion: 1,
          updatedAt: sql`now()`,
        });
      }

      const assetIds: string[] = [];
      for (const assetDraft of draft.assets ?? []) {
        const rtuId = rtuIds[assetDraft.rtuIndex];
        if (!rtuId) {
          throw new BadRequestException("Invalid asset rtuIndex");
        }
        const [assetRow] = await tx
          .insert(assets)
          .values({
            code: assetDraft.code,
            name: assetDraft.name,
            siteName: assetDraft.siteName,
            locationId: locationRow.id,
            rtuId,
            domain: assetDraft.domain,
            active: true,
            meta: assetDraft.meta ?? null,
          })
          .returning();
        assetIds.push(assetRow.id);
      }

      const assetPointIds: string[] = [];
      for (const ap of draft.assetPoints ?? []) {
        const assetId = assetIds[ap.assetIndex];
        if (!assetId) {
          throw new BadRequestException("Invalid assetPoint assetIndex");
        }
        const [apRow] = await tx
          .insert(assetPoints)
          .values({
            assetId,
            pointKey: ap.pointKey,
            sourceDataKey: ap.sourceDataKey,
            sensorCode: ap.sensorCode ?? null,
            unit: ap.unit ?? null,
            active: true,
          })
          .returning();
        assetPointIds.push(apRow.id);
      }

      const result = {
        locationId: locationRow.id,
        rtuIds,
        assetIds,
        pointKeyIds,
        assetPointIds,
      };

      await tx
        .update(onboardingSessions)
        .set({
          status: "committed",
          committedAt: sql`now()`,
          updatedAt: sql`now()`,
          result,
        })
        .where(eq(onboardingSessions.id, sessionId));

      await this.audit.write({
        actor: jwt,
        action: "master.onboarding.commit",
        entityType: "onboarding_session",
        entityId: sessionId,
        payload: result,
      });

      const [org] = await tx
        .select({ code: organizations.code })
        .from(organizations)
        .where(eq(organizations.id, session.organizationId))
        .limit(1);

      await this.audit.write({
        actor: jwt,
        action: "master.location.create",
        entityType: "location",
        entityId: locationRow.id,
        payload: { orgCode: org?.code, via: "onboarding" },
      });

      return {
        sessionId,
        ...result,
      };
    });
  }

  private async canUseOnboarding(jwt: JwtPayload): Promise<boolean> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    return user.role === "admin" || user.role === "organization_admin";
  }
}
