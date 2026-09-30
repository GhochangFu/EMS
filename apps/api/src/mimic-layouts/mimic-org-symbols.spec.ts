import { expect } from "vitest";

import { orgSymbolsOf, type OrgSymbolRow } from "./mimic-org-symbols";

/**
 * `F3.32f` slice 3 — the read-side re-check of stored organization symbols (ADR 0086 decision 6,
 * plan D6). Assertions live here; `mimic-org-symbols.test.ts` is the Vitest entry point
 * (ADR 0014). Pure: no database.
 */

const VALID: OrgSymbolRow = {
  id: "55555555-5555-4555-8555-555555555555",
  libraryId: "66666666-6666-4666-8666-666666666666",
  key: "org.plant:inlet",
  label: "Inlet screen",
  groupCode: "water",
  style: "stroke",
  viewBox: [0, 0, 100, 50],
  shapes: [["path", { d: "M0 0L10 10" }]],
  active: false,
  sourceFilename: "inlet.svg",
  sha256: "b".repeat(64),
  updatedAt: new Date("2026-09-30T01:02:03.000Z"),
};

function collect(): { warnings: string[]; warn: (message: string) => void } {
  const warnings: string[] = [];
  return { warnings, warn: (message) => warnings.push(message) };
}

/** A valid row maps to the DTO — group from `group_code`, the timestamp as ISO, retired kept. */
export function mapsAValidRow(): void {
  const { warnings, warn } = collect();
  const out = orgSymbolsOf([VALID], warn);
  expect(out).toEqual([
    {
      id: VALID.id,
      libraryId: VALID.libraryId,
      key: "org.plant:inlet",
      label: "Inlet screen",
      group: "water",
      style: "stroke",
      viewBox: [0, 0, 100, 50],
      shapes: [["path", { d: "M0 0L10 10" }]],
      active: false,
      sourceFilename: "inlet.svg",
      sha256: "b".repeat(64),
      updatedAt: "2026-09-30T01:02:03.000Z",
    },
  ]);
  expect(warnings).toEqual([]);
}

/** A row the contract refuses (a `script` tag) is omitted, and the valid one beside it kept. */
export function omitsARowTheContractRefuses(): void {
  const { warn } = collect();
  const bad: OrgSymbolRow = { ...VALID, id: "77777777-7777-4777-8777-777777777777", key: "org.plant:bad", shapes: [["script", {}]] };
  const out = orgSymbolsOf([bad, VALID], warn);
  expect(out.map((s) => s.key)).toEqual(["org.plant:inlet"]);
}

/** The omission is logged by id only — never the stored content. */
export function logsTheIdAndNotTheContent(): void {
  const { warnings, warn } = collect();
  const bad: OrgSymbolRow = {
    ...VALID,
    id: "77777777-7777-4777-8777-777777777777",
    shapes: [["path", { d: "M0 0", onload: "alert(1)" }]],
  };
  orgSymbolsOf([bad], warn);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("77777777-7777-4777-8777-777777777777");
  expect(warnings[0]).not.toContain("alert");
  expect(warnings[0]).not.toContain("onload");
}

/** A timestamp the driver answered as a string still maps to ISO. */
export function acceptsAStringTimestamp(): void {
  const { warn } = collect();
  const out = orgSymbolsOf([{ ...VALID, updatedAt: "2026-09-30 01:02:03+00" }], warn);
  expect(out[0]?.updatedAt).toBe("2026-09-30T01:02:03.000Z");
}
