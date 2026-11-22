import { BadRequestException, InternalServerErrorException, type Logger } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import { deviceProfiles } from "@bms/db";
import type { BmsDb } from "@bms/db";
import {
  MODBUS_DRAFT_PROFILE_NEEDS_UNIT_ID_MESSAGE,
  modbusDraftConfigSchema,
  type ModbusDraftConfig,
  type OnboardingDraft,
} from "@bms/shared";

import type { BmsTx } from "../../database/tenant-context";
import { buildModbusConnectionConfig, StoredProfileRegistersInvalidError } from "../rtus/rtu-modbus-config";
import {
  assertModbusEndpointsServeOneOrganization,
  lockModbusEndpoints,
  MODBUS_DEFAULT_PORT,
  type ModbusEndpoint,
} from "../rtus/rtu-modbus-endpoint";
import { RTU_MODBUS_PROFILE_NOT_FOUND_MESSAGE } from "../rtus/rtus-modbus.service";
import { configIssueMessage } from "./onboarding-config-issues";

/**
 * `F1.2` plan PR 11 (ADR 0141 Amendment 1 (f), decision 23) — what the onboarding commit does for
 * a `modbus_tcp` RTU of the draft. Its own file: `onboarding-commit.service.ts` is near §4.5's
 * ceiling.
 *
 * - **One register-copy path.** A draft that names a device profile (`config.profileId`) is bound
 *   at commit with PR 7's `buildModbusConnectionConfig`, the RTUs page bind's helper: the stored
 *   row holds the profile's registers and `profile: { code, version }`, built fresh.
 * - **The profile is the organization's.** Read on the commit's tenant transaction with the
 *   organization in the predicate, so another organization's profile is "not found", by the bind's
 *   own fixed sentence.
 * - **Canonical host.** Every Modbus config is stored as `modbusDraftConfigSchema` parsed it, so
 *   the host is in its one spelling (PR 7 review M1) with or without a profile.
 * - **One endpoint, one organization** (Amendment 2 (a)): every Modbus RTU of the draft is
 *   cloud-served (onboarding names no edge gateway), so each endpoint is locked and checked by
 *   `rtu-modbus-endpoint.ts`, the bind's own code.
 * - **Ingest.** A Modbus RTU committed with a profile keeps the draft's `ingestEnabled`; without
 *   one it is committed with ingest off, as every non-MQTT RTU was (`committedIngestEnabled`).
 */

/** A Modbus RTU of the draft: its index, its parsed config and the endpoint it dials. */
export type DraftModbusRtu = {
  readonly index: number;
  readonly code: string;
  readonly config: ModbusDraftConfig;
  readonly endpoint: ModbusEndpoint;
};

/** What the commit stores for one Modbus RTU: the connection row's config and the profile bound, if any. */
export type ModbusCommitConnection = {
  readonly config: Record<string, unknown>;
  readonly profile: { readonly code: string; readonly version: number } | null;
  readonly registerCount: number;
};

/**
 * The draft's Modbus TCP RTUs, each config parsed by `modbusDraftConfigSchema` (the host
 * canonical). The validator refused a draft whose Modbus config does not parse before the commit
 * got here, so a parse failure is the same 400 with the issues at their paths (fixed text, §9.6).
 */
export function draftModbusRtus(draft: OnboardingDraft): DraftModbusRtu[] {
  const found: DraftModbusRtu[] = [];
  (draft.rtus ?? []).forEach((rtu, index) => {
    if (rtu.protocol !== "modbus_tcp") {
      return;
    }
    const parsed = modbusDraftConfigSchema.safeParse(rtu.config ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Draft is not ready to commit",
        errors: parsed.error.issues.map((issue) => ({
          path: [`rtus.${index}.config`, ...issue.path].join("."),
          message: configIssueMessage(issue),
        })),
      });
    }
    const config: ModbusDraftConfig = parsed.data;
    found.push({
      index,
      code: rtu.code,
      config,
      endpoint: { host: config.host, port: config.port ?? MODBUS_DEFAULT_PORT },
    });
  });
  return found;
}

