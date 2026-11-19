import { expect } from "vitest";

import { loadPheCatalog, phePilotExpectedRows, pheRtuSites, type PheRtuSite, seedPheCatalog } from "./phe-pilot-seed";
import {
  decidePheSite,
  gateExemptsSkip,
  type PheSiteHolder,
  pheRtuTarget,
} from "./phe-site-split";
import { hierarchyExpectations } from "./verify-hierarchy-expected";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

/**
 * `F4.388` (ADR 0139 decisions 1, 3, 4, 10, 11; plan D1–D5, D9) — the pure
 * halves of the split path: the site identity on the real catalog, the split
 * expectations the gate counts, the holder rule the seed adopts or skips by,
 * and the target an RTU and its assets are written at.
 */

/** The suffix rule on the 12 real display names. */
export function assertTheSuffixRuleOnTheRealNames(): void {
  const sites = pheRtuSites(loadPheCatalog());
  expect(sites.map((site) => [site.name, site.code])).toEqual([
    ["Lotapata I", "PHE-CBLTPT1-I"],
    ["Lotapata II", "PHE-CBLTPT1-II"],
    ["Mora Nodir Kuthi I", "PHE-CBMDK1-I"],
    ["Mora Nodir Kuthi II", "PHE-CBMDK1-II"],
    ["Banchukamari I", "PHE-ALPBNCK1-I"],
    ["Banchukamari II", "PHE-ALPBNCK1-II"],
    ["Bilsi I", "PHE-CBBILSI1-I"],
    ["Bilsi II", "PHE-CBBILSI1-II"],
    ["Bhutnirghat I", "PHE-ALPBHTNRGHT2-I"],
    ["Bhutnirghat II", "PHE-ALPBHTNRGHT2-II"],
    ["Salkumarhat I", "PHE-SALKMHT1-I"],
    ["Salkumarhat II", "PHE-SALKMHT1-II"],
  ]);
  const bhutnirghat = sites.find((site) => site.name === "Bhutnirghat I");
  expect(bhutnirghat?.slug).toBe("phe-bhutnirghat-i");
  expect(bhutnirghat?.stationSlug).toBe("phe-bhutnirghat");
}

/** Lotapata's two sites with their four asset codes each; none for the default list. */
export function assertLotapataSplitSites(): void {
  const catalog = loadPheCatalog();
  expect(phePilotExpectedRows(catalog).splitSites, "the committed list splits nothing").toEqual([]);
  expect(phePilotExpectedRows(catalog, []).splitSites).toEqual([]);
  const split = phePilotExpectedRows(catalog, ["CBLTPT1"]).splitSites;
  expect(split.map((site) => [site.slug, site.code, site.edgeRtuId])).toEqual([
    ["phe-lotapata-i", "PHE-CBLTPT1-I", 3],
    ["phe-lotapata-ii", "PHE-CBLTPT1-II", 5],
  ]);
  expect(split.map((site) => [...site.assetCodes].sort())).toEqual([
    ["PHE-AIRSP1051M-000000003", "PHE-MFM-000000003", "PHE-PUMP-C-000000002", "PHE-PUMP-M-000000002"],
    ["PHE-AIRSP1051M-000000004", "PHE-MFM-000000004", "PHE-PUMP-C-000000003", "PHE-PUMP-M-000000003"],
  ]);
  // The other expectations do not move with the list.
  expect(phePilotExpectedRows(catalog, ["CBLTPT1"]).rtuSites).toEqual(phePilotExpectedRows(catalog).rtuSites);
  expect(hierarchyExpectations(catalog, ["CBLTPT1"]).phe.splitSites).toEqual(split);
}

/** A code that is not a catalog station's throws, naming it, before anything reads it. */
export function assertAnUnknownStationCodeThrows(): void {
  const catalog = loadPheCatalog();
  expect(() => phePilotExpectedRows(catalog, ["NOPE1"])).toThrow(/NOPE1/);
  expect(() => hierarchyExpectations(catalog, ["CBLTPT1", "NOPE1"])).toThrow(/NOPE1/);
  expect(() => phePilotExpectedRows(catalog, ["CBLTPT1", "CBLTPT1"])).toThrow(/CBLTPT1/);
}

/**
 * Plan D2: the seed refuses a bad list before its first query — an unknown
 * code, and a non-empty list with no superuser holder reader. Neither handle
 * is touched, so `null` stands in for both.
 */
