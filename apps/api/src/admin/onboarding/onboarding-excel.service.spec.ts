import {
  MAX_ONBOARDING_ASSETS,
  MAX_ONBOARDING_RTUS,
  ONBOARDING_DRAFT_STRING_MAX,
} from "@bms/shared";
import { BadRequestException } from "@nestjs/common";
import * as XLSX from "xlsx";

import { buildWorkbookBufferDeclaring } from "../../testing/declared-range-workbook";
import { syntheticZip } from "../../testing/synthetic-zip";
import { MAX_ECHOED_CELL_CHARS, MAX_INFLATED_BYTES } from "../spreadsheet-guard";
import { MAX_HEADER_COLUMNS, SHEET_ROWS_BOUND } from "../telemetry-import/telemetry-import-rows";
import { MAX_IMPORT_FILE_BYTES } from "../telemetry-import/telemetry-import.schema";
import {
  MAX_RTU_TOPIC_CHARS,
  OnboardingExcelService,
  onboardingSheetRangeProblem,
} from "./onboarding-excel.service";
import { onboardingProtocolSchema } from "./onboarding.schema";

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
 *
 * Exported for `onboarding-excel-cell-bounds.spec.ts`, which is the same suite
 * split at AGENTS.md §4.5's line ceiling: the two files must refuse through one
 * helper, or "must be refused as a 400" comes to mean two different things.
 */
