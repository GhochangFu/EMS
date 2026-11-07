import { expect } from "vitest";

import { carriedTabGroups, replaceOutcome } from "./site-layout-replace.pure";

/**
 * `F4.320` PR 2 (ADR 0087 Amendment 4 decisions 4 and 5) — the two pure rules of Replace: which
 * old group picks a rebuilt copy carries, and what Replace does with a held copy. Vitest entry
 * point: the sibling `.test.ts`.
 */

const ELEC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ELEC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HVAC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OVERVIEW_GROUP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const GROUPS = [
  { id: ELEC_A, domain: "electrical" },
  { id: ELEC_B, domain: "electrical" },
  { id: HVAC, domain: "hvac" },
  { id: OVERVIEW_GROUP, domain: null },
];

const TABS = [
  { key: "overview", domain: null },
  { key: "sld", domain: "electrical" },
  { key: "ups", domain: "electrical" },
  { key: "hvac", domain: "hvac" },
];

/** A tab key the new version still has keeps its old group (decision 4). */
export function anOldPickIsCarriedByTabKey(): void {
  expect(
    carriedTabGroups(TABS, [{ tabKey: "sld", assetGroupId: ELEC_B }, { tabKey: "hvac", assetGroupId: HVAC }], GROUPS, {}),
  ).toEqual({ sld: ELEC_B, hvac: HVAC });
}

/** A `tabGroups` entry overrides the carried pick, and the carried pick of its group is dropped. */
export function aBodyChoiceOverridesTheCarriedPick(): void {
  const old = [
    { tabKey: "sld", assetGroupId: ELEC_A },
    { tabKey: "ups", assetGroupId: ELEC_B },
  ];
  // The body moves ELEC_A to `ups`: `sld` loses its old pick (the planner would refuse it as taken).
  expect(carriedTabGroups(TABS, old, GROUPS, { ups: ELEC_A })).toEqual({ ups: ELEC_A });
  // The body names `sld` only: `ups` keeps its own old pick.
  expect(carriedTabGroups(TABS, old, GROUPS, { sld: ELEC_B })).toEqual({ sld: ELEC_B });
  expect(carriedTabGroups(TABS, old, GROUPS, { sld: ELEC_A })).toEqual({ sld: ELEC_A, ups: ELEC_B });
}

/**
 * An old pick the planner would refuse is not carried: a tab key the new version dropped, the
 * Overview (it binds through `groupCode`), a group gone from the site, a group whose domain is
 * no longer the tab's, a tab with no group.
 */
export function anOldPickThePlannerWouldRefuseIsNotCarried(): void {
  const gone = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  expect(
    carriedTabGroups(
      TABS,
      [
        { tabKey: "water", assetGroupId: ELEC_A },
        { tabKey: "overview", assetGroupId: OVERVIEW_GROUP },
        { tabKey: "sld", assetGroupId: gone },
        { tabKey: "ups", assetGroupId: HVAC },
        { tabKey: "hvac", assetGroupId: null },
      ],
      GROUPS,
      {},
    ),
  ).toEqual({});
  // The positive twin: the same rows with valid groups are carried.
  expect(
    carriedTabGroups(TABS, [{ tabKey: "sld", assetGroupId: ELEC_A }, { tabKey: "ups", assetGroupId: ELEC_B }], GROUPS, {}),
  ).toEqual({ sld: ELEC_A, ups: ELEC_B });
}

/** One group is carried once: a second tab that held it (an old copy of another shape) drops it. */
export function aGroupIsCarriedOnce(): void {
  expect(
    carriedTabGroups(TABS, [{ tabKey: "sld", assetGroupId: ELEC_A }, { tabKey: "ups", assetGroupId: ELEC_A }], GROUPS, {}),
  ).toEqual({ sld: ELEC_A });
}

const HELD = { dashboardId: ELEC_A, templateId: ELEC_B, templateCode: "pump-station-standard", version: 2 };

/** Decision 5: no copy, another code, the same version (bulk only), else replace. */
export function theOutcomeFollowsTheCopyAndTheMode(): void {
  const v3 = { code: "pump-station-standard", version: 3 };
  const v2 = { code: "pump-station-standard", version: 2 };
  expect(replaceOutcome(null, v3, "bulk")).toBe("no_copy");
  expect(replaceOutcome(null, v3, "site")).toBe("no_copy");
  expect(replaceOutcome(HELD, { code: "smoc-standard", version: 3 }, "bulk")).toBe("other_template");
  expect(replaceOutcome(HELD, { code: "smoc-standard", version: 2 }, "site")).toBe("other_template");
  expect(replaceOutcome(HELD, v2, "bulk")).toBe("same_version");
  expect(replaceOutcome(HELD, v2, "site"), "per site, the same version is an explicit rebuild").toBe("replace");
  expect(replaceOutcome(HELD, v3, "bulk")).toBe("replace");
  expect(replaceOutcome(HELD, v3, "site")).toBe("replace");
  // An older version is another version too: bulk replaces a copy newer than the template.
  expect(replaceOutcome({ ...HELD, version: 4 }, v3, "bulk")).toBe("replace");
}
