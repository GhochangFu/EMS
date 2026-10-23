import { expect } from "vitest";
import { z, type ZodTypeAny } from "zod";

import * as contracts from "../../contracts";
import {
  CANVAS_ENTRY_IDS,
  cardOnlyKeysFor,
  catalogEntry,
  catalogParamsOf,
  catalogPath,
  COPILOT_CATALOG,
  DELETE_ALLOWANCE,
  EXCLUDED_ROUTES,
  formulaRefsOf,
  formulaSitesOf,
  hashExcludedKeysFor,
  pathParamsOf,
  proposeToolName,
} from "./index";
import { modelBodyOf } from "./model-body";
import { onboardingCommitCounts, onboardingCommitSiteName } from "./onboarding";
import { bodyFieldsOf, objectShapeOf, stepValuesSchema } from "./object-shape";
import { emptyBody } from "./summary-text";
import type { CatalogEntry, CatalogFormula } from "./types";

/**
 * `F3.85` PR 8 / ADR 0099 decisions 2, 3, 6 (plan §10.1) — the catalog's own
 * rules. The route side (every write route is an entry or excluded, the
 * controller parses the same export) is `tests/f3.85-catalog-coverage.test.ts`.
 * Vitest entry point: the sibling `.test.ts`.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const ROW = "22222222-2222-4222-8222-222222222222";
const TARGET_NAME = "Target Row 7";
const ORG_NAME = "Org Seven";

/** `F3.87` PR 5: a layout body's fields — two units on the core library and one pipe between them. */
const LAYOUT_GRAPH = {
  name: "Raw water",
  slug: "raw-water",
  canvasW: 120,
  canvasH: 80,
  nodes: [
    { key: "pump_1", kind: "unit", symbol: "pump", label: "Pump 1", x: 0, y: 0, w: 20, h: 25, isSource: true },
    { key: "tank_1", kind: "unit", symbol: "tank", label: "Tank 1", x: 40, y: 0, w: 20, h: 25 },
  ],
  pipes: [{ fromKey: "pump_1", toKey: "tank_1" }],
  symbolLibraries: ["core"],
};

/** `F3.87` PR 6: an SVG the symbol parser takes — one circle on a 24 by 24 box. */
const SYMBOL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>';

/** One valid body and path per entry, and the name its summary must contain. */
export const FIXTURES: Readonly<
  Record<string, { body: Record<string, unknown>; params: Record<string, string>; names: string }>
