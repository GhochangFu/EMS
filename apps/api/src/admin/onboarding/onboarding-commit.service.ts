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
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import { CredentialCryptoService } from "../../security/credential-crypto.service";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { translateCommitUniqueConflict } from "./onboarding-commit-conflict";
import { distinctAssetDomains, draftCountProblem } from "./onboarding-draft-caps";
import {
  conflictingPointKeyDeclaration,
  pointKeyConflictMessage,
  type CatalogPointKey,
} from "./onboarding-point-key-conflict";
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

/**
 * Persists onboarding draft as master-data rows in one transaction.
 *
 * `F4.16` / ADR 0043 — `onboarding_sessions`, `locations` and `point_keys`
 * carry `ENABLE ROW LEVEL SECURITY` (migration `0040`). The initial session
 * read runs on `fleetDb`: the organization is not yet known at that point (it
 * comes FROM the row). Once known, the entire write transaction below runs
 * inside `withTenant(tenantDb, session.organizationId, …)` — every row it
 * writes, policied or not, belongs to that one organization.
 *
 * `E7.1b` (ADR 0043 §5) — `rtus`, `assets` and `asset_points` gained an
 * `organization_id` column (migration `0046`) and get a `tenant_isolation`
 * policy + `FORCE` in `0047`. Their inserts here now stamp that column with
 * `session.organizationId`, the same org the transaction's GUC is set to, so
 * the `WITH CHECK` passes once the policy lands. `locations` and `point_keys`
 * already stamped it at F4.16; the audit rows defer `organization_id` to
 * E7.1c (ruling 5).
 */
