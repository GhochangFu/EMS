import { Inject, Injectable } from "@nestjs/common";
import { asc, eq, sql } from "drizzle-orm";

import {
  locations,
  protocolCatalog,
  rtuConnectionConfigs,
  rtus,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { OnboardingProtocol } from "@bms/shared";

import { DRIZZLE } from "../../database/database.tokens";

export type ProtocolCatalogEntry = {
  code: OnboardingProtocol;
  label: string;
  description: string | null;
  ingestWired: boolean;
  exampleConfig: Record<string, unknown>;
};

export type OrgProtocolExample = {
  protocol: string;
  rtuCode: string;
  displayName: string;
  config: Record<string, unknown>;
  locationName: string;
};

export type ProtocolContext = {
  catalog: ProtocolCatalogEntry[];
  orgExamples: OrgProtocolExample[];
};

/** Loads protocol catalog and org-scoped RTU examples for onboarding chat. */
@Injectable()
export class OnboardingProtocolService {
  constructor(@Inject(DRIZZLE) private readonly db: BmsDb) {}

  /** Returns catalog rows ordered for display. */
  async listCatalog(): Promise<ProtocolCatalogEntry[]> {
    try {
      const rows = await this.db
        .select()
        .from(protocolCatalog)
        .orderBy(asc(protocolCatalog.sortOrder));
      return rows.map((row) => ({
        code: row.code as OnboardingProtocol,
        label: row.label,
        description: row.description,
        ingestWired: row.ingestWired,
        exampleConfig: (row.exampleConfig as Record<string, unknown>) ?? {},
      }));
    } catch {
      return [];
    }
  }

  /** Returns catalog plus live examples from RTUs in the organization. */
  async getContextForOrganization(organizationId: string): Promise<ProtocolContext> {
    const catalog = await this.listCatalog();
    const orgExamples = await this.db
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
      const example = JSON.stringify(entry.exampleConfig);
      return `- **${entry.label}** (\`${entry.code}\`, ${wired}): ${entry.description ?? ""} Example config: ${example}`;
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