export function refusalMessage(buffer: Buffer, what: string): string {
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
  // `F4.103`'s headroom claim, gated instead of asserted in prose: the two count
  // caps are set *above* the sheet this system itself produces, so lowering
  // either below the template turns the generated workbook into a refusal. The
  // constants, never their present values — a restated 100 stops checking
  // anything the moment the cap moves.
  assert(
    parsed.rtus.length <= MAX_ONBOARDING_RTUS,
    `the RTU cap must leave room for the template's own RTUs, got ${parsed.rtus.length} of ${MAX_ONBOARDING_RTUS}`,
  );
  assert(parsed.rtus[0].code === "BERHAMPUR-RTU-1", `rtus[0].code, got ${JSON.stringify(parsed.rtus[0].code)}`);
  assert(
    parsed.rtus[0].credentialsSet === false,
    "the template's blank password is a placeholder, so no RTU arrives with credentials set",
  );

  assert(parsed.assets.length === 3, `the template carries three assets, got ${parsed.assets.length}`);
  assert(
    parsed.assets.length <= MAX_ONBOARDING_ASSETS,
    `the asset cap must leave room for the template's own assets, got ${parsed.assets.length} of ${MAX_ONBOARDING_ASSETS}`,
  );
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

/**
 * The 500-to-400 conversion around `XLSX.read` must not swallow the reason.
 *
 * The `catch` that turns an unreadable buffer into a `BadRequestException` had
 * no binding at all, so the only record that anything went wrong was a sentence
 * the client got and the server did not. That is a support call with nothing to
 * read: every corrupt upload looks identical from the outside.
 *
 * **What may be logged, and at what level.** The error's `message`, and nothing
 * else — never the buffer, never a cell (AGENTS.md §9.6). `debug`, because a
 * client sending a broken file is not an operational fault and must not be able
 * to fill a log by repeating it.
 */
export function assertUnreadableUploadIsLogged(): void {
  const service = new OnboardingExcelService();
  const logged: string[] = [];
  // The service's own logger, replaced in place. `private readonly` is a
  // compile-time constraint on an ordinary own property.
  (service as unknown as { logger: { debug(message: string): void } }).logger = {
    debug: (message: string) => logged.push(message),
  };

  // A zip whose central directory is well-formed and whose payload is not: it
  // passes the size and inflation guards, so `XLSX.read` is what fails.
  const buffer = syntheticZip([1024]);
  let refusal = "";
  try {
    service.parseUpload(buffer);
  } catch (error) {
    refusal = (error as Error).message;
  }
  assert(
    refusal === "Could not read the uploaded file as Excel",
    `an unreadable buffer is still a 400 with the same sentence, got "${refusal}"`,
  );

  assert(logged.length === 1, `the swallowed error is logged exactly once, got ${logged.length}`);
  const line = logged[0];
  const prefix = "onboarding workbook unreadable: ";
  assert(line.startsWith(prefix), `the line says what failed, got "${line}"`);
  assert(
    line.length > prefix.length,
    "the line carries the underlying error message, which is the whole point of logging it",
  );
  // §9.6, asserted rather than trusted: a log line is a message, not a payload.
  assert(line.length < 500, `a log line is bounded, got ${line.length} characters`);
  assert(
    !line.includes(buffer.toString("base64").slice(0, 24)) &&
      !line.includes(buffer.toString("hex").slice(0, 24)),
    `the buffer must never reach the log, got "${line}"`,
  );
}

/**
 * The template's own rows, read back out of the workbook the service generates
 * rather than restated here. Every fixture below is this shape with one thing
 * changed, so the "and the honest sheet still parses" direction compares
 * against the real thing and cannot drift from it.
 *
 * Exported, with the two section offsets below, for
 * `onboarding-excel-cell-bounds.spec.ts` — the same suite, split at §4.5's line
 * ceiling. Copying these into the sibling would give the two files two different
 * workbooks and only one of them would still be the service's own.
 */
export function templateRows(): (string | number)[][] {
  const book = XLSX.read(new OnboardingExcelService().buildTemplateBuffer("Berhampur"), { type: "buffer" });
  return XLSX.utils.sheet_to_json<(string | number)[]>(book.Sheets[book.SheetNames[0]], {
    header: 1,
    defval: "",
  });
}

/** Rows 0–10 of the template: everything down to and including the `ASSETS` header row. */
export const ROWS_ABOVE_THE_FIRST_ASSET = 11;

/** Rows 0–5 of the template: everything down to and including the `RTUS` header row. */
export const ROWS_ABOVE_THE_FIRST_RTU = 6;

/**
 * Row 8 of the template: the blank row that closes the `RTUS` section. Rows 8
 * to {@link ROWS_ABOVE_THE_FIRST_ASSET} are therefore the blank row, the
 * `ASSETS` marker and its header row — taken from the generated template rather
 * than restated, so a change to either marker cannot leave this file describing
 * a workbook the service no longer produces.
 */
const ROWS_CLOSING_THE_RTU_SECTION = 8;

/** An ordinary workbook — no hand-set `!ref`, so SheetJS declares what the cells occupy. */
export function buildWorkbookBuffer(rows: (string | number)[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Onboarding");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
}

/** The template, with its `ASSETS` section grown to `assetRowCount` data rows. */
function rowsWithAssetCount(assetRowCount: number): (string | number)[][] {
  const rows = templateRows().slice(0, ROWS_ABOVE_THE_FIRST_ASSET);
  for (let i = 1; i <= assetRowCount; i += 1) {
    rows.push([`BERHAMPUR-ASSET-${i}`, `Device ${i}`, "BERHAMPUR-RTU-1", "electrical", "Berhampur"]);
  }
  return rows;
}

/**
 * The template with **both** sections grown: `rtuRowCount` RTU data rows and
 * `assetRowCount` asset data rows.
 *
 * Every generated RTU gets its own code and its own display name, so
 * `normalizeRtuDisplayNames` has nothing to adjust and a parse of the under-cap
 * fixture reports exactly the rows the fixture wrote. The assets keep pointing
 * at `BERHAMPUR-RTU-1`, which the first generated row still supplies.
 */
function rowsWithSectionCounts(
  rtuRowCount: number,
  assetRowCount: number,
): (string | number)[][] {
  const template = templateRows();
  const rows = template.slice(0, ROWS_ABOVE_THE_FIRST_RTU);
  for (let i = 1; i <= rtuRowCount; i += 1) {
    rows.push([
      `BERHAMPUR-RTU-${i}`,
      `Berhampur RTU ${i}`,
      "mqtt",
      "phe.thinkiot.co.in",
      "8883",
      `BERHAMPUR-RTU-${i}/Topic1`,
      "true",
      "pheadmin",
      "",
    ]);
  }
  rows.push(...template.slice(ROWS_CLOSING_THE_RTU_SECTION, ROWS_ABOVE_THE_FIRST_ASSET));
  for (let i = 1; i <= assetRowCount; i += 1) {
    rows.push([`BERHAMPUR-ASSET-${i}`, `Device ${i}`, "BERHAMPUR-RTU-1", "electrical", "Berhampur"]);
  }
  return rows;
}

/**
 * The template, with its `RTUS` section grown to `rtuRowCount` data rows and its
 * `ASSETS` section left the size the generated template ships — derived from the
 * template itself, not restated, for the reason
 * {@link ROWS_CLOSING_THE_RTU_SECTION} gives.
 */
function rowsWithRtuCount(rtuRowCount: number): (string | number)[][] {
  return rowsWithSectionCounts(rtuRowCount, templateRows().length - ROWS_ABOVE_THE_FIRST_ASSET);
}

/**
 * Owner ruling 1 — a sheet declaring more than {@link MAX_HEADER_COLUMNS}
 * columns is **refused**, not read through a window.
 *
 * The pure cases matter more than the workbook ones: a hostile
 * `<dimension ref="…"/>` can name a width no writer would ever produce, so the
 * ceiling has to be assertable without a workbook existing. That is why
 * `onboardingSheetRangeProblem` is exported.
 */
export function assertDeclaredWidthIsRefusedNotWindowed(): void {
  // --- the shape that killed the mapping sheet, at O(1) ---------------------
  // A malformed `<dimension ref="A1:AAAAAAAA21"/>`. Nothing may scan this; the
  // answer comes from arithmetic on the range and the clock proves it.
  const started = performance.now();
  const absurd = onboardingSheetRangeProblem({ s: { r: 0, c: 0 }, e: { r: 20, c: 8_353_082_582 } });
  const elapsedMs = performance.now() - started;
  assert(absurd !== null, "a range declaring 8.35 billion columns must be refused");
  assert(
    String(absurd).includes("8353082583"),
    `the refusal names the width it read, got "${String(absurd)}"`,
  );
  assert(
    String(absurd).includes(String(MAX_HEADER_COLUMNS)),
    `the refusal names the bound it applied, got "${String(absurd)}"`,
  );
  // A ceiling, not a benchmark: unbounded, this range takes minutes.
  assert(elapsedMs < 50, `the width check must not scan, took ${elapsedMs.toFixed(1)} ms`);

  // --- the boundary, from both sides ---------------------------------------
  assert(
    onboardingSheetRangeProblem({ s: { r: 0, c: 0 }, e: { r: 10, c: MAX_HEADER_COLUMNS - 1 } }) === null,
    `exactly ${MAX_HEADER_COLUMNS} columns is inside the bound`,
  );
  assert(
    onboardingSheetRangeProblem({ s: { r: 0, c: 0 }, e: { r: 10, c: MAX_HEADER_COLUMNS } }) !== null,
    `${MAX_HEADER_COLUMNS + 1} columns is outside it`,
  );
  // Width counts from the range's own first column, not from column A — a sheet
  // whose used range starts at F is not 5 columns closer to the bound.
  assert(
    onboardingSheetRangeProblem({ s: { r: 0, c: 5 }, e: { r: 10, c: 5 + MAX_HEADER_COLUMNS - 1 } }) === null,
    "a range starting at column F is measured from F",
  );

  // --- which sentence a sheet that breaches both bounds gets ----------------
  // Both branches are O(1), so the order is a choice about what an operator can
  // act on: deleting content to the right is a repair, "your file may have been
  // cut" is not. Neither workbook fixture below fires both branches, so this is
  // the only thing holding that order.
  // One past each bound, expressed as both constants: `30_000` and `100` were
  // literals that stop breaching the moment either bound moves.
  const both = onboardingSheetRangeProblem({
    s: { r: 0, c: 0 },
    e: { r: SHEET_ROWS_BOUND, c: MAX_HEADER_COLUMNS },
  });
  assert(
    String(both).includes("columns"),
    `a sheet over both bounds is told about its width first, got "${String(both)}"`,
  );

  // --- the WIRING: the check must actually run inside parseUpload -----------
  // 702 declared columns over 16 rows — 11× the bound, and milliseconds to
  // write. A full-width fixture cannot exist here; see the helper's docblock.
  const wide = refusalMessage(
    buildWorkbookBufferDeclaring(templateRows(), "A1:ZZ16", "Onboarding"),
    "a workbook declaring 702 columns",
  );
  assert(wide.includes("702"), `the refusal names the declared width, got "${wide}"`);
  assert(wide.includes(String(MAX_HEADER_COLUMNS)), `the refusal names the bound, got "${wide}"`);
  assert(
    wide.includes("to the right"),
    `the refusal tells the operator what to remove, got "${wide}"`,
  );
  // AGENTS.md §4.3 and `spreadsheet-guard.ts`: a refusal describes the range,
  // never the cells. Nothing here may echo sheet text.
  assert(!wide.includes("Berhampur"), `the refusal must not echo cell text, got "${wide}"`);

  // --- ruling 1's rationale, evidenced rather than asserted in prose --------
  // `password` moved one column past the bound, with a real secret under it, so
  // the sheet is one column too wide and is refused. Every index below is
  // `MAX_HEADER_COLUMNS`, never the literal 64: restated, *lowering* the
  // constant would leave this green with the fixture no longer past the bound —
  // which is the whole claim.
  const movedRows = templateRows();
  for (const rowIndex of [5, 6, 7]) {
    const row = [...movedRows[rowIndex]];
    for (let c = 8; c < MAX_HEADER_COLUMNS; c += 1) {
      row[c] = "";
    }
    row[MAX_HEADER_COLUMNS] = rowIndex === 5 ? "password" : `s3cr3t-${rowIndex}`;
    movedRows[rowIndex] = row;
  }
  const moved = refusalMessage(buildWorkbookBuffer(movedRows), "a workbook with password at column BM");
  assert(moved.includes("columns"), `the BM-password sheet is refused for its width, got "${moved}"`);

  // And this is what a windowing read would have returned instead: the same
  // rows cut to exactly the 64 columns a window would keep parse fine, report
  // no credentials, and say nothing at all about the secret that was dropped.
  // That silence is why ruling 1 refuses.
  const windowed = new OnboardingExcelService().parseUpload(
    buildWorkbookBuffer(movedRows.map((row) => row.slice(0, MAX_HEADER_COLUMNS))),
  );
  assert(
    windowed.rtuCredentials.length === 0 && windowed.rtus.every((rtu) => rtu.credentialsSet === false),
    `a windowed read drops the credential silently — that is the point, got ${JSON.stringify(windowed.rtuCredentials)}`,
  );

  // --- the other direction: at the bound, nothing changes -------------------
  // `A1:BL16` is exactly 64 columns and two rows more than the template holds.
  // Every extra cell densifies to "", which washes out through the header
  // `indexOf` and the blank-row break, so the parse must be identical.
  const atBound = new OnboardingExcelService().parseUpload(
    buildWorkbookBufferDeclaring(templateRows(), "A1:BL16", "Onboarding"),
  );
  const untouched = new OnboardingExcelService().parseUpload(
    new OnboardingExcelService().buildTemplateBuffer("Berhampur"),
  );
  assert(
    JSON.stringify(atBound) === JSON.stringify(untouched),
    `a sheet at exactly the column bound parses unchanged, got ${JSON.stringify(atBound)}`,
  );
}

/**
 * `F4.103` — a `RTUS` or `ASSETS` section holding more data rows than its cap is
 * refused before the parser walks it.
 *
 * **This is a different guard from the reading bound, and the two are proved
 * apart rather than together.** `onboardingSheetRangeProblem` bounds what
 * `sheet_to_json` may densify and fires on the declared range; this one bounds
 * what the draft may carry once it has been read, and fires on a count. Every
 * fixture below is under the reading bound, so nothing here can pass because
 * the other guard answered — and `assertSheetReachingTheRowBoundIsRefused`
 * asserts the same separation from the other side.
 *
 * The pure boundary cases live in `onboarding-draft-caps.spec.ts`. What this
 * function adds is the **wiring**: that `parseUpload` calls the guard at all,
 * that it counts data rows rather than section rows, and that the sheet the
 * caps were sized against still parses.
 */
export function assertOverCapSectionIsRefused(): void {
  // --- ASSETS, from both sides ---------------------------------------------
  const atAssetCap = new OnboardingExcelService().parseUpload(
    buildWorkbookBuffer(rowsWithAssetCount(MAX_ONBOARDING_ASSETS)),
  );
  assert(
    atAssetCap.assets.length === MAX_ONBOARDING_ASSETS,
    `a sheet of exactly ${MAX_ONBOARDING_ASSETS} asset rows parses whole, got ${atAssetCap.assets.length}`,
  );

  const overAssets = refusalMessage(
    buildWorkbookBuffer(rowsWithAssetCount(MAX_ONBOARDING_ASSETS + 1)),
    `a sheet of ${MAX_ONBOARDING_ASSETS + 1} asset rows`,
  );
  assert(
    overAssets.includes("ASSETS"),
    `the refusal names the section to repair, got "${overAssets}"`,
  );
  // The count is the section's **data** rows, not its rows: one more than the
  // cap, never one more than that. This is what pins the `length - 1` in
  // `parseUpload`, and it is the number the operator counts down the sheet.
  assert(
    overAssets.includes(String(MAX_ONBOARDING_ASSETS + 1)),
    `the refusal names the data-row count it found, got "${overAssets}"`,
  );
  assert(
    overAssets.includes(String(MAX_ONBOARDING_ASSETS)),
    `the refusal names the cap it applied, got "${overAssets}"`,
  );
  // AGENTS.md §4.3, the rule every refusal in this file follows: a refusal
  // describes what it refused and never repeats a cell. Both of the template's
  // own strings are checked, because the fixture rows carry both.
  assert(
    !overAssets.includes("Berhampur") && !overAssets.includes("BERHAMPUR-RTU-1"),
    `the refusal must not echo cell text, got "${overAssets}"`,
  );

  // --- RTUS, from both sides ------------------------------------------------
  const atRtuCap = new OnboardingExcelService().parseUpload(
    buildWorkbookBuffer(rowsWithRtuCount(MAX_ONBOARDING_RTUS)),
  );
  assert(
    atRtuCap.rtus.length === MAX_ONBOARDING_RTUS,
    `a sheet of exactly ${MAX_ONBOARDING_RTUS} RTU rows parses whole, got ${atRtuCap.rtus.length}`,
  );
  // The grown section is still an honest workbook: its assets resolve to the
  // first generated RTU, and no display name needed adjusting. Without this the
  // at-cap case above could pass over a fixture the parser had quietly repaired.
  assert(
    atRtuCap.displayNameFixes.length === 0 && atRtuCap.assets.every((asset) => asset.rtuIndex === 0),
    `the grown RTUS section parses as written, got ${JSON.stringify(atRtuCap.displayNameFixes)}`,
  );

  const overRtus = refusalMessage(
    buildWorkbookBuffer(rowsWithRtuCount(MAX_ONBOARDING_RTUS + 1)),
    `a sheet of ${MAX_ONBOARDING_RTUS + 1} RTU rows`,
  );
  assert(overRtus.includes("RTUS"), `the refusal names the section to repair, got "${overRtus}"`);
  assert(
    overRtus.includes(String(MAX_ONBOARDING_RTUS + 1)) &&
      overRtus.includes(String(MAX_ONBOARDING_RTUS)),
    `the refusal names the count it found and the cap it applied, got "${overRtus}"`,
  );

  // --- which section a sheet over both caps is told about (owner answer 2) ---
  // `RTUS` appears above `ASSETS` in the sheet and is the first thing an
  // operator scrolls to. Nothing but the loop's order in `parseUpload` holds
  // this, exactly as the width-versus-height ordering above is held by one case.
  const both = refusalMessage(
    buildWorkbookBuffer(
      rowsWithSectionCounts(MAX_ONBOARDING_RTUS + 1, MAX_ONBOARDING_ASSETS + 1),
    ),
    `a sheet over both section caps`,
  );
  assert(
    both.includes("RTUS") && !both.includes("ASSETS"),
    `a sheet over both caps is told about its RTUS section first, got "${both}"`,
  );

  // --- the regression direction: the sheet this system itself produces ------
  // `assertTemplateRoundTripsUnchanged` asserts the template's counts are under
  // both caps; this asserts the guard does not refuse it anyway.
  const template = new OnboardingExcelService().parseUpload(
    new OnboardingExcelService().buildTemplateBuffer("Berhampur"),
  );
  assert(
    template.rtus.length === 2 && template.assets.length === 3,
    `the generated template survives both caps, got ${template.rtus.length} RTUs and ${template.assets.length} assets`,
  );
}

/**
 * Owner ruling 2 — reuse {@link SHEET_ROWS_BOUND} rather than invent a tighter
 * figure, and refuse a sheet that **reaches** it.
 *
 * **`F4.103` supersedes the half of ruling 2 that declined a tighter figure**
 * (owner confirmed 2026-09-08). A tighter one was declined then because
 * `onboardingDraftSchema` carried no `.max()` to derive it from, and that is
 * exactly what `F4.103` supplies: {@link MAX_ONBOARDING_ASSETS} is not invented
 * here, it is the cap the draft schema already enforces on the same array. So
 * the third fixture below — a sheet one row under the reading bound, which
 * declares 20,090 assets — has **flipped from parsing whole to being refused by
 * the ASSETS cap**, and this docblock says so rather than the assertion being
 * quietly edited.
 *
 * **Ruling 2's surviving half is untouched, and is still what these fixtures
 * pin.** `SHEET_ROWS_BOUND` is still the read bound, still reused rather than
 * re-invented, and still the guard a sheet *at* the bound gets. The two guards
 * are distinct and are asserted to be: the first and third fixtures below sit
 * one row apart and get different sentences, and the count check's sentence is
 * asserted **not** to mention the reading bound.
 *
 * **What is lost by the flip, and how it is kept.** The old assertion was the
 * only evidence that a sheet under the bound is read *whole* — that
 * `sheetRows: SHEET_ROWS_BOUND` does not silently cut short of it. That evidence
 * survives in the refusal itself: the sentence interpolates the data-row count
 * `sectionRows` returned, so asserting the message names 20,090 says the reader
 * reached all 20,090 rows and the cap refused them, in one assertion.
 *
 * **What `sheetRows` does and does not buy, honestly.** With this refusal in
 * place a 25,000-row sheet is refused with or without `sheetRows` — the
 * declared range says so either way. What `sheetRows` bounds is how much
 * SheetJS materialises *before* the check can run, and that is gated by the
 * V1/V2 heap measurements recorded on `onboardingSheetRangeProblem`, not by
 * anything in this suite. Do not read a green run here as evidence that
 * `sheetRows` is doing the work: it is a cost bound, not a correctness one.
 */
export function assertSheetReachingTheRowBoundIsRefused(): void {
  // Exactly at the bound: 20,102 rows = 11 template rows above the assets plus
  // 20,091 asset rows. Reaching it is enough — the sheet may have been cut, and
  // a cut workbook must never be imported as if it were whole.
  const atBound = refusalMessage(
    buildWorkbookBuffer(rowsWithAssetCount(SHEET_ROWS_BOUND - ROWS_ABOVE_THE_FIRST_ASSET)),
    `a sheet of exactly ${SHEET_ROWS_BOUND} rows`,
  );
  assert(
    atBound.includes(`reading bound of ${SHEET_ROWS_BOUND} rows`),
    `the refusal says the reading bound is what fired, got "${atBound}"`,
  );
  // The count of what survived a cut is not the size of the file. Quoting it
  // produced a self-contradicting message in the sibling parser (F2.7
  // post-merge review, finding 1), so nothing here quotes a data-row count.
  assert(
    !atBound.includes(String(SHEET_ROWS_BOUND - ROWS_ABOVE_THE_FIRST_ASSET)),
    `the refusal must not quote a data-row count as the file's, got "${atBound}"`,
  );

  // One row fewer clears the reading bound — and is then refused by the ASSETS
  // count cap `F4.103` added. This is the assertion that flipped, and the
  // docblock above says why. The fixture and the claim still share one
  // expression: a restated `20_090` would pass with either bound moved, and then
  // vouch for nothing.
  const assetsUnderBound = SHEET_ROWS_BOUND - 1 - ROWS_ABOVE_THE_FIRST_ASSET;
  const underBound = refusalMessage(
    buildWorkbookBuffer(rowsWithAssetCount(assetsUnderBound)),
    `a sheet one row under the bound, holding ${assetsUnderBound} assets`,
  );
  assert(
    underBound.includes("ASSETS") && underBound.includes(String(MAX_ONBOARDING_ASSETS)),
    `a sheet under the reading bound is refused by the ASSETS cap, got "${underBound}"`,
  );
  // Ruling 2's surviving evidence, carried through the flip: the sentence
  // interpolates the data-row count `sectionRows` returned, so naming
  // ${assetsUnderBound} is what says the reader reached every row up to the
  // bound before the cap refused them. `sheetRows` cut nothing short of it.
  assert(
    underBound.includes(String(assetsUnderBound)),
    `the refusal names every row the reader reached, got "${underBound}"`,
  );
  // And the two guards are distinct rather than one masking the other: this
  // sheet is inside the reading bound, so nothing here may mention it. One row
  // more and the sentence above fires instead.
  assert(
    !underBound.includes("reading bound"),
    `the count cap is a different guard from the reading bound, got "${underBound}"`,
  );

  // And the case where `sheetRows` really cuts: 25,000 rows come back clamped
  // at the bound, so the declared range reads as exactly the bound and the same
  // sentence fires. Without the refusal this file would import as ~20,000 rows
  // with nothing said.
  const cut = refusalMessage(buildWorkbookBuffer(rowsWithAssetCount(24_989)), "a 25,000-row sheet");
  assert(
    cut.includes(`reading bound of ${SHEET_ROWS_BOUND} rows`),
    `a cut sheet gets the same sentence, got "${cut}"`,
  );
}

/**
 * The `displayNameFixes` line is sheet text read back to the operator, so it
 * carries `quoteCell` (`spreadsheet-guard.ts`) like every other echo site
 * (owner ruling 3). Named in prose, not `{@link}`: the helper is not imported
 * here, and an unresolved link renders as plain text.
 *
 * **The bound is on the message, never on the data.** Both RTUs keep the whole
 * cell they were given — the first its 32,767-character display name, the
 * second the 32,767-character *code* the fix substituted — and only the
 * sentence that reports the adjustment is cut. Both halves are asserted,
 * because a "fix" that quietly truncated the stored name would pass a
 * message-length check and corrupt the import.
 *
 * `assetDomainFromCell`'s pass-through needs no `quoteCell` and deliberately
 * has none: `draftAssetSchema.domain` is `assetDomainCodeSchema`, i.e.
 * `z.string().min(1).max(64)`, and `OnboardingValidateService.validate` runs
 * `onboardingDraftSchema.safeParse` before `assertAssetDomain`, so
 * `unknownCodeMessage` can never be handed an unbounded value. Zod's `too_big`
 * message states the bound and never repeats the value, which is what makes
 * that safe.
 *
 * **The same reasoning does not carry to an enum, and the post-merge review of
 * `c79114c4` found where.** `invalid_enum_value` *does* repeat the whole
 * received value, so a `z.enum` field fed straight from a cell is an echo site
 * however short the schema's other members are — see
 * `assertUnknownRtuProtocolIsRefused` below for `protocol`, the sixth site.
 * `location.type` is the other enum reachable from this sheet and is safe by a
 * different route: `parseLocation` maps anything that is not `rsmoc` or
 * `csmoc` onto `smoc_campus`, so no cell text ever reaches it.
 */
export function assertEchoedSheetTextIsBounded(): void {
  // **`F4.104` shrank this fixture, and the case is the same one.** It used
  // 32,767-character cells, which the parse-site bounds now refuse before
  // `normalizeRtuDisplayNames` is reached — so the fixture is written at the
  // largest cell an RTU row may now carry. Nothing about what it proves has
  // moved: `quoteCell` bounds the *message*, the parse site bounds the *draft*,
  // and the two guards answer different failure modes.
  //
  // The relationship the case rests on is asserted rather than assumed. A cell
  // bound at or below the echo bound would leave `quoteCell` with nothing to
  // cut, and every assertion below would pass while proving nothing.
  assert(
    ONBOARDING_DRAFT_STRING_MAX["rtus.displayName"] > MAX_ECHOED_CELL_CHARS,
    `the echo cut is what this case proves, and it needs a cell bound above ${MAX_ECHOED_CELL_CHARS}, ` +
      `got ${ONBOARDING_DRAFT_STRING_MAX["rtus.displayName"]}`,
  );

  const rows = templateRows();
  // Two RTUs sharing one display name, each with its own maximum-length code.
  // The name and the codes are three *different* strings on purpose: were the
  // code equal to the name, `displayNameFromRtuCode` would return the name
  // unchanged, nothing would be pushed, and the count below would pass for the
  // wrong reason.
  const sharedName = "N".repeat(ONBOARDING_DRAFT_STRING_MAX["rtus.displayName"]);
  const duplicateCode = "B".repeat(ONBOARDING_DRAFT_STRING_MAX["rtus.code"]);
  rows[6] = [...rows[6]];
  rows[7] = [...rows[7]];
  rows[6][0] = "A".repeat(ONBOARDING_DRAFT_STRING_MAX["rtus.code"]);
  rows[6][1] = sharedName;
  rows[7][0] = duplicateCode;
  rows[7][1] = sharedName;

  const parsed = new OnboardingExcelService().parseUpload(buildWorkbookBuffer(rows));
  assert(
    parsed.displayNameFixes.length === 1,
    `the duplicate display name is adjusted once, got ${parsed.displayNameFixes.length}`,
  );
  const line = parsed.displayNameFixes[0];
  assert(line.length < 400, `the reported fix must be bounded, got ${line.length} characters`);
  assert(line.includes("more characters"), `a cut cell says how much was omitted, got "${line}"`);
  // The RTU that keeps the name it was given is index **0**. Index 1 is the
  // duplicate, whose name `normalizeRtuDisplayNames` replaced, so a length
  // check there vouches for the substituted code and never for the given name —
  // which is what it did until the post-merge review of `c79114c4`.
  assert(
    parsed.rtus[0].displayName === sharedName,
    `the first RTU keeps all ${sharedName.length} characters of the name it was given, got ${parsed.rtus[0].displayName.length}`,
  );
  // Kept, restated for what it actually proves: the substitution is not a
  // truncation either. The duplicate's name becomes its own maximum-length
  // code, whole.
  assert(
    parsed.rtus[1].displayName === duplicateCode,
    `the duplicate's name is replaced by its full code, got ${parsed.rtus[1].displayName.length} characters`,
  );
}

/**
 * The `topic` cell is **refused** past {@link MAX_RTU_TOPIC_CHARS}, not cut
 * (post-merge review, finding 1; owner ruling).
 *
 * `topic` is the one RTU cell that reaches a response message unquoted —
 * `mqttSetupTemplate` prints it as `topic: <value>` so the operator can edit
 * the block and paste it back, and quoting it would put the quote character
 * inside the topic the paste-back parser stores. Bounding it here is what makes
 * that echo safe, which is why the refusal lives at the parse boundary rather
 * than at the interpolation.
 *
 * **Refusing, not truncating, is the point.** A silently shortened topic is a
 * subscription to a topic nobody asked for: the RTU commits, ingest connects,
 * and no telemetry ever arrives. The bound is not invented either — see the
 * constant's docblock for where 255 comes from.
 */
export function assertOverlongRtuTopicIsRefused(): void {
  // Exactly at the bound, on the second RTU row: parsed, and kept whole.
  const legalRows = templateRows();
  legalRows[7] = [...legalRows[7]];
  legalRows[7][5] = "L".repeat(MAX_RTU_TOPIC_CHARS);
  const parsed = new OnboardingExcelService().parseUpload(buildWorkbookBuffer(legalRows));
  assert(
    String(parsed.rtus[1].config.topic).length === MAX_RTU_TOPIC_CHARS,
    `a topic of exactly ${MAX_RTU_TOPIC_CHARS} characters parses whole, got ${String(parsed.rtus[1].config.topic).length}`,
  );

  // One character more, same row.
  const overRows = templateRows();
  overRows[7] = [...overRows[7]];
  overRows[7][5] = "X".repeat(MAX_RTU_TOPIC_CHARS + 1);
  const message = refusalMessage(
    buildWorkbookBuffer(overRows),
    `a topic of ${MAX_RTU_TOPIC_CHARS + 1} characters`,
  );
  assert(
    message.includes("RTU row 2"),
    `the refusal names the row to repair — the second RTU data row, got "${message}"`,
  );
  assert(
    message.includes(String(MAX_RTU_TOPIC_CHARS + 1)),
    `the refusal names the length it read, got "${message}"`,
  );
  assert(
    message.includes(String(MAX_RTU_TOPIC_CHARS)),
    `the refusal names the bound it applied, got "${message}"`,
  );
  // AGENTS.md §4.3, and the same rule the range refusals follow: a refusal
  // describes the cell, never echoes it. A 32,767-character topic quoted back
  // is the amplification this row exists to close.
  assert(
    !message.includes("XXXXXXXXXX"),
    `the refusal must not echo the topic it refused, got "${message.slice(0, 200)}"`,
  );

  // And the honest sheet is untouched: the template's own topics are short.
  const template = new OnboardingExcelService().parseUpload(
    new OnboardingExcelService().buildTemplateBuffer("Berhampur"),
  );
  assert(
    template.rtus[0].config.topic === "BERHAMPUR-RTU-1/Topic1",
    `the template's topic survives the bound, got ${JSON.stringify(template.rtus[0].config.topic)}`,
  );
}

/**
 * The **sixth** echo site, and the one every guard this row shipped with let
 * through: the `protocol` cell was cast, not validated (post-merge review of
 * `c79114c4`; owner ruling).
 *
 * `parseRtus` wrote `get(values, "protocol") as OnboardingProtocol` straight
 * into the draft. `draftRtuSchema.protocol` is `onboardingProtocolSchema`, a
 * `z.enum`, and Zod 3's `invalid_enum_value` message embeds the **whole**
 * received value — so `OnboardingValidateService.validate` turned one hostile
 * cell per row into one maximum-length string per row, returned in
 * `validationErrors` of the upload response, after the same draft was written
 * to `onboarding_sessions.draft`.
 *
 * **Why the other five guards do not see it.** A shared-string table lets every
 * RTU row reference *one* 32,767-character value, so the file stays small and
 * declares little. Measured on `c79114c4` (xlsx 0.20.3, zod 3.25.76): 2,000 RTU
 * rows in a 231,182-byte upload returned **65.8 MB** of `validationErrors`, and
 * 20,090 rows in a 2,274,916-byte upload took the draft jsonb to ~658 MB and
 * died at the write with `RangeError: Invalid string length`. Both passed the
 * interceptor's limits, the byte cap, the inflation budget, the declared width,
 * the reading bound and the topic bound.
 *
 * So the fix is the same shape the topic took: refuse at the parse boundary,
 * and **echo the length, never the value** (AGENTS.md §4.3). Validating here
 * closes the spreadsheet route only — `PATCH :id/draft` and the model's
 * `draftPatch` write `rtus[].protocol` into the same enum, which is the already
 * filed `.max()`-on-the-draft-schema row, deliberately not this one.
 */
export function assertUnknownRtuProtocolIsRefused(): void {
  // The whole vocabulary parses, not just the default. `modbus_tcp` also flips
  // `ingestEnabled`, so this pins that the guard reads the cell rather than
  // replacing it with `mqtt`.
  const legalRows = templateRows();
  legalRows[7] = [...legalRows[7]];
  legalRows[7][2] = "modbus_tcp";
  const parsed = new OnboardingExcelService().parseUpload(buildWorkbookBuffer(legalRows));
  assert(
    parsed.rtus[0].protocol === "mqtt",
    `an ordinary mqtt row parses unchanged, got ${JSON.stringify(parsed.rtus[0].protocol)}`,
  );
  assert(
    parsed.rtus[0].ingestEnabled === true,
    "an mqtt RTU still arrives with ingest enabled",
  );
  assert(
    parsed.rtus[1].protocol === "modbus_tcp",
    `every member of the vocabulary parses, got ${JSON.stringify(parsed.rtus[1].protocol)}`,
  );
  assert(
    parsed.rtus[1].ingestEnabled === false,
    "a non-mqtt RTU arrives with ingest disabled, as it did before the guard",
  );

  // A blank cell is not an unknown protocol — it is the `mqtt` default, and the
  // guard must not turn the sheet's own optional column into a refusal.
  const blankRows = templateRows();
  blankRows[6] = [...blankRows[6]];
  blankRows[6][2] = "";
  const blank = new OnboardingExcelService().parseUpload(buildWorkbookBuffer(blankRows));
  assert(
    blank.rtus[0].protocol === "mqtt",
    `a blank protocol cell still defaults to mqtt, got ${JSON.stringify(blank.rtus[0].protocol)}`,
  );

  // A hand-written sheet says `MQTT`, and that is the same protocol. The fold
  // is the owner's ruling and matches `assetDomainFromCell`, which normalises
  // its own cell for the same stated reason — so the guard refuses an unknown
  // protocol, never a differently-typed known one. Spacing folds too: the
  // section reader trims, and this pins the parser's own fold rather than
  // relying on that.
  const casedRows = templateRows();
  casedRows[6] = [...casedRows[6]];
  casedRows[7] = [...casedRows[7]];
  casedRows[6][2] = "MQTT";
  casedRows[7][2] = "  Modbus_TCP  ";
  const cased = new OnboardingExcelService().parseUpload(buildWorkbookBuffer(casedRows));
  assert(
    cased.rtus[0].protocol === "mqtt",
    `an uppercase MQTT cell imports as mqtt, got ${JSON.stringify(cased.rtus[0].protocol)}`,
  );
  assert(
    cased.rtus[1].protocol === "modbus_tcp",
    `a mixed-case padded cell imports folded, got ${JSON.stringify(cased.rtus[1].protocol)}`,
  );
  // The fold must not leak past the vocabulary check into what the RTU does.
  assert(
    cased.rtus[0].ingestEnabled === true && cased.rtus[1].ingestEnabled === false,
    "a folded protocol drives ingestEnabled exactly as the lowercase spelling does",
  );

  // The amplifier itself: one maximum-length cell, on the second RTU row.
  const hostileRows = templateRows();
  hostileRows[7] = [...hostileRows[7]];
  hostileRows[7][2] = "Z".repeat(32_767);
  const message = refusalMessage(
    buildWorkbookBuffer(hostileRows),
    "a 32,767-character protocol cell",
  );
  assert(
    message.includes("RTU row 2"),
    `the refusal names the row to repair — the second RTU data row, got "${message}"`,
  );
  assert(
    message.includes(String(32_767)),
    `the refusal names the length it read, got "${message}"`,
  );
  assert(
    onboardingProtocolSchema.options.every((option) => message.includes(option)),
    `the refusal names the vocabulary the operator must choose from, got "${message}"`,
  );
  // The point of the whole row: the refusal is bounded by what it says, not by
  // what it was given. A message that carried the cell would be the same
  // amplification through a 400 instead of a 200.
  assert(
    !message.includes("ZZZZZZZZZZ"),
    `the refusal must not echo the protocol it refused, got "${message.slice(0, 200)}"`,
  );
  assert(
    message.length < 500,
    `the refusal is a sentence, not a copy of the cell, got ${message.length} characters`,
  );

  // A short unknown value is refused on the same sentence. Asserted because the
  // guard is about the vocabulary, not the length — a bound alone would let
  // `http` through to the enum and back out through `validationErrors`.
  const shortRows = templateRows();
  shortRows[6] = [...shortRows[6]];
  shortRows[6][2] = "http";
  const shortMessage = refusalMessage(buildWorkbookBuffer(shortRows), "an unknown short protocol");
  assert(
    shortMessage.includes("RTU row 1") && shortMessage.includes("of 4 characters"),
    `a four-character unknown protocol is refused by the same sentence, got "${shortMessage}"`,
  );

  // And the honest sheet is untouched.
  const template = new OnboardingExcelService().parseUpload(
    new OnboardingExcelService().buildTemplateBuffer("Berhampur"),
  );
  assert(
    template.rtus.every((rtu) => rtu.protocol === "mqtt"),
    `the template's own protocol column survives the guard, got ${JSON.stringify(template.rtus.map((rtu) => rtu.protocol))}`,
  );
}
