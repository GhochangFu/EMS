import { BadRequestException } from "@nestjs/common";

import { modbusDraftConfigSchema } from "@bms/shared";

import { applyWorkbookProfiles, type OnboardingProfileRef } from "./onboarding-device-profiles";
import { OnboardingExcelService } from "./onboarding-excel.service";
import { buildWorkbookBuffer, refusalMessage, templateRows } from "./onboarding-excel.service.spec";

/**
 * `F1.2` plan PR 11 (ADR 0141 Amendment 1 (f), decision 23) — the workbook names a device profile
 * by **code** (`profile_code`), beside the unit id it binds (`unit_id`), on a Modbus TCP row. The
 * parser reads no database: it checks the cell and hands the code on (`rtuProfileCodes`); the
 * upload resolves it to the organization's newest version (`applyWorkbookProfiles`) and the draft
 * holds that row's id. A code is what an operator can read off the Device profiles page; an id is
 * not. Every refusal names the row and the column, never the cell (§4.3, §9.6).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const LOCATION_TYPE_CODES = ["smoc_campus", "rsmoc", "csmoc", "pump_station"] as const;
/** The template's two RTU data rows. */
const FIRST_RTU_ROW = 6;
const PROTOCOL = 2;
const UNIT_ID = 9;
const PROFILE_CODE = 10;

/** The template with its second RTU row turned into a Modbus row carrying `unitId` and `profile`. */
function modbusRows(unitId: string, profile: string, protocol = "modbus_tcp"): (string | number)[][] {
  const rows = templateRows();
  const row = [...rows[FIRST_RTU_ROW + 1]];
  while (row.length <= PROFILE_CODE) {
    row.push("");
  }
  row[PROTOCOL] = protocol;
  row[UNIT_ID] = unitId;
  row[PROFILE_CODE] = profile;
  rows[FIRST_RTU_ROW + 1] = row;
  return rows;
}

function parse(rows: (string | number)[][]) {
  return new OnboardingExcelService().parseUpload(buildWorkbookBuffer(rows), LOCATION_TYPE_CODES);
}

/** XP1 — the template names both columns, after the nine it had, so an older workbook still reads. */
export function assertTheTemplateNamesTheTwoColumnsLast(): void {
  const header = templateRows()[FIRST_RTU_ROW - 1].map(String);
  assert(header[UNIT_ID] === "unit_id" && header[PROFILE_CODE] === "profile_code", `got ${JSON.stringify(header)}`);
}

/** XP2 — a Modbus row's unit id lands in `device`, its profile code goes to `rtuProfileCodes`, ingest stays off. */
export function assertAModbusRowCarriesItsUnitIdAndProfileCode(): void {
  const parsed = parse(modbusRows("7", "pm5110"));
  const rtu = parsed.rtus[1];
  const { host, port } = rtu.config;
  assert(JSON.stringify(rtu.config) === JSON.stringify({ host, port, device: { unitId: 7 } }), `got ${JSON.stringify(rtu.config)}`);
  assert(modbusDraftConfigSchema.safeParse(rtu.config).success, "the row passes the Modbus draft schema");
  assert(rtu.ingestEnabled === false, "ingest is switched on in the chat or the wizard, never by the sheet");
  assert(JSON.stringify(parsed.rtuProfileCodes) === JSON.stringify([{ rtuIndex: 1, code: "pm5110" }]), `got ${JSON.stringify(parsed.rtuProfileCodes)}`);
  const plain = parse(modbusRows("", ""));
  assert(JSON.stringify(plain.rtus[1].config) === JSON.stringify({ host, port }), "blank cells add nothing");
  assert(plain.rtuProfileCodes.length === 0, "no code, nothing to resolve");
}

/** XP3 — a unit id that is not a whole number, or a profile code outside the code class, refuses the upload without echo. */
export function assertABadCellIsRefusedWithoutEcho(): void {
  for (const [unitId, profile] of [
    ["s3ntinel", ""],
    ["1.5", ""],
    ["1", "s3ntinel code!"],
    ["1", `s3ntinel${"x".repeat(80)}`],
  ]) {
    const message = refusalMessage(buildWorkbookBuffer(modbusRows(unitId, profile)), `unit_id ${unitId} / profile_code`);
    assert(message.startsWith("RTU row 2 "), `the row is named, got ${message}`);
    assert(!message.includes("s3ntinel") && !message.includes("1.5"), `no cell is echoed, got ${message}`);
  }
}

/** XP4 — a profile code on a row of another protocol is refused: only a Modbus TCP RTU is bound. */
export function assertAProfileCodeOnAnotherProtocolIsRefused(): void {
  const message = refusalMessage(buildWorkbookBuffer(modbusRows("", "pm5110", "mqtt")), "profile_code on mqtt");
  assert(message.includes("RTU row 2") && message.includes("Modbus TCP"), `got ${message}`);
}

/** XP5 — the upload writes the resolved id on the row; an unknown code is refused by row, never echoed. */
export async function assertTheUploadResolvesTheCodeToTheOrganizationsProfile(): Promise<void> {
  const ref: OnboardingProfileRef = { id: "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b", code: "pm5110", version: 2 };
  const asked: string[][] = [];
  const resolve = async (codes: readonly string[]) => {
    asked.push([...codes]);
    return new Map(codes.filter((code) => code === "pm5110").map((code) => [code, ref] as const));
  };
  const parsed = parse(modbusRows("7", "pm5110"));
  await applyWorkbookProfiles(parsed, resolve);
  assert((parsed.rtus[1].config as Record<string, unknown>).profileId === ref.id, `got ${JSON.stringify(parsed.rtus[1].config)}`);
  assert(modbusDraftConfigSchema.safeParse(parsed.rtus[1].config).success, "the resolved row passes the draft schema");

  const unknown = parse(modbusRows("7", "s3ntinel-code"));
  let caught: unknown;
  await applyWorkbookProfiles(unknown, resolve).catch((err: unknown) => {
    caught = err;
  });
  assert(caught instanceof BadRequestException, "an unknown code is a 400");
  const message = (caught as BadRequestException).message;
  assert(message.startsWith("RTU row 2 ") && !message.includes("s3ntinel"), `got ${message}`);

  const none = parse(modbusRows("", ""));
  asked.length = 0;
  await applyWorkbookProfiles(none, resolve);
  assert(asked.length === 0, "a sheet naming no profile reads nothing");
}
