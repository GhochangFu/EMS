import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { harness as filesHarness, type Scenario as FilesScenario } from "./report-files.service.spec";
import { ReportProposalCheckService, type ReportProposalCheckInput } from "./report-proposal-check.service";
import {
  CHANNEL_ID,
  channelRow,
  harness as schedulesHarness,
  ORG_ID,
  OTHER_LOCATION,
  OTHER_ORG_ID,
  SCHEDULE_ID,
  type Scenario as SchedulesScenario,
  storedSchedule,
  WC,
} from "./report-schedules.service.spec";

/**
 * `F4.280` (ADR 0099 Amendment 8 D2, D4, D5, Q14; owner rulings Q4, Q5) — the
 * check a report proposal runs before its card is stored. It runs the routes'
 * own checks read-only, through the real services on the specs' database
 * fakes: `ReportSchedulesService.checkWriteScope` for a schedule and
 * `ReportFilesService.previewSave` for the on-demand save, so every refusal is
 * the route's own sentence. It never calls a write method. Vitest entry point:
 * the sibling `.test.ts`.
 */

const JWT = { sub: "f4280-check", role: "admin" } as JwtPayload;

const CREATE_BODY = {
  organizationId: ORG_ID,
  name: "Weekly energy",
  formats: ["pdf"],
  cadence: "weekly",
  runAtLocal: "07:00",
  timezone: "Asia/Kolkata",
  locationIds: [WC],
};

/** The writable set the check reads itself (the route's `writableLocationIds`). */
function accessWith(writable: string[] | null): never {
  return { writableLocationIds: async () => writable } as never;
}

/** A write method the check must never reach: it records the call and throws. */
function untouchable<T extends object>(service: T, methods: readonly string[], touched: string[]): T {
  for (const method of methods) {
    Object.assign(service, {
      [method]: async () => {
        touched.push(method);
        throw new Error(`${method} must not run in a proposal check`);
      },
    });
  }
  return service;
}

type Built = {
  check: ReportProposalCheckService;
  touched: string[];
  filesCalls: () => string[];
  renders: () => number;
  /** The schedules fakes' reads (`fleet:readById`, `tx:storedChannel`, …). */
  schedulesCalls: () => string[];
  channelWheres: () => { sql: string; params: unknown[] }[];
  executed: () => { sql: string; params: unknown[] }[];
};

function build(
  options: { schedules?: SchedulesScenario; files?: FilesScenario; writable?: string[] | null } = {},
): Built {
  const touched: string[] = [];
  const schedules = schedulesHarness({ organizationLocations: [WC, OTHER_LOCATION], ...options.schedules });
  const files = filesHarness(options.files);
  const check = new ReportProposalCheckService(
    untouchable(schedules.service, ["create", "update", "remove"], touched),
    untouchable(files.service, ["saveOnDemand", "remove"], touched),
    accessWith(options.writable === undefined ? null : options.writable),
  );
  return {
    check,
    touched,
    filesCalls: () => files.calls,
    renders: () => files.reports.calls.length,
    schedulesCalls: () => schedules.calls,
    channelWheres: () => schedules.channelWheres,
    executed: () => schedules.executed,
  };
}

function input(entryId: string, body: Record<string, unknown>, params: Record<string, string> = {}): ReportProposalCheckInput {
  return { entryId, params, body, organizationId: ORG_ID, user: JWT };
}

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return "(no refusal)";
}

const createWith = (body: Record<string, unknown>) => input("reportSchedule.create", { ...CREATE_BODY, ...body });
const updateWith = (body: Record<string, unknown>) => input("reportSchedule.update", body, { id: SCHEDULE_ID });
const SAVE = input("reportFile.save", { organizationId: ORG_ID, startDate: "2026-09-01", endDate: "2026-09-30", format: "pdf" });

/** Q-6: a `location_admin` naming a channel gets the route's 403 from `loadById`. */
export async function aLocationAdminNamingAChannelGetsTheRoutes403(): Promise<void> {
  const { check } = build({ schedules: { channel: "refused" }, writable: [WC] });
  expect(await refusal(() => check.check(createWith({ channelId: CHANNEL_ID })))).toBe(
    "Notification channel is outside your access scope",
  );
}

/** A webhook channel is refused with the route's sentence. */
export async function aWebhookChannelIsRefused(): Promise<void> {
  const { check } = build({ schedules: { channel: channelRow({ kind: "webhook" }) } });
  expect(await refusal(() => check.check(createWith({ channelId: CHANNEL_ID })))).toBe("channelId must name an email channel");
}

/** A channel of another organization is refused with the route's sentence. */
export async function aChannelOfAnotherOrganizationIsRefused(): Promise<void> {
  const { check } = build({ schedules: { channel: channelRow({ organizationId: OTHER_ORG_ID }) } });
  expect(await refusal(() => check.check(createWith({ channelId: CHANNEL_ID })))).toBe(
    "channelId names a channel of another organization",
  );
}

