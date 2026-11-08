import { asc, desc } from "drizzle-orm";

import { mqttPayloadFormats } from "@bms/db";
import { mqttPayloadFormatDefinitionSchema } from "@bms/shared";

import type { DiscoveryFormat } from "./discovery-collector";

/** The slice of a transaction this module needs; a fake satisfies it in specs. */
export type DiscoveryFormatsReader = {
  select(fields: { code: typeof mqttPayloadFormats.code; definition: typeof mqttPayloadFormats.definition }): {
    from(table: typeof mqttPayloadFormats): {
      orderBy(...order: unknown[]): Promise<{ code: string; definition: unknown }[]>;
    };
  };
};

/**
 * `F4.334` / ADR 0116 decision 8 (plan T4.2) — every catalog format the
 * discovery collector tries, read on the job's tenant transaction (the
 * catalog keeps `bms_tenant` SELECT, migration `0130`): built-in first, then by
 * code, with the RTU's chosen code moved to the front. A row whose definition
 * fails the shared schema is left out and its **code** returned in `invalid`
 * for the job to log — never the definition. A chosen code with no row leaves
 * the order as it is: discovery tries every format, and the validator, not
 * discovery, refuses an unknown code.
 */
export async function loadDiscoveryFormats(
  tx: DiscoveryFormatsReader,
  chosen: string | undefined,
): Promise<{ formats: DiscoveryFormat[]; invalid: string[] }> {
  const rows = await tx
    .select({ code: mqttPayloadFormats.code, definition: mqttPayloadFormats.definition })
    .from(mqttPayloadFormats)
    .orderBy(desc(mqttPayloadFormats.builtin), asc(mqttPayloadFormats.code));
  const formats: DiscoveryFormat[] = [];
  const invalid: string[] = [];
  for (const row of rows) {
    const parsed = mqttPayloadFormatDefinitionSchema.safeParse(row.definition);
    if (parsed.success) {
      formats.push({ code: row.code, definition: parsed.data });
    } else {
      invalid.push(row.code);
    }
  }
  const at = chosen === undefined ? -1 : formats.findIndex((format) => format.code === chosen);
  if (at > 0) {
    const [picked] = formats.splice(at, 1);
    formats.unshift(picked!);
  }
  return { formats, invalid };
}
