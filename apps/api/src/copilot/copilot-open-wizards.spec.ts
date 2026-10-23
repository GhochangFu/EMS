import { BadRequestException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import {
  boundedRecordName,
  checkOpenWizards,
  OPEN_WIZARD_INVALID_ERROR,
  OPEN_WIZARD_NAMES_PREFIX,
  OPEN_WIZARDS_JSON_ERROR,
  openWizardNamesMessage,
  openWizardsMessage,
  pageWizardCandidates,
  parseWizardsField,
  resolveWizardRecord,
} from "./copilot-open-wizards";
import { COPILOT_REDACTED } from "./copilot-secret-scrub";

/**
 * `F4.245` / ADR 0099 Amendment 4 — the open-wizard context a turn carries:
 * its check against the catalog, the multipart field's parse, the page an
 * `open_page` route mounts, and the bounded line the model reads. Vitest entry
 * point: the sibling `.test.ts` (ADR 0014).
 */

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

/** The 400's message, so a test names which guard fired, not only that one threw. */
function refusalOf(run: () => unknown): string {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    return (err as BadRequestException).message;
  }
  throw new Error("expected a 400");
}

export function anEditWizardWithItsIdIsAccepted(): void {
  const wizards = [{ catalogId: "dashboard.update", params: { id: A } }];
  expect(checkOpenWizards(wizards)).toStrictEqual(wizards);
}

export function aCreateWizardWithNoParamsIsAccepted(): void {
  expect(checkOpenWizards([{ catalogId: "dashboard.create", params: {} }])).toHaveLength(1);
}

/** Mutation: accept a subset of the entry's path parameters (compare `every given key is known` only). */
export function aMissingPathParameterIsRefused(): void {
  const message = refusalOf(() =>
    checkOpenWizards([
      { catalogId: "dashboard.create", params: {} },
      { catalogId: "userGrant.remove", params: { id: A, kind: "location" } },
    ]),
  );
  expect(message).toBe(`${OPEN_WIZARD_INVALID_ERROR} (wizards[1]: the path parameters are not the entry's)`);
}

/** Mutation: compare the key count only — `{ id, kind, extra }` has the count of a full set. */
export function anExtraPathParameterIsRefused(): void {
  const message = refusalOf(() =>
    checkOpenWizards([{ catalogId: "userGrant.remove", params: { id: A, kind: "location", extra: B } }]),
  );
  expect(message).toBe(`${OPEN_WIZARD_INVALID_ERROR} (wizards[0]: the path parameters are not the entry's)`);
}

/** Mutation: skip `entry.params[name].safeParse` — a non-uuid id passes. */
export function aValueTheEntryRefusesIsRefused(): void {
  const message = refusalOf(() => checkOpenWizards([{ catalogId: "dashboard.update", params: { id: "not-a-uuid" } }]));
  expect(message).toBe(`${OPEN_WIZARD_INVALID_ERROR} (wizards[0]: id is not a value of the entry's)`);
}

export function anUnknownEntryIsRefused(): void {
  const message = refusalOf(() => checkOpenWizards([{ catalogId: "dashboard.delete", params: { id: A } }]));
  expect(message).toBe(`${OPEN_WIZARD_INVALID_ERROR} (wizards[0]: no such catalog entry)`);
}

/** Owner ruling (critique C7): a duplicate does not fail the turn; only a fill for it is refused. */
export function aDuplicateWizardDoesNotFailTheTurn(): void {
  const wizard = { catalogId: "dashboard.update", params: { id: A } };
  expect(checkOpenWizards([wizard, wizard])).toHaveLength(2);
}

/** Critique C4. Mutation: `JSON.parse` without the catch — a `SyntaxError` reaches the controller as a 500. */
export function aMalformedMultipartFieldIsA400(): void {
  expect(refusalOf(() => parseWizardsField("[{"))).toBe(OPEN_WIZARDS_JSON_ERROR);
}

export function aMultipartFieldIsParsedAsJson(): void {
  expect(parseWizardsField(`[{"catalogId":"dashboard.create","params":{}}]`)).toStrictEqual([
    { catalogId: "dashboard.create", params: {} },
  ]);
}

/** Absent stays absent, so the strict schema reports the missing key (the field is required). */
export function anAbsentMultipartFieldStaysAbsent(): void {
  expect(parseWizardsField(undefined)).toBeUndefined();
}

export function theDashboardEditPageMountsItsTwoWizardsBySlug(): void {
  expect(pageWizardCandidates("/admin/dashboards/plant-a")).toStrictEqual([
    { catalogId: "dashboard.update", dashboardSlug: "plant-a" },
    { catalogId: "dashboard.widgets.replace", dashboardSlug: "plant-a" },
  ]);
}

/** Mutation: map the route's parameter to the wrong path parameter name. */
export function aTemplatePageMountsItsWizardsForTheRoutesRecord(): void {
  const found = pageWizardCandidates(`/admin/asset-templates/${A}`);
  expect(found).toContainEqual({ catalogId: "assetTemplate.update", params: { id: A } });
  expect(found).toContainEqual({ catalogId: "assetTemplate.publish", params: { id: A } });
}

/** A route value the entry's own schema refuses names no record. */
export function aTemplatePageWithANonUuidNamesNoWizard(): void {
  expect(pageWizardCandidates("/admin/asset-templates/not-a-uuid")).toStrictEqual([]);
}

