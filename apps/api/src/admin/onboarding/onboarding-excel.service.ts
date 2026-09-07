import { BadRequestException, Injectable } from "@nestjs/common";
import * as XLSX from "xlsx";

import type { OnboardingDraft, OnboardingProtocol } from "@bms/shared";

import { quoteCell, zipInflationProblem } from "../spreadsheet-guard";
import { MAX_HEADER_COLUMNS, SHEET_ROWS_BOUND } from "../telemetry-import/telemetry-import-rows";
import { MAX_IMPORT_FILE_BYTES } from "../telemetry-import/telemetry-import.schema";
import type { OnboardingDraftInput } from "./onboarding.schema";

/**
 * The sentence that refuses an onboarding workbook whose **declared** used
 * range is too wide or reaches the reading bound, or `null` when
 * `sheet_to_json` may densify it (`F4.102`).
 *
 * Both branches are O(1) on the range alone — no cell is touched — which is the
 * whole point: the cost this bounds is paid inside `sheet_to_json`, so the
 * check has to happen before it and must not itself scan.
 *
 * **Why the width is checked first.** Both tests are O(1), so ordering is not
 * about cost; it is about which sentence an operator can act on. A sheet that
 * is both too wide and too tall gets the column message, because deleting
 * content to the right is a repair and "your file may have been cut" is not.
 *
 * **Why `columnBoundedRange` cannot be reused** (`telemetry-import-rows.ts`;
 * named in prose because it is not imported here, so a `{@link}` would render
 * as plain text). That helper is written
 * for a sheet with one header row at `range.s.r`, and it scans that row by name
 * to refuse a recognised header pushed beyond the window. This workbook has
 * three marker-delimited sections — `LOCATION`, `RTUS`, `ASSETS` — each with
 * its own header row further down, and `range.s.r` is the `LOCATION` marker
 * row, which holds one cell and no headers at all. A by-name scan of that row
 * would vouch for nothing.
 *
 * **Why refusing beats windowing** (owner ruling 1). The importer can narrow
 * its range and still be correct, because a column it drops is one it does not
 * read. Here every dropped column is data: move `password` to column BM and a
 * windowed read parses the sheet, reports `credentialsSet: false` and an empty
 * `rtuCredentials`, and says nothing — the operator's RTU silently arrives
 * without the credential they supplied. Refusing is the only answer that does
 * not invent a result.
 *
 * **The numbers.** The template's widest section is `RTU_HEADERS` at nine
 * columns, so {@link MAX_HEADER_COLUMNS} = 64 is roughly 7× the sheet this
 * system itself produces, and the worst case a workbook can still buy is
 * 20,101 × 64 = **1,286,464** cells. Not 20,102 × 64: the row test below is
 * `>=` and it runs *before* `sheet_to_json`, so the tallest range this parser
 * ever densifies is one row under the bound. The importer states 20,102 × 64
 * from the same two constants and is right about itself — its row refusal
 * happens after densification, so it pays for the row this one never reads.
 *
 * **Why both bounds ship, and not just the column one.** Measured at `ef1a3e11`
 * — the commit this row starts from, where `XLSX.read` was called with no
 * `sheetRows` — on node v24.17.0 / xlsx 0.20.3, through the real `parseUpload`,
 * from a **3,038-byte** upload holding three real rows:
 *
 * - `<dimension ref="A1:XFD20102"/>` declares 329,351,168 cells: the process
 *   died with `FATAL ERROR: JavaScript heap out of memory` after ~86 s at a
 *   512 MB heap cap, and after 362 s at 2048 MB. A bigger heap postpones the
 *   kill rather than preventing it. That range is 16,384 columns wide, so the
 *   **column** branch is what answers it now, in O(1) on the range alone.
 * - `<dimension ref="A1:I1048576"/>` declares 9,437,184 cells and **is nine
 *   columns wide**, so no column bound can see it. It cost 12.7 s and 552 MB RSS
 *   at `ef1a3e11` — and on this branch it is **accepted**, in 64 ms, because
 *   `sheetRows` makes SheetJS's reader clamp a declared end row past the bound
 *   down to the sheet's real extent: `!ref` comes back `A1:B3` over a three-row
 *   fixture. `A1:C25000` clamps the same way. A declared end row *under* the
 *   bound is preserved as declared — `A1:XFD20000` reads back at 16,384 columns
 *   and is refused for its width.
 *
 * So the row branch is not dead code, but its live case is a **real** sheet that
 * fills to the bound rather than a declared-but-empty range: 25,000 rows of data
 * clamp to exactly 20,102 and are refused as possibly cut, which
 * `onboarding-excel.service.spec.ts` asserts end to end. The clamp handles the
 * empty declaration, and neither branch may be removed on the strength of the
 * other.
 */
