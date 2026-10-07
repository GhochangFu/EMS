import { Inject, Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";

import { locations, rtuConnectionConfigs, rtus } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { PROTOCOL_CATALOG, type ProtocolCatalogEntry } from "@bms/shared";

import { FLEET_DRIZZLE } from "../../database/database.tokens";

export type { ProtocolCatalogEntry } from "@bms/shared";

export type OrgProtocolExample = {
  protocol: string;
  rtuCode: string;
  displayName: string;
  config: Record<string, unknown>;
  locationName: string;
};

export type ProtocolContext = {
  catalog: readonly ProtocolCatalogEntry[];
  orgExamples: OrgProtocolExample[];
};

/**
 * Loads protocol catalog and org-scoped RTU examples for onboarding chat.
 *
 * `F3.24a` (ADR 0093 decision 3) — the catalog is code, `PROTOCOL_CATALOG` in
 * `@bms/shared/ingest`; no database is read for it.
 *
 * `F4.16` / ADR 0043 — `getContextForOrganization` joins `locations` (RLS
 * since migration `0040`) and runs on `fleetDb`; `organizationId` is
 * always a value the caller has already been authorized against upstream in
 * `OnboardingService`, so this is a pool change, not a new authorization
 * surface.
 */
@Injectable()
export class OnboardingProtocolService {
  constructor(@Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb) {}

  /** Returns the code-defined catalog in display order. Kept `async` so its callers do not change. */
  async listCatalog(): Promise<readonly ProtocolCatalogEntry[]> {
    return PROTOCOL_CATALOG;
  }

  /** Returns catalog plus live examples from RTUs in the organization. */
  async getContextForOrganization(organizationId: string): Promise<ProtocolContext> {
    const catalog = await this.listCatalog();
    const orgExamples = await this.fleetDb
      .select({
        protocol: rtuConnectionConfigs.protocol,
        rtuCode: rtus.code,
        displayName: rtus.displayName,
        config: rtuConnectionConfigs.config,
        locationName: locations.name,
      })
      .from(rtuConnectionConfigs)
      .innerJoin(rtus, eq(rtuConnectionConfigs.rtuId, rtus.id))
      .innerJoin(locations, eq(rtus.locationId, locations.id))
      .where(eq(locations.organizationId, organizationId))
      .orderBy(sql`${rtuConnectionConfigs.protocol}`, rtus.code)
      .limit(8);

    return {
      catalog,
      orgExamples: orgExamples.map((row) => ({
        protocol: row.protocol,
        rtuCode: row.rtuCode,
        displayName: row.displayName,
        config: (row.config as Record<string, unknown>) ?? {},
        locationName: row.locationName,
      })),
    };
  }

  /** Formats protocol context as markdown for LLM or rule-based replies. */
  formatForAssistant(context: ProtocolContext, exampleRtuName: string): string {
    const lines = context.catalog.map((entry) => {
      const wired = entry.ingestWired ? "live ingest" : "config only";
      const required = entry.requiredFields.join(", ") || "none";
      const optional = entry.optionalFields.join(", ") || "none";
      const browse = entry.supportsDiscovery ? "yes" : "no";
      const example = JSON.stringify(entry.exampleConfig);
      return `- **${entry.label}** (\`${entry.code}\`, ${wired}): ${entry.description} Required: ${required} · Optional: ${optional} · Browse: ${browse} · Example config: ${example}`;
    });

    const orgLines =
      context.orgExamples.length > 0
        ? context.orgExamples.map(
            (ex) =>
              `- Org example: **${ex.displayName}** (\`${ex.rtuCode}\`) at ${ex.locationName} uses **${ex.protocol}**`,
          )
        : [`- No existing RTU protocol examples in this org yet. Try **${exampleRtuName}** with **MQTT**.`];

    return `${lines.join("\n")}\n\n**Examples from your organization:**\n${orgLines.join("\n")}`;
  }
}
