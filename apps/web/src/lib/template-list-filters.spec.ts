/**
 * Organization and domain filters for the template list (`F2.21` part 2).
 *
 * Fixtures are built through `adminAssetTemplateSummaryDtoSchema` and then
 * through `groupTemplateVersions`, rather than hand-shaped as groups. Both
 * choices are deliberate: the schema stops a fixture drifting from the contract
 * the page receives, and grouping for real means these tests exercise the same
 * `latest` the page renders — which is the whole basis for filtering on
 * `latest.domain`.
 */
import {
  adminAssetTemplateSummaryDtoSchema,
  assetDomainDtoSchema,
} from "@bms/shared/contracts";
import type {
  AdminAssetTemplateSummaryDto,
  AssetDomainDto,
} from "@bms/shared";

import {
  NO_TEMPLATE_LIST_FILTERS,
  filterTemplateGroups,
  templateDomainOptions,
  templateListSubtitle,
  templateOrganizationOptions,
} from "./template-list-filters";
import { groupTemplateVersions, type TemplateVersionGroup } from "./template-list-grouping";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type SummarySeed = {
  code: string;
  version: number;
  domain?: string;
  organizationId?: string;
  organizationCode?: string;
};

/** One list row, validated against the contract before any test sees it. */
function summary(seed: SummarySeed): AdminAssetTemplateSummaryDto {
  const organizationId = seed.organizationId ?? "org-1";
  return adminAssetTemplateSummaryDtoSchema.parse({
    id: `${organizationId}-${seed.code}-v${seed.version}`,
    organizationId,
    organizationCode: seed.organizationCode ?? "ACME",
    organizationName: "Acme Water",
    code: seed.code,
    version: seed.version,
    name: `${seed.code} v${seed.version}`,
    assetType: "chiller",
    domain: seed.domain ?? "hvac",
    description: null,
    status: "draft",
    content: {},
    publishedAt: null,
    archivedAt: null,
    stockCode: null,
    stockVersion: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pointCount: 4,
  });
}

function groups(seeds: readonly SummarySeed[]): TemplateVersionGroup[] {
  return groupTemplateVersions(seeds.map(summary));
}

/** One vocabulary row, validated against the contract the page receives. */
function domain(code: string, label: string, sortOrder: number): AssetDomainDto {
  return assetDomainDtoSchema.parse({ code, label, sortOrder, active: true });
}

/**
 * Labels are deliberately NOT derivable from their codes, and `sortOrder`
 * deliberately disagrees with alphabetical order — `Water` sorts before
 * `HVAC` by `sortOrder` and after it alphabetically. A title-casing shortcut,
 * or a sort that fell back to the label, would pass a lazier fixture and fail
 * this one.
 */
const DOMAINS: readonly AssetDomainDto[] = [
  domain("electrical", "Electrical plant", 1),
  domain("water", "Water treatment", 2),
  domain("hvac", "HVAC", 3),
];

const ids = (rows: readonly TemplateVersionGroup[]): string =>
  rows.map((group) => `${group.organizationCode}/${group.code}`).join(",");

/** No filter keeps every group, in the order grouping produced. */
export function runEmptyFilterKeepsEverythingTests(): void {
  const all = groups([
    { code: "CHILLER", version: 1 },
    { code: "PUMP", version: 1, organizationId: "org-2", organizationCode: "BETA" },
    { code: "AHU", version: 1 },
  ]);
  const kept = filterTemplateGroups(all, NO_TEMPLATE_LIST_FILTERS);
  assert(kept.length === all.length, `expected every group, got ${kept.length} of ${all.length}`);
  assert(ids(kept) === ids(all), `order changed: ${ids(kept)} vs ${ids(all)}`);
}

/** Each axis selects on its own, and both together intersect. */
export function runFiltersByOrganizationAndDomainTests(): void {
  const all = groups([
    { code: "CHILLER", version: 1, domain: "hvac" },
    { code: "TRF", version: 1, domain: "electrical" },
    { code: "PUMP", version: 1, domain: "hvac", organizationId: "org-2", organizationCode: "BETA" },
    { code: "RO", version: 1, domain: "water", organizationId: "org-2", organizationCode: "BETA" },
  ]);

  assert(
    ids(filterTemplateGroups(all, { organizationId: "org-2", domain: "" })) === "BETA/PUMP,BETA/RO",
    "organization alone should keep both of that organization's templates",
  );
  assert(
    ids(filterTemplateGroups(all, { organizationId: "", domain: "hvac" })) ===
      "ACME/CHILLER,BETA/PUMP",
    "domain alone should reach across organizations",
  );
  assert(
    ids(filterTemplateGroups(all, { organizationId: "org-2", domain: "hvac" })) === "BETA/PUMP",
    "both filters must intersect, not union",
  );
  assert(
    filterTemplateGroups(all, { organizationId: "org-1", domain: "water" }).length === 0,
    "a combination nothing matches must yield an empty list, not a fallback",
  );
}

/**
 * A template whose domain changed between versions filters by its LATEST.
 *
 * This is the case that makes group-level filtering necessary. Filtering rows
 * before grouping would render one template as two headers under two domains.
 * Both directions are asserted: it appears under the new domain and does NOT
 * appear under the old one, and its old version is still reachable inside the
 * group it does appear in.
 */