/**
 * The `rtus.ingest_enabled` the commit writes. MQTT keeps the draft's switch (as before); a Modbus
 * TCP RTU keeps it only when a profile is bound (decision 23); every other RTU is committed off.
 */
export function committedIngestEnabled(
  protocol: string,
  ingestEnabled: boolean | undefined,
  profileBound: boolean,
): boolean {
  if (protocol === "mqtt" || (protocol === "modbus_tcp" && profileBound)) {
    return ingestEnabled ?? false;
  }
  return false;
}

/**
 * Locks every endpoint of the draft's Modbus RTUs (sorted, once each) and refuses one another
 * organization's active cloud-served RTU uses — the 409 of Amendment 2 (a), before any insert.
 * Two RTUs of this draft on one endpoint are one organization's and pass.
 */
export async function assertDraftModbusEndpoints(
  tx: BmsTx,
  fleetDb: BmsDb,
  organizationId: string,
  modbusRtus: readonly DraftModbusRtu[],
): Promise<void> {
  if (modbusRtus.length === 0) {
    return;
  }
  const endpoints = modbusRtus.map((rtu) => rtu.endpoint);
  await lockModbusEndpoints(tx, endpoints);
  // PR 11 review L7: one read of the other organizations' endpoints, every draft endpoint tested against it.
  await assertModbusEndpointsServeOneOrganization(fleetDb, null, organizationId, endpoints);
}

/**
 * The connection row's config for one Modbus RTU of the draft. With `profileId`, the profile is
 * read on the tenant transaction (organization and protocol in the predicate) and its registers
 * copied by `buildModbusConnectionConfig`; an unknown or foreign id is the validation 400 at
 * `config.profileId` with the bind's "not found" sentence. Without one, the parsed draft config.
 */
export async function modbusCommitConnection(
  tx: BmsTx,
  organizationId: string,
  rtu: DraftModbusRtu,
  logger: Pick<Logger, "error">,
): Promise<ModbusCommitConnection> {
  const { profileId, ...connection } = rtu.config;
  if (profileId === undefined) {
    return {
      config: connection,
      profile: null,
      registerCount: connection.device?.registers?.length ?? 0,
    };
  }
  const [profile] = await tx
    .select({ id: deviceProfiles.id, code: deviceProfiles.code, version: deviceProfiles.version, registers: deviceProfiles.registers })
    .from(deviceProfiles)
    .where(
      and(
        eq(deviceProfiles.id, profileId),
        eq(deviceProfiles.organizationId, organizationId),
        eq(deviceProfiles.protocol, "modbus_tcp"),
      ),
    )
    .limit(1);
  if (!profile) {
    throw new BadRequestException({
      message: "Draft is not ready to commit",
      errors: [{ path: `rtus.${rtu.index}.config.profileId`, message: RTU_MODBUS_PROFILE_NOT_FOUND_MESSAGE }],
    });
  }
  // The schema already refuses a profile without a unit id; this keeps the type honest.
  if (connection.device === undefined) {
    throw new BadRequestException({
      message: "Draft is not ready to commit",
      errors: [{ path: `rtus.${rtu.index}.config.device.unitId`, message: MODBUS_DRAFT_PROFILE_NEEDS_UNIT_ID_MESSAGE }],
    });
  }
  const unitId = connection.device.unitId;
  let config: Record<string, unknown>;
  try {
    config = buildModbusConnectionConfig(
      {
        host: connection.host,
        port: connection.port,
        timeoutMs: connection.timeoutMs,
        interRequestDelayMs: connection.interRequestDelayMs,
        pollIntervalMs: connection.pollIntervalMs ?? null,
        unitId,
      },
      profile,
    );
  } catch (err) {
    if (err instanceof StoredProfileRegistersInvalidError) {
      // Every profile write validates its registers, so this is stored-data drift (§9.6: ids only).
      logger.error(`device profile ${profile.id}: stored registers do not parse; onboarding commit refused`);
      throw new InternalServerErrorException("The device profile's stored registers are invalid");
    }
    throw err;
  }
  const device = config.device as { registers: unknown[] };
  return { config, profile: { code: profile.code, version: profile.version }, registerCount: device.registers.length };
}
