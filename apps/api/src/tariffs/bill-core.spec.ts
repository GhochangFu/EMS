import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mappingInForce } from "./location-tariff-read";
import { elapsedShare, monthFirstDay, monthOf, monthWindow, previousMonth } from "./month-window";
import { pickVersion, type TariffVersion } from "./tariff-versions";

/** `F4.365` U4 — the pure parts of the bill core, and a source scan of its fleet reads. */

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export function assertTheKolkataMonthWindow(): void {
  const w = monthWindow("2026-11", "Asia/Kolkata");
  assert(w.start.toISOString() === "2026-10-31T18:30:00.000Z", `start ${w.start.toISOString()}`);
  assert(w.end.toISOString() === "2026-11-30T18:30:00.000Z", `end ${w.end.toISOString()}`);
  assert(monthWindow("2026-12", "Asia/Kolkata").end.toISOString() === "2026-12-31T18:30:00.000Z", "December rolls the year");
  assert(monthOf(new Date("2026-10-31T19:00:00Z"), "Asia/Kolkata") === "2026-11", "local month");
  assert(monthFirstDay("2026-02") === "2026-02-01" && previousMonth("2026-01") === "2025-12", "helpers");
  assert(elapsedShare(w, new Date(w.start.getTime() + 3 * 86_400_000)) === 0.1, "day 3 of 30 = 10%");
  assert(elapsedShare(w, new Date("2027-01-01T00:00:00Z")) === 1, "a past month is whole");
}

const version = (effectiveFrom: string, source: "catalog" | "organization"): TariffVersion => ({
  id: `${source}-${effectiveFrom}`,
  key: "k",
  source,
  organizationId: source === "organization" ? "org" : null,
  name: "n",
  state: "s",
  energyUnit: "kwh",
  fixedBasis: "none",
  dataStatus: "official",
  effectiveFrom,
  tariffOrder: null,
  sourceUrl: null,
  slabs: [],
});

export function assertPickVersionRules(): void {
  const vs = [version("2026-04-01", "catalog"), version("2026-07-01", "catalog"), version("2026-07-01", "organization"), version("2026-10-01", "organization")];
  assert(pickVersion(vs, "2026-03-01") === null, "before any version");
  assert(pickVersion(vs, "2026-05-01")?.id === "catalog-2026-04-01", "the catalog's April version");
  assert(pickVersion(vs, "2026-07-01")?.id === "organization-2026-07-01", "a tie goes to the organization");
  assert(pickVersion([...vs].reverse(), "2026-08-01")?.id === "organization-2026-07-01", "the tie is order-independent");
  assert(pickVersion(vs, "2026-09-01")?.id === "organization-2026-07-01", "a later version does not serve an earlier month");
  assert(pickVersion(vs, "2026-10-01")?.id === "organization-2026-10-01", "the October revision");
}

export function assertMappingInForce(): void {
  const rows = [
    { effectiveFrom: "2026-01-01", effectiveTo: "2026-04-01" },
    { effectiveFrom: "2026-04-01", effectiveTo: null },
  ];
  assert(mappingInForce(rows, "2025-12-01") === null, "before");
  assert(mappingInForce(rows, "2026-03-01") === rows[0], "first window");
  assert(mappingInForce(rows, "2026-04-01") === rows[1], "half-open: the end belongs to the next");
}

const source = (file: string) => readFileSync(join(__dirname, file), "utf8");

/** The fleet reads bypass RLS, so the organization equality IS the isolation (plan D12). */
export function assertTheFleetReadsKeepTheirOrganizationEquality(): void {
  const register = source("register-read.ts");
  assert((register.match(/FROM telemetry\.point_values/g) ?? []).length === 2, "two probe sites");
  assert((register.match(/^\s+LIMIT 1$/gm) ?? []).length === 2, "each probe is LIMIT 1");
  const versions = source("tariff-versions.ts");
  const orgJoin = /JOIN bms\.org_tariff_categories o ON o\.key = p\.key AND o\.organization_id = p\.organization_id/;
  assert(orgJoin.test(versions), "readVersions joins organization rows on the pair's organization");
  assert(!orgJoin.test(versions.replace("AND o.organization_id = p.organization_id", "")), "positive control: the pattern sees a violation");
  const mappings = source("location-tariff-read.ts");
  assert(mappings.includes("JOIN bms.locations l ON l.id = lt.location_id AND l.organization_id = lt.organization_id"), "mapping ↔ location organization");
  assert(mappings.includes("lt.organization_id = n.organization_id"), "nearest mapping keeps the asset's organization");
}
