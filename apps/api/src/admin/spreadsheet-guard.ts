/**
 * What a spreadsheet upload may cost before it has done anything, and what the
 * message answering it may repeat back. Shared by the `F1.9` telemetry
 * importer and the `F2.7` mapping sheet (PR 2 security review, H1 and H2), and
 * since `F4.105` by the onboarding import summary.
 *
 * **Why a size cap on the upload is not a bound on the work.** AGENTS.md §4.3
 * says so in as many words, and the review measured it: a 4.8 MB workbook of
 * 6,000 rows whose two key cells each held 32,767 characters passed the 5 MiB
 * cap and the row cap, then produced 375 MiB of error text (every
 * `duplicate_row` echoed both cells) and blocked the event loop for ~32 s —
 * an 83× amplification from a request that writes nothing and can be repeated.
 * Separately, a 1.3 MB workbook whose `xl/sharedStrings.xml` inflated to
 * 1.2 GiB took the process to 2.5 GB RSS before a single row was read: the
 * `sheetRows` option bounds row materialisation, not string-table inflation.
 *
 * So there are three, on three separate axes, and the first two are pre-read
 * guards while the last two are formatters applied at the echo site:
 *
 * - {@link zipInflationProblem} bounds what a zip may declare it will inflate
 *   to, read from the central directory *before* `XLSX.read` inflates
 *   anything;
 * - {@link quoteCell} bounds **how long** each echoed cell may be;
 * - {@link echoedItems} with {@link moreTail} bounds **how many** items a
 *   message may list. That is the count axis of the same problem: every cell
 *   on a 500-line list can be inside {@link MAX_ECHOED_CELL_CHARS} and the list
 *   still be a data dump rather than a summary.
 *
 * **The count bound has exactly one caller today**, the onboarding import
 * summary in `onboarding-chat.service.ts` — five sites in one message, all
 * enumerated in `onboarding-chat-summary-caps.spec.ts`. Neither the `F1.9`
 * telemetry importer nor the `F2.7` mapping sheet honours it; they apply
 * `quoteCell` and their own row bounds. Do not read "declared here" as
 * "applied everywhere".
 *
 * All of them are pure and dependency-free.
 */

/** The longest run of cell text an error message may echo. `row`/`column`/`code` identify the cell; the text is a hint. */
export const MAX_ECHOED_CELL_CHARS = 64;

/**
 * Declared uncompressed bytes a workbook may claim across all zip entries.
 * Measured, not guessed: a MAPPINGS sheet at the 20,000-row cap declares
 * **8.7–10 MiB** unpacked depending on how full its cells are (8.68 MiB for a
 * plain one, 9.98 MiB for the export the post-merge review measured), so 64 MiB
 * is **6.4–7.4×** the biggest sheet this system produces — not the order of
 * magnitude this docblock used to claim — and still refuses the measured bomb
 * at under 4 % of its size. On disk that sheet is 2.1–2.6 MiB, because the
 * export is deflated; the declared inflation is the same either way, which is
 * the point of reading it rather than the file size.
 */
export const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

/**
 * A cell's text, quoted, cut to {@link MAX_ECHOED_CELL_CHARS} with the omitted
 * length stated. Apply at every interpolation of sheet-supplied text into a
 * response message; never rely on a wrapper doing it (some messages are built
 * before the wrapper is called).
 */
export function quoteCell(text: string, max: number = MAX_ECHOED_CELL_CHARS): string {
  if (text.length <= max) {
    return `'${text}'`;
  }
  return `'${text.slice(0, max)}…' (+${text.length - max} more characters)`;
}

