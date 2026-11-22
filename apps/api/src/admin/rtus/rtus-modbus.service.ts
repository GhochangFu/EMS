import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, ne, sql } from "drizzle-orm";

import { assets, deviceProfiles, rtuConnectionConfigs, rtus } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { setRtuModbusBodySchema } from "@bms/shared";
import type { AdminRtuDto, JwtPayload, SetRtuModbusBody } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import { translateConstraintErrors } from "../../database/translate-constraint-errors";
import { MasterDataAuditService } from "../master-data-audit.service";
import { resolveTelemetrySource } from "../telemetry-source";
import { connectionModbusOf } from "./rtu-connection-modbus";
import { buildModbusConnectionConfig, StoredProfileRegistersInvalidError } from "./rtu-modbus-config";
import { RtusAdminService } from "./rtus.service";

/** The audit action of a bind (ADR 0141 decision 15, plan C10). */
export const RTU_MODBUS_UPDATE_ACTION = "master.rtu.modbus.update";
/** One 404 for an unknown profile and another organization's: it names neither (the profiles API's rule). */
export const RTU_MODBUS_PROFILE_NOT_FOUND_MESSAGE = "Device profile not found";
export const RTU_MODBUS_OTHER_PROTOCOL_MESSAGE =
  "This RTU's connection is another protocol; Modbus settings apply to an RTU with no connection or a Modbus TCP one";
export const RTU_MODBUS_ENDPOINT_OTHER_ORGANIZATION_MESSAGE =
  "This Modbus endpoint (host and port) is already used by an RTU of another organization; one endpoint serves one organization";
export const RTU_MODBUS_RACED_MESSAGE = "Another change to this RTU's connection landed first; reload and try again";

/** The Modbus TCP port when a stored row names none (ADR 0141 decision 5). */
const MODBUS_DEFAULT_PORT = 502;

/**
 * `F1.2` (ADR 0141 decisions 5, 6, 10 and 15, Amendment 2 (a); plan T7.2, builder call C10) —
 * `PUT /admin/rtus/:id/modbus`: binds an RTU to one of its organization's device profiles and sets
 * its Modbus TCP connection. Its own file: `rtus.service.ts` is at 740 lines.
 *
 * - **Gate:** `canManageLocation`, the `setPayloadFormat` gate. The endpoint override stays with
 *   whoever may manage the RTU's location (Amendment 1 (c)).
 * - **Upsert:** an RTU with no connection row gets one with `protocol = 'modbus_tcp'`; a Modbus
 *   row is rewritten whole (`buildModbusConnectionConfig`); any other protocol is 409.
 * - **The registers are copied** from the profile row, read under `withTenant` so a profile of
 *   another organization is invisible (404). A later profile version never reaches a bound RTU.
 * - **One endpoint, one organization** (Amendment 2 (a)): an endpoint another organization's RTU
 *   uses is 409 here, before the ingest host would skip it as `endpoint-organization-conflict`.
 *   The check reads across organizations on `bms_fleet` and answers a boolean, never a row.
 * - **Assets:** the `F4.59` postcondition (`admin/telemetry-source.ts`) runs on the same
 *   transaction, so an ingest-enabled RTU's assets move to the ingest host with the new row.
 * - **Audit:** `master.rtu.modbus.update` with the profile reference and the register count,
 *   never the list.
 */