/** A location outside the organization is the route's 400. */
export async function aLocationOutsideTheOrganizationIsRefused(): Promise<void> {
  const { check } = build({ schedules: { organizationLocations: [WC] } });
  expect(await refusal(() => check.check(createWith({ locationIds: [OTHER_LOCATION] })))).toBe(
    "locationIds names a location outside the organization",
  );
}

/** A location outside the writable set is the route's 403. */
export async function aLocationOutsideTheWritableSetIsRefused(): Promise<void> {
  const { check } = build({ writable: [WC] });
  expect(await refusal(() => check.check(createWith({ locationIds: [OTHER_LOCATION] })))).toBe(
    "locationIds is outside your access scope",
  );
}

/** `[]` needs organization-level rights: a `location_admin` gets the route's 403. */
export async function anEmptyScopeForALocationAdminIsRefused(): Promise<void> {
  const { check } = build({
    schedules: { readScope: { kind: "location", organizationIds: [ORG_ID], locationIds: [WC] } },
    writable: [WC],
  });
  expect(await refusal(() => check.check(createWith({ locationIds: [] })))).toBe(
    "An empty location scope requires organization-level rights",
  );
}

/** D5: the email channel's every address is in the card's recipients, in full. */
export async function theRecipientsHoldEveryAddressInFull(): Promise<void> {
  const { check } = build({ schedules: { channel: channelRow({ config: { to: ["ops@example.test", "lead@example.test"] } }) } });
  const { recipients } = await check.check(createWith({ channelId: CHANNEL_ID }));
  expect(recipients).toEqual([
    { channelId: CHANNEL_ID, name: "Ops email", kind: "email", targets: ["ops@example.test", "lead@example.test"] },
  ]);
}

/** D5: the note names the channel and the count. */
export async function theNoteNamesTheChannelAndTheCount(): Promise<void> {
  const { check } = build({ schedules: { channel: channelRow({ config: { to: ["ops@example.test", "lead@example.test"] } }) } });
  expect((await check.check(createWith({ channelId: CHANNEL_ID }))).note).toBe(
    'Email delivery: channel "Ops email", 2 recipients, on every run with no later Confirm.',
  );
}

/** D5: the note holds no address. */
export async function theNoteHoldsNoAddress(): Promise<void> {
  const { check } = build();
  expect((await check.check(createWith({ channelId: CHANNEL_ID }))).note).not.toMatch(/@/);
}

/** Q4: an update without `channelId` lists no recipient. */
export async function anUpdateWithoutAChannelListsNoRecipient(): Promise<void> {
  const { check } = build();
  expect((await check.check(updateWith({ name: "Renamed" }))).recipients).toEqual([]);
}

/** Q4: an update without `channelId` says the delivery is unchanged. */
export async function anUpdateWithoutAChannelSaysUnchanged(): Promise<void> {
  const { check } = build();
  expect((await check.check(updateWith({ name: "Renamed" }))).note).toBe("Email delivery: unchanged.");
}

/** `channelId: null` says none. */
export async function aNullChannelSaysNone(): Promise<void> {
  const { check } = build();
  expect((await check.check(updateWith({ channelId: null }))).note).toBe("Email delivery: none.");
}

/** Q14: the save with storage unconfigured is the route's 503 sentence. */
export async function anUnconfiguredSaveIsTheRoutes503(): Promise<void> {
  const { check } = build({ files: { client: { kind: "unconfigured" } } });
  expect(await refusal(() => check.check(SAVE))).toBe(
    "Object storage is not configured: OBJECT_STORAGE_ENDPOINT is unset (ADR 0066 decision 3)",
  );
}

/** A `location_admin` with no granted location in the organization is the route's 403. */
export async function aLocationAdminWithNoGrantedLocationIsRefused(): Promise<void> {
  const { check } = build({
    files: {
      writableLocationIds: [OTHER_LOCATION],
      grantedLocationIds: ["99999999-9999-4999-8999-999999999999"],
      writableOrganizationIds: [ORG_ID],
      readScope: { kind: "location", organizationIds: [ORG_ID], locationIds: [OTHER_LOCATION] },
      organizationLocations: [WC],
    },
  });
  expect(await refusal(() => check.check(SAVE))).toBe("No location scope in this organization to record for the report");
}

/** At the cap the save is the route's 409. */
export async function aSaveAtTheCapIsTheRoutes409(): Promise<void> {
  const { check } = build({ files: { fleetCount: 50 } });
  expect(await refusal(() => check.check(SAVE))).toBe(
    "This organization already has 50 saved reports; delete one before saving another",
  );
}

