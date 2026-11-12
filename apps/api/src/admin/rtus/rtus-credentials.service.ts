import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, eq, inArray, ne, sql } from "drizzle-orm";

import { locations, rtuConnectionConfigs, rtus } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AdminRtuDto, JwtPayload, ReplaceRtuCredentialsBody } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import { hasControlChars, MQTT_CREDENTIAL_CONTROL_CHARS } from "../../onboarding-discovery/discovery-credentials";
import { CredentialCryptoService } from "../../security/credential-crypto.service";
import { MasterDataAuditService, type AuditInput } from "../master-data-audit.service";
import { brokerOf, sameBroker, type MqttBroker } from "../onboarding/onboarding-mqtt-broker";
import { RTU_ORG_MISMATCH_MESSAGE, RtusAdminService } from "./rtus.service";

/** `F4.333` (ADR 0129 decision 2): the audit action, one row per RTU written. */
export const RTU_CREDENTIALS_REPLACE_ACTION = "master.rtu.credentials.replace";

/** Decision 3 (Q4): the roles that may replace a committed RTU's credential. */
export const RTU_CREDENTIALS_ROLE_MESSAGE =
  "Only a global administrator or an organization administrator may replace an RTU's credentials.";
export const RTU_CREDENTIALS_NO_CONNECTION = "RTU has no connection config";
export const RTU_CREDENTIALS_NOT_MQTT = "Credentials can be replaced on MQTT RTUs only";
/** Decision 5 (Q7). */
export const RTU_CREDENTIALS_EDGE_SERVED =
  "This RTU is served by an edge gateway. Its broker credential is in the gateway's config file; change it there.";
export const RTU_CREDENTIALS_NEEDS_KEY =
  "CREDENTIAL_ENCRYPTION_KEY is not configured, so credentials cannot be stored encrypted. Nothing was written.";
/** Q3: one message for every refused sibling, so the answer reveals nothing about an RTU the caller cannot see. */
export const rtuCredentialsSiblingsRefused = (ids: readonly string[]): string =>
  `These RTUs cannot take this credential (not found, not yours, inactive, edge-served, or not on the same broker): ${ids.join(", ")}. Nothing was written.`;
/**
 * Build ruling on the PR 2 security review's L2: one ingest endpoint can serve
 * two organizations (`host:port`, first non-empty credential wins), so a
 * credential replaced here could break another organization's connection. An
 * organization administrator is refused on such a broker; a global
 * administrator, who answers for every tenant, may proceed.
 */
export const RTU_CREDENTIALS_SHARED_BROKER =
  "Another organization's RTUs use this broker, so a global administrator must replace this credential. Nothing was written.";
export const RTU_CREDENTIALS_RACED = "An RTU changed while its credential was being replaced. Nothing was written.";

/**
 * Security review M1: ingest fills an absent host or port from `MQTT_HOST` /
 * `MQTT_PORT` before it groups RTUs into endpoints, so a stored `null` may be
 * any broker. For the shared-broker check, a `null` matches anything: the
 * check fails closed, never open.
 */
export function mayShareBroker(a: MqttBroker, b: MqttBroker): boolean {
  const field = <T>(x: T | null, y: T | null) => x === null || y === null || x === y;
  return field(a.host, b.host) && field(a.port, b.port) && a.tls === b.tls;
}

type Target = {
  id: string;
  organizationId: string;
  locationId: string;
  active: boolean;
  edgeGatewayId: string | null;
  protocol: string | null;
  config: unknown;
  hadCredential: boolean;
  keyVersion: number | null;
};

/**
 * `F4.333` (ADR 0129 decisions 2, 3 and 5) — `PUT /admin/rtus/:id/credentials`.
 *
 * Write-only: the body's values are encrypted once at the current key version,
 * stored on the target and on each `alsoApplyTo` sibling, and dropped. They
 * reach no response, log line, audit row or error (AGENTS.md §9.6). Only the
 * three credential columns and `updated_at` are written, so host, port and TLS
 * stay as stored. Ingest picks the new blob up at its next reload through the
 * credential fingerprint (decision 4).
 *
 * Its own service because `RtusAdminService` serves catalog entries and this
 * route is catalog-excluded (`tests/f3.85-audit-via-mark.test.ts`).
 */
