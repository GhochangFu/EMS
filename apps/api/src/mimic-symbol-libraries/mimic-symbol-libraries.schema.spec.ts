import { expect } from "vitest";
import type { ZodTypeAny } from "zod";

import {
  createMimicOrgSymbolLibraryBodySchema,
  mimicSymbolFilenameSchema,
  mimicSymbolLibrariesQuerySchema,
  mimicSymbolUploadFieldsSchema,
  putMimicLibrarySettingBodySchema,
  updateMimicOrgSymbolBodySchema,
  updateMimicOrgSymbolLibraryBodySchema,
} from "./mimic-symbol-libraries.schema";

/**
 * `F3.32f` slice 3 U2 — the request shapes of `/api/v1/mimic-symbol-libraries`, each refusal by
 * its path. Assertions live here; `mimic-symbol-libraries.schema.test.ts` is the Vitest entry
 * point (ADR 0014), one `it()` per claim.
 */

const ORG = "11111111-1111-4111-8111-111111111111";

const validCreate = (): Record<string, unknown> => ({
  organizationId: ORG,
  code: "plant",
  label: "Plant",
  style: "stroke",
  licence: "CC BY 4.0",
  attribution: "Drawn by the plant team",
  sourceUrl: "https://example.test/plant",
});

const pathsOf = (schema: ZodTypeAny, value: unknown): string[] => {
  const parsed = schema.safeParse(value);
  expect(parsed.success, "the value must be refused").toBe(false);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."));
};

const refusedAt = (schema: ZodTypeAny, value: unknown, path: string): void => {
  expect(pathsOf(schema, value)).toContain(path);
};

export function acceptsAValidCreateBody(): void {
  const parsed = createMimicOrgSymbolLibraryBodySchema.parse(validCreate());
  expect(parsed.code).toBe("plant");
}

export function defaultsAnAbsentAttributionToEmpty(): void {
  const { attribution: _a, sourceUrl: _s, ...rest } = validCreate();
  const parsed = createMimicOrgSymbolLibraryBodySchema.parse(rest);
  expect(parsed.attribution).toBe("");
  expect(parsed.sourceUrl).toBeUndefined();
}

export function createRefusesAnUnknownKey(): void {
  refusedAt(createMimicOrgSymbolLibraryBodySchema, { ...validCreate(), shapes: [] }, "");
}

export function createRefusesAnUppercaseCode(): void {
  refusedAt(createMimicOrgSymbolLibraryBodySchema, { ...validCreate(), code: "Plant" }, "code");
}

export function createRefusesACodeOf28Characters(): void {
  refusedAt(createMimicOrgSymbolLibraryBodySchema, { ...validCreate(), code: `p${"a".repeat(27)}` }, "code");
}

export function createRefusesAnOrgPrefixedCode(): void {
  refusedAt(createMimicOrgSymbolLibraryBodySchema, { ...validCreate(), code: "org.plant" }, "code");
}

export function createRefusesAnEmptyLabel(): void {
  refusedAt(createMimicOrgSymbolLibraryBodySchema, { ...validCreate(), label: "  " }, "label");
}

export function createRefusesAnUnknownStyle(): void {
  refusedAt(createMimicOrgSymbolLibraryBodySchema, { ...validCreate(), style: "outline" }, "style");
}

export function createRefusesAJavascriptSourceUrl(): void {
  refusedAt(createMimicOrgSymbolLibraryBodySchema, { ...validCreate(), sourceUrl: "javascript:alert(1)" }, "sourceUrl");
}

export function createRefusesAMissingOrganization(): void {
  const { organizationId: _o, ...rest } = validCreate();
  refusedAt(createMimicOrgSymbolLibraryBodySchema, rest, "organizationId");
}

export function libraryPatchRefusesAnEmptyBody(): void {
  refusedAt(updateMimicOrgSymbolLibraryBodySchema, {}, "");
}

export function libraryPatchAcceptsActiveAlone(): void {
  expect(updateMimicOrgSymbolLibraryBodySchema.parse({ active: false })).toEqual({ active: false });
}

export function libraryPatchRefusesTheCode(): void {
  refusedAt(updateMimicOrgSymbolLibraryBodySchema, { code: "other" }, "");
}

export function symbolPatchRefusesAnEmptyBody(): void {
  refusedAt(updateMimicOrgSymbolBodySchema, {}, "");
}

export function symbolPatchRefusesAnUnknownGroup(): void {
  refusedAt(updateMimicOrgSymbolBodySchema, { group: "space" }, "group");
}

export function symbolPatchRefusesTheShapes(): void {
  refusedAt(updateMimicOrgSymbolBodySchema, { active: true, shapes: [] }, "");
}

export function settingRefusesAMissingEnabled(): void {
  refusedAt(putMimicLibrarySettingBodySchema, { organizationId: ORG }, "enabled");
}

export function settingRefusesAnUnknownKey(): void {
  refusedAt(putMimicLibrarySettingBodySchema, { organizationId: ORG, enabled: true, libraryCode: "core" }, "");
}

export function queryRefusesANonUuidOrganization(): void {
  refusedAt(mimicSymbolLibrariesQuerySchema, { organizationId: "ESKOM" }, "organizationId");
}

export function uploadFieldsRefuseAnUnknownField(): void {
  refusedAt(mimicSymbolUploadFieldsSchema, { caption: "x" }, "");
}

export function uploadFieldsRefuseANameOutsideTheGrammar(): void {
  refusedAt(mimicSymbolUploadFieldsSchema, { name: "Inlet Screen" }, "name");
}

export function uploadFieldsAcceptBlankFormFields(): void {
  expect(mimicSymbolUploadFieldsSchema.parse({ name: "", label: "", group: "" })).toEqual({ name: "", label: "", group: "" });
}

export function filenameRefusesAControlCharacter(): void {
  expect(mimicSymbolFilenameSchema.safeParse("inlet\u0000.svg").success).toBe(false);
}
