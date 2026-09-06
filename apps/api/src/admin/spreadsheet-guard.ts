/**
 * Two guards every spreadsheet upload runs before it costs anything, shared by
 * the `F1.9` telemetry importer and the `F2.7` mapping sheet (PR 2 security
 * review, H1 and H2).
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
 * So: {@link quoteCell} bounds what a message may echo, and
 * {@link zipInflationProblem} bounds what a zip may declare it will inflate to,
 * read from the central directory *before* `XLSX.read` inflates anything. Both
 * are pure and dependency-free.
 */

/** The longest run of cell text an error message may echo. `row`/`column`/`code` identify the cell; the text is a hint. */
export const MAX_ECHOED_CELL_CHARS = 64;

/**
 * Declared uncompressed bytes a workbook may claim across all zip entries.
 * A real MAPPINGS or telemetry sheet at the 20,000-row cap inflates to a few
 * MiB; 64 MiB leaves an order of magnitude of headroom and still refuses the
 * measured bomb at under 4 % of its size.
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