@Injectable()
export class RtusCredentialsService {
  private readonly logger = new Logger(RtusCredentialsService.name);

  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
    private readonly crypto: CredentialCryptoService,
    private readonly rtusService: RtusAdminService,
  ) {}

  async replace(jwt: JwtPayload, id: string, body: ReplaceRtuCredentialsBody): Promise<AdminRtuDto> {
    // 404 before 403, as the other RTU routes answer.
    const [target] = await this.read([id]);
    if (!target) {
      throw new NotFoundException("RTU not found");
    }
    const user = await this.accessControl.requireMasterDataUser(jwt);
    if (user.role !== "admin" && user.role !== "organization_admin") {
      throw new ForbiddenException(RTU_CREDENTIALS_ROLE_MESSAGE);
    }
    if (!(await this.accessControl.canManageLocation(jwt, target.locationId))) {
      throw new ForbiddenException("RTU is outside your access scope");
    }
    if (!(await this.orgAgrees(target))) {
      this.logger.error(`RTU ${target.id}: organization_id does not match its location's; write refused`);
      throw new InternalServerErrorException(RTU_ORG_MISMATCH_MESSAGE);
    }
    if (target.protocol === null) {
      throw new NotFoundException(RTU_CREDENTIALS_NO_CONNECTION);
    }
    if (target.protocol !== "mqtt") {
      throw new BadRequestException(RTU_CREDENTIALS_NOT_MQTT);
    }
    if (target.edgeGatewayId !== null) {
      throw new ConflictException(RTU_CREDENTIALS_EDGE_SERVED);
    }
    const broker = brokerOf(target.config);
    // Postgres answers lower-case ids; `z.string().uuid()` also accepts upper case.
    const siblingIds = [...new Set((body.alsoApplyTo ?? []).map((other) => other.toLowerCase()))].filter(
      (other) => other !== id.toLowerCase(),
    );
    const siblings = await this.read(siblingIds);
    const refused: string[] = [];
    for (const siblingId of siblingIds) {
      const sibling = siblings.find((row) => row.id === siblingId);
      const ok =
        sibling !== undefined &&
        sibling.organizationId === target.organizationId &&
        sibling.active &&
        sibling.edgeGatewayId === null &&
        sibling.protocol === "mqtt" &&
        broker.host !== null &&
        broker.port !== null &&
        sameBroker(broker, brokerOf(sibling.config)) &&
        (await this.accessControl.canManageLocation(jwt, sibling.locationId)) &&
        // Security review L2: the F4.138 org agreement, as for the target.
        (await this.orgAgrees(sibling));
      if (!ok) {
        refused.push(siblingId);
      }
    }
    if (refused.length > 0) {
      throw new BadRequestException(rtuCredentialsSiblingsRefused(refused));
    }

    if (user.role !== "admin" && (await this.brokerSharedWithAnotherOrg(target.organizationId, broker))) {
      throw new ConflictException(RTU_CREDENTIALS_SHARED_BROKER);
    }

    if (!CredentialCryptoService.isConfigured()) {
      throw new ServiceUnavailableException(RTU_CREDENTIALS_NEEDS_KEY);
    }
    // Last, as ADR 0129 decision 2 orders the refusals: the body's own 400.
    if (hasControlChars(body.username) || hasControlChars(body.password)) {
      throw new BadRequestException(MQTT_CREDENTIAL_CONTROL_CHARS);
    }
    // One blob for every RTU written: the same credential, one fresh IV.
    const encrypted = this.crypto.encrypt({ username: body.username, password: body.password });
    const written = [target, ...siblingIds.map((siblingId) => siblings.find((row) => row.id === siblingId)!)];

    await withTenant(this.tenantDb, target.organizationId, async (tx) => {
      const rows = await tx
        .update(rtuConnectionConfigs)
        .set({
          credentialsCiphertext: encrypted.ciphertext,
          credentialsIv: encrypted.iv,
          keyVersion: encrypted.keyVersion,
          updatedAt: new Date(),
        })
        .where(
          and(
            inArray(
              rtuConnectionConfigs.rtuId,
              written.map((row) => row.id),
            ),
            eq(rtuConnectionConfigs.protocol, "mqtt"),
            // Security review L1: re-checked at write time, so an RTU moved to
            // an edge gateway since the read fails the row count instead.
            sql`EXISTS (SELECT 1 FROM bms.rtus r WHERE r.id = ${rtuConnectionConfigs.rtuId} AND r.edge_gateway_id IS NULL)`,
          ),
        )
        .returning({ rtuId: rtuConnectionConfigs.rtuId });
      // All or nothing: a row deleted, re-protocolled or hidden since the read
      // rolls the whole write back, and no audit row is written (L2 of F4.334).
      if (rows.length !== written.length) {
        throw new ConflictException(RTU_CREDENTIALS_RACED);
      }
      await this.audit.writeMany(
        written.map(
          (row): AuditInput => ({
            actor: jwt,
            action: RTU_CREDENTIALS_REPLACE_ACTION,
            entityType: "rtu",
            entityId: row.id,
            organizationId: target.organizationId,
            // Never a value, never a key name (§9.6, ADR 0021 decision 6).
            payload: {
              hadCredential: row.hadCredential,
              fromKeyVersion: row.hadCredential ? row.keyVersion : null,
              toKeyVersion: encrypted.keyVersion,
            },
          }),
        ),
        tx,
      );
    });
    this.logger.log(`RTU ${id}: credentials replaced on ${written.length} RTU(s)`);
    return this.rtusService.fetchRow(id);
  }

  /** The RTUs and their connection rows, on `fleetDb`; the callers' grant checks are the isolation control. */
  private async read(ids: readonly string[]): Promise<Target[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.fleetDb
      .select({
        id: rtus.id,
        organizationId: rtus.organizationId,
        locationId: rtus.locationId,
        active: rtus.active,
        edgeGatewayId: rtus.edgeGatewayId,
        protocol: rtuConnectionConfigs.protocol,
        config: rtuConnectionConfigs.config,
        ciphertext: rtuConnectionConfigs.credentialsCiphertext,
        keyVersion: rtuConnectionConfigs.keyVersion,
      })
      .from(rtus)
      .leftJoin(rtuConnectionConfigs, eq(rtuConnectionConfigs.rtuId, rtus.id))
      .where(inArray(rtus.id, [...ids]));
    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      locationId: row.locationId,
      active: row.active,
      edgeGatewayId: row.edgeGatewayId,
      protocol: row.protocol,
      config: row.config,
      hadCredential: row.ciphertext !== null,
      keyVersion: row.keyVersion,
    }));
  }

  /** `F4.138`: whether the RTU's organization equals its location's; drift is refused, never repaired. */
  private async orgAgrees(row: Target): Promise<boolean> {
    const [location] = await this.fleetDb
      .select({ organizationId: locations.organizationId })
      .from(locations)
      .where(eq(locations.id, row.locationId))
      .limit(1);
    return location?.organizationId === row.organizationId;
  }

  /**
   * Whether an active MQTT RTU of another organization may connect to the same
   * broker (host, port, TLS), with a stored `null` matching anything
   * ({@link mayShareBroker}).
   */
  private async brokerSharedWithAnotherOrg(organizationId: string, broker: MqttBroker): Promise<boolean> {
    // Code review 4: from `rtus`, LEFT JOIN, as ingest plans it (`bindings.ts`):
    // an RTU with no connection row is MQTT by `source_type` and connects to the
    // environment's broker, so its config reads as `{}` and matches fail-closed.
    const others = await this.fleetDb
      .select({ config: rtuConnectionConfigs.config })
      .from(rtus)
      .leftJoin(rtuConnectionConfigs, eq(rtuConnectionConfigs.rtuId, rtus.id))
      .where(
        and(
          sql`coalesce(${rtuConnectionConfigs.protocol}, ${rtus.sourceType}) = 'mqtt'`,
          eq(rtus.active, true),
          ne(rtus.organizationId, organizationId),
        ),
      );
    return others.some((row) => mayShareBroker(broker, brokerOf(row.config ?? {})));
  }
}
