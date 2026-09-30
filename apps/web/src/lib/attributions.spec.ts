import { MIMIC_SYMBOL_LIBRARIES } from "@bms/shared";
import { expect } from "vitest";

import { globalLibraryAttributions } from "./attributions";

/**
 * `F3.32f` slice 1 (ADR 0086 decision 8) — the attributions page's global rows.
 * `attributions.test.ts` is the Vitest entry.
 */

/** A1 — one entry per library, in the registry's palette order (seven since F3.32f slice 2). */
export function listsTheSevenLibrariesInOrder(): void {
  expect(globalLibraryAttributions({}).map((entry) => entry.code)).toEqual([
    "core",
    "tabler",
    "lucide",
    "mdi",
    "qet",
    "wmpid",
    "drawio",
  ]);
}

/** A2 — core has no source link, no notice and no credits. */
export function coreHasNoSourceNoticeOrCredits(): void {
  const core = globalLibraryAttributions({}).find((entry) => entry.code === "core");
  expect(core?.sourceUrl).toBeNull();
  expect(core?.notice).toBeNull();
  expect(core?.credits).toEqual([]);
}

/** A3 — Lucide reads "ISC and MIT", 1.48.0, with its site as source. */
export function lucideCarriesItsLicenceVersionAndSource(): void {
  const lucide = globalLibraryAttributions({}).find((entry) => entry.code === "lucide");
  expect(lucide?.licence).toBe("ISC and MIT");
  expect(lucide?.version).toBe("1.48.0");
  expect(lucide?.sourceUrl).toBe("https://lucide.dev");
}

/** A4 — a notice comes from the parameter; a library without one gets null. */
export function noticesComeFromTheParameter(): void {
  const entries = globalLibraryAttributions({ mdi: "X" });
  expect(entries.find((entry) => entry.code === "mdi")?.notice).toBe("X");
  expect(entries.find((entry) => entry.code === "tabler")?.notice).toBeNull();
}

/** A5 — name and version are the registry's label and version. */
export function nameAndVersionAreTheRegistrys(): void {
  const entries = globalLibraryAttributions({});
  expect(entries.length).toBeGreaterThan(0);
  for (const entry of entries) {
    const library = MIMIC_SYMBOL_LIBRARIES.find((row) => row.code === entry.code);
    expect(library).toBeDefined();
    expect(entry.name).toBe(library?.label);
    expect(entry.version).toBe(library?.version);
  }
}
