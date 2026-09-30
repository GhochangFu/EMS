import { mimicOrgSymbolDtoSchema } from "./mimic-layouts";
import { mimicSymbolLibrariesResponseSchema } from "./mimic-symbol-library-catalog";
import {
  MAX_MIMIC_SYMBOL_SHAPES,
  MIMIC_ORG_LIBRARY_CODE,
  mimicOrgLibraryKeySchema,
  mimicOrgSymbolKeySchema,
} from "./mimic-symbol-libraries";

/**
 * `F3.32f` slice 3 / ADR 0086 decisions 2 and 6 — the organization symbol vocabulary: the keys,
 * the stored symbol as the response re-checks it, and the library catalog.
 *
 * Assertions live here; `mimic-symbol-libraries.test.ts` is the Vitest entry point (ADR 0014).
 * One claim per exported function, so a mutation reddens the `it` that owns it.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function firstMessage(result: { success: boolean; error?: { issues: { message: string }[] } }): string {
  return result.success ? "" : (result.error?.issues[0]?.message ?? "");
}

function pathsOf(result: { success: boolean; error?: { issues: { path: (string | number)[] }[] } }): string[] {
  return result.success ? [] : (result.error?.issues.map((issue) => issue.path.join(".")) ?? []);
}

const SYMBOL_ID = "55555555-5555-4555-8555-555555555555";
const LIBRARY_ID = "66666666-6666-4666-8666-666666666666";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

/** A stored symbol that parses: the positive control every refusal below differs from by one field. */
export const validOrgSymbol = {
  id: SYMBOL_ID,
  libraryId: LIBRARY_ID,
  key: "org.plant:inlet-screen",
  label: "Inlet screen",
  group: "water",
  style: "stroke",
  viewBox: [0, 0, 100, 50],
  shapes: [
    ["path", { d: "M0 0L10 10z", transform: "translate(1 2) scale(2)" }],
    ["circle", { cx: "5", cy: "5", r: "2.5" }],
  ],
  active: true,
  sourceFilename: "inlet-screen.svg",
  sha256: "a".repeat(64),
  updatedAt: "2026-09-30T00:00:00.000Z",
};

function withShapes(shapes: unknown[]): unknown {
  return { ...validOrgSymbol, shapes };
}

/** An organization symbol key is `org.<code>:<name>` (decision 2). */
export function orgSymbolKeyAcceptsOrgPlantInletScreen(): void {
  const parsed = mimicOrgSymbolKeySchema.safeParse("org.plant:inlet-screen");
  assert(parsed.success, `org.plant:inlet-screen refused: ${firstMessage(parsed)}`);
}

/** A static key, an upper-case code and a missing name are not organization keys; the message is
 * the class of error only. */
export function orgSymbolKeyRefusesAStaticKeyAndAnUppercaseOne(): void {
  for (const key of ["tank", "mdi:heat-pump", "org.Plant:inlet", "org.plant", "org.plant:", "org.plant:-x"]) {
    const parsed = mimicOrgSymbolKeySchema.safeParse(key);
    assert(!parsed.success, `${key} parsed as an organization symbol key`);
    assert(firstMessage(parsed) === "Unknown mimic symbol", `${key}: ${firstMessage(parsed)}`);
  }
}

/** The whole key fits `mimic_layout_nodes.org_symbol_key varchar(64)`. */
export function orgSymbolKeyRefusesOverSixtyFourCharacters(): void {
  const at64 = `org.plant:${"a".repeat(64 - "org.plant:".length)}`;
  assert(mimicOrgSymbolKeySchema.safeParse(at64).success, "a 64-character key must parse");
  assert(!mimicOrgSymbolKeySchema.safeParse(`${at64}a`).success, "a 65-character key parsed");
}

/** A library code is at most 27 characters, so `org.<code>` fits `varchar(32)` (decision 2). */
export function orgLibraryKeyRefusesACodeOver27Characters(): void {
  const at27 = `p${"a".repeat(26)}`;
  assert(mimicOrgLibraryKeySchema.safeParse(`org.${at27}`).success, "a 27-character code must parse");
  const over = mimicOrgLibraryKeySchema.safeParse(`org.${at27}a`);
  assert(!over.success, "a 28-character code parsed");
  assert(firstMessage(over) === "Unknown symbol library", `message: ${firstMessage(over)}`);
  assert(MIMIC_ORG_LIBRARY_CODE.test(at27) && !MIMIC_ORG_LIBRARY_CODE.test(`${at27}a`), "the bare code bound differs");
}

/** A library key is not a symbol key and not a static code. */
export function orgLibraryKeyRefusesASymbolKeyAndAStaticCode(): void {
  for (const code of ["org.plant:inlet", "core", "mdi", "org.", "org.9plant"]) {
    assert(!mimicOrgLibraryKeySchema.safeParse(code).success, `${code} parsed as an organization library key`);
  }
}

/** The positive control: a well-formed stored symbol parses. */
export function orgSymbolDtoParsesAValidSymbol(): void {
  const parsed = mimicOrgSymbolDtoSchema.safeParse(validOrgSymbol);
  assert(parsed.success, `the valid symbol refused at ${JSON.stringify(pathsOf(parsed))}`);
}

