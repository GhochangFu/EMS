/**
 * Version grouping for the template list (`F2.5`, ADR 0038 decision 1 —
 * Unit 6).
 *
 * Fixtures are built through `adminAssetTemplateSummaryDtoSchema` rather than
 * cast, so a fixture cannot drift from the contract the page actually receives.
 * A hand-shaped object literal with `as` would keep compiling after a required
 * field was added and would test grouping over a row the API never sends.
 */
import { adminAssetTemplateSummaryDtoSchema } from "@bms/shared/contracts";
import type { AdminAssetTemplateSummaryDto, AssetTemplateStatus } from "@bms/shared";

import { groupTemplateVersions } from "./template-list-grouping";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type SummarySeed = {
  code: string;
  version: number;
  status?: AssetTemplateStatus;
  organizationId?: string;
  organizationCode?: string;
  createdAt?: string;
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
    domain: "hvac",
    description: null,
    status: seed.status ?? "draft",
    content: {},
    publishedAt: null,
    archivedAt: null,
    stockCode: null,
    stockVersion: null,
    createdAt: seed.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pointCount: 4,
  });
}

/** Three versions of one template collapse into one group, newest first. */
export function runGroupsVersionsTests(): void {
  const groups = groupTemplateVersions([
    summary({ code: "CHILLER", version: 1 }),
    summary({ code: "CHILLER", version: 3 }),
    summary({ code: "CHILLER", version: 2 }),
    summary({ code: "PUMP", version: 1 }),
  ]);

  assert(groups.length === 2, `expected 2 groups, got ${groups.length}`);
  assert(
    groups.map((group) => group.code).join(",") === "CHILLER,PUMP",
    `groups must sort by code — got ${groups.map((group) => group.code).join(",")}`,
  );

  const chiller = groups[0];
  assert(chiller.versions.length === 3, `CHILLER holds 3 versions, got ${chiller.versions.length}`);
  assert(
    chiller.versions.map((row) => row.version).join(",") === "3,2,1",
    `versions must run newest first — got ${chiller.versions.map((row) => row.version).join(",")}`,
  );
  assert(chiller.latest.version === 3, `latest must be v3, got v${chiller.latest.version}`);
}

/**
 * Input order does not decide output order.
 *
 * The API's ordering is not part of this contract, and a test whose fixture
 * arrives pre-sorted proves nothing about the sort.
 */
export function runOrderIsIndependentOfInputTests(): void {
  const ascending = groupTemplateVersions([
    summary({ code: "PUMP", version: 1 }),
    summary({ code: "CHILLER", version: 1 }),
    summary({ code: "CHILLER", version: 2 }),
  ]);
  const descending = groupTemplateVersions([
    summary({ code: "CHILLER", version: 2 }),
    summary({ code: "CHILLER", version: 1 }),
    summary({ code: "PUMP", version: 1 }),
  ]);

  assert(
    JSON.stringify(ascending) === JSON.stringify(descending),
    "grouping must not depend on the order the API returned rows in",
  );
}

/**
 * Two organizations may each own a `CHILLER`, and they stay apart.
 *
 * Merging them would produce a group whose Instantiate crosses an org boundary
 * — which the API refuses with "Template belongs to a different organization
 * than the target", after the author has already filled in the form.
 */
export function runGroupsByOrganizationAndCodeTests(): void {
  const groups = groupTemplateVersions([
    summary({ code: "CHILLER", version: 1, organizationId: "org-1", organizationCode: "ACME" }),
    summary({ code: "CHILLER", version: 2, organizationId: "org-1", organizationCode: "ACME" }),
    summary({ code: "CHILLER", version: 1, organizationId: "org-2", organizationCode: "BOREAL" }),
  ]);

  assert(groups.length === 2, `two organizations means two groups, got ${groups.length}`);
  assert(
    groups.map((group) => group.organizationCode).join(",") === "ACME,BOREAL",
    "groups must sort by organization code first",
  );
  assert(groups[0].versions.length === 2, "ACME holds both of its versions");
  assert(groups[1].versions.length === 1, "BOREAL holds only its own");
  assert(
    groups[1].versions[0].organizationId === "org-2",
    "a group must never hold another organization's row",
  );
}

/**
 * The filter runs before grouping, and an emptied group disappears.
 *
 * An empty group header reads as "this template has no versions", which is a
 * different and more alarming claim than "nothing here matches your filter".
 */
export function runStatusFilterTests(): void {
  const rows = [
    summary({ code: "CHILLER", version: 1, status: "archived" }),
    summary({ code: "CHILLER", version: 2, status: "published" }),
    summary({ code: "CHILLER", version: 3, status: "draft" }),
    summary({ code: "PUMP", version: 1, status: "draft" }),
    summary({ code: "VALVE", version: 1, status: "archived" }),
  ];

  const all = groupTemplateVersions(rows);
  assert(all.length === 3, `no filter shows every group, got ${all.length}`);
  assert(all[0].versions.length === 3, "CHILLER keeps all three versions unfiltered");

  const drafts = groupTemplateVersions(rows, "draft");
  assert(
    drafts.map((group) => group.code).join(",") === "CHILLER,PUMP",
    `VALVE has no draft and must disappear — got ${drafts.map((group) => group.code).join(",")}`,
  );
  assert(drafts[0].versions.length === 1, "only CHILLER v3 is a draft");
  assert(
    drafts[0].latest.version === 3 && drafts[0].latest.status === "draft",
    "latest must be the newest *visible* version, not the newest overall",
  );

  const archived = groupTemplateVersions(rows, "archived");
  assert(
    archived.map((group) => group.code).join(",") === "CHILLER,VALVE",
    "PUMP has no archived version and must disappear",
  );
  assert(
    archived[0].latest.version === 1,
    "CHILLER's only archived version is v1, so it summarises the group",
  );

  assert(groupTemplateVersions([], "draft").length === 0, "no rows means no groups");
}

/** The input array is not reordered under the caller. */
export function runDoesNotMutateInputTests(): void {
  const rows = [
    summary({ code: "CHILLER", version: 1 }),
    summary({ code: "CHILLER", version: 3 }),
    summary({ code: "CHILLER", version: 2 }),
  ];
  const before = rows.map((row) => row.version).join(",");
  groupTemplateVersions(rows);
  assert(
    rows.map((row) => row.version).join(",") === before,
    `grouping must not sort the caller's array in place — it is now ${rows
      .map((row) => row.version)
      .join(",")}`,
  );
}