export async function assertTheSeedRefusesABadListBeforeAnyQuery(): Promise<void> {
  const nothing = null as unknown as Parameters<typeof seedPheCatalog>[0];
  const noPool = null as unknown as Parameters<typeof seedPheCatalog>[1];
  await expect(seedPheCatalog(nothing, noPool, { splitStationCodes: ["NOPE1"] })).rejects.toThrow(/NOPE1/);
  await expect(seedPheCatalog(nothing, noPool, { splitStationCodes: ["CBLTPT1"] })).rejects.toThrow(/holderReader/);
}

/** The split list is not in the throw-on-empty set: release A's empty list derives. */
export function assertTheSplitListIsNotInTheThrowOnEmptySet(): void {
  expect(() => hierarchyExpectations(loadPheCatalog(), [])).not.toThrow();
  expect(hierarchyExpectations().phe.splitSites).toEqual([]);
}

const PHEWB = "00000000-0000-0000-0000-00000000000a";
const ESKOM = "00000000-0000-0000-0000-00000000000e";

function lotapataI(): PheRtuSite {
  const site = pheRtuSites(loadPheCatalog())[0];
  if (!site) throw new Error("the PHE catalog has no RTU");
  return site;
}

function holder(overrides: Partial<PheSiteHolder>): PheSiteHolder {
  const site = lotapataI();
  return { id: "h1", slug: site.slug, code: site.code, organizationId: PHEWB, isSite: true, ...overrides };
}

/**
 * ADR 0139 decision 3 and owner ruling Q2: adopt only the site itself; skip on
 * any other holder of the slug or the code, and say which kind it is.
 */
export function assertTheHolderRule(): void {
  const site = lotapataI();
  expect(decidePheSite(site, [], PHEWB)).toEqual({ kind: "insert" });
  expect(decidePheSite(site, [holder({})], PHEWB)).toEqual({ kind: "adopt", locationId: "h1" });
  // Another organization's row on the slug.
  expect(decidePheSite(site, [holder({ organizationId: ESKOM, isSite: false, code: "X" })], PHEWB)).toMatchObject({
    kind: "skip",
    reason: "foreign-slug",
    holderId: "h1",
  });
  // A PHEWB row on the slug that is not the site (no triple, or another parent).
  expect(decidePheSite(site, [holder({ isSite: false, code: "X" })], PHEWB)).toMatchObject({
    kind: "skip",
    reason: "phewb-slug",
  });
  // A row on the code under another slug, in either organization.
  for (const organizationId of [PHEWB, ESKOM]) {
    expect(
      decidePheSite(site, [holder({ slug: "phe-other", isSite: false, organizationId })], PHEWB),
    ).toMatchObject({ kind: "skip", reason: "code-holder" });
  }
  // The site itself, but another row holds its code: never a 23505.
  expect(
    decidePheSite(site, [holder({ code: "PHE-ADMIN" }), holder({ id: "h2", slug: "phe-other", isSite: false })], PHEWB),
  ).toMatchObject({ kind: "skip", reason: "code-holder", holderId: "h2" });
  // A PHEWB slug holder wins over a code holder: the boot must stop on it.
  expect(
    decidePheSite(
      site,
      [holder({ isSite: false, code: "X" }), holder({ id: "h2", slug: "phe-other", isSite: false })],
      PHEWB,
    ),
  ).toMatchObject({ kind: "skip", reason: "phewb-slug", holderId: "h1" });
}

/** Owner ruling Q2: the gate exempts every skip but a PHEWB slug holder. */
export function assertTheGateExemptsAllButAPhewbSlugHolder(): void {
  const site = lotapataI();
  const skip = (reason: "foreign-slug" | "phewb-slug" | "code-holder") => ({
    site,
    reason,
    holderId: "h1",
    holderSlug: site.slug,
  });
  expect(gateExemptsSkip(skip("foreign-slug"))).toBe(true);
  expect(gateExemptsSkip(skip("code-holder"))).toBe(true);
  expect(gateExemptsSkip(skip("phewb-slug"))).toBe(false);
}

/**
 * ADR 0139 decisions 4 and 11 (plan D5): the resolved site, else the site the
 * RTU already sits at (never back), else the station; `site_name` is the
 * location's name in the first two and the catalog station name in the third.
 */
export function assertTheRtuTargetOrder(): void {
  const station = { locationId: "station", name: "Lotapata" };
  const site = { locationId: "site", name: "Lotapata I" };
  const current = { locationId: "current", name: "Lotapata I (renamed)" };
  expect(pheRtuTarget({ site, current, station })).toEqual({ locationId: "site", siteName: "Lotapata I", kind: "site" });
  expect(pheRtuTarget({ current, station })).toEqual({
    locationId: "current",
    siteName: "Lotapata I (renamed)",
    kind: "stays",
  });
  expect(pheRtuTarget({ station })).toEqual({ locationId: "station", siteName: "Lotapata", kind: "station" });
}
