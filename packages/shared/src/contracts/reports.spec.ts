import {
  REPORT_CADENCES,
  REPORT_FILE_FORMATS,
  REPORT_ONDEMAND_CAP_DEFAULT,
  reportDeliveryStatusSchema,
  reportFileDtoSchema,
  reportScheduleDtoSchema,
  reportTemplateIdSchema,
} from "./reports";
import { energyReportTemplateSchema } from "./operations";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const VALID_REPORT_FILE = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  templateId: "energy_consumption",
  format: "pdf",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-07",
  locationIds: [],
  contentType: "application/pdf",
  byteSize: 4096,
  sha256: "a".repeat(64),
  filename: "energy-consumption-2026-09-01-to-2026-09-07.pdf",
  deliveryStatus: "none",
  deliveryError: null,
  scheduleId: null,
  createdBy: null,
  createdAt: "2026-09-21T00:00:00.000Z",
};

const VALID_REPORT_SCHEDULE = {
  id: "44444444-4444-4444-8444-444444444444",
  organizationId: "22222222-2222-4222-8222-222222222222",
  name: "Weekly energy consumption",
  templateId: "energy_consumption",
  formats: ["pdf"],
  cadence: "weekly",
  runAtLocal: "07:00",
  timezone: "Asia/Kolkata",
  locationIds: [],
  channelId: null,
  enabled: true,
  nextRunAt: "2026-09-28T01:30:00.000Z",
  lastRunAt: null,
  createdBy: null,
  createdAt: "2026-09-21T00:00:00.000Z",
  updatedAt: "2026-09-21T00:00:00.000Z",
};

/**
 * `F3.5a` — `reports.ts` contract assertions (ADR 0071 decisions 4, 6, 11).
 *
 * Assertions live here; `reports.test.ts` is the vitest entry point (ADR
 * 0014).
 */
export function assertDtoRefusesObjectKey(): void {
  // Positive control first: the valid row, with no objectKey, must parse —
  // an absence check needs an adjacent positive (memory: an assertion can
  // miss the broken surface).
  const positive = reportFileDtoSchema.safeParse(VALID_REPORT_FILE);
  assert(
    positive.success === true,
    `the valid report-file row must parse, got ${JSON.stringify(positive.success === false ? positive.error.issues : null)}`,
  );

  const withKey = reportFileDtoSchema.safeParse({
    ...VALID_REPORT_FILE,
    objectKey: "org/22222222-2222-4222-8222-222222222222/reports/33333333-3333-4333-8333-333333333333",
  });
  assert(
    withKey.success === false,
    "reportFileDtoSchema must refuse a payload carrying objectKey (ADR 0071 decision 4/11) — the server-generated key never reaches a response DTO",
  );
}

export function assertFormatsAreExactlyPdfAndXlsx(): void {
  assert(
    JSON.stringify(REPORT_FILE_FORMATS) === JSON.stringify(["pdf", "xlsx"]),
    `REPORT_FILE_FORMATS must be exactly ["pdf", "xlsx"] in order, got ${JSON.stringify(REPORT_FILE_FORMATS)}`,
  );
}

export function assertDeliveryStatusesAreTheFour(): void {
  assert(
    JSON.stringify(reportDeliveryStatusSchema.options) ===
      JSON.stringify(["none", "sent", "skipped_unconfigured", "failed"]),
    `reportDeliveryStatusSchema must hold exactly the four statuses in order, got ${JSON.stringify(reportDeliveryStatusSchema.options)}`,
  );
}

export function assertTemplateIdIsDerivedFromTheEnergyTemplate(): void {
  assert(
    (reportTemplateIdSchema as unknown) === (energyReportTemplateSchema.shape.id as unknown),
    "reportTemplateIdSchema must be the same schema object as energyReportTemplateSchema.shape.id (§4.8 — derived, not restated)",
  );
}

export function assertFilenameRefusesAControlCharacter(): void {
  const result = reportFileDtoSchema.safeParse({
    ...VALID_REPORT_FILE,
    filename: "energy-consumption\r\n.pdf",
  });
  assert(
    result.success === false,
    `a filename carrying a control character must be refused, got ${JSON.stringify(result.success === true ? result.data : null)}`,
  );

  // Positive control: the unmodified valid filename still parses.
  const positive = reportFileDtoSchema.safeParse(VALID_REPORT_FILE);
  assert(positive.success === true, "the valid filename must still parse as the positive control");
}

export function assertCapDefaultIsFifty(): void {
  assert(
    REPORT_ONDEMAND_CAP_DEFAULT === 50,
    `REPORT_ONDEMAND_CAP_DEFAULT must be 50, got ${REPORT_ONDEMAND_CAP_DEFAULT}`,
  );
}

