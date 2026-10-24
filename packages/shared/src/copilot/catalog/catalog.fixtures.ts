/**
 * `F3.85` PR 8 — one valid body and path per catalog entry, and the name its
 * summary must contain. Moved out of `catalog.spec.ts` by `F4.281` (owner
 * ruling DC7) so that file holds the AGENTS.md §4.5 line cap; the rules that
 * read these stay there.
 */

export const ORG = "11111111-1111-4111-8111-111111111111";
export const ROW = "22222222-2222-4222-8222-222222222222";
export const TARGET_NAME = "Target Row 7";
export const ORG_NAME = "Org Seven";

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
export const SYMBOL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>';

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
  // `F4.280` (Amendment 8) — report schedules and the on-demand save; no fixture holds `recipients` (D5).
  "reportSchedule.create": {
    body: {
      organizationId: ORG,
      name: "Weekly energy",
      formats: ["pdf"],
      cadence: "weekly",
      runAtLocal: "07:00",
      timezone: "Asia/Kolkata",
      locationIds: [ROW],
    },
    params: {},
    names: ORG_NAME,
  },
  "reportSchedule.update": { body: { name: "Weekly energy v2" }, params: { id: ROW }, names: TARGET_NAME },
  "reportFile.save": {
    body: { organizationId: ORG, startDate: "2026-09-01", endDate: "2026-09-30", format: "pdf" },
    params: {},
    names: ORG_NAME,
  },  // `F4.281` (Amendment 8) — maintenance schedules; the create's summary names its asset (`targetName`).
  "maintenanceSchedule.create": {
    body: { assetId: ROW, title: "Quarterly filter check", intervalDays: 90, firstDueAt: "2026-11-01T09:00:00.000Z" },
    params: {},
    names: TARGET_NAME,
  },
  "maintenanceSchedule.activate": { body: { active: true }, params: { id: ROW }, names: TARGET_NAME },
  "maintenanceSchedule.deactivate": { body: { active: false, reason: "Season over" }, params: { id: ROW }, names: TARGET_NAME },
  // `F4.283` (Amendment 8) — file-borne data; the telemetry writes name the bound organization, the image its asset.
  "telemetry.import": { body: { sourceKind: "manual", file: { kind: "attachment", index: 1 } }, params: {}, names: ORG_NAME },
  "telemetryReading.create": {
    body: { rows: [{ assetId: ROW, pointKey: "kw", value: 12.5, time: "2026-10-20T09:00:00.000Z" }] },
    params: {},
    names: ORG_NAME,
  },
  "assetImage.upload": { body: { caption: "Front panel", file: { kind: "attachment", index: 1 } }, params: { assetId: ROW }, names: TARGET_NAME },
};
