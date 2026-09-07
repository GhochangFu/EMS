import { BadRequestException } from "@nestjs/common";
import * as XLSX from "xlsx";

import { syntheticZip } from "../../testing/synthetic-zip";
import { MAX_INFLATED_BYTES } from "../spreadsheet-guard";
import { MAX_IMPORT_FILE_BYTES } from "../telemetry-import/telemetry-import.schema";
import { OnboardingExcelService } from "./onboarding-excel.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * The message `parseUpload` refused a buffer with. Fails the test when the call
 * returns instead of throwing — a guard that silently accepts is the thing
 * every assertion below is looking for.
 *
 * `parseUpload` has one caller, `OnboardingService.uploadExcel`, and it does
 * not catch, so a `BadRequestException` raised here reaches the client as a 400
 * carrying exactly this sentence.
 */
function refusalMessage(buffer: Buffer, what: string): string {
  const service = new OnboardingExcelService();
  try {
    service.parseUpload(buffer);
  } catch (error) {
    assert(
      error instanceof BadRequestException,
      `${what} must be refused as a 400, got ${error instanceof Error ? error.constructor.name : String(error)}`,
    );
    return (error as Error).message;
  }
  throw new Error(`${what} must be refused, but parseUpload returned`);
}

/**
 * `F4.102` — the onboarding workbook upload had no spec at all, so every bound
 * this row adds would have had nothing to be a regression *against*.
 *
 * This first function is deliberately green on the base commit: it pins what
 * `parseUpload` does today with the workbook this same service generates, so
 * the guards that follow can be shown to refuse the hostile shapes **without**
 * changing the honest one. A guard asserted in one direction only is the
 * failure mode this row exists to correct.
 */
export function assertTemplateRoundTripsUnchanged(): void {
  const service = new OnboardingExcelService();
  const buffer = service.buildTemplateBuffer("Berhampur");
  const parsed = service.parseUpload(buffer);

  assert(parsed.location.name === "Berhampur", `location.name, got ${JSON.stringify(parsed.location.name)}`);
  assert(parsed.location.code === "BERHAMPUR", `location.code is upper-cased, got ${JSON.stringify(parsed.location.code)}`);
  assert(parsed.location.slug === "berhampur", `location.slug is lower-cased, got ${JSON.stringify(parsed.location.slug)}`);

  assert(parsed.rtus.length === 2, `the template carries two RTUs, got ${parsed.rtus.length}`);
  assert(parsed.rtus[0].code === "BERHAMPUR-RTU-1", `rtus[0].code, got ${JSON.stringify(parsed.rtus[0].code)}`);
  assert(
    parsed.rtus[0].credentialsSet === false,
    "the template's blank password is a placeholder, so no RTU arrives with credentials set",
  );

  assert(parsed.assets.length === 3, `the template carries three assets, got ${parsed.assets.length}`);
  assert(parsed.assets[2].rtuIndex === 1, `assets[2] belongs to the second RTU, got ${parsed.assets[2].rtuIndex}`);
  assert(parsed.assets[0].domain === "electrical", `assets[0].domain, got ${JSON.stringify(parsed.assets[0].domain)}`);

  assert(
    parsed.rtuCredentials.length === 0,
    `the template's placeholder password must never become a credential, got ${parsed.rtuCredentials.length}`,
  );
  assert(
    parsed.displayNameFixes.length === 0,
    `the template's two display names are distinct, so nothing is adjusted, got ${JSON.stringify(parsed.displayNameFixes)}`,
  );

  // The width the 64-column bound is measured against. The widest of the three
  // sections is `RTU_HEADERS` (rtu_code, rtu_name, protocol, host, port, topic,
  // tls, username, password) — nine columns, so `MAX_HEADER_COLUMNS` leaves
  // roughly 7× headroom over the sheet this system itself produces. The literal
  // is used rather than the constant on purpose: `RTU_HEADERS` is module-private
  // and widening a module's surface for a test is worse than restating nine.
  const book = XLSX.read(buffer, { type: "buffer" });
  const ref = book.Sheets[book.SheetNames[0]]["!ref"];
  assert(ref !== undefined, "the generated template declares a used range");
  const range = XLSX.utils.decode_range(String(ref));
  assert(
    range.e.c - range.s.c + 1 === 9,
    `the template is nine columns wide (RTU_HEADERS.length), got ${range.e.c - range.s.c + 1} from '${String(ref)}'`,
  );
}

/**
 * The service's own byte cap, which is **not** the interceptor's.
 *
 * `onboarding.controller.ts` now declares `limits.fileSize`, and multer refuses
 * an oversize part with a 413 before this method is reached — but the
 * interceptor guards one route, and `parseUpload` is a public method any future
 * caller may reach without it. `mapping-sheet-rows.ts` keeps both for the same
 * reason. Nothing in Vitest instantiates a Nest module, so the interceptor's
 * enforcement is not what this asserts; the cap inside the service is.
 */
export function assertOversizeBufferIsRefused(): void {
  const message = refusalMessage(
    Buffer.alloc(MAX_IMPORT_FILE_BYTES + 1),
    `a ${MAX_IMPORT_FILE_BYTES + 1}-byte upload`,
  );
  assert(
    message.includes(`${MAX_IMPORT_FILE_BYTES}-byte limit`),
    `the refusal names the cap it applied, got "${message}"`,
  );

  // The other direction, and the reason the comparison is `>` and not `>=`: a
  // buffer of exactly the cap is not this guard's business. It is still refused
  // — it holds no LOCATION section — but by the parser, with a different
  // sentence. Measured: `XLSX.read` takes 58 ms over it and yields `!ref` `A1`.
  const atCap = refusalMessage(Buffer.alloc(MAX_IMPORT_FILE_BYTES), "a buffer of exactly the cap");
  assert(
    !atCap.includes("byte limit"),
    `a buffer of exactly the cap is not over it, got "${atCap}"`,
  );
}

/**
 * What the zip *declares* it unpacks to, refused before `XLSX.read` inflates a
 * byte — the third guard `spreadsheet-guard.ts` exists for, and the one
 * `sheetRows` cannot cover because the shared-string table is inflated whole.
 */
export function assertDeclaredZipBombIsRefusedBeforeRead(): void {
  const message = refusalMessage(syntheticZip([500 * 1024 * 1024]), "a zip declaring 500 MB unpacked");
  // `when unpacked` is the discriminator, not decoration. `syntheticZip` builds
  // a central directory over no real payload, so had `XLSX.read` been reached
  // the refusal would have been the unreadable-file sentence instead. The
  // wording is therefore what proves the check ran *first*.
  assert(
    message.includes("when unpacked"),
    `the refusal must come from the declared-inflation guard, got "${message}"`,
  );

  const atBudget = refusalMessage(syntheticZip([MAX_INFLATED_BYTES]), "a zip declaring exactly the budget");
  assert(
    !atBudget.includes("when unpacked"),
    `a zip at exactly the inflation budget is not over it, got "${atBudget}"`,
  );
}
