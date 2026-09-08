/**
 * `F4.104` — the workbook half of the string bounds: every cell an onboarding
 * upload reads is bounded **where it is read**, because the draft schema that
 * bounds the same fields is parsed nowhere on this route.
 *
 * **A sibling of `onboarding-excel.service.spec.ts`, not a second subject.**
 * The two belong to one suite and share one set of fixtures — which is why the
 * builders below are *imported* from that file rather than copied, so both
 * describe the workbook the service actually generates. They are separate files
 * only because the combined one passes the 1,000-line ceiling AGENTS.md §4.5
 * sets for this phase.
 */
import { ONBOARDING_DRAFT_STRING_MAX } from "@bms/shared";

import {
  MAX_RTU_HOST_CHARS,
  OnboardingExcelService,
} from "./onboarding-excel.service";
import type { ParsedExcel } from "./onboarding-excel.service";
import {
  buildWorkbookBuffer,
  refusalMessage,
  ROWS_ABOVE_THE_FIRST_ASSET,
  ROWS_ABOVE_THE_FIRST_RTU,
  templateRows,
} from "./onboarding-excel.service.spec";
import { MAX_RTU_CREDENTIAL_CHARS, onboardingDraftSchema } from "./onboarding.schema";
import { OnboardingValidateService } from "./onboarding-validate.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Row 2 of the template: the one `LOCATION` data row. `parseLocation` reads
 * `rows[1]` of its own section and nothing else, which is why the refusals from
 * that section carry no row number to count.
 */
const LOCATION_DATA_ROW = 2;

/** The second `RTUS` data row, and the second `ASSETS` one — data rows 2 and 2 as an operator counts them. */
const SECOND_RTU_ROW = ROWS_ABOVE_THE_FIRST_RTU + 1;
const SECOND_ASSET_ROW = ROWS_ABOVE_THE_FIRST_ASSET + 1;

/** `RTU_HEADERS` positions for the two credential columns, which no draft field ever receives. */
const RTU_USERNAME_COLUMN = 7;
const RTU_PASSWORD_COLUMN = 8;

/** Replaces one cell, copying the row first so the shared template rows are never mutated. */
function writeCell(
  rows: (string | number)[][],
  rowIndex: number,
  columnIndex: number,
  value: string,
): void {
  rows[rowIndex] = [...rows[rowIndex]];
  rows[rowIndex][columnIndex] = value;
}

/**
 * One bounded cell of the workbook: where it is written, what it becomes, and
 * the bound past which the upload must be refused.
 */
type BoundedCellCase = {
  readonly section: "LOCATION" | "RTUS" | "ASSETS";
  /** The data-row number the refusal must name, or `null` for `LOCATION`'s single row. */
  readonly dataRow: number | null;
  /** The column header literal the refusal must name — never the cell's text. */
  readonly column: string;
  readonly max: number;
  /** Writes the value under test, plus anything else the cell needs to be reached at all. */
  readonly write: (rows: (string | number)[][], value: string) => void;
  /** Reads back what the cell became, which is what the "at the bound" direction asserts is kept whole. */
  readonly read: (parsed: ParsedExcel) => string;
};

/**
 * The thirteen cells, written out rather than derived: **eleven** that reach
 * `onboarding_sessions.draft` and **two** that reach `CredentialCryptoService`
 * instead. Every bound is imported — from `@bms/shared` for the draft's string
 * fields, from the parse site for `host`, and from the schema that governs a
 * credential for the last two.
 *
 * **Six** headers are deliberately absent: `port`, `latitude` and `longitude`
 * (numeric parses guarded by `Number.isFinite`), `tls` (compared against four
 * literals), `type` (two literals, everything else replaced) and the `rtu_code`
 * column of the `ASSETS` section (a lookup key into `rtuCodeToIndex`, never
 * stored). `topic` and `protocol` are bounded, but by `F4.102`'s own checks
 * rather than by this table. Each reason is written at its own site in the
 * parser; enumerating the three header arrays against the union of the two sets
 * is the cross-package gate's job, not this file's — and when that gate is
 * written it must know that `username` and `password` reach `cellLengthProblem`
 * under one composite label, `username or password`, because ruling 5 forbids
 * the sentence naming which of the two was long. A scanner matching
 * `RTU_HEADERS` members against the column literals in the parser will read both
 * as unbounded unless it is told otherwise.
 */