export function onboardingSheetRangeProblem(range: XLSX.Range): string | null {
  const declaredColumns = range.e.c - range.s.c + 1;
  if (declaredColumns > MAX_HEADER_COLUMNS) {
    return (
      `The sheet declares ${declaredColumns} columns, more than the ${MAX_HEADER_COLUMNS} this importer reads; ` +
      `remove the content to the right of column ${XLSX.utils.encode_col(range.s.c + MAX_HEADER_COLUMNS - 1)} and upload the workbook again`
    );
  }
  // `>=`, not `>`: reaching the bound means the sheet may have been cut, and a
  // cut workbook must never be imported as if it were whole. Both sibling
  // parsers refuse on the same condition.
  if (range.e.r + 1 >= SHEET_ROWS_BOUND) {
    return (
      `The sheet reaches the reading bound of ${SHEET_ROWS_BOUND} rows, so it may have been cut; ` +
      "split the workbook into smaller ones and upload them one at a time"
    );
  }
  return null;
}

/**
 * The longest `topic` cell an onboarding workbook may carry.
 *
 * **Derived from the column it commits to, not invented.** `bms.rtus.mqtt_topic`
 * is `character varying(255)` (`packages/db/src/schema/bms-schema.ts`), and
 * `OnboardingCommitService` writes this exact value there, so a longer topic can
 * never reach a committed RTU — it can only be carried around the draft, echoed
 * into chat, and refused by Postgres at the end.
 *
 * **Why the sheet is refused rather than the cell cut** (owner ruling). Every
 * other sheet-supplied string this importer echoes is bounded at the *message*
 * with `quoteCell`, which leaves the data whole. `topic` cannot be: it is
 * printed unquoted by `OnboardingChatService.mqttSetupTemplate` for the operator
 * to edit and paste back, so a quote character would end up inside the stored
 * topic (the paste-back parser is `/topic[:\s]+(\S+)/i`). Truncating instead is
 * worse than refusing — a shortened topic subscribes to a topic nobody asked
 * for, the RTU commits, and no telemetry ever arrives. Past this bound the sheet
 * is wrong, and saying so is the only answer that does not invent a result.
 *
 * **What it closes.** Measured at `ef1a3e11` past all five other guards: 2,000
 * RTU rows sharing one 32,767-character topic made a 77,564-byte upload produce
 * a 65.6 MB `assistantMessage`; 8,000 rows produced 250.3 MB at 1,452 MB RSS and
 * 11.7 s of blocked event loop; 16,500 rows threw `RangeError: Invalid string
 * length`, which nothing catches — an uncaught 500 from a 600 KB file.
 */
export const MAX_RTU_TOPIC_CHARS = 255;

/**
 * Reads a spreadsheet's `domain` cell into a plant-domain code (ADR 0031).
 *
 * **Case and spacing are normalised; an unrecognised value is not.** A sheet
 * written by hand says `HVAC` or ` Electrical `, and those are the same domain
 * — folding them is not guessing. Anything else is passed through *unchanged*
 * so `OnboardingCommitService` rejects it against `bms.asset_domains` and names
 * the valid codes to whoever uploaded the sheet.
 *
 * What this replaces is the previous `|| "electrical"` fallback, which silently
 * classified any unreadable cell as electrical plant. That is the same failure
 * `assets.domain`'s dropped `DEFAULT` removes at the other end: answering
 * confidently when nobody said.
 */
function assetDomainFromCell(cell: string): string {
  return cell.trim().toLowerCase();
}

export type ParsedExcel = {
  location: NonNullable<OnboardingDraft["location"]>;
  rtus: NonNullable<OnboardingDraft["rtus"]>;
  assets: NonNullable<OnboardingDraft["assets"]>;
  rtuCredentials: { rtuIndex: number; credentials: Record<string, unknown> }[];
  displayNameFixes: string[];
};

const LOCATION_HEADERS = [
  "name",
  "code",
  "slug",
  "type",
  "latitude",
  "longitude",
  "province",
] as const;