/** Q14: the save's note says it renders on Confirm, with its stamp. */
export async function theSaveNoteSaysItRendersOnConfirm(): Promise<void> {
  const { check } = build();
  expect((await check.check(SAVE)).note).toBe("Rendered on Confirm; stamped to the whole organization.");
}

/** `F4.290`: a save naming a site reaches `previewSave`, and the note names the stamp it gives. */
export async function aSaveNamingASiteIsStampedToIt(): Promise<void> {
  const { check } = build();
  expect((await check.check({ ...SAVE, body: { ...SAVE.body, locationIds: [WC] } })).note).toBe("Rendered on Confirm; stamped to 1 location.");
}

/** `F4.290`: a named site outside the organization is the route's 400 sentence. */
export async function aSaveNamingAForeignSiteIsRefused(): Promise<void> {
  const { check } = build();
  const foreign = "29292929-2929-4292-8292-292929292929";
  expect(await refusal(() => check.check({ ...SAVE, body: { ...SAVE.body, locationIds: [foreign] } }))).toBe(
    "locationIds names a location outside the organization",
  );
}

/** `previewSave` renders nothing and makes no storage call. */
export async function thePreviewRendersNothingAndStoresNothing(): Promise<void> {
  const built = build();
  await built.check.check(SAVE);
  expect([built.renders(), built.filesCalls().includes("putObject")]).toEqual([0, false]);
}

/** The check calls no write method, across all three entries. */
export async function theCheckCallsNoWriteMethod(): Promise<void> {
  const built = build();
  await built.check.check(createWith({ channelId: CHANNEL_ID }));
  await built.check.check(updateWith({ name: "Renamed" }));
  await built.check.check(SAVE);
  expect(built.touched).toEqual([]);
}

/** Positive control: the untouchable fake does refuse a write, so the claim above is not vacuous. */
export async function theUntouchableFakeRefusesAWrite(): Promise<void> {
  const touched: string[] = [];
  const service = untouchable(schedulesHarness().service, ["create"], touched);
  expect([await refusal(() => service.create(JWT, CREATE_BODY as never)), touched]).toEqual([
    "create must not run in a proposal check",
    ["create"],
  ]);
}

/** `checkWriteScope` answers the loaded email channel row. */
export async function checkWriteScopeAnswersTheChannelRow(): Promise<void> {
  const h = schedulesHarness({ organizationLocations: [WC] });
  expect((await h.service.checkWriteScope(JWT, ORG_ID, [WC], CHANNEL_ID, null))?.id).toBe(CHANNEL_ID);
}

/** D4 (Q5): a `channelId` string starts email, with no read. */
export async function aChannelIdStartsEmail(): Promise<void> {
  const { check } = build();
  expect(await check.startsEmail({ ...createWith({ channelId: CHANNEL_ID }) })).toBe(true);
}

/** Q5: re-enabling a schedule whose stored channel is set starts email again. */
export async function reEnablingAScheduleWithAStoredChannelStartsEmail(): Promise<void> {
  const { check } = build({ schedules: { scheduleRows: [storedSchedule({ channelId: CHANNEL_ID, enabled: false })] } });
  expect(await check.startsEmail(updateWith({ enabled: true }))).toBe(true);
}

/** Q5: re-enabling a schedule with no stored channel starts no email (adjacent control). */
export async function reEnablingAScheduleWithNoStoredChannelStartsNoEmail(): Promise<void> {
  const { check } = build({ schedules: { scheduleRows: [storedSchedule({ channelId: null, enabled: false })] } });
  expect(await check.startsEmail(updateWith({ enabled: true }))).toBe(false);
}

/** Q5: re-enabling while clearing the channel starts no email. */
export async function reEnablingWhileClearingTheChannelStartsNoEmail(): Promise<void> {
  const { check } = build({ schedules: { scheduleRows: [storedSchedule({ channelId: CHANNEL_ID, enabled: false })] } });
  expect(await check.startsEmail(updateWith({ enabled: true, channelId: null }))).toBe(false);
}

/** The save never starts email. */
export async function theSaveStartsNoEmail(): Promise<void> {
  const { check } = build();
  expect(await check.startsEmail(SAVE)).toBe(false);
}

/*
 * `F4.280` follow-up (owner ruling 2026-10-24): an update that sets `enabled:
 * true` and omits `channelId` reads the schedule's stored channel once and lists
 * its recipients, so the admin sees who gets the emails again. The read is the
 * route's row read, then the channel on the tenant handle under the schedule's
 * organization — never `ChannelsService.loadById`, whose gate refuses a
 * `location_admin` the PATCH route admits. Every other update makes no read.
 */

