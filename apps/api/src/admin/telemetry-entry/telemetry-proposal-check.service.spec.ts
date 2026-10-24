import { ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import type { JwtPayload, RejectedRowDto, TelemetryEntryRow } from "@bms/shared";

import { TelemetryImportService } from "../telemetry-import/telemetry-import.service";
import { TelemetryProposalCheckService } from "./telemetry-proposal-check.service";
import type { AcceptedRow, TelemetryWriteService } from "./telemetry-write.service";

/**
 * `F4.283` (ADR 0099 Amendment 8 Q18, Q21; owner rulings 2026-10-24, drafter
 * choices 2 and 4) — the copilot's telemetry proposal check over fakes, and the
 * import service's `previewForProposal` over a fake pool. One claim per `it()`.
 * Vitest entry point: the sibling `.test.ts`.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "99999999-9999-4999-8999-999999999999";
const ASSET = "22222222-2222-4222-8222-222222222222";
const LOCATION = "33333333-3333-4333-8333-333333333333";
const USER: JwtPayload = { sub: "u1", email: "a@bms.local", name: "A", role: "organization_admin" };
const ROW: TelemetryEntryRow = { assetId: ASSET, pointKey: "kw", value: 1, time: "2026-10-20T09:00:00.000Z" };

const accepted = (rowNumber: number, over: Partial<AcceptedRow> = {}): AcceptedRow => ({
  rowNumber,
  row: ROW,
  unit: "kW",
  mappingNeeded: false,
  organizationId: ORG,
  ...over,
});

/** A select chain that answers `rows`, whatever the projection. */
function fleetAnswering(rows: unknown[]): BmsDb {
  const chain = { from: () => chain, where: () => Promise.resolve(rows), limit: () => Promise.resolve(rows) };
  return { select: () => chain } as unknown as BmsDb;
}

function writesAnswering(result: { accepted: AcceptedRow[]; rejected: RejectedRowDto[] }): Pick<TelemetryWriteService, "validateRows"> {
  return { validateRows: async () => result };
}

function checkWith(options: {
  writes?: Pick<TelemetryWriteService, "validateRows">;
  imports?: Pick<TelemetryImportService, "previewForProposal">;
  codes?: Array<{ id: string; code: string }>;
}): TelemetryProposalCheckService {
  return new TelemetryProposalCheckService(
    fleetAnswering(options.codes ?? []),
    (options.imports ?? {}) as TelemetryImportService,
    (options.writes ?? writesAnswering({ accepted: [], rejected: [] })) as TelemetryWriteService,
  );
}

async function refusalOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    if (err instanceof ForbiddenException) return err.message;
    throw err;
  }
  return "(no refusal)";
}

/** Q21: a reading whose asset is in another organization refuses with its row number. */
export async function anOutOfOrganizationReadingNamesItsRow(): Promise<void> {
  const check = checkWith({
    writes: writesAnswering({ accepted: [accepted(1), accepted(2), accepted(3, { organizationId: OTHER_ORG })], rejected: [] }),
  });
  expect(await refusalOf(() => check.checkReadings({ user: USER, organizationId: ORG, rows: [ROW, ROW, ROW] }))).toBe(
    "Row 3: the asset is outside this conversation's organization.",
  );
}

/** A reading the route would reject refuses with the route's sentence and its row number. */
export async function aRouteRejectedReadingIsTheRoutesSentence(): Promise<void> {
  const check = checkWith({
    writes: writesAnswering({
      accepted: [accepted(1)],
      rejected: [{ rowNumber: 2, field: "assetId", reason: "Asset not found or outside your access scope" }],
    }),
  });
  expect(await refusalOf(() => check.checkReadings({ user: USER, organizationId: ORG, rows: [ROW, ROW] }))).toBe(
    "Row 2: Asset not found or outside your access scope.",
  );
}

/** A reading that needs a mapping: the note names `CODE/pointKey`. */
export async function aMappingNeededReadingIsNamedInTheNote(): Promise<void> {
  const check = checkWith({
    writes: writesAnswering({ accepted: [accepted(1, { mappingNeeded: true })], rejected: [] }),
    codes: [{ id: ASSET, code: "PUMP-1" }],
  });
  const { note } = await check.checkReadings({ user: USER, organizationId: ORG, rows: [ROW] });
  expect(note).toBe("1 of 1 rows accepted, 0 rejected; creates 1 point mapping: PUMP-1/kw.");
}