const RTU_HEADERS = [
  "rtu_code",
  "rtu_name",
  "protocol",
  "host",
  "port",
  "topic",
  "tls",
  "username",
  "password",
] as const;

const ASSET_HEADERS = [
  "asset_code",
  "asset_name",
  "rtu_code",
  "domain",
  "site_name",
] as const;

/** Generates and parses onboarding Excel templates (location + RTUs + assets). */
@Injectable()
export class OnboardingExcelService {
  /** Builds a sample single-sheet workbook buffer. */
  buildTemplateBuffer(locationExample = "Berhampur"): Buffer {
    const prefix = locationExample.toUpperCase().replace(/[^A-Z0-9]+/g, "-");
    const slug = locationExample.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const rows: string[][] = [
      ["LOCATION"],
      [...LOCATION_HEADERS],
      [locationExample, prefix, slug, "smoc_campus", "22.3159", "87.3222", "Odisha"],
      [],
      ["RTUS"],
      [...RTU_HEADERS],
      [
        `${prefix}-RTU-1`,
        `${locationExample} RTU 1`,
        "mqtt",
        "phe.thinkiot.co.in",
        "8883",
        `${prefix}-RTU-1/Topic1`,
        "true",
        "pheadmin",
        "",
      ],
      [
        `${prefix}-RTU-2`,
        `${locationExample} RTU 2`,
        "mqtt",
        "phe.thinkiot.co.in",
        "8883",
        `${prefix}-RTU-2/Topic2`,
        "true",
        "pheadmin",
        "",
      ],
      [],
      ["ASSETS"],
      [...ASSET_HEADERS],
      [`${prefix}-ASSET-1`, "Device 1", `${prefix}-RTU-1`, "electrical", locationExample],
      [`${prefix}-ASSET-2`, "Device 2", `${prefix}-RTU-1`, "electrical", locationExample],
      [`${prefix}-ASSET-3`, "Device 3", `${prefix}-RTU-2`, "electrical", locationExample],
    ];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Onboarding");
    return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
  }

  /**
   * Parses an uploaded workbook into onboarding draft sections.
   *
   * `F4.102` put this behind the bounds its two sibling parsers already had.
   * The controller's `FileInterceptor` limit is not a substitute for the byte
   * cap below: this is a public method, and any future caller reaching it
   * without the interceptor would otherwise be unbounded — the same reason
   * `mapping-sheet-rows.ts` keeps both.
   */
  parseUpload(buffer: Buffer): ParsedExcel {
    if (buffer.length > MAX_IMPORT_FILE_BYTES) {
      throw new BadRequestException(
        `File is ${buffer.length} bytes, more than the ${MAX_IMPORT_FILE_BYTES}-byte limit`,
      );
    }

    // What the zip *declares* it unpacks to, read from its central directory
    // before a byte is inflated. `sheetRows` below bounds row materialisation
    // only; the shared-string table is inflated whole, and the `F2.7` security
    // review took the process to 2.5 GB RSS with a 1.3 MB file through this
    // same `XLSX.read` shape (`spreadsheet-guard.ts`).
    const inflation = zipInflationProblem(buffer);
    if (inflation !== null) {
      throw new BadRequestException(inflation);
    }

    let book: XLSX.WorkBook;
    try {
      // Bounds what SheetJS materialises before the range check below can run.
      // It is a cost bound, not the correctness one: a 25,000-row sheet is
      // refused either way, because the declared range says so.
      book = XLSX.read(buffer, { type: "buffer", sheetRows: SHEET_ROWS_BOUND });
    } catch {
      // A corrupt or truncated buffer was a 500 before this row: `XLSX.read`
      // throws and nothing between here and the controller caught it. Both
      // siblings answer a 400 instead, and an unreadable upload is the client's
      // fault, not the server's.
      throw new BadRequestException("Could not read the uploaded file as Excel");
    }
    const sheet = book.Sheets[book.SheetNames[0] ?? ""];
    if (!sheet) {
      throw new BadRequestException("Workbook has no sheets");
    }
    // Before `sheet_to_json` densifies anything. A sheet with no `!ref` yields
    // `[]` and falls into the LOCATION refusal below, which is what it did
    // before this guard existed.
    const ref = sheet["!ref"];
    if (ref !== undefined) {
      const problem = onboardingSheetRangeProblem(XLSX.utils.decode_range(ref));
      if (problem !== null) {
        throw new BadRequestException(problem);
      }
    }
    const rows = XLSX.utils.sheet_to_json<(string | number | boolean)[]>(sheet, {
      header: 1,
      defval: "",
    }) as (string | number | boolean)[][];

    const locationRows = this.sectionRows(rows, "LOCATION");
    const rtuRows = this.sectionRows(rows, "RTUS");
    const assetRows = this.sectionRows(rows, "ASSETS");

    if (locationRows.length < 2) {
      throw new BadRequestException("LOCATION section requires a header row and one data row");
    }

    const location = this.parseLocation(locationRows);
    const { rtus: parsedRtus, rtuCredentials } = this.parseRtus(rtuRows);
    const { rtus, displayNameFixes } = this.normalizeRtuDisplayNames(parsedRtus);
    const rtuCodeToIndex = new Map(rtus.map((rtu, index) => [rtu.code, index]));
    const parsedAssets = this.parseAssets(assetRows, location.name, rtuCodeToIndex);

    return {
      location,
      rtus,
      assets: parsedAssets,
      rtuCredentials,
      displayNameFixes,
    };
  }

