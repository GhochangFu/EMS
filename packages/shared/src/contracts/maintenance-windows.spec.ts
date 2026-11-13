import {
  MAINTENANCE_WINDOW_MAX_MS,
  closeMaintenanceWindowBodySchema,
  copilotCreateMaintenanceWindowModelBodySchema,
  createMaintenanceWindowBodySchema,
  extendMaintenanceWindowBodySchema,
  maintenanceWindowItemSchema,
  maintenanceWindowTargetKindSchema,
  maintenanceWindowTargetSchema,
  maintenanceWindowsResponseSchema,
} from "./maintenance-windows";

/**
 * `F4.359` / ADR 0131 — the maintenance-window contracts. Assertions live
 * here; `maintenance-windows.test.ts` is the vitest entry point (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const ends = "2026-11-14T10:00:00.000Z";

const body = {
  reason: "Scheduled UPS battery swap",
  endsAt: ends,
  targets: [{ kind: "asset", assetId: U1 }],
};

const item = {
  id: U1,
  organizationId: U2,
  reason: "Scheduled UPS battery swap",
  startsAt: "2026-11-13T10:00:00.000Z",
  endsAt: ends,
  endedAt: null,
  state: "active",
  createdByName: "Admin",
  endedByName: null,
  workOrder: { id: U2, reference: "WO-1" },
  maintenanceSchedule: null,
  targets: [{ kind: "asset", id: U1, label: "UPS-1" }],
  assetIds: [U1],
};

/** A window runs at most 7 days. */
export function runMaxMsTest(): void {
  assert(MAINTENANCE_WINDOW_MAX_MS === 7 * 24 * 60 * 60 * 1000, "max is 7 days");
}

/** The target is a discriminated union of strict single-id objects. */
export function runTargetUnionTest(): void {
  assert(maintenanceWindowTargetSchema.safeParse({ kind: "location", locationId: U1 }).success, "location");
  assert(maintenanceWindowTargetSchema.safeParse({ kind: "rule", ruleId: U1 }).success, "rule");
  assert(
    !maintenanceWindowTargetSchema.safeParse({ kind: "asset", assetId: U1, locationId: U2 }).success,
    "two ids refused",
  );
  assert(!maintenanceWindowTargetSchema.safeParse({ kind: "asset", assetId: "x" }).success, "non-uuid refused");
  assert(!maintenanceWindowTargetSchema.safeParse({ kind: "zone", assetId: U1 }).success, "unknown kind refused");
}

/** The create body: reason length, 1-200 targets, strictness, an optional start. */
export function runBodyTest(): void {
  assert(createMaintenanceWindowBodySchema.safeParse(body).success, "absent startsAt accepted");
  assert(
    createMaintenanceWindowBodySchema.safeParse({ ...body, startsAt: "2026-11-13T10:00:00Z", workOrderId: U1 }).success,
    "full body accepted",
  );
  assert(!createMaintenanceWindowBodySchema.safeParse({ ...body, extra: 1 }).success, "unknown key refused");
  assert(!createMaintenanceWindowBodySchema.safeParse({ ...body, targets: [] }).success, "0 targets refused");
  const target = { kind: "asset", assetId: U1 };
  assert(
    createMaintenanceWindowBodySchema.safeParse({ ...body, targets: Array(200).fill(target) }).success,
    "200 targets accepted",
  );
  assert(
    !createMaintenanceWindowBodySchema.safeParse({ ...body, targets: Array(201).fill(target) }).success,
    "201 targets refused",
  );
  assert(!createMaintenanceWindowBodySchema.safeParse({ ...body, reason: "ab" }).success, "2-char reason refused");
  assert(!createMaintenanceWindowBodySchema.safeParse({ ...body, reason: "  ab  " }).success, "trimmed length counts");
  assert(createMaintenanceWindowBodySchema.safeParse({ ...body, reason: "abc" }).success, "3 accepted");
  assert(
    !createMaintenanceWindowBodySchema.safeParse({ ...body, reason: "a".repeat(2001) }).success,
    "2001 refused",
  );
  assert(createMaintenanceWindowBodySchema.safeParse({ ...body, reason: "a".repeat(2000) }).success, "2000 accepted");
}