const BOUNDED_CELL_CASES: readonly BoundedCellCase[] = [
  {
    section: "LOCATION",
    dataRow: null,
    column: "name",
    max: ONBOARDING_DRAFT_STRING_MAX["location.name"],
    write: (rows, value) => writeCell(rows, LOCATION_DATA_ROW, 0, value),
    read: (parsed) => parsed.location.name,
  },
  {
    section: "LOCATION",
    dataRow: null,
    column: "code",
    max: ONBOARDING_DRAFT_STRING_MAX["location.code"],
    write: (rows, value) => writeCell(rows, LOCATION_DATA_ROW, 1, value),
    read: (parsed) => parsed.location.code,
  },
  {
    section: "LOCATION",
    dataRow: null,
    column: "slug",
    max: ONBOARDING_DRAFT_STRING_MAX["location.slug"],
    write: (rows, value) => writeCell(rows, LOCATION_DATA_ROW, 2, value),
    read: (parsed) => parsed.location.slug,
  },
  {
    section: "LOCATION",
    dataRow: null,
    column: "province",
    max: ONBOARDING_DRAFT_STRING_MAX["location.province"],
    write: (rows, value) => writeCell(rows, LOCATION_DATA_ROW, 6, value),
    read: (parsed) => parsed.location.province ?? "",
  },
  {
    section: "RTUS",
    dataRow: 2,
    column: "rtu_code",
    max: ONBOARDING_DRAFT_STRING_MAX["rtus.code"],
    write: (rows, value) => writeCell(rows, SECOND_RTU_ROW, 0, value),
    read: (parsed) => parsed.rtus[1].code,
  },
  {
    section: "RTUS",
    dataRow: 2,
    column: "rtu_name",
    max: ONBOARDING_DRAFT_STRING_MAX["rtus.displayName"],
    write: (rows, value) => writeCell(rows, SECOND_RTU_ROW, 1, value),
    read: (parsed) => parsed.rtus[1].displayName,
  },
  {
    section: "RTUS",
    dataRow: 2,
    column: "host",
    max: MAX_RTU_HOST_CHARS,
    write: (rows, value) => writeCell(rows, SECOND_RTU_ROW, 3, value),
    read: (parsed) => String(parsed.rtus[1].config.host),
  },
  {
    // The two credential columns, ruling 5's first rider. The partner cell is
    // written too, and short: `parseRtus` pushes nothing to `rtuCredentials`
    // unless the username is non-empty and the password is not a placeholder,
    // so a fixture that set one alone would read as "bounded" while exercising
    // no path at all — the base measurement says so in as many words.
    section: "RTUS",
    dataRow: 2,
    column: "username or password",
    max: MAX_RTU_CREDENTIAL_CHARS,
    write: (rows, value) => {
      writeCell(rows, SECOND_RTU_ROW, RTU_USERNAME_COLUMN, value);
      writeCell(rows, SECOND_RTU_ROW, RTU_PASSWORD_COLUMN, "s3cret-and-not-a-placeholder");
    },
    read: (parsed) => String(parsed.rtuCredentials[0]?.credentials.username ?? ""),
  },
  {
    section: "RTUS",
    dataRow: 2,
    column: "username or password",
    max: MAX_RTU_CREDENTIAL_CHARS,
    write: (rows, value) => {
      writeCell(rows, SECOND_RTU_ROW, RTU_PASSWORD_COLUMN, value);
      writeCell(rows, SECOND_RTU_ROW, RTU_USERNAME_COLUMN, "pheadmin");
    },
    read: (parsed) => String(parsed.rtuCredentials[0]?.credentials.password ?? ""),
  },
  {
    section: "ASSETS",
    dataRow: 2,
    column: "asset_code",
    max: ONBOARDING_DRAFT_STRING_MAX["assets.code"],
    write: (rows, value) => writeCell(rows, SECOND_ASSET_ROW, 0, value),
    read: (parsed) => parsed.assets[1].code,
  },
  {
    section: "ASSETS",
    dataRow: 2,
    column: "asset_name",
    max: ONBOARDING_DRAFT_STRING_MAX["assets.name"],
    write: (rows, value) => writeCell(rows, SECOND_ASSET_ROW, 1, value),
    read: (parsed) => parsed.assets[1].name,
  },
  {
    section: "ASSETS",
    dataRow: 2,
    column: "domain",
    max: ONBOARDING_DRAFT_STRING_MAX["assets.domain"],
    write: (rows, value) => writeCell(rows, SECOND_ASSET_ROW, 3, value),
    read: (parsed) => parsed.assets[1].domain,
  },
  {
    section: "ASSETS",
    dataRow: 2,
    column: "site_name",
    max: ONBOARDING_DRAFT_STRING_MAX["assets.siteName"],
    write: (rows, value) => writeCell(rows, SECOND_ASSET_ROW, 4, value),
    read: (parsed) => parsed.assets[1].siteName,
  },
];