> = {
  "dashboard.create": { body: { organizationId: ORG, slug: "main-tx", name: "Main TX" }, params: {}, names: "Main TX" },
  "dashboard.update": { body: { name: "Renamed" }, params: { id: ROW }, names: TARGET_NAME },
  "dashboard.widgets.replace": { body: { widgets: [] }, params: { id: ROW }, names: TARGET_NAME },
  "dashboardTemplate.create": {
    body: { organizationId: ORG, code: "tpl-1", name: "Feeder Template", section: "operations" },
    params: {},
    names: "Feeder Template",
  },
  "dashboardTemplate.update": { body: { name: "Renamed" }, params: { id: ROW }, names: TARGET_NAME },
  "dashboardTemplate.publish": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  "dashboardTemplate.archive": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  "dashboardTemplate.draft": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  "dashboardTemplate.instantiate": {
    body: { assetGroupId: null, slug: "from-tpl", name: "From Template" },
    params: { id: ROW },
    names: TARGET_NAME,
  },
  "dashboardTemplate.importStock": { body: { organizationId: ORG }, params: { code: "smoc-standard" }, names: ORG_NAME },
  "dashboardTemplate.applyToSites": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  "calcParameter.create": {
    body: { organizationId: ORG, key: "tariff_rate", value: 1.5, effectiveFrom: "2026-10-01T00:00:00+00:00" },
    params: {},
    names: "tariff_rate",
  },
  "calcParameter.update": { body: { value: 2 }, params: { id: ROW }, names: TARGET_NAME },
  "calcOverride.set": {
    body: { formula: null, formulaDialect: null, calcTrigger: null, calcIntervalSeconds: null, maxInputAgeSeconds: 60 },
    params: { assetId: ROW, pointKey: "kw_total" },
    names: TARGET_NAME,
  },
  "assetTemplate.update": {
    body: {
      points: [
        { pointKey: "kw", kind: "measured" },
        { pointKey: "kw_x2", kind: "derived", formula: "{kw} * 2", formulaDialect: "bms-calc-v1", calcTrigger: "streaming" },
      ],
      content: { kpis: [{ code: "kw_avg", name: "Average kW", pointKeys: ["kw"], expression: "{kw}", dialect: "bms-calc-v1" }] },
    },
    params: { id: ROW },
    names: TARGET_NAME,
  },
  "assetTemplate.publish": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  // `F4.254` PR 2: the four authoring entries. `points` defaults to `[]` on create.
  "assetTemplate.create": {
    body: { organizationId: ORG, code: "feeder-1", name: "Feeder Meter", assetType: "feeder", domain: "electrical", points: [] },
    params: {},
    names: "Feeder Meter",
  },
  "assetTemplate.archive": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  "assetTemplate.draft": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  "assetTemplate.importStock": { body: { organizationId: ORG }, params: { code: "feeder" }, names: ORG_NAME },
  // `F4.254` PR 3: the raw body the route parses (its `.transform` output is never stored or sent).
  "assetTemplate.instantiate": {
    body: { locationId: ROW, assets: [{ code: "P-1", name: "Pump 1" }] },
    params: { id: ROW },
    names: TARGET_NAME,
  },
  // `F3.86` PR 4: what the model proposes (`modelBodyOf`) — a create has no password.
  "user.create": {
    body: { email: "priya@example.test", displayName: "Priya Rao", role: "viewer", organizationId: ORG },
    params: {},
    names: "Priya Rao",
  },
  "user.update": { body: { displayName: "Renamed" }, params: { id: ROW }, names: TARGET_NAME },
  "user.deactivate": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  "user.reactivate": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  "userGrant.add": { body: { kind: "location", targetId: ROW }, params: { id: ROW }, names: TARGET_NAME },
  "userGrant.remove": { body: {}, params: { id: ROW, kind: "location", grantId: ROW }, names: TARGET_NAME },
  "location.controlRoomView.set": { body: { kind: "dashboard", dashboardId: ROW }, params: { id: ROW }, names: TARGET_NAME },
  "location.siteLayout.make": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  // `F3.86` PR 3c — asset groups and their members, and the point-key catalog (ruling Q1).
  "assetGroup.create": {
    body: { locationId: ROW, code: "WATER", name: "Water Plant", description: null, domain: "water" },
    params: {},
    names: "Water Plant",
  },
  "assetGroup.update": { body: { name: "Renamed", description: "x" }, params: { id: ROW }, names: TARGET_NAME },
  "assetGroup.member.add": { body: { assetId: ORG, role: "raw_water_pump" }, params: { id: ROW }, names: TARGET_NAME },
  "assetGroup.member.setRole": { body: { role: null }, params: { id: ROW }, names: TARGET_NAME },
  "assetGroup.member.remove": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  "pointKey.create": {
    body: { code: "kw_total", name: "Total kW", domain: "electrical", unit: "kW", headlineRank: null },
    params: {},
    names: "kw_total",
  },
  "pointKey.update": { body: { name: "Renamed", headlineRank: 3 }, params: { id: ROW }, names: TARGET_NAME },
  "pointKey.deactivate": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  "pointKey.reactivate": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  // `F3.86` PR 3a: locations and RTUs.
  "location.create": {
    body: { organizationId: ORG, code: "PUNE-1", slug: "pune-1", name: "Pune Works", type: "rsmoc", latitude: 18.5, longitude: 73.8 },
    params: {},
    names: "Pune Works",
  },
  "location.update": { body: { name: "Renamed", parentId: ROW }, params: { id: ROW }, names: TARGET_NAME },
  "location.deactivate": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  "location.reactivate": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  "rtu.create": {
    body: { locationId: ROW, code: "RTU-7", displayName: "Gateway Seven", sourceType: "mqtt", mqttTopic: "site/rtu7" },
    params: {},
    names: "Gateway Seven",
  },
  "rtu.update": { body: { displayName: "Renamed" }, params: { id: ROW }, names: TARGET_NAME },
  "rtu.deactivate": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  "rtu.reactivate": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  // `F3.86` PR 3b: assets and asset points.
  "asset.create": {
    body: { code: "PUMP-7", name: "Feed Pump Seven", siteName: "Pune Works", locationId: ROW, domain: "water" },
    params: {},
    names: "Feed Pump Seven",
  },
  "asset.update": { body: { name: "Renamed", locationId: ROW }, params: { id: ROW }, names: TARGET_NAME },
  "asset.deactivate": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  "asset.reactivate": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  "assetPoint.create": {
    body: { assetId: ROW, pointKey: "kw", sourceDataKey: "pump7_kw", scaleMultiplier: 0.1 },
    params: {},
    names: TARGET_NAME,
  },
  "assetPoint.update": { body: { unit: "kW", engMax: 500 }, params: { id: ROW }, names: TARGET_NAME },
  "assetPoint.deactivate": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  "assetPoint.reactivate": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  // `F3.86` PR 6 — the server-made onboarding commit (decision 7): the hash of the draft the turn stored.
  "onboarding.commit": { body: { draftHash: "a".repeat(64) }, params: { id: ROW }, names: TARGET_NAME },
  // `F3.24b` (ADR 0103) — the server-made discovery start, bound to the broker the card showed (H3).
  "onboarding.discovery": {
    body: { rtuCode: "R1", topicPrefix: "Airsprint-1051/Data", windowSeconds: 60, expected: { host: "broker.example.com", port: 8883 } },
    params: { id: ROW },
    names: TARGET_NAME,
  },
  // `F3.87` PR 5 — the canvas entries (owner ruling Q1): two units and one pipe; the replace at version 1.
  "mimicLayout.create": { body: { organizationId: ORG, ...LAYOUT_GRAPH }, params: {}, names: "Raw water" },
  "mimicLayout.replace": { body: { version: 1, ...LAYOUT_GRAPH }, params: { id: ROW }, names: TARGET_NAME },
  // `F3.87` PR 6 — the symbol libraries (Amendment 3 A3); the upload fixture is the model's body, the SVG as text.
  "mimicLibrary.setting": { body: { organizationId: ORG, enabled: false }, params: { libraryCode: "lucide" }, names: ORG_NAME },
  "mimicLibrary.create": {
    body: { organizationId: ORG, code: "plant", label: "Plant Symbols", style: "stroke", licence: "MIT" },
    params: {},
    names: "Plant Symbols",
  },
  "mimicLibrary.update": { body: { active: false }, params: { id: ROW }, names: TARGET_NAME },
  "mimicSymbol.update": { body: { group: "water" }, params: { id: ROW, symbolId: ORG }, names: TARGET_NAME },
  "mimicSymbol.upload": { body: { name: "pump-x", label: "Pump X", svg: { kind: "text", text: SYMBOL_SVG } }, params: { id: ROW }, names: TARGET_NAME },
  // `F3.87` PR 6 — the unit-role vocabulary, for the global admin (Amendment 3 A1, A6; ruling Q4).
  "assetRole.create": { body: { code: "pump-x", label: "Pump X" }, params: {}, names: "pump-x" },
  "assetRole.update": { body: { label: "Renamed" }, params: { code: "cooling-tower" }, names: TARGET_NAME },
  "assetRole.deactivate": { body: { active: false }, params: { code: "cooling-tower" }, names: TARGET_NAME },
  "assetRole.reactivate": { body: { active: true }, params: { code: "cooling-tower" }, names: TARGET_NAME },
  "locationType.create": { body: { code: "pump_station_x", label: "Pump station X", sortOrder: 40 }, params: {}, names: "pump_station_x" },
  "locationType.update": { body: { label: "Renamed" }, params: { code: "pump_station" }, names: TARGET_NAME },
  "locationType.deactivate": { body: {}, params: { code: "pump_station" }, names: TARGET_NAME },
  "locationType.reactivate": { body: {}, params: { code: "pump_station" }, names: TARGET_NAME },
  // `F4.278` (Amendment 8) — the alarm rules; a threshold create on an asset, the rest on one rule row.
  "rule.create": {
    body: {
      name: "Chiller high",
      ruleType: "threshold",
      assetId: ROW,
      pointKey: "supply_temp_c",
      operator: "gt",
      thresholdValue: 3,
      condition: { window: "latest" },
      action: { type: "notify", target: "Operations" },
    },
    params: {},
    names: "Chiller high",
  },
  "rule.update": { body: { thresholdValue: 4 }, params: { id: ROW }, names: TARGET_NAME },
  "rule.duplicate": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  "rule.publish": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  "rule.enable": { body: { enabled: true }, params: { id: ROW }, names: TARGET_NAME },
  "rule.disable": { body: { enabled: false }, params: { id: ROW }, names: TARGET_NAME },
  "rule.archive": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  // `F4.279` (Amendment 8) — notifications and escalation; no fixture holds a secret or a URL (Q11, Q12).
  "notificationChannel.create": {
    body: { organizationId: ORG, code: "ops", name: "Ops", kind: "email", config: { to: ["a@example.test"] } },
    params: {},
    names: "Ops",
  },
  "notificationChannel.update": { body: { name: "Ops desk" }, params: { id: ROW }, names: TARGET_NAME },
  "notificationChannel.deactivate": { body: { enabled: false }, params: { id: ROW }, names: TARGET_NAME },
  "notificationChannel.reactivate": { body: { enabled: true }, params: { id: ROW }, names: TARGET_NAME },
  "notificationChannel.test": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  "escalationProfile.create": { body: { organizationId: ORG, code: "p1", name: "P1" }, params: {}, names: "P1" },
  "escalationProfile.update": { body: { name: "P1 renamed" }, params: { id: ROW }, names: TARGET_NAME },
  "escalationDefaults.set": {
    body: { organizationId: ORG, items: [{ severity: "critical", profileId: ROW }] },
    params: {},
    names: ORG_NAME,
  },
  "escalationDefaults.clear": { body: { organizationId: ORG, items: [] }, params: {}, names: ORG_NAME },
  "rule.notifications.set": { body: { channelIds: [ROW] }, params: { id: ROW }, names: TARGET_NAME },
};

