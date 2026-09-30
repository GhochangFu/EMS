import { mimicOrgSymbolDtoSchema } from "@bms/shared";
import type { MimicOrgSymbolDto } from "@bms/shared";

/**
 * `F3.32f` slice 3 / ADR 0086 decisions 6 and 7 (plan D6) — the organization symbols a layout
 * read embeds, re-checked on the way out.
 *
 * A row can reach `bms.mimic_org_symbols` by a path other than the upload parser (a `bms_fleet`
 * write, a later migration), so every row passes `mimicOrgSymbolDtoSchema.safeParse` — seven tags,
 * the attribute list, each value in its grammar. A row that fails is **omitted and logged by id
 * only**: never a 400 for the whole layout (the `F4.108` rule on stored data), and never the
 * stored content in a log line. The unit that names it then draws the fallback glyph.
 *
 * Shared by `MimicLayoutsService.toDto` (Drizzle) and `MimicNodesService.readLayouts` (raw SQL
 * on the fleet pool); each reads the rows its own way and maps them to `OrgSymbolRow`.
 */

/** One stored symbol joined to its library's style, as either reader hands it over. */
export type OrgSymbolRow = {
  readonly id: string;
  readonly libraryId: string;
  readonly key: string;
  readonly label: string;
  readonly groupCode: string;
  readonly style: string;
  readonly viewBox: readonly number[];
  readonly shapes: unknown;
  readonly active: boolean;
  readonly sourceFilename: string;
  readonly sha256: string;
  readonly updatedAt: Date | string;
};

function isoOf(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

/** The rows as DTOs, in the order given; a row the contract refuses is omitted and `warn`ed. */
export function orgSymbolsOf(rows: readonly OrgSymbolRow[], warn: (message: string) => void): MimicOrgSymbolDto[] {
  const out: MimicOrgSymbolDto[] = [];
  for (const row of rows) {
    const parsed = mimicOrgSymbolDtoSchema.safeParse({
      id: row.id,
      libraryId: row.libraryId,
      key: row.key,
      label: row.label,
      group: row.groupCode,
      style: row.style,
      viewBox: row.viewBox,
      shapes: row.shapes,
      active: row.active,
      sourceFilename: row.sourceFilename,
      sha256: row.sha256,
      updatedAt: isoOf(row.updatedAt),
    });
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      warn(`mimic org symbol ${row.id}: omitted, the stored row fails the response contract`);
    }
  }
  return out;
}
