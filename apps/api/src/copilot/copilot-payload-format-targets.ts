import { and, eq, sql } from "drizzle-orm";

import { type BmsDb, mqttPayloadFormats, rtuConnectionConfigs } from "@bms/db";

import { connectionPayloadFormatOf } from "../admin/rtus/rtu-connection-tls";
import { type BmsTx, withTenant } from "../database/tenant-context";

/**
 * `F4.334` / ADR 0099 Amendment 17 decisions 1 and 4 — the resolver's reads for the payload
 * format entries and `rtu.setPayloadFormat`, beside `copilot-target-resolver.ts` for the
 * AGENTS.md §4.5 line cap.
 */

/** A catalog row as the card names it, with its edit stamp and the RTUs in scope that name it. */
export type PayloadFormatTarget = {
  readonly organizationId: string;
  readonly name: string;
  readonly updatedAt: string;
  readonly usageCount: number;
};

/**
 * The row `code` names, or `null`. On the tenant pool: `bms.mqtt_payload_formats` has no
 * organization and no row-level security, and `bms_tenant` keeps `SELECT` (migration `0130`).
 * The RTU count is summed over the turn's allowed organizations under `withTenant`
 * (`rtu_connection_configs` carries FORCE ROW LEVEL SECURITY) — never outside the turn's scope,
 * so the card names the organization it counted, as the location-type count does.
 */
export async function readPayloadFormatTarget(
  tenantDb: BmsDb,
  code: string,
  allowedOrganizationIds: readonly string[],
  organizationId: string,
): Promise<PayloadFormatTarget | null> {
  const [row] = await tenantDb
    .select({ name: mqttPayloadFormats.name, updatedAt: mqttPayloadFormats.updatedAt })
    .from(mqttPayloadFormats)
    .where(eq(mqttPayloadFormats.code, code))
    .limit(1);
  if (!row) return null;
  let usageCount = 0;
  for (const allowed of allowedOrganizationIds) {
    const [counted] = await withTenant(tenantDb, allowed, (tx) =>
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(rtuConnectionConfigs)
        .where(
          and(
            eq(rtuConnectionConfigs.organizationId, allowed),
            sql`${rtuConnectionConfigs.config}->>'payloadFormat' = ${code}`,
          ),
        ),
    );
    usageCount += Number(counted?.n ?? 0);
  }
  return { organizationId, name: row.name, updatedAt: row.updatedAt.toISOString(), usageCount };
}

/** An RTU's payload format now (`null` for the built-in, no connection row, or not MQTT), read in the tenant `tx`. */
export async function readRtuPayloadFormat(tx: BmsTx, rtuId: string): Promise<string | null> {
  const [row] = await tx
    .select({ protocol: rtuConnectionConfigs.protocol, config: rtuConnectionConfigs.config })
    .from(rtuConnectionConfigs)
    .where(eq(rtuConnectionConfigs.rtuId, rtuId))
    .limit(1);
  return row ? connectionPayloadFormatOf(row.protocol, row.config) : null;
}