/**
 * `F4.104` — every workbook cell that becomes a draft string or a credential is
 * bounded **where it is read**, and the upload is refused past that bound
 * (owner ruling 1).
 *
 * **Why the parse site rather than a schema parse at the upload boundary.**
 * `onboardingDraftSchema` bounds all eleven draft fields and `uploadExcel`
 * parses it nowhere, so measured on `9d384295` all eleven reached
 * `onboarding_sessions.draft` at 32,767 characters from a ~50 KB upload — and a
 * 32,767-character `password` reached `CredentialCryptoService`, eight times the
 * bound `setCredentialsBodySchema` puts on the same value. Parsing the draft
 * schema in `uploadExcel` would have imported `.min(2)` and two regexes with the
 * lengths and refused a partial workbook wholesale; the sibling
 * {@link assertPartialWorkbookStillParses} is what holds that line.
 *
 * **Both directions, for every one of the thirteen.** A cell exactly at its
 * bound parses and is kept whole; one character more is a 400 naming the
 * section, the data row as the operator counts it, the column header, the length
 * found and the bound — and echoing no cell text (AGENTS.md §4.3).
 *
 * **The at-the-bound direction is also the enumeration guard.** Each case reads
 * its own value back out of the parse, so a case whose `write` addressed the
 * wrong column would return the template's own short cell and fail there rather
 * than passing on a refusal it never caused.
 */
export function assertOverlongCellsAreRefused(): void {
  assert(
    BOUNDED_CELL_CASES.length === 13,
    `eleven cells reach the draft and two reach the credential store — repair the table, not this ` +
      `number, if the parser gained or lost a bounded cell; got ${BOUNDED_CELL_CASES.length}`,
  );

  for (const { section, dataRow, column, max, write, read } of BOUNDED_CELL_CASES) {
    const where = dataRow === null ? `${section} ${column}` : `${section} row ${dataRow} ${column}`;

    // --- exactly at the bound: parsed, and kept whole ------------------------
    // A run of hyphens, which `.trim()`, `.toUpperCase()` and `.toLowerCase()`
    // all leave alone — so this direction can assert the stored value is the
    // cell, byte for byte, on the fields that are folded as well as the ones
    // that are not.
    const legalValue = "-".repeat(max);
    const legalRows = templateRows();
    write(legalRows, legalValue);
    const parsed = new OnboardingExcelService().parseUpload(buildWorkbookBuffer(legalRows));
    assert(
      read(parsed) === legalValue,
      `a ${where} cell of exactly ${max} characters parses whole, got ${read(parsed).length}`,
    );
    assert(
      parsed.rtus.length === 2 && parsed.assets.length === 3,
      `a cell at the bound must not disturb the rest of the sheet (${where}), got ${parsed.rtus.length} RTUs and ${parsed.assets.length} assets`,
    );

    // --- one character more: refused ----------------------------------------
    const overRows = templateRows();
    write(overRows, "Z".repeat(max + 1));
    const message = refusalMessage(
      buildWorkbookBuffer(overRows),
      `a ${where} cell of ${max + 1} characters`,
    );
    const expectedWhere =
      dataRow === null
        ? `The ${section} section's data row has`
        : `The ${section} section's data row ${dataRow} has`;
    assert(
      message.includes(expectedWhere),
      `the refusal names the section and the row to repair, got "${message}"`,
    );
    assert(
      message.includes(`in the ${column} column`),
      `the refusal names the column to repair, got "${message}"`,
    );
    assert(
      message.includes(String(max + 1)),
      `the refusal names the length it read, got "${message}"`,
    );
    assert(
      message.includes(`more than the ${max}`),
      `the refusal names the bound it applied, got "${message}"`,
    );
    // §4.3. Both cases are checked because two of these cells are folded on the
    // way in — a `slug` refusal that echoed its cell would echo it lowercased,
    // and an upper-case-only check would pass while the amplification stayed.
    assert(
      !/Z{10}/i.test(message),
      `the refusal must not echo the cell it refused, got "${message.slice(0, 200)}"`,
    );
    assert(
      message.length < 400,
      `the refusal is a sentence, not a copy of the cell, got ${message.length} characters`,
    );
  }

  // Ruling 5, the half no per-cell assertion can express: the refusal must not
  // say *which* credential column was long. Naming it would tell any reader of
  // the 400 whether that RTU row carried a password at all. The two fixtures
  // differ only in which column holds the hostile value, so the messages being
  // byte-identical is the executable form of that rule.
  const hostileCredential = "Z".repeat(MAX_RTU_CREDENTIAL_CHARS + 1);
  const longUsername = templateRows();
  writeCell(longUsername, SECOND_RTU_ROW, RTU_USERNAME_COLUMN, hostileCredential);
  const longPassword = templateRows();
  writeCell(longPassword, SECOND_RTU_ROW, RTU_PASSWORD_COLUMN, hostileCredential);
  const fromUsername = refusalMessage(
    buildWorkbookBuffer(longUsername),
    `a ${MAX_RTU_CREDENTIAL_CHARS + 1}-character username`,
  );
  const fromPassword = refusalMessage(
    buildWorkbookBuffer(longPassword),
    `a ${MAX_RTU_CREDENTIAL_CHARS + 1}-character password`,
  );
  assert(
    fromUsername === fromPassword,
    `the two credential columns must produce one identical sentence, got "${fromUsername}" and "${fromPassword}"`,
  );

  // And the honest sheet is untouched — the template's own cells are short.
  const template = new OnboardingExcelService().parseUpload(
    new OnboardingExcelService().buildTemplateBuffer("Berhampur"),
  );
  assert(
    template.location.name === "Berhampur" && template.rtus.length === 2 && template.assets.length === 3,
    `the generated template survives all thirteen bounds, got ${JSON.stringify(template.location.name)}`,
  );
}

