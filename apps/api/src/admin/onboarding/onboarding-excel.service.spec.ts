import * as XLSX from "xlsx";

import { OnboardingExcelService } from "./onboarding-excel.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
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