/** The reason is counted in code points, as the database `char_length` CHECK counts it. */
export function runCodePointTest(): void {
  // "\u{1F600}a" is 3 UTF-16 units but 2 code points: the DB char_length CHECK refuses it.
  assert(!createMaintenanceWindowBodySchema.safeParse({ ...body, reason: "\u{1F600}a" }).success, "2 code points refused");
  assert(createMaintenanceWindowBodySchema.safeParse({ ...body, reason: "\u{1F600}ab" }).success, "3 code points accepted");
  assert(
    createMaintenanceWindowBodySchema.safeParse({ ...body, reason: "\u{1F600}".repeat(2000) }).success,
    "2000 emoji accepted",
  );
  assert(
    !createMaintenanceWindowBodySchema.safeParse({ ...body, reason: "\u{1F600}".repeat(2001) }).success,
    "2001 emoji refused",
  );
  assert(!extendMaintenanceWindowBodySchema.safeParse({ endsAt: ends, reason: "\u{1F600}a" }).success, "extend code points");
  assert(!closeMaintenanceWindowBodySchema.safeParse({ reason: "\u{1F600}a" }).success, "close code points");
}

/** The extend body needs `endsAt`; the close body takes an optional reason; both are strict. */
export function runExtendCloseTest(): void {
  assert(extendMaintenanceWindowBodySchema.safeParse({ endsAt: ends }).success, "extend without reason");
  assert(extendMaintenanceWindowBodySchema.safeParse({ endsAt: ends, reason: "more time" }).success, "extend reason");
  assert(!extendMaintenanceWindowBodySchema.safeParse({ reason: "more time" }).success, "extend needs endsAt");
  assert(!extendMaintenanceWindowBodySchema.safeParse({ endsAt: ends, x: 1 }).success, "extend strict");
  assert(closeMaintenanceWindowBodySchema.safeParse({}).success, "close empty");
  assert(!closeMaintenanceWindowBodySchema.safeParse({ reason: "ab" }).success, "close short reason");
  assert(!closeMaintenanceWindowBodySchema.safeParse({ x: 1 }).success, "close strict");
}

/** The item and list response parse, and refuse a missing `assetIds` or an unknown state. */
export function runItemTest(): void {
  assert(maintenanceWindowsResponseSchema.safeParse({ items: [item] }).success, "item parses");
  const { assetIds: _omit, ...noAssets } = item;
  assert(!maintenanceWindowItemSchema.safeParse(noAssets).success, "missing assetIds refused");
  assert(!maintenanceWindowItemSchema.safeParse({ ...item, state: "paused" }).success, "unknown state refused");
}

/** The item's target `kind` is the union's discriminator, from one list: no kind in one and not the other. */
export function runTargetKindTest(): void {
  const unionKinds = maintenanceWindowTargetSchema.options.map((option) => option.shape.kind.value).sort();
  assert(JSON.stringify(unionKinds) === JSON.stringify([...maintenanceWindowTargetKindSchema.options].sort()), "one list of kinds");
  const target = item.targets[0];
  assert(!maintenanceWindowItemSchema.safeParse({ ...item, targets: [{ ...target, kind: "zone" }] }).success, "unknown item kind refused");
  assert(maintenanceWindowItemSchema.safeParse({ ...item, targets: [{ ...target, kind: "rule" }] }).success, "rule item kind accepted");
}

/**
 * `F4.359` PR 6 review: the Copilot's model body refuses a target named twice (the card counts
 * the targets it lists), case-insensitively, and tells the model to omit `startsAt` for "now";
 * the route body keeps neither rule nor that description.
 */
export function runCopilotModelBodyTest(): void {
  const twice = { ...body, targets: [{ kind: "asset", assetId: U1 }, { kind: "asset", assetId: U1.toUpperCase() }] };
  const parsed = copilotCreateMaintenanceWindowModelBodySchema.safeParse(twice);
  assert(!parsed.success, "a target named twice refused");
  assert(
    !parsed.success && parsed.error.issues.some((issue) => issue.message === "each target may be named once"),
    "the duplicate refusal has its sentence",
  );
  const distinct = { ...body, targets: [{ kind: "asset", assetId: U1 }, { kind: "location", locationId: U1 }, { kind: "asset", assetId: U2 }] };
  assert(copilotCreateMaintenanceWindowModelBodySchema.safeParse(distinct).success, "distinct targets accepted");
  assert(createMaintenanceWindowBodySchema.safeParse(twice).success, "the route body is unchanged");
  const modelStart = copilotCreateMaintenanceWindowModelBodySchema.shape.startsAt.description ?? "";
  assert(modelStart.startsWith("Omit to start now."), `model startsAt describes omit-for-now: ${modelStart}`);
  assert(createMaintenanceWindowBodySchema.shape.startsAt.description === undefined, "the route startsAt has no description");
}