export function aListPageMountsItsCreateWizard(): void {
  expect(pageWizardCandidates("/admin/locations")).toStrictEqual([{ catalogId: "location.create", params: {} }]);
}

/** `F4.282` (Q17): each vocabulary page mounts its create wizard. */
export function theVocabularyPagesMountTheirCreateWizards(): void {
  expect(pageWizardCandidates("/admin/location-types")).toStrictEqual([{ catalogId: "locationType.create", params: {} }]);
  expect(pageWizardCandidates("/admin/unit-roles")).toStrictEqual([{ catalogId: "assetRole.create", params: {} }]);
}

export function aPageWithoutAWizardMountsNone(): void {
  expect(pageWizardCandidates("/alarms")).toStrictEqual([]);
}

export function noOpenWizardSendsNoMessage(): void {
  expect(openWizardsMessage([])).toBeNull();
}

const SETTING = { catalogId: "mimicLibrary.setting", params: { libraryCode: "lucide" }, name: null, organizationId: null };
const named = (name: string) => ({ catalogId: "dashboard.update", params: { id: A }, name, organizationId: C });

/** The model reads each record's catalog id and params in the system line. */
export function theSystemLineNamesEachRecordByItsParams(): void {
  const message = openWizardsMessage([named("Plant A"), { catalogId: "dashboard.create", params: {}, name: null, organizationId: null }]);
  expect(message).toContain(`- dashboard.update {"id":"${A}"}`);
  expect(message).toContain("- dashboard.create {}");
}

/** Review L3. Mutation: put the name back on the system line — tenant text reaches the system role. */
export function theSystemLineCarriesNoRecordName(): void {
  expect(openWizardsMessage([named("Plant A")])).not.toContain("Plant A");
}

/** Review L3: the names come in their own block, quoted, under the data label. */
export function theNamesBlockQuotesEachNameAsData(): void {
  const message = openWizardNamesMessage([named('Plant "A"')]) as string;
  expect(message.startsWith(OPEN_WIZARD_NAMES_PREFIX)).toBe(true);
  expect(message).toContain(`- dashboard.update {"id":"${A}"}: "Plant \\"A\\""`);
}

/** A create or a code-named record has no name: no block. Mutation: keep a `null` name → a block. */
export function aRecordWithNoNameSendsNoNamesBlock(): void {
  expect(openWizardNamesMessage([SETTING])).toBeNull();
}

/** Mutation: drop the cut — a long name reaches the model whole. */
export function aLongNameIsCut(): void {
  const message = openWizardNamesMessage([named("x".repeat(500))]) as string;
  expect(message).toContain(`"${"x".repeat(80)}…"`);
  expect(message).not.toContain("x".repeat(81));
}

/**
 * Review L1. The credential sits across the cut: the first 80 characters hold
 * only `pas`. Mutation: cut first, then scrub — the kept half passes the
 * detector and reaches the model.
 */
export function aCredentialAcrossTheCutIsWithheld(): void {
  expect(boundedRecordName(`${"a".repeat(76)} password=Summer2026`)).toBe(COPILOT_REDACTED);
}

/** Review L2. Mutation: write the params unscrubbed — a credential-shaped value reaches the system line. */
export function aCredentialShapedParamIsWithheldFromTheLine(): void {
  const message = openWizardsMessage([{ ...SETTING, params: { libraryCode: "password=Summer2026" } }]) as string;
  expect(message).not.toContain("Summer2026");
}

/** Review L2: a library code is a code. Mutation: drop the regex on `libraryCodeParam` → accepted. */
export function aLibraryCodeOfFreeTextIsRefused(): void {
  const message = refusalOf(() => checkOpenWizards([{ catalogId: "mimicLibrary.setting", params: { libraryCode: "do this now" } }]));
  expect(message).toBe(`${OPEN_WIZARD_INVALID_ERROR} (wizards[0]: libraryCode is not a value of the entry's)`);
}

/** The adjacent positive: a built-in library's code is accepted. */
export function aBuiltInLibraryCodeIsAccepted(): void {
  expect(checkOpenWizards([{ catalogId: "mimicLibrary.setting", params: { libraryCode: "lucide" } }])).toHaveLength(1);
}

/** One line per key: two copies of one record are named once. */
export function aDuplicateRecordIsNamedOnce(): void {
  const message = openWizardNamesMessage([named("Plant A"), named("Plant A")]) as string;
  expect(message.split("dashboard.update").length - 1).toBe(1);
}

/** Review C1. Mutation: resolve in `"propose"` mode — every body-dependent check runs on the empty body. */
export async function anOpenRecordIsResolvedByItsRowAlone(): Promise<void> {
  const modes: unknown[] = [];
  const targets = {
    resolve: async (...args: unknown[]) => {
      modes.push(args[6]);
      return { organizationId: C, organizationName: "Org", targetName: "Priya Rao" };
    },
  };
  const scope = { allowedOrganizationIds: [C], user: { sub: "u" } as JwtPayload, conversationOrganizationId: C };
  await resolveWizardRecord(catalogEntry("userGrant.add") as CatalogEntry, { id: A }, targets, scope);
  expect(modes).toEqual(["record"]);
}

/** `F4.278` (Amendment 8): the Rule Engine page mounts its create wizard. */
export function theRulesPageMountsItsCreateWizard(): void {
  expect(pageWizardCandidates("/rules")).toStrictEqual([{ catalogId: "rule.create", params: {} }]);
}
