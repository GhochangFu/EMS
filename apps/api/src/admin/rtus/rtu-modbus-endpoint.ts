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

/** The key one endpoint is compared by: canonical host and port. */
function endpointKey(endpoint: ModbusEndpoint): string {
  return `${endpoint.host}:${endpoint.port}`;
}

/**
 * The endpoints (`host:port`, host canonical) that **active, cloud-served** RTUs of other
 * organizations hold a `modbus_tcp` row on (ADR 0141 Amendment 2 (a), a cloud-host rule: an
 * edge-served or inactive RTU is not polled by the cloud host, PR 7 review H2). Read once, on
 * `bms_fleet`, because the tenant policy would hide exactly the rows it looks for; the caller
 * tests every endpoint it writes against the one set (PR 11 review L7). Each stored host is
 * compared in its canonical spelling (`canonicalModbusHost`, review M1), so a row written before
 * hosts were canonical still counts; a row with no `port` is 502. Called under the endpoints'
 * advisory locks, on another connection, so it sees a racing write's committed row. `rtuId` is
 * the RTU being written, left out of the read; `null` for RTUs not yet inserted (the onboarding
 * commit). Never returned to a caller: it answers membership only.
 */
async function endpointsOfOtherOrganizations(
  fleetDb: BmsDb,
  rtuId: string | null,
  organizationId: string,
): Promise<Set<string>> {
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
  const held = new Set<string>();
  for (const row of rows) {
    if (typeof row.host === "string") {
      held.add(endpointKey({ host: canonicalModbusHost(row.host), port: typeof row.port === "number" ? row.port : MODBUS_DEFAULT_PORT }));
    }
  }
  return held;
}

/**
 * The 409 of ADR 0141 Amendment 2 (a) for cloud-served RTUs: refuses when another organization's
 * active cloud-served RTU uses any of `endpoints`. One read for all of them. The caller holds the
 * endpoints' locks (`lockModbusEndpoints`). One rule for the RTUs page bind, the onboarding
 * commit and an RTU's reactivation.
 */
export async function assertModbusEndpointsServeOneOrganization(
  fleetDb: BmsDb,
  rtuId: string | null,
  organizationId: string,
  endpoints: readonly ModbusEndpoint[],
): Promise<void> {
  if (endpoints.length === 0) {
    return;
  }
  const held = await endpointsOfOtherOrganizations(fleetDb, rtuId, organizationId);
  if (endpoints.some((endpoint) => held.has(endpointKey(endpoint)))) {
    throw new ConflictException(RTU_MODBUS_ENDPOINT_OTHER_ORGANIZATION_MESSAGE);
  }
}

/**
 * `F1.2` PR 11 security review L1 — an RTU coming back to life on the cloud host: when its stored
 * connection row is `modbus_tcp` and no edge gateway serves it, its endpoint is locked and checked
 * as a bind's would be, on the caller's transaction, so reactivation cannot put a second
 * organization on one endpoint. A row whose `host` is not a string names no endpoint.
 */
export async function assertStoredModbusEndpointServesOneOrganization(
  tx: BmsTx,
  fleetDb: BmsDb,
  rtu: { readonly id: string; readonly organizationId: string; readonly edgeGatewayId: string | null },
): Promise<void> {
  if (rtu.edgeGatewayId !== null) {
    return;
  }
  const [row] = await tx
    .select({ protocol: rtuConnectionConfigs.protocol, config: rtuConnectionConfigs.config })
    .from(rtuConnectionConfigs)
    .where(eq(rtuConnectionConfigs.rtuId, rtu.id))
    .limit(1);
  const config = (row?.config ?? {}) as Record<string, unknown>;
  if (row?.protocol !== "modbus_tcp" || typeof config.host !== "string") {
    return;
  }
  const endpoint = {
    host: canonicalModbusHost(config.host),
    port: typeof config.port === "number" ? config.port : MODBUS_DEFAULT_PORT,
  };
  await lockModbusEndpoints(tx, [endpoint]);
  await assertModbusEndpointsServeOneOrganization(fleetDb, rtu.id, rtu.organizationId, [endpoint]);
}
