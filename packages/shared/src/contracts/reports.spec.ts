import {
  REPORT_FILE_FORMATS,
  REPORT_ONDEMAND_CAP_DEFAULT,
  reportDeliveryStatusSchema,
  reportFileDtoSchema,
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
  createdBy: null,
  createdAt: "2026-09-21T00:00:00.000Z",
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