/**
 * The most items one list in a message may name. {@link MAX_ECHOED_CELL_CHARS}
 * is its sibling on the other axis — that one bounds how long each item is,
 * this one bounds how many there are — and the two have to be read together,
 * because either alone leaves the product unbounded.
 *
 * **What 25 sits above.** The shipped `template.xlsx` carries **2 RTU and 3
 * asset data rows**, so 25 is ~8× the happy path and the template's own import
 * summary gains no tail at any of its five sites. That is asserted, not
 * assumed: `assertAssetsByRtuSummaryIsCapped` drives the real template through
 * `parseUpload` and requires the reply to contain no tail anywhere.
 *
 * **What it sits deliberately below.** The seeded estate is **99 assets**, and
 * a 100-RTU / 500-asset workbook is legal — those are `F4.103`'s section caps.
 * Unlike `F4.103`'s counts this is a **display** bound and not an
 * **acceptance** bound: eliding is the point. The headline `**500** asset(s)`
 * stays exact while the list under it stops being a data dump, so the operator
 * is never told a smaller number than they uploaded.
 *
 * **Measured, not guessed — and the two measurement routes are kept apart,
 * because they give different numbers.** At `F4.103`'s caps (100 RTUs, 500
 * assets, 99 duplicate display names), a real **62,640-byte workbook** produced
 * a **77,817**-character assistant message before this bound; the constructed
 * drafts in `onboarding-chat-summary-caps.spec.ts`, which hold every
 * echo-bearing cell at exactly its `F4.104` bound rather than merely long,
 * produced **85,242**. Do not quote one route's byte count against the other's
 * character count — that spec's docblock carries both, with the composition.
 * After this bound the same drafts produce ~12.8 KB. The filed row's own
 * 13.16 MB figure is dead either way: `workbookSectionCountProblem` refuses the
 * 20,095-row workbook it came from.
 *
 * This is an `apps/api` constant and **not** a `packages/shared` one: no schema
 * reads it and no API response *type* depends on it, unlike `F4.103`'s section
 * caps and `F4.104`'s `ONBOARDING_DRAFT_STRING_MAX`, which each had a second
 * copy in `packages/shared/src/contracts/` to stay in sync with.
 */
export const MAX_ECHOED_ITEMS = 25;

/**
 * The leading {@link MAX_ECHOED_ITEMS} of `items`, and how many were left.
 *
 * A **prefix of whatever order the caller passes**, never a sample. Whether the
 * caller may reorder before calling is the caller's question and the two answer
 * it differently, so neither may be copied onto the other:
 *
 * - `formatAssetsByRtuSummary` **must not**. It keys its whole asset map off
 *   the RTU's index, so a reorder or a filter there silently attributes every
 *   asset to the wrong RTU;
 * - `mqttSetupTemplate` **deliberately does**, sorting the RTUs that still need
 *   setup to the front. Nothing in the block it renders keys off position, and
 *   without the sort a leading-25 cut can drop the only RTU the message is
 *   about.
 */
export function echoedItems<T>(
  items: readonly T[],
  max: number = MAX_ECHOED_ITEMS,
): { shown: readonly T[]; omitted: number } {
  if (items.length <= max) {
    return { shown: items, omitted: 0 };
  }
  return { shown: items.slice(0, max), omitted: items.length - max };
}

/**
 * The line that closes a cut list: `…and 12 more`, `…and 12 more RTUs` when the
 * caller names the unit, or `""` when nothing was omitted so a list at the cap
 * gains no tail.
 *
 * **A count and nothing else from the data** (AGENTS.md §4.3). It takes a
 * number rather than the omitted items precisely so that no item can be
 * interpolated here — the caller has already been through {@link quoteCell} for
 * the items it does show, and an "N more (starting with 'x')" improvement would
 * reopen the echo this exists to close.
 *
 * `noun` does not weaken that, and it must not be allowed to: it exists because
 * `formatAssetsByRtuSummary` renders an RTU tail and an asset tail in the same
 * block, where two bare `…and N more` lines read as the same thing. It is a
 * **caller-side literal** — `"RTUs"`, written out at the call site — and never
 * a value derived from an item. The type cannot enforce that; this sentence is
 * the guard, and `assertEchoedItemsHelpersAreBounded` asserts the shape a
 * literal produces.
 *
 * The wording avoids `more characters`, which is `quoteCell`'s. Specs count
 * occurrences of that phrase on one line to prove two separate cells were each
 * cut, and a tail carrying it would make those counts pass for the wrong
 * reason. `…` is `quoteCell`'s ellipsis, so one message carries one vocabulary.
 */
