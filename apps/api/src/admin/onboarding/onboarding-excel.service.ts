import { BadRequestException, Injectable } from "@nestjs/common";
import * as XLSX from "xlsx";

import type { OnboardingDraft, OnboardingProtocol } from "@bms/shared";

import type { OnboardingDraftInput } from "./onboarding.schema";

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

  /** Parses an uploaded workbook into onboarding draft sections. */
  parseUpload(buffer: Buffer): ParsedExcel {
    const book = XLSX.read(buffer, { type: "buffer" });
    const sheet = book.Sheets[book.SheetNames[0] ?? ""];
    if (!sheet) {
      throw new BadRequestException("Workbook has no sheets");
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
          topic: get(values, "topic"),
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
          displayNameFixes.push(`**${trimmed || rtu.code}** → **${fixed}** (from \`${rtu.code}\`)`);
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
        domain: get(values, "domain") || "electrical",
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