/** An attribute outside the geometry list is refused on the way out (decision 6). */
export function shapeAttrsRefuseAnUnknownKey(): void {
  const parsed = mimicOrgSymbolDtoSchema.safeParse(withShapes([["rect", { x: "0", onload: "alert(1)" }]]));
  assert(!parsed.success, "a shape carrying onload parsed");
  assert(pathsOf(parsed).some((p) => p.startsWith("shapes.0.1")), `paths: ${JSON.stringify(pathsOf(parsed))}`);
}

/** A numeric attribute is a bare number: `10px` is refused. */
export function shapeAttrsRefuseAUnitSuffix(): void {
  const parsed = mimicOrgSymbolDtoSchema.safeParse(withShapes([["circle", { cx: "10px", cy: "1", r: "1" }]]));
  assert(!parsed.success, "cx=10px parsed");
  assert(pathsOf(parsed).includes("shapes.0.1.cx"), `paths: ${JSON.stringify(pathsOf(parsed))}`);
}

/** Path data holds the command letters and numbers only. */
export function pathDataRefusesALetterOutsideTheCommandSet(): void {
  const parsed = mimicOrgSymbolDtoSchema.safeParse(withShapes([["path", { d: "javascript:alert(1)" }]]));
  assert(!parsed.success, "d=javascript: parsed");
  assert(pathsOf(parsed).includes("shapes.0.1.d"), `paths: ${JSON.stringify(pathsOf(parsed))}`);
}

/** A transform holds numbers only: `url(#x)` is refused. */
export function transformRefusesAUrl(): void {
  const parsed = mimicOrgSymbolDtoSchema.safeParse(withShapes([["path", { d: "M0 0", transform: "url(#x)" }]]));
  assert(!parsed.success, "transform=url(#x) parsed");
  assert(pathsOf(parsed).includes("shapes.0.1.transform"), `paths: ${JSON.stringify(pathsOf(parsed))}`);
}

/** The tag is one of the seven shape elements. */
export function orgSymbolDtoRefusesATagOutsideTheSeven(): void {
  const parsed = mimicOrgSymbolDtoSchema.safeParse(withShapes([["script", {}]]));
  assert(!parsed.success, "a script shape parsed");
  assert(pathsOf(parsed).includes("shapes.0.0"), `paths: ${JSON.stringify(pathsOf(parsed))}`);
}

/** At most 200 shapes (decision 6). */
export function orgSymbolDtoRefusesMoreThan200Shapes(): void {
  const rect = ["rect", { x: "0", y: "0", width: "1", height: "1" }];
  const at = mimicOrgSymbolDtoSchema.safeParse(withShapes(Array.from({ length: MAX_MIMIC_SYMBOL_SHAPES }, () => rect)));
  assert(at.success, `200 shapes refused at ${JSON.stringify(pathsOf(at))}`);
  const over = mimicOrgSymbolDtoSchema.safeParse(withShapes(Array.from({ length: MAX_MIMIC_SYMBOL_SHAPES + 1 }, () => rect)));
  assert(!over.success, "201 shapes parsed");
}

/** The view box is four numbers with a positive width and height. */
export function orgSymbolDtoRefusesAZeroWidthViewBox(): void {
  const zero = mimicOrgSymbolDtoSchema.safeParse({ ...validOrgSymbol, viewBox: [0, 0, 0, 50] });
  assert(!zero.success, "a zero-width view box parsed");
  const three = mimicOrgSymbolDtoSchema.safeParse({ ...validOrgSymbol, viewBox: [0, 0, 50] });
  assert(!three.success, "a three-number view box parsed");
}

/** The catalog answers the global libraries with the switch and the organization's libraries
 * with their symbols (decision 7). */
export function catalogResponseParsesGlobalAndOrganizationLibraries(): void {
  const parsed = mimicSymbolLibrariesResponseSchema.safeParse({
    global: [
      {
        code: "tabler",
        label: "Tabler Icons",
        style: "stroke",
        licence: "MIT",
        active: true,
        enabled: false,
        inactiveSymbolKeys: ["tabler:bolt"],
      },
    ],
    organization: [
      {
        id: LIBRARY_ID,
        organizationId: ORG_ID,
        code: "plant",
        key: "org.plant",
        label: "Plant",
        style: "stroke",
        licence: "CC BY 4.0",
        attribution: "Drawn by the plant team",
        sourceUrl: null,
        active: true,
        symbolCount: 1,
        symbols: [validOrgSymbol],
        createdAt: "2026-09-30T00:00:00.000Z",
        updatedAt: "2026-09-30T00:00:00.000Z",
      },
    ],
  });
  assert(parsed.success, `the catalog refused at ${JSON.stringify(pathsOf(parsed))}`);
}

/** An organization library's key must be an organization key, not a static code. */
export function catalogRefusesAStaticCodeAsAnOrganizationKey(): void {
  const parsed = mimicSymbolLibrariesResponseSchema.safeParse({
    global: [],
    organization: [
      {
        id: LIBRARY_ID,
        organizationId: ORG_ID,
        code: "mdi",
        key: "mdi",
        label: "Plant",
        style: "stroke",
        licence: "CC BY 4.0",
        attribution: "",
        sourceUrl: null,
        active: true,
        symbolCount: 0,
        symbols: [],
        createdAt: "2026-09-30T00:00:00.000Z",
        updatedAt: "2026-09-30T00:00:00.000Z",
      },
    ],
  });
  assert(!parsed.success, "an organization library keyed mdi parsed");
  assert(pathsOf(parsed).includes("organization.0.key"), `paths: ${JSON.stringify(pathsOf(parsed))}`);
}