/**
 * `F3.86` PR 6 (plan §8.2, decision 7): the onboarding commit is made by the
 * server, never proposed by the model; its target is the session, and the
 * summary helpers count what the draft creates.
 */
export function theOnboardingCommitIsAServerEntry(): void {
  const entry = catalogEntry("onboarding.commit");
  if (!entry) throw new Error("onboarding.commit");
  expect({
    method: entry.method,
    path: entry.path,
    proposer: entry.proposer,
    risk: entry.risk,
    target: entry.target,
    bodyName: entry.bodyName,
    steps: entry.steps,
  }).toEqual({
    method: "POST",
    path: "/admin/onboarding/sessions/:id/commit",
    proposer: "server",
    risk: "create",
    target: { kind: "onboardingSession", param: "id" },
    bodyName: "commitOnboardingBodySchema",
    steps: [{ id: "draft", title: "Draft", fields: ["draftHash"] }],
  });
  expect(EXCLUDED_ROUTES.some((route) => route.path === entry.path)).toBe(false);
  expect(EXCLUDED_ROUTES.some((route) => route.path === "/admin/onboarding/sessions/:id/draft")).toBe(true);
  expect(onboardingCommitCounts({ rtus: [1], assets: [1, 2], assetPoints: [] })).toBe(
    "It creates 1 RTU, 2 assets and 0 mappings.",
  );
  expect(onboardingCommitSiteName({ location: { name: "Plant 4" } })).toBe("Plant 4");
  expect(onboardingCommitSiteName({})).toBe("(no name yet)");
}

const summaryOf = (entry: CatalogEntry) => {
  const fixture = FIXTURES[entry.id];
  if (!fixture) throw new Error(`no fixture for ${entry.id}`);
  return entry.summary({ body: fixture.body, params: fixture.params, targetName: TARGET_NAME, organizationName: ORG_NAME });
};

export function everyEntryHasAFixtureAndOnlyThose(): void {
  expect(Object.keys(FIXTURES).sort()).toEqual(COPILOT_CATALOG.map((entry) => entry.id).sort());
}

/** The body is the very export the controller parses (decision 2: "the body is the controller's schema"). */
export function everyBodyIsTheSharedExportByIdentity(): void {
  const exports = contracts as unknown as Record<string, unknown>;
  for (const entry of COPILOT_CATALOG) {
    if (entry.bodyName === null) {
      expect(entry.body, entry.id).toBe(emptyBody);
    } else {
      expect(exports[entry.bodyName], entry.id).toBeDefined();
      expect(entry.body, entry.id).toBe(exports[entry.bodyName]);
    }
  }
}

export function aBodylessEntryTakesOnlyTheEmptyObject(): void {
  expect(emptyBody.safeParse({}).success).toBe(true);
  expect(emptyBody.safeParse({ x: 1 }).success).toBe(false);
}

export function everyFixtureBodyAndPathParses(): void {
  for (const entry of COPILOT_CATALOG) {
    const fixture = FIXTURES[entry.id];
    if (!fixture) throw new Error(entry.id);
    // The body the model proposes (`F3.86` PR 2): an entry's `clientOnly` fields are not in it.
    const parsed = modelBodyOf(entry).safeParse(fixture.body);
    expect(parsed.success, `${entry.id}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`).toBe(true);
    for (const [name, schema] of Object.entries(entry.params)) {
      expect((schema as ZodTypeAny).safeParse(fixture.params[name]).success, `${entry.id} :${name}`).toBe(true);
    }
  }
}

export function everySummaryNamesItsTarget(): void {
  for (const entry of COPILOT_CATALOG) {
    expect(summaryOf(entry), entry.id).toContain(FIXTURES[entry.id]?.names);
  }
}

