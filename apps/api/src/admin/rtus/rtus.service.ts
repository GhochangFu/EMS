import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { assets, locations, organizations, rtuConnectionConfigs, rtus } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { INGEST_PROTOCOLS } from "@bms/shared";
import type { AdminRtuDto, AdminRtuSummaryDto, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import { MasterDataAuditService } from "../master-data-audit.service";
import { translateRtuCodeCollision } from "./rtus-conflict";
import type { CreateRtuBody, UpdateRtuBody } from "./rtus.schema";

/**
 * `F4.16` / `E7.1b` / ADR 0043 — `rtus` gains `organization_id` + a
 * `tenant_isolation` policy + `FORCE` in migration `0047`.
 *
 * Reads run on `fleetDb`, trusting the `writableLocationIds`/`canManageLocation`
 * scope filter this service already applies (Amendment 2/3) — the same "bypass,
 * then trust an already-computed grant" shape `AccessControlService` uses. Writes
 * run inside `withTenant(tenantDb, organizationId, …)`; the org is the RTU's
 * location's org, resolved before the write. An RTU never relocates (its
 * `location_id` is not updatable), so — unlike `assets` — there is no cross-org
 * move to guard against. The `deactivate` active-asset count reads `assets`
 * (policied in `0047`) inside that same GUC.
 */
@Injectable()
export class RtusAdminService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  /** Lists RTUs scoped to writable locations. */
  async list(
    jwt: JwtPayload,
    locationId?: string,
    activeOnly?: boolean,
  ): Promise<{ items: AdminRtuDto[] }> {
    await this.accessControl.requireMasterDataUser(jwt);
    const writableIds = await this.accessControl.writableLocationIds(jwt);
    const conditions = [];
    if (locationId) {
      if (!(await this.accessControl.canManageLocation(jwt, locationId))) {
        throw new ForbiddenException("Location is outside your access scope");
      }
      conditions.push(eq(rtus.locationId, locationId));
    } else if (writableIds !== null) {
      if (writableIds.length === 0) {
        return { items: [] };
      }
      conditions.push(inArray(rtus.locationId, writableIds));
    }
    if (activeOnly === true) {
      conditions.push(eq(rtus.active, true));
    } else if (activeOnly === false) {
      conditions.push(eq(rtus.active, false));
    }

    const rows = await this.fleetDb
      .select({
        rtu: rtus,
        locationName: locations.name,
        organizationCode: organizations.code,
      })
      .from(rtus)
      .innerJoin(locations, eq(rtus.locationId, locations.id))
      .innerJoin(organizations, eq(locations.organizationId, organizations.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(rtus.displayName));

    return { items: rows.map((row) => this.mapRow(row)) };
  }

  /** Returns one RTU summary when in scope. */
  async getById(jwt: JwtPayload, id: string): Promise<AdminRtuSummaryDto> {
    await this.accessControl.requireMasterDataUser(jwt);
    const [row] = await this.fleetDb
      .select({
        rtu: rtus,
        locationName: locations.name,
        organizationId: organizations.id,
        organizationCode: organizations.code,
      })
      .from(rtus)
      .innerJoin(locations, eq(rtus.locationId, locations.id))
      .innerJoin(organizations, eq(locations.organizationId, organizations.id))
      .where(eq(rtus.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException("RTU not found");
    }
    if (!(await this.accessControl.canManageLocation(jwt, row.rtu.locationId))) {
      throw new ForbiddenException("RTU is outside your access scope");
    }
    return {
      id: row.rtu.id,
      code: row.rtu.code,
      displayName: row.rtu.displayName,
      locationId: row.rtu.locationId,
      locationName: row.locationName,
      organizationId: row.organizationId,
      organizationCode: row.organizationCode,
    };
  }

  /** Creates an RTU under a writable location. */
  async create(jwt: JwtPayload, body: CreateRtuBody): Promise<AdminRtuDto> {
    await this.accessControl.requireMasterDataUser(jwt);
    if (!(await this.accessControl.canManageLocation(jwt, body.locationId))) {
      throw new ForbiddenException("Location is outside your access scope");
    }
    const organizationId = await this.resolveLocationOrg(body.locationId);

    const created = await withTenant(this.tenantDb, organizationId, async (tx) => {
      const [row] = await tx
        .insert(rtus)
        .values({
          locationId: body.locationId,
          code: body.code,
          displayName: body.displayName,
          sourceType: body.sourceType,
          domain: body.domain ?? null,
          externalRtuId: body.externalRtuId ?? null,
          rtuCode: body.rtuCode ?? null,
          mqttTopic: body.mqttTopic ?? null,
          stationCode: body.stationCode ?? null,
          stationName: body.stationName ?? null,
          // `F4.59` — `update` moves the RTU's assets' `meta.telemetrySource`
          // with this column, and `create` needs no counterpart: `assets.rtu_id`
          // references `rtus.id`, and the id an asset would have to carry is
          // generated by this insert. A new RTU has no assets by construction,
          // whatever this flag says — including the combination `update` gates
          // against, an enabled RTU that declares no ingest source: there are no
          // assets here for that to strand.
          //
          // The asset gains its `rtu_id` later, through `AssetsAdminService`,
          // which does not write `telemetrySource` at all. So an asset attached
          // to an RTU that is **both** enabled and declaring an ingest protocol
          // arrives on `catalog` and stays there until someone next edits the
          // RTU — the simulator and the ingest host then both write it. For a
          // `simulator` or `catalog` RTU, `catalog` is the correct answer and
          // not a hole, which is why this names the declared case rather than
          // "an already-enabled RTU". Either way it is a second file; it is not
          // this one.
          ingestEnabled: body.ingestEnabled ?? false,
          organizationId,
          meta: body.meta ?? null,
          active: true,
        })
        .returning();

      // E7.1c (item D): folded into this transaction so the stamped
      // organizationId matches the GUC the strict WITH CHECK now demands.
      await this.audit.write(
        {
          actor: jwt,
          action: "master.rtu.create",
          entityType: "rtu",
          entityId: row.id,
          organizationId,
          payload: body,
        },
        tx,
      );
      return row;
    }).catch((err: unknown) => {
      // `F4.60` — migration `0071` makes `rtus.rtu_code` unique fleet-wide when
      // it is set, and this insert carries no `onConflict` (a duplicate is
      // refused, never merged). Without this the driver's `23505` reached Nest's
      // default handler and became a 500 for a value the caller chose.
      //
      // `.catch` on the returned promise rather than a `try` around the block,
      // the shape `commit()` in `onboarding-commit.service.ts` uses, for the same
      // reason: wrapping would reindent the whole transaction body and hide a
      // two-line change in a diff nobody can read. Drizzle rolls the transaction
      // back and re-throws the driver's own error object, so `code` and
      // `constraint` survive to here.
      //
      // `translateRtuCodeCollision` is narrow on both axes and returns anything
      // else unchanged, so this `throw` re-throws the original object with its
      // stack intact: `rtus_location_code_unique`, `rtus_external_rtu_idx`,
      // `rtus_mqtt_topic_idx`, a foreign-key violation and a dropped connection
      // all still answer exactly as they did.
      throw translateRtuCodeCollision(err);
    });

    return this.fetchRow(created.id);
  }

  /** Updates an RTU in scope. */
  async update(jwt: JwtPayload, id: string, body: UpdateRtuBody): Promise<AdminRtuDto> {
    // fleetDb read (Amendment 2/3): `rtus` gains a policy in 0047; the
    // `canManageLocation` gate below is the isolation control.
    const [existing] = await this.fleetDb
      .select()
      .from(rtus)
      .where(eq(rtus.id, id))
      .limit(1);
    if (!existing) {
      throw new NotFoundException("RTU not found");
    }
    if (!(await this.accessControl.canManageLocation(jwt, existing.locationId))) {
      throw new ForbiddenException("RTU is outside your access scope");
    }

    const organizationId =
      existing.organizationId ?? (await this.resolveLocationOrg(existing.locationId));
    const nextIngestEnabled = body.ingestEnabled ?? existing.ingestEnabled;
    await withTenant(this.tenantDb, organizationId, async (tx) => {
      await tx
        .update(rtus)
        .set({
        code: body.code ?? existing.code,
        displayName: body.displayName ?? existing.displayName,
        sourceType: body.sourceType ?? existing.sourceType,
        domain: body.domain !== undefined ? body.domain : existing.domain,
        externalRtuId:
          body.externalRtuId !== undefined ? body.externalRtuId : existing.externalRtuId,
        rtuCode: body.rtuCode !== undefined ? body.rtuCode : existing.rtuCode,
        mqttTopic: body.mqttTopic !== undefined ? body.mqttTopic : existing.mqttTopic,
        stationCode:
          body.stationCode !== undefined ? body.stationCode : existing.stationCode,
        stationName:
          body.stationName !== undefined ? body.stationName : existing.stationName,
        ingestEnabled: nextIngestEnabled,
        // Merged, not replaced. A PATCH carrying `meta` used to swap the whole
        // object, and `bms.rtus.meta` is a shared bag holding keys this caller
        // knows nothing about. One of them is load-bearing: `F1.7` stamps
        // `enabledSetVersion` there, and the seed reads it to decide whether
        // `ingest_enabled` still belongs to the operator. Dropping the key on an
        // unrelated `meta` write therefore handed the column back to the seed,
        // which then reverted the operator's own switch on the next
        // `pnpm db:seed` — the exact defect `F1.7` closed, re-entering through
        // the API that owns the column. Unreachable from the current admin
        // screen, which never sends `meta`; that is a coupling across two
        // packages with nothing enforcing it, not a design.
        meta:
          body.meta !== undefined
            ? { ...(existing.meta ?? {}), ...body.meta }
            : existing.meta,
        organizationId,
      })
        .where(eq(rtus.id, id));

      // `F4.59` — the assets follow the switch, in this transaction.
      //
      // The invariant `packages/db/src/phe-pilot-seed.ts` maintains: an RTU is
      // `mqtt` on both its own columns and its assets' `meta.telemetrySource`,
      // or on neither, because `apps/sim/src/index.js` skips exactly the assets
      // marked `mqtt` (`coalesce(meta->>'telemetrySource','sim') <> 'mqtt'`).
      // Splitting them is silently wrong in both directions: an enabled RTU
      // whose assets still read `catalog` has the simulator and the ingest host
      // writing the same `(time, asset, point_key)`, resolved by whichever
      // upsert lands second; a disabled one whose assets are still `mqtt` has
      // neither writing them, and the points just stop. Until `F4.59` nothing
      // under `apps/api/src` wrote this key at all, so the admin screen's switch
      // produced one or the other every time it was used.
      //
      // **`assets.rtu_id`, not `asset_points.rtu_id`.** That is the edge the
      // seed sets (`assetValues.rtuId`), the one `deactivate` below counts, and
      // the one `tests/f1.7-seed-ownership.integration.test.ts` asserts the
      // invariant over. The ingest host reaches points through
      // `asset_points.rtu_id` instead (`BINDING_QUERY`), so a point wired to
      // this RTU on an asset owned by another one is not moved here — moving it
      // would take that asset's *other* points away from the simulator on the
      // strength of one foreign point, which is the dead-points failure again.
      //
      // **Merged, not replaced**, for the reason recorded above about
      // `rtus.meta`: `bms.assets.meta` is a shared bag too, and one of its other
      // keys is load-bearing — `apps/sim` reads `meta->>'telemetryEnabled'` in
      // the same query, so replacing the object would re-enable simulation on an
      // asset an operator had switched off. (The seed replaces `assets.meta`
      // wholesale; it can, because it writes every key it finds there.)
      //
      // **The write is unconditional, not gated on a change of
      // `ingest_enabled`** (its *value* is conditional — see below), exactly as
      // the `.set()` above restates every column on every PATCH. It makes the
      // invariant a postcondition of `update` rather than a delta rule, so a row
      // already split — by a switch thrown before this fix — is repaired by the
      // next edit of its RTU. The rewrite is a no-op for both readers when the
      // value does not change, including the seeded `simulator` value, which
      // means the same thing as `catalog` to a filter testing `<> 'mqtt'`.
      // **The move onto `mqtt` is conditional; the move back is not.** Handing
      // an asset to the ingest host is only safe if a host will take it.
      // `planEndpoints` resolves an RTU's protocol as
      // `rtu_connection_configs.protocol ?? rtus.source_type` and skips
      // `catalog` as `unsupported-protocol` — so an operator who switches
      // `ingest_enabled` on while the RTU still says `catalog` and has no
      // connection config would, with an unconditional move, take those assets
      // off the simulator and get nothing in return. Simulated became **dead**,
      // which is a worse failure than the double-write this fix exists to close.
      // In doubt, alive beats dead: the assets stay on `catalog` and the
      // simulator keeps them going until the RTU says what it speaks.
      //
      // **The predicate is deliberately coarser than the host's own check** —
      // "the operator has said what this RTU speaks", not "the host can bind it
      // today". Restating `isIngestProtocol` or the adapter registry here would
      // put the ingest host's protocol vocabulary in the API, where it would go
      // stale the day an adapter lands: a Modbus RTU would keep its assets on
      // the simulator because this file had not heard of Modbus. A declared
      // protocol is a stable fact this service legitimately owns; whether an
      // adapter exists for it is the host's business, and its `no-adapter` skip
      // is the honest place for that answer.
      //
      // **Positive membership, not a list of exclusions.** `rtus.source_type`
      // has three values and only one of them has an adapter: an earlier draft
      // of this predicate tested `!== 'catalog'` and so handed every
      // `simulator` RTU's assets to a host that will never bind them —
      // 99 of the 147 RTU-attached assets in the seeded fleet, and precisely
      // the dead-points failure the paragraph above exists to prevent.
      // `INGEST_PROTOCOLS` is the vocabulary that says which sources have an
      // adapter at all, and `packages/shared/src/ingest.ts` records why
      // `simulator` and `catalog` are not in it. A fourth source type that
      // gains an adapter is then right here with no edit. Today only `mqtt`
      // qualifies on this disjunct; a `modbus_tcp` RTU reaches the second one
      // through its connection-config row.
      const declaredSource = body.sourceType ?? existing.sourceType;
      const handsOverToIngest =
        nextIngestEnabled &&
        ((INGEST_PROTOCOLS as readonly string[]).includes(declaredSource) ||
          (
            await tx
              .select({ present: sql<number>`1` })
              .from(rtuConnectionConfigs)
              .where(eq(rtuConnectionConfigs.rtuId, id))
              .limit(1)
          ).length > 0);
      const telemetrySource = handsOverToIngest ? "mqtt" : "catalog";
      // The organization predicate is explicit, and it is defence in depth
      // rather than the control. RLS already confines this write: a probe as
      // `bms_tenant` (F4.59 security review) attached a PHEWB asset to an ESKOM
      // RTU and ran this UPDATE under ESKOM's GUC — `UPDATE 1`, the foreign row
      // untouched and still `catalog`. So the danger is not a cross-tenant
      // write; it is that such a row is skipped **silently** while the endpoint
      // answers 200, leaving exactly the split invariant this row exists to
      // close. `assets.service.ts:230-241` refuses the same shape one file away
      // for the same reason. No rowcount assertion: an RTU with no assets
      // legitimately updates zero rows.
      const updatedAssets = await tx
        .update(assets)
        .set({
          meta: sql`coalesce(meta, '{}'::jsonb) || jsonb_build_object('telemetrySource', ${telemetrySource}::text)`,
        })
        .where(and(eq(assets.rtuId, id), eq(assets.organizationId, organizationId)))
        .returning({ id: assets.id });

      await this.audit.write(
        {
          actor: jwt,
          action: "master.rtu.update",
          entityType: "rtu",
          entityId: id,
          organizationId,
          // The asset side effect is recorded, because the PATCH body alone
          // does not say that this request moved which process owns N assets'
          // samples. The COUNT and the resolved value only — never asset ids
          // (ADR 0021, AGENTS.md §9.6).
          payload: {
            ...body,
            telemetrySource,
            assetsMoved: updatedAssets.length,
          },
        },
        tx,
      );
    }).catch((err: unknown) => {
      // `F4.60` — the same translation `create` applies, for the same index and
      // in the same `.catch` shape. Justified in full there.
      //
      // The `.set()` above restates `rtu_code` on every PATCH, including when
      // the body does not mention it. That is **not** a self-collision: Postgres
      // recognises the old tuple as the row's own prior version, so an update
      // that writes a row's existing `rtu_code` back is not a duplicate.
      // `rtus.rtu-code-conflict.integration.spec.ts` fences that, because a
      // pre-check written here instead — `SELECT … WHERE rtu_code = $1` without
      // excluding this row — would refuse every edit of an ingest-bound RTU.
      throw translateRtuCodeCollision(err);
    });
    return this.fetchRow(id);
  }

  /** Deactivates an RTU when no active assets remain. */
  async deactivate(jwt: JwtPayload, id: string): Promise<AdminRtuDto> {
    // fleetDb read (Amendment 2/3): `rtus` gains a policy in 0047; the
    // `canManageLocation` gate below is the isolation control.
    const [existing] = await this.fleetDb
      .select()
      .from(rtus)
      .where(eq(rtus.id, id))
      .limit(1);
    if (!existing) {
      throw new NotFoundException("RTU not found");
    }
    if (!(await this.accessControl.canManageLocation(jwt, existing.locationId))) {
      throw new ForbiddenException("RTU is outside your access scope");
    }

    const organizationId =
      existing.organizationId ?? (await this.resolveLocationOrg(existing.locationId));
    await withTenant(this.tenantDb, organizationId, async (tx) => {
      // The RTU's assets share its org, so the active-asset guard reads `assets`
      // (policied in 0047) inside the same tenant GUC.
      const [activeAsset] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(assets)
        .where(and(eq(assets.rtuId, id), eq(assets.active, true)))
        .limit(1);
      if ((activeAsset?.count ?? 0) > 0) {
        throw new ConflictException("Cannot deactivate RTU with active assets");
      }
      await tx.update(rtus).set({ active: false }).where(eq(rtus.id, id));
      await this.audit.write(
        {
          actor: jwt,
          action: "master.rtu.deactivate",
          entityType: "rtu",
          entityId: id,
          organizationId,
        },
        tx,
      );
    });
    return this.fetchRow(id);
  }

  /** Reactivates an RTU. */
  async reactivate(jwt: JwtPayload, id: string): Promise<AdminRtuDto> {
    // fleetDb read (Amendment 2/3): `rtus` gains a policy in 0047; the
    // `canManageLocation` gate below is the isolation control.
    const [existing] = await this.fleetDb
      .select()
      .from(rtus)
      .where(eq(rtus.id, id))
      .limit(1);
    if (!existing) {
      throw new NotFoundException("RTU not found");
    }
    if (!(await this.accessControl.canManageLocation(jwt, existing.locationId))) {
      throw new ForbiddenException("RTU is outside your access scope");
    }

    const organizationId =
      existing.organizationId ?? (await this.resolveLocationOrg(existing.locationId));
    await withTenant(this.tenantDb, organizationId, async (tx) => {
      await tx.update(rtus).set({ active: true }).where(eq(rtus.id, id));
      await this.audit.write(
        {
          actor: jwt,
          action: "master.rtu.reactivate",
          entityType: "rtu",
          entityId: id,
          organizationId,
        },
        tx,
      );
    });
    return this.fetchRow(id);
  }

  /**
   * Resolves a location's organization on `fleetDb` before a write opens its
   * tenant context. `locations` carries a policy (`0040`); the caller has
   * already passed `canManageLocation` for this location, which is the
   * isolation control.
   */
  private async resolveLocationOrg(locationId: string): Promise<string> {
    const [row] = await this.fleetDb
      .select({ organizationId: locations.organizationId })
      .from(locations)
      .where(eq(locations.id, locationId))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Location not found");
    }
    return row.organizationId;
  }

  private async fetchRow(id: string): Promise<AdminRtuDto> {
    const [row] = await this.fleetDb
      .select({
        rtu: rtus,
        locationName: locations.name,
        organizationCode: organizations.code,
      })
      .from(rtus)
      .innerJoin(locations, eq(rtus.locationId, locations.id))
      .innerJoin(organizations, eq(locations.organizationId, organizations.id))
      .where(eq(rtus.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException("RTU not found");
    }
    return this.mapRow(row);
  }

  private mapRow(row: {
    rtu: typeof rtus.$inferSelect;
    locationName: string;
    organizationCode: string;
  }): AdminRtuDto {
    const rtu = row.rtu;
    return {
      id: rtu.id,
      locationId: rtu.locationId,
      locationName: row.locationName,
      organizationCode: row.organizationCode,
      code: rtu.code,
      displayName: rtu.displayName,
      sourceType: rtu.sourceType as AdminRtuDto["sourceType"],
      domain: rtu.domain,
      externalRtuId: rtu.externalRtuId,
      rtuCode: rtu.rtuCode,
      mqttTopic: rtu.mqttTopic,
      stationCode: rtu.stationCode,
      stationName: rtu.stationName,
      ingestEnabled: rtu.ingestEnabled,
      active: rtu.active,
      meta: (rtu.meta as Record<string, unknown> | null) ?? null,
      createdAt: rtu.createdAt.toISOString(),
    };
  }
}
