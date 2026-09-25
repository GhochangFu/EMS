import {
  builtinSiteViewKeySchema,
  siteControlRoomViewNoticeSchema,
  siteControlRoomViewSettingDtoSchema,
} from "./site-control-room-views";

/**
 * `F3.67` / ADR 0076 decisions 3–5 — the site Control Room view setting and
 * resolved-view DTOs.
 *
 * Assertions live here; `site-control-room-views.test.ts` is the Vitest entry
 * point (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function expectAccepts(
  schema: { safeParse: (v: unknown) => { success: boolean } },
  value: unknown,
  message: string,
): void {
  assert(schema.safeParse(value).success === true, `${message} — expected success, got a refusal`);
}

function expectRejects(
  schema: { safeParse: (v: unknown) => { success: boolean } },
  value: unknown,
  message: string,
): void {
  assert(schema.safeParse(value).success === false, `${message} — expected a refusal, got success`);
}

const noRowSetting = {
  locationId: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  kind: "generated",
  dashboardId: null,
  builtinKey: null,
  updatedAt: null,
  updatedBy: null,
};

/** C1 — the no-row shape (`kind: "generated"`, every optional field `null`)
 * parses. */
export function runNoRowSettingTest(): void {
  expectAccepts(siteControlRoomViewSettingDtoSchema, noRowSetting, "the no-row setting shape");
}

/** C2 — an unknown `kind` is refused. */
export function runUnknownKindTest(): void {
  expectRejects(
    siteControlRoomViewSettingDtoSchema,
    { ...noRowSetting, kind: "mimic" },
    "a setting with kind: mimic",
  );
}

/** C3a — an unknown notice is refused. */
export function runUnknownNoticeTest(): void {
  expectRejects(siteControlRoomViewNoticeSchema, "other", "the notice value other");
}

/** C3b — `dashboard_removed` is one of the closed notice values. */
export function runKnownNoticeTest(): void {
  expectAccepts(siteControlRoomViewNoticeSchema, "dashboard_removed", "the notice value dashboard_removed");
}

/** C4 — an unknown built-in key is refused. */
export function runUnknownBuiltinKeyTest(): void {
  expectRejects(builtinSiteViewKeySchema, "eskom", "the built-in key eskom");
}