export function idsAndToolNamesAreUniqueAndProviderSafe(): void {
  const ids = COPILOT_CATALOG.map((entry) => entry.id);
  expect(new Set(ids).size).toBe(ids.length);
  const names = COPILOT_CATALOG.map(proposeToolName);
  expect(new Set(names).size).toBe(names.length);
  for (const name of names) expect(name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  expect(catalogEntry("dashboard.create")?.id).toBe("dashboard.create");
  expect(catalogEntry("dashboard.delete")).toBeUndefined();
}

/** The `DELETE` entries whose route is not on {@link DELETE_ALLOWANCE}. */
function deletesOutsideTheAllowance(entries: readonly Pick<CatalogEntry, "id" | "method" | "path">[]): string[] {
  return entries
    .filter((entry) => entry.method === "DELETE")
    .filter((entry) => !DELETE_ALLOWANCE.some((allowed) => allowed.path === entry.path))
    .map((entry) => entry.id);
}

/**
 * Decision 3, ruling 19 (`F3.86` PR 2): the allowance names exactly the two
 * removals; no `DELETE` entry is outside it. PR 3c adds the member removal;
 * PR 4 adds `userGrant.remove` beside it.
 */
export function theOnlyDeleteEntriesAreTheTwoRemovals(): void {
  expect(DELETE_ALLOWANCE.map((route) => route.path).sort()).toEqual([
    "/admin/asset-group-members/:id",
    "/admin/users/:id/grants/:kind/:grantId",
  ]);
  expect(deletesOutsideTheAllowance(COPILOT_CATALOG)).toEqual([]);
  // PR 4 adds the grant revoke; PR 3c adds the member removal.
  expect(COPILOT_CATALOG.filter((entry) => entry.method === "DELETE").map((entry) => entry.id).sort()).toEqual([
    "assetGroup.member.remove",
    "userGrant.remove",
  ]);
}

/** Decision 3, ruling 19 (`F3.86` PR 3c): a removal is red on the card — its risk is `deactivate` — and takes no body. */
export function theMemberRemovalIsARedBodylessDelete(): void {
  const entry = catalogEntry("assetGroup.member.remove");
  if (!entry) throw new Error("assetGroup.member.remove");
  expect({ method: entry.method, path: entry.path, risk: entry.risk, bodyName: entry.bodyName, steps: entry.steps }).toEqual({
    method: "DELETE",
    path: "/admin/asset-group-members/:id",
    risk: "deactivate",
    bodyName: null,
    steps: [],
  });
}

/** Ruling Q1 (`F3.86` PR 3c): a point-key write lives in the bound organization — a `fleet` create, a `pointKey` row. */
export function thePointKeyEntriesAreFleetTargets(): void {
  const targets = ["pointKey.create", "pointKey.update", "pointKey.deactivate", "pointKey.reactivate"].map(
    (id) => catalogEntry(id)?.target,
  );
  expect(targets).toEqual([
    { kind: "fleet" },
    { kind: "pointKey", param: "id" },
    { kind: "pointKey", param: "id" },
    { kind: "pointKey", param: "id" },
  ]);
}

/** The rule is not vacuous: an allowed removal passes it and any other `DELETE` does not. */
export function aDeleteOutsideTheAllowanceIsRefused(): void {
  expect(deletesOutsideTheAllowance([{ id: "userGrant.remove", method: "DELETE", path: "/admin/users/:id/grants/:kind/:grantId" }])).toEqual([]);
  expect(deletesOutsideTheAllowance([{ id: "assetGroup.member.remove", method: "DELETE", path: "/admin/asset-group-members/:id" }])).toEqual([]);
  expect(deletesOutsideTheAllowance([{ id: "dashboard.delete", method: "DELETE", path: "/dashboards/:id" }])).toEqual(["dashboard.delete"]);
}

/** A `clientOnly` fixture: a refined body (`ZodEffects`), which `.omit` cannot narrow, and the `modelBody` it needs. */
const PASSWORD_OBJECT = z.object({ email: z.string().email(), temporaryPassword: z.string().min(12) }).strict();
const PASSWORD_BODY = PASSWORD_OBJECT.superRefine(() => undefined);
const PASSWORD_MODEL_BODY = z.object({ email: z.string().email() }).strict();
const passwordEntry = (modelBody: ZodTypeAny | undefined) => ({
  id: "fixture.user.create",
  body: PASSWORD_BODY,
  clientOnly: ["temporaryPassword"] as const,
  ...(modelBody ? { modelBody } : {}),
});

/**
 * Every `modelBody` is strict and holds exactly the body's fields without the
 * `clientOnly` ones — plus `svg` for an `upload` entry (`F3.87` PR 2,
 * Amendment 3 A3: the model sends the file as text), and never `svg` for any
 * other entry. An `upload` entry must have a `modelBody`.
 */
/** `F4.282` (D3): the fields a `fixedBody` entry on the same route sets — the direction entries', not the model's or a step's. */
function directionOwnedFields(id: string): string[] {
  const self = COPILOT_CATALOG.find((candidate) => candidate.id === id);
  if (self === undefined) return [];
  return COPILOT_CATALOG.filter((c) => c.fixedBody && c.method === self.method && c.path === self.path).flatMap((c) =>
    Object.keys(c.fixedBody ?? {}),
  );
}

function modelBodyProblems(entry: Pick<CatalogEntry, "id" | "body" | "clientOnly" | "modelBody" | "upload">): string[] {
  if (entry.modelBody === undefined) return entry.upload ? [`${entry.id}: an upload entry needs a modelBody`] : [];
  const problems: string[] = [];
  let object: ZodTypeAny = entry.modelBody;
  while (object instanceof z.ZodEffects) object = object._def.schema as ZodTypeAny;
  if ((object as z.AnyZodObject)._def.unknownKeys !== "strict") problems.push(`${entry.id}: modelBody is not strict`);
  const owned = directionOwnedFields(entry.id);
  const fields = bodyFieldsOf(entry.body).filter((field) => !entry.clientOnly.includes(field) && !owned.includes(field));
  const expected = (entry.upload ? [...fields, "svg"] : fields).sort();
  if (JSON.stringify(bodyFieldsOf(entry.modelBody).sort()) !== JSON.stringify(expected)) {
    problems.push(`${entry.id}: modelBody fields differ from the body's without clientOnly`);
  }
  return problems;
}

/** `F3.87` PR 2: an upload fixture — the multipart text fields, and the model's body that adds the file as `svg`. */
const UPLOAD_FIELDS = z.object({ name: z.string(), label: z.string() }).strict();
const UPLOAD_MODEL_BODY = z.object({ name: z.string(), label: z.string(), svg: z.string() }).strict();
const UPLOAD_DESCRIPTOR = { fileField: "file", contentType: "image/svg+xml", maxBytes: 65_536 } as const;
const uploadEntry = (modelBody: ZodTypeAny | undefined, upload: typeof UPLOAD_DESCRIPTOR | undefined) => ({
  id: "fixture.symbol.upload",
  body: UPLOAD_FIELDS,
  clientOnly: [] as const,
  ...(modelBody ? { modelBody } : {}),
  ...(upload ? { upload } : {}),
});

/** `F3.87` PR 2: the upload `modelBody` rule — the body's fields plus `svg`, strict; and only for an upload entry. */
export function anUploadModelBodyAddsTheSvgAndOnlyThere(): void {
  expect(modelBodyProblems(uploadEntry(UPLOAD_MODEL_BODY, UPLOAD_DESCRIPTOR))).toEqual([]);
  expect(modelBodyProblems(uploadEntry(UPLOAD_FIELDS, UPLOAD_DESCRIPTOR))).toEqual([
    "fixture.symbol.upload: modelBody fields differ from the body's without clientOnly",
  ]);
  expect(modelBodyProblems(uploadEntry(UPLOAD_MODEL_BODY, undefined))).toEqual([
    "fixture.symbol.upload: modelBody fields differ from the body's without clientOnly",
  ]);
  expect(modelBodyProblems(uploadEntry(undefined, UPLOAD_DESCRIPTOR))).toEqual(["fixture.symbol.upload: an upload entry needs a modelBody"]);
}

const COPILOT_ROLES: readonly string[] = ["admin", "organization_admin", "location_admin", "asset_group_admin"];

/** `F3.87` PR 2: an `upload` entry is a `POST` with a `modelBody`; `offeredTo` names one or more copilot roles only. */
function releaseThreeFieldProblems(entry: Pick<CatalogEntry, "id" | "method" | "modelBody" | "upload" | "offeredTo">): string[] {
  const problems: string[] = [];
  if (entry.upload && entry.method !== "POST") problems.push(`${entry.id}: an upload entry is not a POST`);
  if (entry.upload && entry.modelBody === undefined) problems.push(`${entry.id}: an upload entry has no modelBody`);
  if (entry.offeredTo && entry.offeredTo.length === 0) problems.push(`${entry.id}: offeredTo is empty`);
  for (const role of entry.offeredTo ?? []) if (!COPILOT_ROLES.includes(role)) problems.push(`${entry.id}: offeredTo names ${role}`);
  return problems;
}

export function theReleaseThreeEntryFieldsAreWellFormed(): void {
  for (const entry of COPILOT_CATALOG) expect(releaseThreeFieldProblems(entry), entry.id).toEqual([]);
}

/** The rule is not vacuous: an upload on a PATCH, an upload with no modelBody, an empty or non-copilot `offeredTo`. */
export function aMalformedReleaseThreeEntryIsRefused(): void {
  const upload = UPLOAD_DESCRIPTOR;
  expect(releaseThreeFieldProblems({ id: "f.a", method: "PATCH", modelBody: UPLOAD_MODEL_BODY, upload })).toEqual([
    "f.a: an upload entry is not a POST",
  ]);
  expect(releaseThreeFieldProblems({ id: "f.b", method: "POST", upload })).toEqual(["f.b: an upload entry has no modelBody"]);
  expect(releaseThreeFieldProblems({ id: "f.c", method: "POST", offeredTo: [] })).toEqual(["f.c: offeredTo is empty"]);
  expect(releaseThreeFieldProblems({ id: "f.d", method: "POST", offeredTo: ["admin", "viewer"] })).toEqual([
    "f.d: offeredTo names viewer",
  ]);
  expect(releaseThreeFieldProblems({ id: "f.e", method: "POST", modelBody: UPLOAD_MODEL_BODY, upload, offeredTo: ["admin"] })).toEqual([]);
}

/** `F3.87` PR 2: a `cardOnly` key is never a body field nor a model-body field, and no fixture body holds one. */
function cardOnlyProblems(
  entry: Pick<CatalogEntry, "id" | "body" | "clientOnly" | "modelBody" | "cardOnly">,
  fixtureBody: Record<string, unknown> | undefined,
): string[] {
  const problems: string[] = [];
  for (const key of entry.cardOnly ?? []) {
    if (bodyFieldsOf(entry.body).includes(key)) problems.push(`${entry.id}: cardOnly ${key} is a body field`);
    else if (bodyFieldsOf(modelBodyOf(entry)).includes(key)) problems.push(`${entry.id}: cardOnly ${key} is a model-body field`);
    if (fixtureBody && Object.prototype.hasOwnProperty.call(fixtureBody, key)) problems.push(`${entry.id}: a fixture holds ${key}`);
  }
  return problems;
}

export function noCardOnlyKeyIsABodyField(): void {
  for (const entry of COPILOT_CATALOG) expect(cardOnlyProblems(entry, FIXTURES[entry.id]?.body), entry.id).toEqual([]);
}

/** The rule is not vacuous: a `cardOnly` key that is a body field, one in the model body, one in a fixture body. */
export function aCardOnlyKeyInTheBodyIsRefused(): void {
  const body = z.object({ name: z.string(), baseline: z.string() }).strict();
  expect(cardOnlyProblems({ id: "f.a", body, clientOnly: [], cardOnly: ["baseline"] }, undefined)).toEqual([
    "f.a: cardOnly baseline is a body field",
  ]);
  const modelBody = z.object({ name: z.string(), svgText: z.string() }).strict();
  expect(
    cardOnlyProblems({ id: "f.b", body: z.object({ name: z.string() }).strict(), clientOnly: [], modelBody, cardOnly: ["svgText"] }, undefined),
  ).toEqual(["f.b: cardOnly svgText is a model-body field"]);
  expect(
    cardOnlyProblems({ id: "f.c", body: z.object({ name: z.string() }).strict(), clientOnly: [], cardOnly: ["baseline"] }, { baseline: {} }),
  ).toEqual(["f.c: a fixture holds baseline"]);
  expect(cardOnlyProblems({ id: "f.d", body: z.object({ name: z.string() }).strict(), clientOnly: [], cardOnly: ["baseline"] }, { name: "x" })).toEqual(
    [],
  );
}

/** `F3.87` PR 2: the hash leaves out `clientOnly` and `cardOnly`; an unknown entry leaves out nothing. */
export function theHashLeavesOutClientOnlyAndCardOnlyKeys(): void {
  for (const entry of COPILOT_CATALOG) {
    expect([...hashExcludedKeysFor(entry.id)].sort(), entry.id).toEqual([...entry.clientOnly, ...(entry.cardOnly ?? [])].sort());
  }
  expect(hashExcludedKeysFor("no.such.entry")).toEqual([]);
}

/**
 * `F3.86` PR 2: the model never sees a `clientOnly` field — for every entry,
 * and for the fixture whose refined body needs a `modelBody`.
 */
export function noClientOnlyFieldReachesTheModelBody(): void {
  for (const entry of COPILOT_CATALOG) {
    expect(modelBodyProblems(entry), entry.id).toEqual([]);
    const fields = bodyFieldsOf(modelBodyOf(entry));
    for (const field of entry.clientOnly) expect(fields, entry.id).not.toContain(field);
    // A clientOnly key the model sends anyway must fail the parse (security review L1).
    if (entry.clientOnly.length > 0) {
      let object: ZodTypeAny = modelBodyOf(entry);
      while (object instanceof z.ZodEffects) object = object._def.schema as ZodTypeAny;
      expect((object as z.AnyZodObject)._def.unknownKeys, entry.id).toBe("strict");
    }
  }
  const fixture = passwordEntry(PASSWORD_MODEL_BODY);
  expect(modelBodyProblems(fixture)).toEqual([]);
  expect(bodyFieldsOf(modelBodyOf(fixture))).toEqual(["email"]);
  expect(modelBodyOf(fixture).safeParse({ email: "a@b.co", temporaryPassword: "x".repeat(12) }).success).toBe(false);
}

/** The `modelBody` rule is not vacuous: a `modelBody` that keeps the password is refused. */
export function aModelBodyThatKeepsAClientOnlyFieldIsRefused(): void {
  expect(modelBodyProblems(passwordEntry(PASSWORD_OBJECT))).toEqual([
    "fixture.user.create: modelBody fields differ from the body's without clientOnly",
  ]);
  expect(modelBodyProblems(passwordEntry(PASSWORD_MODEL_BODY.passthrough()))).toEqual(["fixture.user.create: modelBody is not strict"]);
}

/** Without a `modelBody`, a plain object body loses its `clientOnly` fields, and a refined one is a load error. */
export function modelBodyOfOmitsOrRefuses(): void {
  const plain = { id: "fixture.plain", body: PASSWORD_OBJECT, clientOnly: ["temporaryPassword"] as const };
  expect(bodyFieldsOf(modelBodyOf(plain))).toEqual(["email"]);
  // A body in strip mode still gives a strict model body: the key is refused, not stripped and stored.
  const stripping = { id: "fixture.strip", body: PASSWORD_OBJECT.strip(), clientOnly: ["temporaryPassword"] as const };
  expect(modelBodyOf(stripping).safeParse({ email: "a@b.co", temporaryPassword: "x".repeat(12) }).success).toBe(false);
  expect(modelBodyOf(stripping).safeParse({ email: "a@b.co" }).success).toBe(true);
  expect(() => modelBodyOf(passwordEntry(undefined))).toThrow(/needs a modelBody/);
  const none = catalogEntry("dashboard.create");
  if (!none) throw new Error("dashboard.create");
  expect(modelBodyOf(none)).toBe(none.body);
}

export function pathParamsAndTheirSchemasAgree(): void {
  for (const entry of COPILOT_CATALOG) {
    expect(Object.keys(entry.params).sort(), entry.id).toEqual(pathParamsOf(entry.path).sort());
    // A target named by a path parameter (not a create's organization, parent or fleet row) names one of the route's.
    if ("param" in entry.target) {
      expect(Object.keys(entry.params), entry.id).toContain(entry.target.param);
    }
  }
}

/**
 * Ruling Q6: each body field is in exactly one step, and no step names a
 * field the body lacks. `F3.87` owner ruling Q1: a canvas entry
 * (`CANVAS_ENTRY_IDS`, the layout editor) has no steps at all.
 */
export function stepProblems(entry: Pick<CatalogEntry, "id" | "body" | "clientOnly" | "steps" | "fixedBody">): string[] {
  const inSteps = entry.steps.flatMap((step) => step.fields);
  if (entry.fixedBody !== undefined) return entry.steps.length === 0 ? [] : [`${entry.id}: a fixed-body entry has steps`];
  if ((CANVAS_ENTRY_IDS as readonly string[]).includes(entry.id)) {
    return inSteps.length === 0 && entry.steps.length === 0 ? [] : [`${entry.id}: a canvas entry has steps`];
  }
  const problems: string[] = [];
  if (new Set(inSteps).size !== inSteps.length) problems.push(`${entry.id}: a field in two steps`);
  const owned = directionOwnedFields(entry.id);
  const fields = bodyFieldsOf(entry.body).filter((field) => !entry.clientOnly.includes(field) && !owned.includes(field));
  if (JSON.stringify([...inSteps].sort()) !== JSON.stringify([...fields].sort())) problems.push(`${entry.id}: steps differ from the body's fields`);
  if (entry.clientOnly.some((field) => inSteps.includes(field))) problems.push(`${entry.id}: a clientOnly field in a step`);
  return problems;
}

export function everyBodyFieldIsInExactlyOneStep(): void {
  for (const entry of COPILOT_CATALOG) expect(stepProblems(entry), entry.id).toEqual([]);
}

/** `F3.87` ruling Q1: the canvas exemption is exact — a canvas id with a step fails, and a stepper entry missing a field still fails. */
export function theCanvasExemptionIsExact(): void {
  const body = z.object({ name: z.string(), nodes: z.array(z.string()) }).strict();
  const step = { id: "name", title: "Name", fields: ["name"] };
  expect(stepProblems({ id: "mimicLayout.create", body, clientOnly: [], steps: [] })).toEqual([]);
  expect(stepProblems({ id: "mimicLayout.replace", body, clientOnly: [], steps: [step] })).toEqual(["mimicLayout.replace: a canvas entry has steps"]);
  expect(stepProblems({ id: "fixture.stepper", body, clientOnly: [], steps: [step] })).toEqual(["fixture.stepper: steps differ from the body's fields"]);
}

/** Through refinements, optionals, defaults and a pipeline's output, to the schema that holds the value. */
function unwrapValue(schema: ZodTypeAny): ZodTypeAny {
  let current = schema;
  for (;;) {
    if (current instanceof z.ZodEffects) current = current._def.schema as ZodTypeAny;
    else if (current instanceof z.ZodOptional || current instanceof z.ZodNullable || current instanceof z.ZodDefault) {
      current = current._def.innerType as ZodTypeAny;
    } else if (current instanceof z.ZodPipeline) current = current._def.out as ZodTypeAny;
    else return current;
  }
}

/** The schema at a catalog formula path (`content.kpis[].expression`), or `undefined` when the body has no such field. */
export function schemaAtPath(schema: ZodTypeAny, path: string): ZodTypeAny | undefined {
  let current: ZodTypeAny = schema;
  for (const segment of path.split(".")) {
    const many = segment.endsWith("[]");
    const key = many ? segment.slice(0, -2) : segment;
    const object = unwrapValue(current);
    if (!(object instanceof z.ZodObject)) return undefined;
    const next = (object.shape as Record<string, ZodTypeAny>)[key];
    if (next === undefined) return undefined;
    current = next;
    if (many) {
      const array = unwrapValue(current);
      if (!(array instanceof z.ZodArray)) return undefined;
      current = array.element as ZodTypeAny;
    }
  }
  return current;
}

export function refsAndFormulasNameBodyFields(): void {
  for (const entry of COPILOT_CATALOG) {
    const fields = bodyFieldsOf(entry.body);
    for (const ref of entry.refs) expect(fields, `${entry.id} ref`).toContain(ref.field);
    for (const formula of entry.formulas) {
      for (const path of [formula.field, formula.dialectField, formula.refsField]) {
        if (path === undefined) continue;
        expect(schemaAtPath(entry.body, path), `${entry.id} ${path}`).toBeDefined();
      }
    }
  }
}

/** The path check is not vacuous: a misspelled leaf and a non-array segment resolve to nothing; the real path resolves. */
export function aFormulaPathTheBodyLacksResolvesToNothing(): void {
  const body = catalogEntry("assetTemplate.update")?.body;
  if (!body) throw new Error("assetTemplate.update");
  expect(schemaAtPath(body, "content.kpis[].expression")).toBeDefined();
  expect(schemaAtPath(body, "content.kpis[].expresion")).toBeUndefined();
  expect(schemaAtPath(body, "name[].expression")).toBeUndefined();
}

const KPI_FORMULA: CatalogFormula = {
  field: "content.kpis[].expression",
  dialectField: "content.kpis[].dialect",
  refsField: "points[].pointKey",
};
const KPI_BODY = {
  points: [{ pointKey: "kw" }, { pointKey: "kva" }],
  content: {
    kpis: [
      { expression: "{kw}", dialect: "bms-calc-v1" },
      { expression: "{kva}", dialect: "unvalidated" },
    ],
  },
};

/** An array path names one site per item, each with the dialect from the same item. */
export function aFormulaPathNamesOneSitePerItem(): void {
  expect(formulaSitesOf(KPI_BODY, KPI_FORMULA)).toEqual([
    { path: "content.kpis.0.expression", expression: "{kw}", dialect: "bms-calc-v1" },
    { path: "content.kpis.1.expression", expression: "{kva}", dialect: "unvalidated" },
  ]);
}

/** A refs path collects every name at it across the body. */
export function aRefsPathCollectsEveryName(): void {
  expect(formulaRefsOf(KPI_BODY, KPI_FORMULA)).toEqual(["kw", "kva"]);
}

/** A body that does not carry the formula path has no site. */
export function aBodyWithoutTheFormulaPathHasNoSite(): void {
  expect(formulaSitesOf({ name: "x" }, KPI_FORMULA)).toEqual([]);
}

/** A body that does not carry the refs path answers `null`: the target's names apply. */
export function aBodyWithoutTheRefsPathHasNoRefs(): void {
  expect(formulaRefsOf({ name: "x" }, KPI_FORMULA)).toBeNull();
}

const TOP_LEVEL_FORMULA: CatalogFormula = { field: "formula", dialectField: "formulaDialect" };

/** A top-level formula is one site at its own key. */
export function aTopLevelFormulaIsOneSite(): void {
  expect(formulaSitesOf({ formula: "{kw}", formulaDialect: "bms-calc-v2" }, TOP_LEVEL_FORMULA)).toEqual([
    { path: "formula", expression: "{kw}", dialect: "bms-calc-v2" },
  ]);
}

/** A formula with no refs path takes the target's names (`null`). */
export function aFormulaWithoutARefsPathHasNoRefs(): void {
  expect(formulaRefsOf({ formula: "{kw}" }, TOP_LEVEL_FORMULA)).toBeNull();
}

/** A dialect outside the formula's own item is a catalog error, not a silent mismatch. */
export function aDialectOutsideTheFormulasItemIsAnError(): void {
  expect(() => formulaSitesOf(KPI_BODY, { field: "content.kpis[].expression", dialectField: "dialect" })).toThrow(/same item/);
}

export function noRouteIsBothAnEntryAndExcluded(): void {
  const keys = EXCLUDED_ROUTES.map((route) => `${route.method} ${route.path}`);
  expect(new Set(keys).size).toBe(keys.length);
  for (const entry of COPILOT_CATALOG) expect(keys).not.toContain(`${entry.method} ${entry.path}`);
}

/** `objectShapeOf` unwraps a refinement and splits a union; anything else is a load error. */
export function objectShapeUnwrapsEffectsAndUnions(): void {
  expect(Object.keys(objectShapeOf(contracts.createDashboardBodySchema)[0] ?? {})).toContain("slug");
  expect(objectShapeOf(contracts.instantiateSectionTemplateBodySchema)).toHaveLength(2);
  expect(() => objectShapeOf(z.string())).toThrow(/must be an object/);
}

export function aStepSchemaIsPartialAndStrict(): void {
  const basics = stepValuesSchema(contracts.createDashboardBodySchema, ["name", "slug"]);
  expect(basics.safeParse({ name: "A" }).success).toBe(true);
  expect(basics.safeParse({ name: "" }).success).toBe(false);
  expect(basics.safeParse({ name: "A", organizationId: ORG }).success).toBe(false);
  expect(() => stepValuesSchema(contracts.createDashboardBodySchema, ["nope"])).toThrow(/not a body field/);
}

/** The stored path is the raw path a browser sends: `fetch` must not re-encode it, or the interceptor's compare fails. */
export function aStoredPathSurvivesTheBrowserUnchanged(): void {
  const entry = catalogEntry("calcOverride.set");
  if (!entry) throw new Error("calcOverride.set");
  const path = catalogPath(entry, { assetId: ROW, pointKey: "kw total%/x'(y)" });
  expect(path).toBe(`/api/v1/admin/assets/${ROW}/calc-points/kw%20total%25%2Fx'(y)`);
  expect(new URL(path, "http://api.local").pathname).toBe(path);
  expect(() => catalogPath(entry, { assetId: ROW })).toThrow(/pointKey/);
  // The inverse: the card reads the parameters back from the stored path.
  expect(catalogParamsOf(entry, path)).toEqual({ assetId: ROW, pointKey: "kw total%/x'(y)" });
  expect(catalogParamsOf(entry, `/api/v1/admin/assets/${ROW}/calc-points`)).toBeNull();
  expect(catalogParamsOf(entry, `/api/v1/admin/assets/${ROW}/calc-points/%E0%A4%A`)).toBeNull();
}

/**
 * Every body object is `.strict()`: the stored body is the one the model sent,
 * so a key the schema does not name must fail the parse rather than be
 * stripped and still stored (the `clientOnly` rule depends on it).
 */
export function everyBodyObjectIsStrict(): void {
  for (const entry of COPILOT_CATALOG) {
    let current: ZodTypeAny = entry.body;
    while (current instanceof z.ZodEffects) current = current._def.schema as ZodTypeAny;
    const members = current instanceof z.ZodUnion ? (current.options as ZodTypeAny[]) : [current];
    for (const member of members) {
      let object: ZodTypeAny = member;
      while (object instanceof z.ZodEffects) object = object._def.schema as ZodTypeAny;
      expect((object as z.AnyZodObject)._def.unknownKeys, entry.id).toBe("strict");
    }
  }
}

/** A dot segment is refused as a point key: the browser would resolve it away. */
export function aDotSegmentIsNotAPointKey(): void {
  const params = catalogEntry("calcOverride.set")?.params ?? {};
  for (const bad of [".", ".."]) expect((params.pointKey as ZodTypeAny).safeParse(bad).success, bad).toBe(false);
  expect((params.pointKey as ZodTypeAny).safeParse("kw.total").success).toBe(true);
}

/** Decision 4.9: a widget save says how many current widgets it removes. */
export function theWidgetSummaryCountsRemovedWidgets(): void {
  const entry = catalogEntry("dashboard.widgets.replace");
  if (!entry) throw new Error("dashboard.widgets.replace");
  const summary = entry.summary({
    body: { widgets: [{ id: "keep" }, { widgetType: "chart" }] },
    params: { id: ROW },
    targetName: "Main",
    organizationName: ORG_NAME,
    currentWidgetIds: ["keep", "gone-1", "gone-2"],
  });
  expect(summary).toContain("with 2 widgets");
  expect(summary).toContain("2 current widgets are removed");
}

/** `F3.86` PR 4: the grant summaries name the grant target when the server resolved it, and the id otherwise. */
export function aGrantSummaryNamesItsTarget(): void {
  const add = catalogEntry("userGrant.add");
  const remove = catalogEntry("userGrant.remove");
  if (!add || !remove) throw new Error("userGrant entries");
  const base = { targetName: "Priya Rao", organizationName: ORG_NAME };
  expect(add.summary({ ...base, body: { kind: "location", targetId: ROW }, params: { id: ROW }, refName: "RSMOC-WC" })).toBe(
    'Grant "Priya Rao" access to the site "RSMOC-WC".',
  );
  expect(remove.summary({ ...base, body: {}, params: { id: ROW, kind: "asset_group", grantId: ROW }, refName: "LV boards" })).toBe(
    'Revoke the access of "Priya Rao" to the asset group "LV boards".',
  );
  expect(add.summary({ ...base, body: { kind: "organization", targetId: ROW }, params: { id: ROW } })).toContain(ROW);
}

/**
 * `F3.87` PR 5 (ADR 0099 Amendment 3 A1, A2, owner rulings Q1 and Q5) — the
 * two layout entries: canvas entries with no steps, for the authoring roles
 * only, and a replace whose card-only `baseline` is left out of the hash.
 */
export function theLayoutEntriesAreCanvasEntriesForTheAuthors(): void {
  for (const id of CANVAS_ENTRY_IDS) {
    const entry = catalogEntry(id);
    if (!entry) throw new Error(id);
    expect(entry.steps, id).toEqual([]);
    expect(entry.offeredTo, id).toEqual(["admin", "organization_admin"]);
    expect(EXCLUDED_ROUTES.some((route) => route.path === entry.path && route.method === entry.method), id).toBe(false);
  }
  expect(catalogEntry("mimicLayout.create")?.target).toEqual({ kind: "organization", manage: "mimic" });
  expect(catalogEntry("mimicLayout.replace")?.target).toEqual({ kind: "mimicLayout", param: "id" });
  expect(catalogEntry("mimicLayout.create")?.cardOnly).toBeUndefined();
  expect(hashExcludedKeysFor("mimicLayout.replace")).toEqual(["baseline"]);
}

/** The summaries count what the body draws, from the body alone. */
export function theLayoutSummariesCountTheGraph(): void {
  const create = catalogEntry("mimicLayout.create");
  const replace = catalogEntry("mimicLayout.replace");
  if (!create || !replace) throw new Error("layout entries");
  expect(summaryOf(create)).toBe(`Create the layout "Raw water" in ${ORG_NAME}: 2 units, 0 panels, 1 pipe.`);
  expect(summaryOf(replace)).toBe(`Replace the layout "${TARGET_NAME}" (version 1): 2 units, 0 panels, 1 pipe.`);
}

/** `cardOnlyKeysFor` names the keys the browser strips: the replace's `baseline`; nothing for any other or an unknown id. */
export function cardOnlyKeysForNamesTheStrippedKeys(): void {
  expect(cardOnlyKeysFor("mimicLayout.replace")).toEqual(["baseline"]);
  expect(cardOnlyKeysFor("mimicLayout.create")).toEqual([]);
  expect(cardOnlyKeysFor("no.such.entry")).toEqual([]);
  for (const entry of COPILOT_CATALOG) expect(cardOnlyKeysFor(entry.id), entry.id).toEqual(entry.cardOnly ?? []);
}

/** The ids `F3.87` PR 6 makes entries: the five library and symbol writes, then the role create. */
const LIBRARY_ENTRY_IDS = ["mimicLibrary.setting", "mimicLibrary.create", "mimicLibrary.update", "mimicSymbol.update", "mimicSymbol.upload"] as const;

/**
 * `F3.87` PR 6 (ADR 0099 Amendment 3 A1, A3) — the five library and symbol
 * entries are for the authoring roles; their targets are the organization a
 * create or setting names, or the library row.
 */
export function theLibraryEntriesAreForTheAuthors(): void {
  for (const id of LIBRARY_ENTRY_IDS) {
    const entry = catalogEntry(id);
    if (!entry) throw new Error(id);
    expect(entry.offeredTo, id).toEqual(["admin", "organization_admin"]);
    expect(EXCLUDED_ROUTES.some((route) => route.path === entry.path && route.method === entry.method), id).toBe(false);
  }
  expect(catalogEntry("mimicLibrary.setting")?.target).toEqual({ kind: "organization", manage: "mimic" });
  expect(catalogEntry("mimicLibrary.create")?.target).toEqual({ kind: "organization", manage: "mimic" });
  expect(catalogEntry("mimicLibrary.update")?.target).toEqual({ kind: "mimicLibrary", param: "id" });
  expect(catalogEntry("mimicSymbol.update")?.target).toEqual({ kind: "mimicLibrary", param: "id" });
  expect(catalogEntry("mimicSymbol.upload")?.target).toEqual({ kind: "mimicLibrary", param: "id" });
}

/**
 * The symbol upload is the catalog's one multipart entry: the route's text
 * fields as the body, the model's body adding `svg`, the SVG text stored for
 * the card alone (`cardOnly`), and the step holding exactly the text fields
 * (the file is never a field, D6).
 */
export function theSymbolUploadIsTheMultipartEntry(): void {
  const entry = catalogEntry("mimicSymbol.upload");
  if (!entry) throw new Error("mimicSymbol.upload");
  const exports = contracts as unknown as Record<string, unknown>;
  expect(entry.upload).toEqual({ fileField: "file", contentType: "image/svg+xml", maxBytes: contracts.MAX_MIMIC_SYMBOL_SVG_BYTES });
  expect(entry.cardOnly).toEqual(["svgText"]);
  expect(hashExcludedKeysFor(entry.id)).toEqual(["svgText"]);
  expect(entry.bodyName).toBe("mimicSymbolUploadFieldsSchema");
  expect(entry.modelBody).toBe(exports.copilotMimicSymbolUploadModelBodySchema);
  expect(entry.modelBodyName).toBe("copilotMimicSymbolUploadModelBodySchema");
  expect(entry.steps).toEqual([{ id: "symbol", title: "Symbol", fields: ["name", "label", "group"] }]);
  expect(COPILOT_CATALOG.filter((candidate) => candidate.upload !== undefined).map((candidate) => candidate.id)).toEqual(["mimicSymbol.upload"]);
}

/** The model's upload body takes the SVG as text or as an attachment index, and nothing else. */
export function theUploadModelBodyTakesTextOrAnAttachment(): void {
  const schema = contracts.copilotMimicSymbolUploadModelBodySchema;
  const base = { name: "pump-x", label: "Pump X" };
  expect(schema.safeParse({ ...base, svg: { kind: "text", text: SYMBOL_SVG } }).success).toBe(true);
  expect(schema.safeParse({ ...base, svg: { kind: "attachment", index: 1 } }).success).toBe(true);
  expect(schema.safeParse({ ...base, svg: { kind: "attachment", index: 4 } }).success).toBe(false);
  expect(schema.safeParse({ ...base, svg: { kind: "url", url: "https://x.test/a.svg" } }).success).toBe(false);
  expect(schema.safeParse({ ...base, svg: { kind: "text", text: "x".repeat(65537) } }).success).toBe(false);
  expect(schema.safeParse({ ...base, svg: { kind: "text", text: SYMBOL_SVG }, svgText: SYMBOL_SVG }).success).toBe(false);
  expect(schema.safeParse({ label: "Pump X", svg: { kind: "text", text: SYMBOL_SVG } }).success).toBe(false);
}

/** Ruling Q4: `assetRole.create` is a fleet entry offered to the global admin alone. */
export function theRoleCreateIsForTheGlobalAdminOnly(): void {
  const entry = catalogEntry("assetRole.create");
  if (!entry) throw new Error("assetRole.create");
  expect({ method: entry.method, path: entry.path, target: entry.target, offeredTo: entry.offeredTo, risk: entry.risk }).toEqual({
    method: "POST",
    path: "/admin/vocabularies/asset-roles",
    target: { kind: "fleet" },
    offeredTo: ["admin"],
    risk: "create",
  });
  expect(entry.steps).toEqual([{ id: "role", title: "Role", fields: ["code", "label", "sortOrder"] }]);
}

/** `F3.87` PR 6: every mimic and role write route is an entry or excluded for good; nothing waits on a later PR. */
export function noMimicOrRoleRouteIsPending(): void {
  expect(EXCLUDED_ROUTES.filter((route) => route.reason.startsWith("F3.87 PR"))).toEqual([]);
}

/** The summaries name the library, the organization or the role code. */
export function theLibraryAndRoleSummariesNameTheirTarget(): void {
  const summary = (id: string, body: Record<string, unknown>, params: Record<string, string> = {}) => {
    const entry = catalogEntry(id);
    if (!entry) throw new Error(id);
    return entry.summary({ body, params, targetName: TARGET_NAME, organizationName: ORG_NAME });
  };
  expect(summary("mimicLibrary.setting", { organizationId: ORG, enabled: false }, { libraryCode: "lucide" })).toBe(
    `Turn the built-in symbol library "lucide" off for ${ORG_NAME}.`,
  );
  expect(summary("mimicLibrary.setting", { organizationId: ORG, enabled: true }, { libraryCode: "lucide" })).toBe(
    `Turn the built-in symbol library "lucide" on for ${ORG_NAME}.`,
  );
  expect(summary("mimicLibrary.create", { organizationId: ORG, code: "plant", label: "Plant Symbols" })).toBe(
    `Create the symbol library "Plant Symbols" (org.plant) in ${ORG_NAME}.`,
  );
  expect(summary("mimicLibrary.update", { active: false })).toBe(`Retire the symbol library "${TARGET_NAME}".`);
  expect(summary("mimicLibrary.update", { active: true })).toBe(`Reactivate the symbol library "${TARGET_NAME}".`);
  expect(summary("mimicLibrary.update", { label: "New", licence: "MIT" })).toBe(`Change label and licence of the symbol library "${TARGET_NAME}".`);
  expect(summary("mimicSymbol.update", { group: "water" })).toBe(`Change group of a symbol in the library "${TARGET_NAME}".`);
  expect(summary("mimicSymbol.upload", { name: "pump-x", label: "Pump X", filename: "pump-x.svg" })).toBe(
    `Upload the symbol "Pump X" (pump-x) to the library "${TARGET_NAME}".`,
  );
  expect(summary("assetRole.create", { code: "pump-x", label: "Pump X" })).toBe(
    'Add the unit role "pump-x" (Pump X) to the fleet-wide role vocabulary.',
  );
}

/**
 * `F4.247` (ADR 0099 Amendment 5 C1): exactly the three list writes take an
 * `If-Match` precondition (`F4.279` Amendment 8 D6 adds the escalation ladder).
 * Mutation: drop the flag from one entry.
 */
export function exactlyTheThreeListWritesTakeAPrecondition(): void {
  const flagged = COPILOT_CATALOG.filter((e) => e.precondition === "updatedAt").map((e) => e.id).sort();
  expect(flagged).toStrictEqual(["assetTemplate.update", "dashboard.widgets.replace", "escalationProfile.update"]);
}