/** The import's counts reach the card unchanged; the rejected rows are bounded for the card. */
export async function theImportCountsPassThroughUnchanged(): Promise<void> {
  const rejected = Array.from({ length: 25 }, (_, i) => ({ rowNumber: i + 2, field: "value", reason: "bad" }));
  const imports: Pick<TelemetryImportService, "previewForProposal"> = {
    previewForProposal: async () => ({ totalRows: 40, acceptedCount: 15, rejectedCount: 25, rejected, mappingsToCreate: [] }),
  };
  const { preview } = await checkWith({ imports }).checkImport({ user: USER, organizationId: ORG, buffer: Buffer.from("x") });
  expect([preview?.totalRows, preview?.acceptedCount, preview?.rejectedCount, preview?.rejected.length]).toEqual([40, 15, 25, 20]);
}

/** The import note names the counts and a mapping name. */
export async function theImportNoteNamesCountsAndAMapping(): Promise<void> {
  const imports: Pick<TelemetryImportService, "previewForProposal"> = {
    previewForProposal: async () => ({
      totalRows: 14,
      acceptedCount: 12,
      rejectedCount: 2,
      rejected: [],
      mappingsToCreate: [{ assetCode: "PUMP-1", pointKey: "kw" }],
    }),
  };
  const { note } = await checkWith({ imports }).checkImport({ user: USER, organizationId: ORG, buffer: Buffer.from("x") });
  expect(note).toBe("12 of 14 rows accepted, 2 rejected; creates 1 point mapping: PUMP-1/kw.");
}

// ---- `TelemetryImportService.previewForProposal` over a fake pool ------------------------------

const csv = (...lines: string[]): Buffer => Buffer.from(["asset_code,point_key,value,time", ...lines].join("\n") + "\n", "utf8");

const CSV = csv("PUMP-1,kw,1,2026-10-20T09:00:00Z", "PUMP-2,kw,2,2026-10-20T09:00:00Z");

type AssetRow = { id: string; code: string; locationId: string; organizationId: string };

function importService(assetRows: AssetRow[], writes: Pick<TelemetryWriteService, "validateRows">): TelemetryImportService {
  const access = { requireMasterDataUser: async () => ({}), writableLocationIds: async () => null };
  return new TelemetryImportService(fleetAnswering(assetRows), access as never, writes as TelemetryWriteService);
}

const PUMP_1: AssetRow = { id: ASSET, code: "PUMP-1", locationId: LOCATION, organizationId: ORG };
const PUMP_2: AssetRow = { id: "44444444-4444-4444-8444-444444444444", code: "PUMP-2", locationId: LOCATION, organizationId: OTHER_ORG };

/** Q21: a sheet row whose asset is in another organization refuses the import with its sheet row number. */
export async function anImportRowInAnotherOrganizationNamesItsRow(): Promise<void> {
  const service = importService([PUMP_1, PUMP_2], writesAnswering({ accepted: [], rejected: [] }));
  expect(await refusalOf(() => service.previewForProposal(USER, CSV, ORG))).toBe("Row 3: the asset is outside this conversation's organization.");
}

/** A sheet row whose asset code is unknown refuses with the route's sentence and its sheet row number. */
export async function anUnknownImportAssetIsTheRoutesSentence(): Promise<void> {
  const service = importService([PUMP_1], writesAnswering({ accepted: [], rejected: [] }));
  expect(await refusalOf(() => service.previewForProposal(USER, CSV, ORG))).toBe("Row 3: Asset not found or outside your access scope.");
}

/** The mappings come from `validateRows`' `mappingNeeded` rows, named by the sheet's asset code. */
export async function theImportMappingsAreTheValidatedRowsThatNeedOne(): Promise<void> {
  const twoRows = csv("PUMP-1,kw,1,2026-10-20T09:00:00Z", "PUMP-1,kva,3,2026-10-20T09:00:00Z");
  const writes = writesAnswering({
    accepted: [accepted(2), accepted(3, { mappingNeeded: true, row: { ...ROW, pointKey: "kva" } })],
    rejected: [],
  });
  const result = await importService([PUMP_1], writes).previewForProposal(USER, twoRows, ORG);
  expect(result.mappingsToCreate).toEqual([{ assetCode: "PUMP-1", pointKey: "kva" }]);
}
