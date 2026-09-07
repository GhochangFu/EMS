import { BadRequestException } from "@nestjs/common";
import * as XLSX from "xlsx";

import { buildWorkbookBufferDeclaring } from "../../testing/declared-range-workbook";
import { syntheticZip } from "../../testing/synthetic-zip";
import { MAX_INFLATED_BYTES } from "../spreadsheet-guard";
import { MAX_HEADER_COLUMNS, SHEET_ROWS_BOUND } from "../telemetry-import/telemetry-import-rows";
import { MAX_IMPORT_FILE_BYTES } from "../telemetry-import/telemetry-import.schema";
import {
  MAX_RTU_TOPIC_CHARS,
  OnboardingExcelService,
  onboardingSheetRangeProblem,
} from "./onboarding-excel.service";

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
 */
function templateRows(): (string | number)[][] {
  const book = XLSX.read(new OnboardingExcelService().buildTemplateBuffer("Berhampur"), { type: "buffer" });
  return XLSX.utils.sheet_to_json<(string | number)[]>(book.Sheets[book.SheetNames[0]], {
    header: 1,
    defval: "",
  });
}

/** Rows 0–10 of the template: everything down to and including the `ASSETS` header row. */
const ROWS_ABOVE_THE_FIRST_ASSET = 11;

/** An ordinary workbook — no hand-set `!ref`, so SheetJS declares what the cells occupy. */
function buildWorkbookBuffer(rows: (string | number)[][]): Buffer {
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
 * Owner ruling 2 — reuse {@link SHEET_ROWS_BOUND} rather than invent a tighter
 * figure, and refuse a sheet that **reaches** it.
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

  // One row fewer parses whole. This is what pins ruling 2: no figure tighter
  // than SHEET_ROWS_BOUND was invented, so a workbook one row under the bound
  // keeps every asset it declares. The fixture and the claim share one
  // expression — a restated `20_090` still passes with the bound moved, and
  // then vouches for nothing.
  const assetsUnderBound = SHEET_ROWS_BOUND - 1 - ROWS_ABOVE_THE_FIRST_ASSET;
  const underBound = new OnboardingExcelService().parseUpload(
    buildWorkbookBuffer(rowsWithAssetCount(assetsUnderBound)),
  );
  assert(
    underBound.assets.length === assetsUnderBound,
    `a sheet one row under the bound is read whole, got ${underBound.assets.length} of ${assetsUnderBound} assets`,
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
 * **The bound is on the message, never on the data.** The RTU keeps the whole
 * display name it was given; only the sentence that reports the adjustment is
 * cut. Both halves are asserted, because a "fix" that quietly truncated the
 * stored name would pass a message-length check and corrupt the import.
 *
 * `assetDomainFromCell`'s pass-through needs no `quoteCell` and deliberately
 * has none: `onboardingDraftAssetSchema.domain` is
 * `z.string().min(1).max(64)`, and `OnboardingValidateService.validate` runs
 * `onboardingDraftSchema.safeParse` before `assertAssetDomain`, so
 * `unknownCodeMessage` can never be handed an unbounded value. Recorded here so
 * the next reviewer does not have to re-derive it.
 */
export function assertEchoedSheetTextIsBounded(): void {
  const rows = templateRows();
  // Two RTUs sharing one display name, each with its own maximum-length code.
  // The name and the codes are three *different* strings on purpose: were the
  // code equal to the name, `displayNameFromRtuCode` would return the name
  // unchanged, nothing would be pushed, and the count below would pass for the
  // wrong reason.
  const sharedName = "N".repeat(32_767);
  rows[6] = [...rows[6]];
  rows[7] = [...rows[7]];
  rows[6][0] = "A".repeat(32_767);
  rows[6][1] = sharedName;
  rows[7][0] = "B".repeat(32_767);
  rows[7][1] = sharedName;

  const parsed = new OnboardingExcelService().parseUpload(buildWorkbookBuffer(rows));
  assert(
    parsed.displayNameFixes.length === 1,
    `the duplicate display name is adjusted once, got ${parsed.displayNameFixes.length}`,
  );
  const line = parsed.displayNameFixes[0];
  assert(line.length < 400, `the reported fix must be bounded, got ${line.length} characters`);
  assert(line.includes("more characters"), `a cut cell says how much was omitted, got "${line}"`);
  assert(
    parsed.rtus[1].displayName.length > 1000,
    `the RTU keeps its full name — only the message is cut, got ${parsed.rtus[1].displayName.length} characters`,
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