const reEnable = () => updateWith({ enabled: true });
const withStoredChannel = (over: Record<string, unknown> = {}): SchedulesScenario => ({
  scheduleRows: [storedSchedule({ channelId: CHANNEL_ID, enabled: false, ...over })],
});
const UNCHANGED = { note: "Email delivery: unchanged.", recipients: [] };

/** Re-enabling a schedule with a stored channel lists that channel's recipients on the card. */
export async function reEnablingWithAStoredChannelListsItsRecipients(): Promise<void> {
  const { check } = build({ schedules: withStoredChannel() });
  expect((await check.check(reEnable())).recipients).toEqual([
    { channelId: CHANNEL_ID, name: "Ops email", kind: "email", targets: ["ops@example.test"] },
  ]);
}

/** The re-enable note names the stored channel and the count, as a `channelId` body does. */
export async function reEnablingWithAStoredChannelNamesItInTheNote(): Promise<void> {
  const { check } = build({ schedules: withStoredChannel() });
  expect((await check.check(reEnable())).note).toBe(
    'Email delivery: channel "Ops email", 1 recipient, on every run with no later Confirm.',
  );
}

/** The re-enable reads the stored channel exactly once. */
export async function reEnablingWithAStoredChannelReadsItOnce(): Promise<void> {
  const built = build({ schedules: withStoredChannel() });
  await built.check.check(reEnable());
  expect(built.schedulesCalls().filter((call) => call === "tx:storedChannel")).toEqual(["tx:storedChannel"]);
}

/** The channel read is bound to the schedule's organization: the tenant GUC and the predicate both name it. */
export async function theStoredChannelReadIsScopedToTheSchedulesOrganization(): Promise<void> {
  const built = build({ schedules: withStoredChannel({ organizationId: OTHER_ORG_ID }) });
  await built.check.check(reEnable());
  const tenantSet = built.executed().find((statement) => statement.sql.includes("set_config"));
  expect([tenantSet?.params, built.channelWheres()[0]?.params]).toEqual([
    expect.arrayContaining([OTHER_ORG_ID]),
    expect.arrayContaining([CHANNEL_ID, OTHER_ORG_ID]),
  ]);
}

/** Re-enabling a schedule with no stored channel stays "unchanged". */
export async function reEnablingWithNoStoredChannelStaysUnchanged(): Promise<void> {
  const { check } = build({ schedules: { scheduleRows: [storedSchedule({ channelId: null, enabled: false })] } });
  expect(await check.check(reEnable())).toEqual(UNCHANGED);
}

/** Re-enabling a schedule with no stored channel makes no channel read. */
export async function reEnablingWithNoStoredChannelReadsNoChannel(): Promise<void> {
  const built = build({ schedules: { scheduleRows: [storedSchedule({ channelId: null, enabled: false })] } });
  await built.check.check(reEnable());
  expect(built.schedulesCalls()).not.toContain("tx:storedChannel");
}

/** An update that does not set `enabled: true` reads neither the row nor the channel. */
export async function aNonEnableUpdateMakesNoRead(): Promise<void> {
  const built = build({ schedules: withStoredChannel() });
  await built.check.check(updateWith({ name: "Renamed", enabled: false }));
  expect(built.schedulesCalls().filter((call) => call === "fleet:readById" || call === "tx:storedChannel")).toEqual([]);
}

/** A stored channel gone from the table keeps "unchanged". */
export async function aGoneStoredChannelStaysUnchanged(): Promise<void> {
  const { check } = build({ schedules: { ...withStoredChannel(), storedChannel: null } });
  expect(await check.check(reEnable())).toEqual(UNCHANGED);
}

/** A stored channel of another organization is never listed (the check fails closed past RLS too). */
export async function aStoredChannelOfAnotherOrganizationIsNotListed(): Promise<void> {
  const { check } = build({ schedules: { ...withStoredChannel(), storedChannel: { organizationId: OTHER_ORG_ID } } });
  expect(await check.check(reEnable())).toEqual(UNCHANGED);
}

/** A stored channel that is not email is not listed. */
export async function aStoredWebhookChannelIsNotListed(): Promise<void> {
  const { check } = build({ schedules: { ...withStoredChannel(), storedChannel: { kind: "webhook" } } });
  expect(await check.check(reEnable())).toEqual(UNCHANGED);
}

/** A `location_admin` the route admits is not refused: `loadById`'s 403 is never reached on a re-enable. */
export async function aLocationAdminTheRouteAdmitsIsNotRefusedTheReEnable(): Promise<void> {
  const { check } = build({
    schedules: { ...withStoredChannel({ locationIds: [WC] }), channel: "refused", readScope: { kind: "location" } as never },
    writable: [WC],
  });
  expect((await check.check(reEnable())).recipients.map((recipient) => recipient.channelId)).toEqual([CHANNEL_ID]);
}