/**
 * `F3.5b` — `reportFileDtoSchema` gains a nullable `scheduleId` (ADR 0071
 * decision 11; R-16). Both `null` and a uuid must parse; a non-uuid string
 * must not.
 */
export function assertFileDtoCarriesANullableScheduleId(): void {
  const withNull = reportFileDtoSchema.safeParse(VALID_REPORT_FILE);
  assert(
    withNull.success === true,
    `a report-file row with scheduleId: null must parse, got ${JSON.stringify(withNull.success === false ? withNull.error.issues : null)}`,
  );

  const withUuid = reportFileDtoSchema.safeParse({
    ...VALID_REPORT_FILE,
    scheduleId: "55555555-5555-4555-8555-555555555555",
  });
  assert(
    withUuid.success === true,
    `a report-file row with a uuid scheduleId must parse, got ${JSON.stringify(withUuid.success === false ? withUuid.error.issues : null)}`,
  );

  const withBadValue = reportFileDtoSchema.safeParse({ ...VALID_REPORT_FILE, scheduleId: "x" });
  assert(
    withBadValue.success === false,
    "a report-file row with a non-uuid scheduleId must be refused",
  );
}

/**
 * `reportScheduleDtoSchema` is a plain `.strict()` object (R-16) — a payload
 * carrying an unknown key must be refused. The valid DTO is the positive
 * control (memory: an assertion can miss the broken surface).
 */
export function assertScheduleDtoRefusesAnUnknownKey(): void {
  const positive = reportScheduleDtoSchema.safeParse(VALID_REPORT_SCHEDULE);
  assert(
    positive.success === true,
    `the valid report-schedule row must parse, got ${JSON.stringify(positive.success === false ? positive.error.issues : null)}`,
  );

  const withUnknownKey = reportScheduleDtoSchema.safeParse({
    ...VALID_REPORT_SCHEDULE,
    objectKey: "org/x/reports/y",
  });
  assert(
    withUnknownKey.success === false,
    "reportScheduleDtoSchema must refuse a payload carrying an unknown key (objectKey)",
  );
}

/** `REPORT_CADENCES` must hold exactly the three cadences, in order (R-7). */
export function assertCadencesAreExactlyTheThree(): void {
  assert(
    JSON.stringify(REPORT_CADENCES) === JSON.stringify(["daily", "weekly", "monthly"]),
    `REPORT_CADENCES must be exactly ["daily", "weekly", "monthly"] in order, got ${JSON.stringify(REPORT_CADENCES)}`,
  );
}

/**
 * `runAtLocal` is `HH:MM` (R-16) — `pg`'s `HH:MM:SS` output must be refused,
 * a bare `HH:MM` must parse, and an out-of-range hour must be refused.
 */
export function assertRunAtLocalRefusesSeconds(): void {
  const withSeconds = reportScheduleDtoSchema.safeParse({ ...VALID_REPORT_SCHEDULE, runAtLocal: "07:00:00" });
  assert(withSeconds.success === false, "runAtLocal carrying seconds (07:00:00) must be refused");

  const bareMinutes = reportScheduleDtoSchema.safeParse({ ...VALID_REPORT_SCHEDULE, runAtLocal: "07:00" });
  assert(
    bareMinutes.success === true,
    `runAtLocal as HH:MM (07:00) must parse, got ${JSON.stringify(bareMinutes.success === false ? bareMinutes.error.issues : null)}`,
  );

  const outOfRange = reportScheduleDtoSchema.safeParse({ ...VALID_REPORT_SCHEDULE, runAtLocal: "24:00" });
  assert(outOfRange.success === false, "runAtLocal of 24:00 must be refused (hour must be 00-23)");
}

/** `name` reuses `NO_CONTROL_CHARACTERS` (R-16) — a control character must be refused. */
export function assertScheduleNameRefusesAControlCharacter(): void {
  const result = reportScheduleDtoSchema.safeParse({
    ...VALID_REPORT_SCHEDULE,
    name: "Weekly\r\nenergy",
  });
  assert(
    result.success === false,
    `a schedule name carrying a control character must be refused, got ${JSON.stringify(result.success === true ? result.data : null)}`,
  );

  const positive = reportScheduleDtoSchema.safeParse(VALID_REPORT_SCHEDULE);
  assert(positive.success === true, "the valid schedule name must still parse as the positive control");
}

/** `formats` is `.min(1)` (R-16 / plan Unit 1) — an empty array must be refused. */
export function assertFormatsRefuseAnEmptyArray(): void {
  const result = reportScheduleDtoSchema.safeParse({ ...VALID_REPORT_SCHEDULE, formats: [] });
  assert(result.success === false, "reportScheduleDtoSchema must refuse an empty formats array");

  const positive = reportScheduleDtoSchema.safeParse(VALID_REPORT_SCHEDULE);
  assert(positive.success === true, "the valid formats array must still parse as the positive control");
}
