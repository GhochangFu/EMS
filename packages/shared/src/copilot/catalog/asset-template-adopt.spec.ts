import { expect } from "vitest";

import * as contracts from "../../contracts";
import { catalogEntry, EXCLUDED_ROUTES } from "./index";
import type { CatalogEntry } from "./types";

/**
 * `F4.312` PR 2 (ADR 0099 Amendment 12; ADR 0109 Amendment 1 decision 5) —
 * the `assetTemplate.adopt` entry: the adopt route, with its own body, as a
 * red `edit` card whose target checks the version and every listed asset.
 * Mutation, applied once and seen red: drop the entry's `red: true`
 * ({@link theCardIsRed}).
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const ADOPT = "/admin/asset-templates/:id/adopt";
const PREVIEW = "/admin/asset-templates/:id/adoption-preview";

/** The `assetTemplate.adopt` catalog entry; throws when the catalog lacks it. */
function adopt(): CatalogEntry {
  const entry = catalogEntry("assetTemplate.adopt");
  if (!entry) throw new Error("assetTemplate.adopt");
  return entry;
}

/** The entry is a `POST`. */
export function theEntryIsAPost(): void {
  expect(adopt().method).toBe("POST");
}

/** The entry's path is the adopt route's. */
export function theEntryIsTheAdoptPath(): void {
  expect(adopt().path).toBe(ADOPT);
}

/** The version is named by the one path parameter `id`. */
export function theVersionIsThePathsId(): void {
  expect(Object.keys(adopt().params)).toEqual(["id"]);
}

/** `risk: "edit"`: it re-pins existing assets. */
export function theRiskIsEdit(): void {
  expect(adopt().risk).toBe("edit");
}

/** The body is the route's own export by identity, so the card stores exactly what the route parses. */
export function theBodyIsTheRoutesOwnSchema(): void {
  expect(adopt().body).toBe(contracts.adoptAssetsBodySchema);
}

/** Adoption is one-way (A7), so the Confirm card is red although `edit` is not a red risk. */
export function theCardIsRed(): void {
  expect(adopt().red).toBe(true);
}

/** The target is the new kind, on the path's version and the body's asset ids. */
export function theTargetIsTheAdoptKind(): void {
  expect(adopt().target).toEqual({ kind: "assetTemplateAdopt", param: "id", field: "assetIds" });
}

const pendingPosts = (): string[] => EXCLUDED_ROUTES.filter((route) => route.method === "POST").map((route) => route.path);

/** The adopt route left the pending list. */
export function theAdoptRouteIsNotPending(): void {
  expect(pendingPosts()).not.toContain(ADOPT);
}

/** The adoption preview stays pending, a read through POST as migrate's preview is. */
export function thePreviewStaysPending(): void {
  expect(pendingPosts()).toContain(PREVIEW);
}

/** The summary names the count, the version and the organization, and says the change cannot be undone. */
export function theSummaryNamesTheBatchAndSaysItIsOneWay(): void {
  const summary = adopt().summary({
    body: { assetIds: ["a", "b"] },
    params: { id: "t" },
    targetName: "Feeder v2",
    organizationName: "Org Seven",
  } as never);
  expect(summary).toBe(
    'Pin 2 assets with no template to the asset template "Feeder v2" in Org Seven, all or none. ' +
      "It cannot be undone; later changes go through migrate.",
  );
}