  /** Converts parsed Excel rows into a draft patch. */
  toDraftPatch(
    parsed: ParsedExcel,
    existing: OnboardingDraft,
    options?: { useExistingPointKeys?: boolean },
  ): OnboardingDraftInput {
    return {
      location: { ...existing.location, ...parsed.location },
      rtus: parsed.rtus.length > 0 ? parsed.rtus : existing.rtus,
      assets: parsed.assets.length > 0 ? parsed.assets : existing.assets,
      onboardingMeta: {
        ...(existing.onboardingMeta ?? {}),
        rtuTargetCount: parsed.rtus.length || existing.onboardingMeta?.rtuTargetCount,
        importedFromExcel: true,
        ...(options?.useExistingPointKeys ? { useExistingPointKeys: true } : {}),
      },
    };
  }

  private sectionRows(
    rows: (string | number | boolean)[][],
    marker: string,
  ): string[][] {
    const start = rows.findIndex(
      (row) => String(row[0] ?? "").trim().toUpperCase() === marker,
    );
    if (start < 0) {
      return [];
    }
    const section: string[][] = [];
    for (let i = start + 1; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row || row.every((cell) => String(cell ?? "").trim() === "")) {
        break;
      }
      const markerCell = String(row[0] ?? "").trim().toUpperCase();
      if (markerCell === "LOCATION" || markerCell === "RTUS" || markerCell === "ASSETS") {
        break;
      }
      section.push(row.map((cell) => String(cell ?? "").trim()));
    }
    return section;
  }

  private parseLocation(rows: string[][]): NonNullable<OnboardingDraft["location"]> {
    const headers = rows[0].map((h) => h.toLowerCase());
    const values = rows[1];
    const get = (key: string, fallback = ""): string => {
      const idx = headers.indexOf(key);
      return idx >= 0 ? values[idx] ?? fallback : fallback;
    };
    const lat = Number.parseFloat(get("latitude", "-25.7"));
    const lng = Number.parseFloat(get("longitude", "28.2"));
    const typeRaw = get("type", "smoc_campus");
    const type =
      typeRaw === "rsmoc" || typeRaw === "csmoc" ? typeRaw : ("smoc_campus" as const);
    return {
      name: get("name"),
      code: get("code").toUpperCase(),
      slug: get("slug").toLowerCase(),
      type,
      latitude: Number.isFinite(lat) ? lat : -25.7,
      longitude: Number.isFinite(lng) ? lng : 28.2,
      province: get("province") || undefined,
    };
  }

  private parseRtus(rows: string[][]): {
    rtus: NonNullable<OnboardingDraft["rtus"]>;
    rtuCredentials: ParsedExcel["rtuCredentials"];
  } {
    if (rows.length < 2) {
      return { rtus: [], rtuCredentials: [] };
    }
    const headers = rows[0].map((h) => h.toLowerCase());
    const get = (values: string[], key: string): string => {
      const idx = headers.indexOf(key);
      return idx >= 0 ? values[idx] ?? "" : "";
    };
    const rtuCredentials: ParsedExcel["rtuCredentials"] = [];
    const rtus = rows.slice(1).map((values, rtuIndex) => {
      const protocol = (get(values, "protocol") || "mqtt") as OnboardingProtocol;
      const portRaw = get(values, "port");
      const port = portRaw ? Number.parseInt(portRaw, 10) : 8883;
      const tlsRaw = get(values, "tls").toLowerCase();
      const topic = get(values, "topic");
      if (topic.length > MAX_RTU_TOPIC_CHARS) {
        // The row number is the RTU's position in the `RTUS` section's data
        // rows, which is what the operator counts down the sheet. Neither the
        // topic nor any other cell is echoed: a refusal describes the cell it
        // refused, it does not repeat it (AGENTS.md §4.3).
        throw new BadRequestException(
          `RTU row ${rtuIndex + 1} has a topic of ${topic.length} characters, more than the ` +
            `${MAX_RTU_TOPIC_CHARS} an MQTT topic may hold; shorten it and upload the workbook again`,
        );
      }
      const username = get(values, "username").trim();
      const password = get(values, "password").trim();
      if (
        username &&
        password &&
        !this.isPlaceholderSecret(password) &&
        protocol === "mqtt"
      ) {
        rtuCredentials.push({
          rtuIndex,
          credentials: { username, password },
        });
      }
      return {
        code: get(values, "rtu_code"),
        displayName: get(values, "rtu_name") || get(values, "rtu_code"),
        protocol,
        config: {
          host: get(values, "host") || "phe.thinkiot.co.in",
          port: Number.isFinite(port) ? port : 8883,
          tls: tlsRaw === "" || tlsRaw === "true" || tlsRaw === "1" || tlsRaw === "yes",
          topic,
        },
        credentialsSet: false,
        ingestEnabled: protocol === "mqtt",
      };
    });
    return { rtus, rtuCredentials };
  }

  /** Fixes duplicate or blank RTU display names using each RTU code. */
  private normalizeRtuDisplayNames(
    rtus: NonNullable<OnboardingDraft["rtus"]>,
  ): { rtus: NonNullable<OnboardingDraft["rtus"]>; displayNameFixes: string[] } {
    const seen = new Set<string>();
    const displayNameFixes: string[] = [];
    const normalized = rtus.map((rtu) => {
      const trimmed = rtu.displayName.trim();
      const key = trimmed.toLowerCase();
      if (!trimmed || seen.has(key)) {
        const fixed = this.displayNameFromRtuCode(rtu.code);
        if (fixed !== trimmed) {
          // Three cells of sheet-supplied text, each bounded where it is
          // interpolated (`spreadsheet-guard.ts`) — never in a wrapper, because
          // this line is built before anything that could wrap it runs.
          // `quoteCell` supplies the quotes, so the backticks that used to
          // surround the code are gone.
          displayNameFixes.push(
            `**${quoteCell(trimmed || rtu.code)}** → **${quoteCell(fixed)}** (from ${quoteCell(rtu.code)})`,
          );
        }
        seen.add(fixed.toLowerCase());
        return { ...rtu, displayName: fixed };
      }
      seen.add(key);
      return rtu;
    });
    return { rtus: normalized, displayNameFixes };
  }

  private displayNameFromRtuCode(code: string): string {
    const match = code.match(/^(.*)-RTU-(\d+)$/i);
    if (match) {
      const prefix = match[1].replace(/-/g, " ");
      return `${prefix} RTU ${match[2]}`;
    }
    return code;
  }

  private parseAssets(
    rows: string[][],
    defaultSiteName: string,
    rtuCodeToIndex: Map<string, number>,
  ): NonNullable<OnboardingDraft["assets"]> {
    if (rows.length < 2) {
      return [];
    }
    const headers = rows[0].map((h) => h.toLowerCase());
    const get = (values: string[], key: string): string => {
      const idx = headers.indexOf(key);
      return idx >= 0 ? values[idx] ?? "" : "";
    };
    return rows.slice(1).map((values) => {
      const rtuCode = get(values, "rtu_code");
      const rtuIndex = rtuCodeToIndex.get(rtuCode) ?? 0;
      return {
        rtuIndex,
        code: get(values, "asset_code"),
        name: get(values, "asset_name") || get(values, "asset_code"),
        siteName: get(values, "site_name") || defaultSiteName,
        domain: assetDomainFromCell(get(values, "domain")),
      };
    });
  }

  private isPlaceholderSecret(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    return (
      normalized === "" ||
      normalized === "your-password" ||
      normalized === "changeme" ||
      normalized === "change-me" ||
      normalized.startsWith("your-") ||
      normalized.startsWith("enter-")
    );
  }
}