/**
 * **Owner ruling 1's regression guard, and the reason this row is not a schema
 * parse at the upload boundary.**
 *
 * An onboarding draft is legitimately partial until it commits (ADR 0011, stated
 * in the shared contract's own head docblock). A workbook with a blank `code`
 * cell uploads today, and `OnboardingValidateService.validate` reports it as the
 * per-field error the operator fixes inside the wizard. The obvious repair for
 * this row — `onboardingDraftSchema.safeParse(patch)` in `uploadExcel` — would
 * have refused that whole upload on `.min(2)`, replacing a fixable field with a
 * dead end, and would have re-opened the `invalid_enum_value` echo `F4.102`
 * closed. Length is the denial-of-service axis; completeness is not.
 *
 * So this asserts the failure mode was avoided rather than only that the
 * refusals fire, and it asserts it against the schema itself: the same
 * `onboardingDraftSchema` that a blanket parse would have used **does** reject
 * this draft, and the upload still succeeds.
 *
 * The blank `asset_name` is the second half and produces **no** error at all —
 * `parseAssets` resolves it through the fallback to `asset_code`. That is the
 * case proving the fallback runs before the bound, not a second error source.
 */
export function assertPartialWorkbookStillParses(): void {
  const rows = templateRows();
  writeCell(rows, LOCATION_DATA_ROW, 1, "");
  writeCell(rows, SECOND_ASSET_ROW, 1, "");

  const service = new OnboardingExcelService();
  const parsed = service.parseUpload(buildWorkbookBuffer(rows));
  assert(parsed.location.code === "", `the blank code cell parses to an empty string, got ${JSON.stringify(parsed.location.code)}`);
  assert(
    parsed.assets[1].name === parsed.assets[1].code && parsed.assets[1].name !== "",
    `a blank asset_name resolves through the fallback to its code, got ${JSON.stringify(parsed.assets[1].name)}`,
  );

  const draft = service.toDraftPatch(parsed, {});

  // The counterfactual, executable: a blanket parse at the upload boundary would
  // have answered 400 for this workbook.
  assert(
    onboardingDraftSchema.safeParse(draft).success === false,
    "the draft schema rejects this partial draft — which is exactly why it is not parsed at the upload boundary",
  );

  const validation = new OnboardingValidateService().validate(draft);
  assert(validation.valid === false, "a draft with a blank location code is not valid yet");
  assert(
    validation.errors.some((error) => error.path === "location.code"),
    `the operator is given a per-field error to fix, got ${JSON.stringify(validation.errors.map((error) => error.path))}`,
  );
  // Everything else in the workbook was accepted. If a second field ever starts
  // reporting here, the fallback or a bound has changed behaviour and this is
  // where it shows.
  assert(
    validation.errors.every((error) => error.path === "location.code"),
    `only the blank cell is reported, got ${JSON.stringify(validation.errors.map((error) => error.path))}`,
  );
}