@Injectable()
export class OnboardingCommitService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
    private readonly validateService: OnboardingValidateService,
    private readonly vocabularies: VocabulariesService,
  ) {}

  /** Commits a draft session when validation passes. */
  async commit(jwt: JwtPayload, sessionId: string): Promise<OnboardingCommitResponseDto> {
    await this.accessControl.requireMasterDataUser(jwt);
    if (!(await this.canUseOnboarding(jwt))) {
      throw new ForbiddenException("Onboarding requires admin or organization_admin role");
    }

    const [session] = await this.fleetDb
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

    // `F4.103` — the count caps, on the stored draft, at the last point before
    // the work is done. This is the last of the four enforcement points — the
    // schema `.max()`, `parseUpload`, `OnboardingService.chat` and here — and
    // the only one a draft assembled before this shipped has to pass.
    //
    // **The placement is the decision, and one line lower it would be dead
    // code.** The ruling asks for the refusal before the transaction opens,
    // which the two lines below also satisfy — but `onboardingDraftSchema` now
    // carries `.max()`, so `OnboardingValidateService.validate` already fails an
    // over-cap draft, `readyToCommit` is false, and the throw below it answers
    // first with `"Draft is not ready to commit"`. Anything after that line is
    // unreachable. Here the check is live, the operator is told which array is
    // too long and by how much, and `validate`'s own per-item `safeParse` loops
    // are spared a walk over the oversized array.
    //
    // `onboarding-commit-caps.spec` holds this ordering with **three**
    // assertions, and the reason the third is there is not the one an earlier
    // version of this comment gave. Moving the block below `validate` does not
    // stay green on the sentence: it fails first on the assertion that the
    // message names the array, with `got "Draft is not ready to commit"`. What
    // the `validateCalls() === 0` assertion adds is the case the two message
    // assertions cannot see — a refactor that *calls* `validate` (for
    // `suggestedPhase`, say) and still throws the count sentence. That keeps
    // both message assertions green while spending exactly the per-item walk
    // this placement exists to avoid, and only the call count goes red.
    //
    // Below the two access gates on purpose: an over-cap draft outside the
    // caller's scope must still be answered by the scope refusal, not told that
    // the session exists and how large its estate is.
    //
    // `?? {}` because `packages/db/src/schema/bms-schema.ts:547` is
    // `jsonb("draft").notNull().default({})`: `NOT NULL` rules out SQL NULL and
    // says nothing about the JSON scalar `null`, which is a legal jsonb value.
    // It reaches here as `null` in spite of the cast, and `validate` turns it
    // into the same 400 it always did. Without the `?? {}` this line reads
    // `.length` off `null` and answers a 500 instead —
    // `assertANullDraftIsStillTheValidationRefusal` is what measures that. The
    // caps themselves are declared once, in
    // `packages/shared/src/contracts/onboarding.ts`.
    const countProblem = draftCountProblem(draft ?? {});
    if (countProblem !== null) {
      throw new BadRequestException(countProblem);
    }

    const validation = this.validateService.validate(draft);
    if (!validation.readyToCommit) {
      throw new BadRequestException({
        message: "Draft is not ready to commit",
        errors: validation.errors,
      });
    }

    // ADR 0031 Amendment 1 — every draft asset's plant domain must be a live
    // `bms.asset_domains` code before the transaction opens.
    //
    // Checked here rather than inside the transaction on purpose: a commit
    // writes locations, RTUs, point keys, assets and mappings together, and a
    // foreign-key failure partway through rolls all of it back and reports a
    // constraint name. This is also the path an uploaded spreadsheet reaches —
    // `onboarding-excel.service.ts` reads the `domain` cell verbatim — so it is
    // the most likely source of an unknown code in the whole API.
    //
    // `F4.103` — one read per *distinct* domain, not one per asset. The check is
    // the same check, in the same place, for the same reason, and it refuses
    // with the same message; what changes is how many times it asks.
    // `VocabulariesService.assertAssetDomain` is an uncached `SELECT … LIMIT 1`
    // with no batching, so an estate of 500 assets sharing one domain sent 500
    // identical queries, sequentially, before the transaction opened. The count
    // is now bounded by the `bms.asset_domains` vocabulary — the distinct valid
    // codes present, plus the unknown one that stops the loop — rather than by
    // the operator's sheet. `distinctAssetDomains` keeps first-appearance order,
    // so the code an operator is sent to repair is still the one the per-asset
    // loop named. `F4.102` indexed `formatAssetsByRtuSummary` once for exactly
    // this reason.
    for (const domain of distinctAssetDomains(draft.assets ?? [])) {
      await this.vocabularies.assertAssetDomain(domain);
    }

    // `F4.109` — the six inserts below carry **no** `onConflict`, by owner
    // ruling 1: a duplicate is refused, never merged into an existing row. What
    // changes here is only the answer. Before this, `23505` reached Nest's
    // default handler and became `500 {"statusCode":500,"message":"Internal
    // server error"}`, so a `location.code` an operator can type twice was
    // reported as a server fault and named nothing.
    //
    // The catch is `.catch` on the returned promise rather than a `try` around
    // the block on purpose: the transaction body is 250 lines and wrapping it
    // would reindent all of them, hiding a two-line change in a diff nobody can
    // read. Drizzle rolls the transaction back and re-throws the driver's own
    // error object, so `code` and `constraint` survive to here.
    //
    // `translateCommitUniqueConflict` is narrow on both axes — SQLSTATE
    // `23505` **and** a constraint the map holds — and returns anything else
    // unchanged, which is why the `throw` re-throws the original error object
    // with its stack intact. An unmapped constraint, a foreign-key violation
    // and a dropped connection all still answer exactly as they did.
    return withTenant(this.tenantDb, session.organizationId, async (tx) => {
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

      // `F3.39` / ADR 0051 decision 2 — the point key catalog is fleet-wide, so
      // this reads and writes it by `code` alone.
      //
      // **This IS a write to global master data by an organization's onboarding
      // flow, and ADR 0051 Amendment 1 decision 1 permits it.** Blocking it
      // would block a new organization from ever declaring a measurement its
      // plant reads and no existing tenant does — the opposite of what ADR 0051
      // decides. A code names a quantity, not an estate, so a genuinely new one
      // belongs in the shared vocabulary. Decision 5's global-`admin` gate is
      // unchanged and covers the vocabulary *admin* endpoints: a tenant
      // administrator may extend the catalog here, never edit it.
      //
      // **Amendment 1 decision 2 is what makes that safe: nothing is inherited
      // silently.** Reusing a row by code while discarding what the draft
      // declared beside it is an escalation, because the catalog's unit is
      // authoritative for a reading whose asset/point pair has no mapping row
      // yet (`telemetry-write.service.ts` — `existingMapping ?
      // existingMapping.unit : catalog.unit`). One organization could therefore
      // relabel or reject another's *first* reading for a point it has not
      // mapped, and the affected tenant could not correct it: `F3.39` narrowed
      // the point-key admin surface to the global `admin` role. So a draft that
      // declares a `unit` or `domain` the catalog does not hold is refused, and
      // a draft that declares neither reuses the row exactly as before.
      //
      // The check runs inside the transaction, unlike the ADR 0031 Amendment 1
      // domain check above it. That one moved out because a foreign-key failure
      // reports a constraint name; this one raises its own message either way,
      // and reading the catalog in the transaction that writes it leaves no
      // window between the two.
      const pointKeyIds: string[] = [];
      const declaredInThisDraft = new Map<string, { id: string; row: CatalogPointKey }>();
      for (const pk of draft.pointKeys ?? []) {
        // The same code twice in one draft. Compared against what this draft
        // already resolved rather than against the catalog, so the message
        // blames the duplicate declaration and not a row created two statements
        // earlier by this very loop.
        const already = declaredInThisDraft.get(pk.code);
        if (already) {
          const clash = conflictingPointKeyDeclaration(pk, already.row);
          if (clash) {
            throw new BadRequestException(pointKeyConflictMessage(pk.code, clash, "draft"));
          }
          pointKeyIds.push(already.id);
          continue;
        }

        const [existing] = await tx
          .select({ id: pointKeys.id, domain: pointKeys.domain, unit: pointKeys.unit })
          .from(pointKeys)
          .where(sql`${pointKeys.code} = ${pk.code}`)
          .limit(1);
        if (existing) {
          const clash = conflictingPointKeyDeclaration(pk, existing);
          if (clash) {
            throw new BadRequestException(pointKeyConflictMessage(pk.code, clash, "catalog"));
          }
          pointKeyIds.push(existing.id);
          declaredInThisDraft.set(pk.code, { id: existing.id, row: existing });
          continue;
        }
        const [created] = await tx
          .insert(pointKeys)
          .values({
            code: pk.code,
            name: pk.name,
            domain: pk.domain ?? null,
            unit: pk.unit ?? null,
            description: pk.description ?? null,
            active: true,
          })
          .returning();
        pointKeyIds.push(created.id);
        declaredInThisDraft.set(pk.code, {
          id: created.id,
          row: { domain: created.domain, unit: created.unit },
        });
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
            organizationId: session.organizationId,
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
          organizationId: session.organizationId,
          protocol: rtuDraft.protocol,
          config,
          credentialsCiphertext,
          credentialsIv,
          keyVersion: 1,
          updatedAt: sql`now()`,
        });
      }

      const assetIds: string[] = [];
      // ADR 0018: points carry their own provenance, so remember which gateway
      // feeds each asset as we create it. Parallel to `assetIds` by index.
      const assetRtuIds: string[] = [];
      for (const assetDraft of draft.assets ?? []) {
        const rtuId = rtuIds[assetDraft.rtuIndex];
        if (!rtuId) {
          throw new BadRequestException("Invalid asset rtuIndex");
        }
        const [assetRow] = await tx
          .insert(assets)
          .values({
            organizationId: session.organizationId,
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
        assetRtuIds.push(rtuId);
      }

      const assetPointIds: string[] = [];
      for (const ap of draft.assetPoints ?? []) {
        const assetId = assetIds[ap.assetIndex];
        if (!assetId) {
          throw new BadRequestException("Invalid assetPoint assetIndex");
        }
        // ADR 0018: the wizard always wires an asset to an RTU, so these are
        // measured points fed by that gateway. asset_points_source_ref_check
        // rejects 'measured' without a source reference.
        const sourceRtuId = assetRtuIds[ap.assetIndex] ?? null;
        const [apRow] = await tx
          .insert(assetPoints)
          .values({
            organizationId: session.organizationId,
            assetId,
            pointKey: ap.pointKey,
            sourceDataKey: ap.sourceDataKey,
            sensorCode: ap.sensorCode ?? null,
            unit: ap.unit ?? null,
            active: true,
            rtuId: sourceRtuId,
            sourceKind: sourceRtuId ? "measured" : "unmapped",
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

      await this.audit.write(
        {
          actor: jwt,
          action: "master.onboarding.commit",
          entityType: "onboarding_session",
          entityId: sessionId,
          organizationId: session.organizationId,
          payload: result,
        },
        tx,
      );

      const [org] = await tx
        .select({ code: organizations.code })
        .from(organizations)
        .where(eq(organizations.id, session.organizationId))
        .limit(1);

      await this.audit.write(
        {
          actor: jwt,
          action: "master.location.create",
          entityType: "location",
          entityId: locationRow.id,
          organizationId: session.organizationId,
          payload: { orgCode: org?.code, via: "onboarding" },
        },
        tx,
      );

      return {
        sessionId,
        ...result,
      };
    }).catch((err: unknown) => {
      // `F4.109` — `.catch` rather than a `try`, and narrow on both SQLSTATE and
      // constraint name. Both choices are justified in full at the head of
      // `commit()` above; `onboarding-commit-conflict.ts` holds the map.
      throw translateCommitUniqueConflict(err);
    });
  }

  private async canUseOnboarding(jwt: JwtPayload): Promise<boolean> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    return user.role === "admin" || user.role === "organization_admin";
  }
}
