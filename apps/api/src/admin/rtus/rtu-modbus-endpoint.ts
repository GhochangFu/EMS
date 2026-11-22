import { ConflictException } from "@nestjs/common";
import { and, eq, isNull, ne, sql } from "drizzle-orm";

import { rtuConnectionConfigs, rtus } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { canonicalModbusHost } from "@bms/shared";

import type { BmsTx } from "../../database/tenant-context";

/** ADR 0141 Amendment 2 (a) — the 409 for an endpoint another organization's cloud-served RTU uses. Names neither organization. */
export const RTU_MODBUS_ENDPOINT_OTHER_ORGANIZATION_MESSAGE =
  "This Modbus endpoint (host and port) is already used by an RTU of another organization; one endpoint serves one organization";

/** The Modbus TCP port when a stored row names none (ADR 0141 decision 5). */
export const MODBUS_DEFAULT_PORT = 502;

/** One Modbus endpoint: a host in its canonical spelling (`canonicalModbusHost`) and a port. */
export type ModbusEndpoint = { readonly host: string; readonly port: number };

/**
 * `F1.2` (ADR 0141 Amendment 2 (a), PR 7 review L1) — takes each endpoint's transaction advisory
 * lock, held to commit, so two writes of one endpoint serialise and the check below sees the
 * other's committed row. Shared by the RTUs page bind (one endpoint) and the onboarding commit
 * (plan PR 11, every Modbus RTU of a draft): duplicates are taken once and the keys in one sorted
 * order, so two commits naming the same endpoints cannot deadlock on each other.
 */
export async function lockModbusEndpoints(tx: BmsTx, endpoints: readonly ModbusEndpoint[]): Promise<void> {
  const keys = [...new Set(endpoints.map((endpoint) => `modbus_tcp:${endpoint.host}:${endpoint.port}`))].sort();
  for (const key of keys) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
  }
}

/**
 * Whether an **active, cloud-served** RTU of another organization holds a `modbus_tcp` row on
 * this `host:port` (ADR 0141 Amendment 2 (a), a cloud-host rule: an edge-served or inactive RTU is
 * not polled by the cloud host, PR 7 review H2). Read on `bms_fleet` because the tenant policy
 * would hide exactly the rows it looks for; it answers a boolean, never a row or an organization.
 * Each stored host is compared in its canonical spelling (`canonicalModbusHost`, review M1), so a
 * row written before hosts were canonical still counts; a row with no `port` is 502. Called under
 * the endpoint's advisory lock, on another connection, so it sees a racing write's committed row.
 * `rtuId` is the RTU being written, left out of the read; `null` for an RTU not yet inserted (the
 * onboarding commit).
 */
export async function modbusEndpointUsedByAnotherOrganization(
  fleetDb: BmsDb,
  rtuId: string | null,
  organizationId: string,
  endpoint: ModbusEndpoint,
): Promise<boolean> {
  const rows = await fleetDb
    .select({ host: sql<unknown>`${rtuConnectionConfigs.config}->'host'`, port: sql<unknown>`${rtuConnectionConfigs.config}->'port'` })
    .from(rtuConnectionConfigs)
    .innerJoin(rtus, eq(rtus.id, rtuConnectionConfigs.rtuId))
    .where(
      and(
        eq(rtuConnectionConfigs.protocol, "modbus_tcp"),
        ne(rtus.organizationId, organizationId),
        ...(rtuId === null ? [] : [ne(rtuConnectionConfigs.rtuId, rtuId)]),
        eq(rtus.active, true),
        isNull(rtus.edgeGatewayId),
      ),
    );
  return rows.some(
    (row) =>
      typeof row.host === "string" &&
      canonicalModbusHost(row.host) === endpoint.host &&
      (typeof row.port === "number" ? row.port : MODBUS_DEFAULT_PORT) === endpoint.port,
  );
}

/**
 * The 409 of ADR 0141 Amendment 2 (a) for a cloud-served RTU: refuses when another organization's
 * active cloud-served RTU uses the endpoint. The caller holds the endpoint's lock
 * (`lockModbusEndpoints`). One rule for the RTUs page bind and the onboarding commit.
 */
export async function assertModbusEndpointServesOneOrganization(
  fleetDb: BmsDb,
  rtuId: string | null,
  organizationId: string,
  endpoint: ModbusEndpoint,
): Promise<void> {
  if (await modbusEndpointUsedByAnotherOrganization(fleetDb, rtuId, organizationId, endpoint)) {
    throw new ConflictException(RTU_MODBUS_ENDPOINT_OTHER_ORGANIZATION_MESSAGE);
  }
}