@Injectable()
export class RtusModbusService {
  private readonly logger = new Logger(RtusModbusService.name);

  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
    private readonly rtusService: RtusAdminService,
  ) {}

  async bind(jwt: JwtPayload, id: string, input: unknown): Promise<AdminRtuDto> {
    const parsed = setRtuModbusBodySchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const body: SetRtuModbusBody = parsed.data;

    // 404 before 403, as the other RTU routes answer.
    const [existing] = await this.fleetDb.select().from(rtus).where(eq(rtus.id, id)).limit(1);
    if (!existing) {
      throw new NotFoundException("RTU not found");
    }
    await this.accessControl.requireMasterDataUser(jwt);
    if (!(await this.accessControl.canManageLocation(jwt, existing.locationId))) {
      throw new ForbiddenException("RTU is outside your access scope");
    }
    const organizationId = await this.rtusService.resolveAgreedOrg(existing);
    const port = body.port ?? MODBUS_DEFAULT_PORT;
    if (await this.endpointUsedByAnotherOrganization(id, organizationId, body.host, port)) {
      throw new ConflictException(RTU_MODBUS_ENDPOINT_OTHER_ORGANIZATION_MESSAGE);
    }

    await translateConstraintErrors(
      () =>
        withTenant(this.tenantDb, organizationId, async (tx) => {
          const [profile] = await tx
            .select({ id: deviceProfiles.id, code: deviceProfiles.code, version: deviceProfiles.version, registers: deviceProfiles.registers })
            .from(deviceProfiles)
            .where(
              and(
                eq(deviceProfiles.id, body.profileId),
                eq(deviceProfiles.organizationId, organizationId),
                eq(deviceProfiles.protocol, "modbus_tcp"),
              ),
            )
            .limit(1);
          if (!profile) {
            throw new NotFoundException(RTU_MODBUS_PROFILE_NOT_FOUND_MESSAGE);
          }
          // Locked, so two concurrent binds audit a true `from`.
          const [current] = await tx
            .select({ protocol: rtuConnectionConfigs.protocol, config: rtuConnectionConfigs.config })
            .from(rtuConnectionConfigs)
            .where(eq(rtuConnectionConfigs.rtuId, id))
            .limit(1)
            .for("update");
          if (current && current.protocol !== "modbus_tcp") {
            throw new ConflictException(RTU_MODBUS_OTHER_PROTOCOL_MESSAGE);
          }

          let config: Record<string, unknown>;
          try {
            config = buildModbusConnectionConfig(body, profile);
          } catch (err) {
            if (err instanceof StoredProfileRegistersInvalidError) {
              // Every profile write validates its registers, so this is stored-data drift (§9.6: ids only).
              this.logger.error(`device profile ${profile.id}: stored registers do not parse; bind of RTU ${id} refused`);
              throw new InternalServerErrorException("The device profile's stored registers are invalid");
            }
            throw err;
          }

          if (current) {
            await tx
              .update(rtuConnectionConfigs)
              .set({ config, updatedAt: new Date() })
              .where(and(eq(rtuConnectionConfigs.rtuId, id), eq(rtuConnectionConfigs.protocol, "modbus_tcp")));
          } else {
            await tx.insert(rtuConnectionConfigs).values({ organizationId, rtuId: id, protocol: "modbus_tcp", config });
          }

          // The F4.59 postcondition: the RTU now declares what it speaks (a connection row), so an
          // ingest-enabled RTU's assets go to the ingest host; with ingest off they stay on `catalog`.
          const telemetrySource = await resolveTelemetrySource(tx, {
            id,
            ingestEnabled: existing.ingestEnabled,
            sourceType: existing.sourceType,
          });
          const moved = await tx
            .update(assets)
            .set({
              meta: sql`coalesce(meta, '{}'::jsonb) || jsonb_build_object('telemetrySource', ${telemetrySource}::text)`,
            })
            .where(and(eq(assets.rtuId, id), eq(assets.organizationId, organizationId)))
            .returning({ id: assets.id });

          const summary = connectionModbusOf("modbus_tcp", config);
          await this.audit.write(
            {
              actor: jwt,
              action: RTU_MODBUS_UPDATE_ACTION,
              entityType: "rtu",
              entityId: id,
              organizationId,
              // The profile reference and the count; never the register list (plan C10).
              payload: {
                created: current === undefined,
                fromProfile: current ? connectionModbusOf("modbus_tcp", current.config)?.profile ?? null : null,
                profile: { code: profile.code, version: profile.version },
                registerCount: summary?.registerCount ?? 0,
                host: body.host,
                port,
                unitId: body.unitId,
                pollIntervalMs: body.pollIntervalMs,
                telemetrySource,
                assetsMoved: moved.length,
              },
            },
            tx,
          );
        }),
      // Two first binds of one RTU: `rtu_connection_configs.rtu_id` is unique, the second loses.
      { onUnique: () => new ConflictException(RTU_MODBUS_RACED_MESSAGE) },
    );
    return this.rtusService.fetchRow(id);
  }

  /**
   * Whether an RTU of **another** organization holds a `modbus_tcp` row on this `host:port` (ADR
   * 0141 Amendment 2 (a)). Read on `bms_fleet` because the tenant policy would hide exactly the
   * rows it looks for; it answers a boolean, never a row or an organization. The host is compared
   * lower-cased (the body schema lower-cases, a stored onboarding row may not) and a row with no
   * `port` is 502. An inactive RTU counts: reactivating it would bring the conflict back.
   */
  private async endpointUsedByAnotherOrganization(
    rtuId: string,
    organizationId: string,
    host: string,
    port: number,
  ): Promise<boolean> {
    const storedPort = sql`coalesce(CASE WHEN jsonb_typeof(${rtuConnectionConfigs.config}->'port') = 'number' THEN (${rtuConnectionConfigs.config}->>'port')::numeric END, ${MODBUS_DEFAULT_PORT})`;
    const [hit] = await this.fleetDb
      .select({ present: sql<number>`1` })
      .from(rtuConnectionConfigs)
      .innerJoin(rtus, eq(rtus.id, rtuConnectionConfigs.rtuId))
      .where(
        and(
          eq(rtuConnectionConfigs.protocol, "modbus_tcp"),
          sql`lower(${rtuConnectionConfigs.config}->>'host') = ${host.toLowerCase()}`,
          sql`${storedPort} = ${port}`,
          ne(rtus.organizationId, organizationId),
          ne(rtuConnectionConfigs.rtuId, rtuId),
        ),
      )
      .limit(1);
    return hit !== undefined;
  }
}