export function runDomainFollowsLatestVersionTests(): void {
  const all = groups([
    { code: "MOVER", version: 1, domain: "electrical" },
    { code: "MOVER", version: 3, domain: "hvac" },
  ]);
  assert(all.length === 1, `one template, got ${all.length} groups`);
  assert(all[0].latest.version === 3, "the group summarises its highest version");

  assert(
    filterTemplateGroups(all, { organizationId: "", domain: "hvac" }).length === 1,
    "the template must appear under the domain its latest version declares",
  );
  assert(
    filterTemplateGroups(all, { organizationId: "", domain: "electrical" }).length === 0,
    "it must NOT also appear under the domain it moved away from",
  );

  const kept = filterTemplateGroups(all, { organizationId: "", domain: "hvac" })[0];
  assert(
    kept.versions.some((version) => version.domain === "electrical"),
    "the earlier version stays reachable inside the group — the filter hides templates, not versions",
  );
}

/** Organization options come from what is present, sorted by code, deduplicated. */
export function runOrganizationOptionsTests(): void {
  const all = groups([
    { code: "PUMP", version: 1, organizationId: "org-2", organizationCode: "BETA" },
    { code: "CHILLER", version: 1, organizationId: "org-1", organizationCode: "ACME" },
    { code: "AHU", version: 1, organizationId: "org-1", organizationCode: "ACME" },
  ]);
  const options = templateOrganizationOptions(all);
  assert(
    options.map((option) => option.label).join(",") === "ACME,BETA",
    `expected ACME,BETA sorted and deduplicated, got ${options.map((o) => o.label).join(",")}`,
  );
  assert(
    options.map((option) => option.value).join(",") === "org-1,org-2",
    "the option value is the id the filter matches on, not the display code",
  );
  assert(templateOrganizationOptions([]).length === 0, "an empty list offers no organizations");
}

/** Domain options are present-only, in the vocabulary's sortOrder. */
export function runDomainOptionsOrderedByVocabularyTests(): void {
  const all = groups([
    { code: "RO", version: 1, domain: "water" },
    { code: "TRF", version: 1, domain: "electrical" },
    { code: "CHILLER", version: 1, domain: "hvac" },
  ]);
  const options = templateDomainOptions(all, DOMAINS);
  // sortOrder is electrical(1), water(2), hvac(3) — which is neither the
  // fixture's insertion order nor alphabetical by code or by label.
  assert(
    options.map((option) => option.value).join(",") === "electrical,water,hvac",
    `expected the vocabulary's sortOrder, got ${options.map((o) => o.value).join(",")}`,
  );
  assert(
    options.map((option) => option.label).join(",") === "Electrical plant,Water treatment,HVAC",
    "labels come from the vocabulary, not from title-casing the code",
  );
  // Present-only: `water` is in the vocabulary but selecting it must not be
  // offered when nothing carries it.
  const onlyHvac = templateDomainOptions(groups([{ code: "CHILLER", version: 1 }]), DOMAINS);
  assert(
    onlyHvac.map((option) => option.value).join(",") === "hvac",
    "a vocabulary domain with no templates must not be offered",
  );
}

/** An unknown domain is still offered, labelled by its code, after every known one. */
export function runUnknownDomainStillOfferedTests(): void {
  const all = groups([
    { code: "ZZZ", version: 1, domain: "zeta" },
    { code: "CHILLER", version: 1, domain: "hvac" },
  ]);
  const options = templateDomainOptions(all, DOMAINS);
  assert(
    options.map((option) => option.value).join(",") === "hvac,zeta",
    `an unknown domain sorts last, got ${options.map((o) => o.value).join(",")}`,
  );
  assert(
    options[1].label === "zeta",
    "an unknown domain is labelled with its bare code, never a placeholder",
  );
  assert(
    filterTemplateGroups(all, { organizationId: "", domain: "zeta" }).length === 1,
    "the offered option must actually select its templates",
  );
}

/** With no vocabulary loaded the picker still works, ordered and labelled by code. */
export function runUndefinedVocabularyFallsBackToCodeTests(): void {
  const all = groups([
    { code: "RO", version: 1, domain: "water" },
    { code: "TRF", version: 1, domain: "electrical" },
  ]);
  const options = templateDomainOptions(all, undefined);
  assert(
    options.map((option) => option.value).join(",") === "electrical,water",
    "with no sortOrder available the order falls back to the code",
  );
  assert(
    options.every((option) => option.label === option.value),
    "`labelFor` returns the bare code when the vocabulary is absent",
  );
}

/** The subtitle says "showing x of y" only while something is hidden. */
export function runSubtitleTests(): void {
  assert(
    templateListSubtitle(42, 42) === "42 templates",
    `unfiltered reads as a plain count, got "${templateListSubtitle(42, 42)}"`,
  );
  assert(
    templateListSubtitle(6, 42) === "showing 6 of 42 templates",
    `filtered must name the total, got "${templateListSubtitle(6, 42)}"`,
  );
  assert(
    templateListSubtitle(0, 42) === "showing 0 of 42 templates",
    "a filter that matches nothing must still say what it filtered out of",
  );
  assert(
    templateListSubtitle(1, 1) === "1 template",
    `singular, got "${templateListSubtitle(1, 1)}"`,
  );
  assert(
    templateListSubtitle(0, 0) === "0 templates",
    "an empty list is not 'showing 0 of 0'",
  );
}