export function moreTail(omitted: number, noun?: string): string {
  if (omitted <= 0) {
    return "";
  }
  return noun ? `…and ${omitted} more ${noun}` : `…and ${omitted} more`;
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const END_OF_CENTRAL_DIRECTORY_LENGTH = 22;
const CENTRAL_ENTRY_FIXED_LENGTH = 46;
const MAX_ZIP_COMMENT_LENGTH = 0xffff;
const ZIP64_MARKER = 0xffffffff;

/** What a zip's central directory declares, without inflating a byte. */
export type DeclaredZipInflation = {
  /** Sum of every entry's declared uncompressed size. */
  readonly totalBytes: number;
  readonly entries: number;
  /** True when any size field carries the zip64 marker — the real size is elsewhere and larger than 4 GiB is possible. */
  readonly zip64: boolean;
};

/** True when the buffer starts with a zip local-file header — an `.xlsx`, never a CSV. */
export function looksLikeZip(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.readUInt32LE(0) === LOCAL_HEADER_SIGNATURE;
}

/**
 * Reads the end-of-central-directory record and walks the central directory.
 * `null` when the buffer is not a zip; throws when it claims to be one and the
 * directory cannot be found or parsed (the caller refuses such a file).
 */
export function declaredZipInflation(buffer: Buffer): DeclaredZipInflation | null {
  if (!looksLikeZip(buffer)) {
    return null;
  }
  const searchFrom = Math.max(0, buffer.length - END_OF_CENTRAL_DIRECTORY_LENGTH - MAX_ZIP_COMMENT_LENGTH);
  let eocd = -1;
  for (let i = buffer.length - END_OF_CENTRAL_DIRECTORY_LENGTH; i >= searchFrom; i -= 1) {
    if (buffer.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error("zip end-of-central-directory record not found");
  }
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  let zip64 = directoryOffset === ZIP64_MARKER || entryCount === 0xffff;
  let totalBytes = 0;
  let offset = directoryOffset;
  let entries = 0;
  while (!zip64 && entries < entryCount) {
    if (offset + CENTRAL_ENTRY_FIXED_LENGTH > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error(`zip central directory entry ${entries + 1} is malformed`);
    }
    const uncompressed = buffer.readUInt32LE(offset + 24);
    const compressed = buffer.readUInt32LE(offset + 20);
    if (uncompressed === ZIP64_MARKER || compressed === ZIP64_MARKER) {
      zip64 = true;
      break;
    }
    totalBytes += uncompressed;
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    offset += CENTRAL_ENTRY_FIXED_LENGTH + nameLength + extraLength + commentLength;
    entries += 1;
  }
  return { totalBytes, entries, zip64 };
}

/**
 * The sentence that refuses a workbook whose declared inflation is over
 * {@link MAX_INFLATED_BYTES}, carries zip64 sizes, or whose directory cannot be
 * read; `null` when the file may be handed to `XLSX.read`. A CSV is never a zip
 * and always passes.
 */
export function zipInflationProblem(buffer: Buffer, maxInflatedBytes: number = MAX_INFLATED_BYTES): string | null {
  let declared: DeclaredZipInflation | null;
  try {
    declared = declaredZipInflation(buffer);
  } catch (error) {
    return `The workbook's zip directory could not be read (${error instanceof Error ? error.message : "unknown"})`;
  }
  if (declared === null) {
    return null;
  }
  if (declared.zip64) {
    return "The workbook uses zip64 sizes; a sheet that large cannot be imported";
  }
  if (declared.totalBytes > maxInflatedBytes) {
    return `The workbook declares ${declared.totalBytes} bytes across ${declared.entries} entries when unpacked, more than the ${maxInflatedBytes}-byte limit`;
  }
  return null;
}
