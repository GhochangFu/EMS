import { BadRequestException } from "@nestjs/common";
import { expect } from "vitest";

import {
  checkOpenWizards,
  OPEN_WIZARD_INVALID_ERROR,
  OPEN_WIZARDS_JSON_ERROR,
  openWizardsMessage,
  pageWizardCandidates,
  parseWizardsField,
} from "./copilot-open-wizards";

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

export function aPageWithoutAWizardMountsNone(): void {
  expect(pageWizardCandidates("/alarms")).toStrictEqual([]);
}

export function noOpenWizardSendsNoMessage(): void {
  expect(openWizardsMessage([])).toBeNull();
}

/** The model reads each record's catalog id, params and name, the name as quoted data. */
export function theMessageNamesEachRecordAsData(): void {
  const message = openWizardsMessage([
    { catalogId: "dashboard.update", params: { id: A }, name: "Plant \"A\"", organizationId: C },
    { catalogId: "dashboard.create", params: {}, name: null, organizationId: null },
  ]);
  expect(message).toContain(`- dashboard.update {"id":"${A}"}: "Plant \\"A\\""`);
  expect(message).toContain("- dashboard.create {}: a new record");
}

/** Mutation: drop the cut — a long name reaches the prompt whole. */
export function aLongNameIsCut(): void {
  const message = openWizardsMessage([
    { catalogId: "dashboard.update", params: { id: A }, name: "x".repeat(500), organizationId: C },
  ]) as string;
  expect(message).toContain(`"${"x".repeat(80)}…"`);
  expect(message).not.toContain("x".repeat(81));
}

/** One line per key: two copies of one record are named once. */
export function aDuplicateRecordIsNamedOnce(): void {
  const record = { catalogId: "dashboard.update", params: { id: A }, name: "Plant A", organizationId: C };
  const message = openWizardsMessage([record, record]) as string;
  expect(message.split("dashboard.update").length - 1).toBe(1);
}
