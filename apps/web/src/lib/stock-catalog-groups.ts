/**
 * Domain grouping for the stock catalog accordion (`F2.17`).
 *
 * Reuses `labelFor` from `vocabulary.ts` rather than a hand-kept
 * code -> label map, for the reason its own docblock gives (`F4.43`): a
 * placeholder like "Unknown" hides which value the row actually holds, so the
 * bare code is the correct fallback, not something to reimplement here.
 *
 * Kept pure and in `lib/` — `vitest.config.ts`'s coverage `include` reaches
 * `apps/web/src/lib/**` and nothing above it, so a `.tsx` is outside the
 * denominator and untestable by the node-environment project.
 */
import type { AssetDomainDto, StockAssetTemplateDto } from "@bms/shared";

import { labelFor } from "./vocabulary";

export type StockCatalogGroup = {
  /** The domain code, as the entry carries it — not normalised. */
  readonly domain: string;
  /** The vocabulary's label, or the bare code when the vocabulary lacks it. */
  readonly label: string;
  /** Catalog order preserved. Never empty. */
  readonly entries: readonly StockAssetTemplateDto[];
};

/**
 * Groups by the domain PRESENT in `entries` — never one row per vocabulary
 * entry. A vocabulary domain with zero catalog entries (`it`, most likely,
 * ahead of a facility pack) gets no heading, because an empty accordion
 * section reads as "nothing here yet" for a domain nobody asked to see.
 *
 * Known domains (present in `domains`) sort by the vocabulary's `sortOrder`
 * ascending — the same axis `assetDomainDtoSchema` rows already carry, and
 * the order the picker on the create form uses. An unknown domain (one the
 * vocabulary does not carry, e.g. a deployment skew) still gets a group —
 * dropping the entries silently would be worse than an unstyled heading —
 * and sorts after every known domain, by its own code, so two unknown domains
 * still order deterministically against each other.
 *
 * When `domains` is `undefined` (the vocabulary has not loaded, or its fetch
 * failed) every group falls back to its bare code for both the sort key and
 * the label, matching `labelFor`'s own fallback.
 */
export function groupStockByDomain(
  entries: readonly StockAssetTemplateDto[],
  domains: readonly AssetDomainDto[] | undefined,
): StockCatalogGroup[] {
  const byDomain = new Map<string, StockAssetTemplateDto[]>();
  for (const entry of entries) {
    const bucket = byDomain.get(entry.domain);
    if (bucket) {
      bucket.push(entry);
    } else {
      byDomain.set(entry.domain, [entry]);
    }
  }

  const knownSortOrder = new Map<string, number>();
  domains?.forEach((row) => knownSortOrder.set(row.code, row.sortOrder));

  const groups: StockCatalogGroup[] = [];
  for (const [domain, domainEntries] of byDomain) {
    groups.push({
      domain,
      label: labelFor(domains, domain),
      entries: domainEntries,
    });
  }

  return groups.sort((a, b) => {
    const aOrder = knownSortOrder.get(a.domain);
    const bOrder = knownSortOrder.get(b.domain);
    if (aOrder !== undefined && bOrder !== undefined) {
      return aOrder - bOrder;
    }
    if (aOrder !== undefined) {
      return -1;
    }
    if (bOrder !== undefined) {
      return 1;
    }
    return a.domain.localeCompare(b.domain);
  });
}
