/**
 * Domain grouping for the stock catalog (`F2.17`, Task 1).
 *
 * Fixtures are built through `stockAssetTemplateDtoSchema` and
 * `assetDomainDtoSchema` rather than cast, so a fixture cannot drift from the
 * contracts the page actually receives — the same discipline
 * `template-list-grouping.spec.ts` uses.
 *
 * Vocabulary labels below are deliberately NOT derivable from their codes
 * (`electrical` -> "Electrical plant", not "Electrical"). A title-casing
 * shortcut, or a hand-kept code->label map, would pass a lazier fixture and
 * fail these.
 */
import { assetDomainDtoSchema, stockAssetTemplateDtoSchema } from "@bms/shared/contracts";
import type { AssetDomainDto, StockAssetTemplateDto } from "@bms/shared";

import { groupStockByDomain } from "./stock-catalog-groups";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type EntrySeed = {
  code: string;
  domain: string;
};

/** One catalog entry, validated against the contract before any test sees it. */
function entry(seed: EntrySeed): StockAssetTemplateDto {
  return stockAssetTemplateDtoSchema.parse({
    code: seed.code,
    name: seed.code,
    assetType: "chiller",
    domain: seed.domain,
    description: null,
    stockVersion: 1,
    content: {},
    points: [],
  });
}

type DomainSeed = {
  code: string;
  label: string;
  sortOrder: number;
};

/** One vocabulary row, validated the same way. */
function domain(seed: DomainSeed): AssetDomainDto {
  return assetDomainDtoSchema.parse({
    code: seed.code,
    label: seed.label,
    sortOrder: seed.sortOrder,
    active: true,
  });
}

/**
 * Three domains present in the entries, vocabulary sortOrder, alphabetical
 * order and first-appearance order all disagree — so the test cannot pass by
 * the grouping picking any of the wrong orders by accident.
 *
 * First appearance in `entries`: water, electrical, mechanical.
 * Alphabetical by code: electrical, mechanical, water.
 * Vocabulary `sortOrder`: mechanical(1), water(2), electrical(3).
 */
const DOMAINS = [
  domain({ code: "electrical", label: "Electrical plant", sortOrder: 3 }),
  domain({ code: "mechanical", label: "Rotating plant", sortOrder: 1 }),
  domain({ code: "water", label: "Water treatment", sortOrder: 2 }),
  // `it` is a real vocabulary domain with zero entries below — it must not
  // produce a heading.
  domain({ code: "it", label: "Information technology", sortOrder: 4 }),
];

/** One group per domain present, ordered by the vocabulary's sortOrder, never one per vocabulary row. */
export function runOrdersBySortOrderAndOmitsEmptyDomainTests(): void {
  const groups = groupStockByDomain(
    [
      entry({ code: "WTP-1", domain: "water" }),
      entry({ code: "ELEC-1", domain: "electrical" }),
      entry({ code: "PUMP-1", domain: "mechanical" }),
    ],
    DOMAINS,
  );

  assert(groups.length === 3, `expected 3 groups (not one per vocabulary row), got ${groups.length}`);
  assert(
    groups.map((group) => group.domain).join(",") === "mechanical,water,electrical",
    `groups must order by vocabulary sortOrder — got ${groups.map((group) => group.domain).join(",")}`,
  );
  assert(
    !groups.some((group) => group.domain === "it"),
    "a vocabulary domain with no entries must not produce a group",
  );
  assert(
    groups.map((group) => group.label).join(",") === "Rotating plant,Water treatment,Electrical plant",
    `labels must come from the vocabulary, not the code — got ${groups.map((group) => group.label).join(",")}`,
  );
}

/** Entries keep catalog order inside a group. */
export function runPreservesCatalogOrderWithinGroupTests(): void {
  const groups = groupStockByDomain(
    [
      entry({ code: "WTP-3", domain: "water" }),
      entry({ code: "WTP-1", domain: "water" }),
      entry({ code: "WTP-2", domain: "water" }),
    ],
    DOMAINS,
  );

  assert(groups.length === 1, `expected 1 group, got ${groups.length}`);
  assert(
    groups[0].entries.map((row) => row.code).join(",") === "WTP-3,WTP-1,WTP-2",
    `entries must keep catalog order — got ${groups[0].entries.map((row) => row.code).join(",")}`,
  );
}

/**
 * A domain the vocabulary does not carry still groups, reads as its bare
 * code, and sorts after every known domain; two unknowns sort between
 * themselves by code.
 */
export function runUnknownDomainSortsLastByCodeTests(): void {
  const groups = groupStockByDomain(
    [
      entry({ code: "WTP-1", domain: "water" }),
      entry({ code: "ZZ-1", domain: "zzz-unknown" }),
      entry({ code: "AA-1", domain: "aaa-unknown" }),
    ],
    DOMAINS,
  );

  assert(groups.length === 3, `expected 3 groups, got ${groups.length}`);
  assert(
    groups.map((group) => group.domain).join(",") === "water,aaa-unknown,zzz-unknown",
    `unknown domains must sort after known ones, and between themselves by code — got ${groups
      .map((group) => group.domain)
      .join(",")}`,
  );
  assert(
    groups[1].label === "aaa-unknown" && groups[2].label === "zzz-unknown",
    "an unknown domain must read as its bare code",
  );
}

/** `domains === undefined` — every group labels as its code and orders by code. */
export function runUndefinedVocabularyOrdersByCodeTests(): void {
  const groups = groupStockByDomain(
    [
      entry({ code: "WTP-1", domain: "water" }),
      entry({ code: "ELEC-1", domain: "electrical" }),
      entry({ code: "PUMP-1", domain: "mechanical" }),
    ],
    undefined,
  );

  assert(groups.length === 3, `expected 3 groups, got ${groups.length}`);
  assert(
    groups.map((group) => group.domain).join(",") === "electrical,mechanical,water",
    `with no vocabulary, groups must order by code — got ${groups.map((group) => group.domain).join(",")}`,
  );
  assert(
    groups.every((group) => group.label === group.domain),
    "with no vocabulary, every label must be the bare code",
  );
}

/** An empty entry array yields no groups. */
export function runEmptyEntriesYieldNoGroupsTests(): void {
  const groups = groupStockByDomain([], DOMAINS);
  assert(groups.length === 0, `expected no groups, got ${groups.length}`);
}

/** The function must not mutate or reorder the caller's array. */
export function runDoesNotMutateInputTests(): void {
  const entries = [
    entry({ code: "WTP-1", domain: "water" }),
    entry({ code: "ELEC-1", domain: "electrical" }),
    entry({ code: "PUMP-1", domain: "mechanical" }),
  ];
  const before = entries.map((row) => row.code).join(",");
  groupStockByDomain(entries, DOMAINS);
  assert(
    entries.map((row) => row.code).join(",") === before,
    `grouping must not reorder the caller's array — it is now ${entries.map((row) => row.code).join(",")}`,
  );
}

/** Every group's `entries` array is never empty. */
export function runNeverEmitsEmptyGroupTests(): void {
  const groups = groupStockByDomain(
    [entry({ code: "WTP-1", domain: "water" })],
    DOMAINS,
  );
  assert(
    groups.every((group) => group.entries.length > 0),
    "a group must never be emitted with zero entries",
  );
}
