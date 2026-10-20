import { expect } from "vitest";

import {
  archiveRefusedMessage,
  branchRefusedMessage,
  draftRequiredMessage,
  instantiateRefusedMessage,
  TEMPLATE_LIFECYCLE_STATUSES,
} from "@bms/shared";
import { catalogEntry } from "@bms/shared/copilot";

import { PROPOSE_TARGET_ERROR, TEMPLATE_LIFECYCLE_RULED_IDS, templateLifecycleRefusal } from "./copilot-template-lifecycle";

/**
 * `F4.246` — the propose tool's mirror of each template route's lifecycle
 * refusal (ADR 0049 decision 2). One claim per case; each refusal is checked
 * beside the status the route admits, so "always refuse" and "never refuse"
 * both redden. Vitest entry point: the sibling `.test.ts`.
 */

/** `assetTemplate.update` / `dashboardTemplate.update`: a draft only, with the "edited" sentence. */
export function anEditOfANonDraftIsRefusedWithTheEditSentence(): void {
  for (const id of ["assetTemplate.update", "dashboardTemplate.update"]) {
    expect(templateLifecycleRefusal(id, "draft"), id).toBeNull();
    expect(templateLifecycleRefusal(id, "published"), id).toBe(draftRequiredMessage("published", "edited"));
    expect(templateLifecycleRefusal(id, "archived"), id).toBe(draftRequiredMessage("archived", "edited"));
  }
}

/** `*.publish`: a draft only, with the "published" sentence (the transition `draft -> published`). */
export function aPublishNeedsADraft(): void {
  for (const id of ["assetTemplate.publish", "dashboardTemplate.publish"]) {
    expect(templateLifecycleRefusal(id, "draft"), id).toBeNull();
    expect(templateLifecycleRefusal(id, "published"), id).toBe(draftRequiredMessage("published", "published"));
    expect(templateLifecycleRefusal(id, "archived"), id).toBe(draftRequiredMessage("archived", "published"));
  }
}

/** `*.archive`: a published version only (the transition `published -> archived`). */
export function anArchiveNeedsAPublishedVersion(): void {
  for (const id of ["assetTemplate.archive", "dashboardTemplate.archive"]) {
    expect(templateLifecycleRefusal(id, "published"), id).toBeNull();
    expect(templateLifecycleRefusal(id, "draft"), id).toBe(archiveRefusedMessage("draft"));
    expect(templateLifecycleRefusal(id, "archived"), id).toBe(archiveRefusedMessage("archived"));
  }
}

/** `dashboardTemplate.draft`: a new draft branches from a published version only. */
export function aNewDashboardDraftBranchesFromAPublishedVersion(): void {
  const id = "dashboardTemplate.draft";
  expect(templateLifecycleRefusal(id, "published")).toBeNull();
  expect(templateLifecycleRefusal(id, "draft")).toBe(branchRefusedMessage("draft"));
  expect(templateLifecycleRefusal(id, "archived")).toBe(branchRefusedMessage("archived"));
}

/** `*.instantiate`: a published version only, each with its own route's sentence. */
export function anInstantiateNeedsAPublishedVersion(): void {
  expect(templateLifecycleRefusal("assetTemplate.instantiate", "published")).toBeNull();
  expect(templateLifecycleRefusal("dashboardTemplate.instantiate", "published")).toBeNull();
  expect(templateLifecycleRefusal("assetTemplate.instantiate", "draft")).toBe(instantiateRefusedMessage("draft", "asset"));
  expect(templateLifecycleRefusal("dashboardTemplate.instantiate", "archived")).toBe(
    instantiateRefusedMessage("archived", "dashboard"),
  );
}

/**
 * An entry whose route holds no status guard is never refused, with any status
 * or none: `assetTemplate.draft` and `dashboardTemplate.applyToSites` read no
 * status, and a non-template entry has none to read.
 */
export function anEntryWithoutALifecycleRuleIsNeverRefused(): void {
  for (const id of ["location.update", "assetTemplate.create", "assetTemplate.draft", "dashboardTemplate.applyToSites"]) {
    for (const status of [...TEMPLATE_LIFECYCLE_STATUSES, undefined]) {
      expect(templateLifecycleRefusal(id, status), `${id} ${String(status)}`).toBeNull();
    }
  }
}

/** A ruled entry whose target carries no status refuses as an unknown target: a fake that forgets `status` cannot pass. */
export function aRuledEntryWithoutAStatusFailsClosed(): void {
  for (const id of TEMPLATE_LIFECYCLE_RULED_IDS) {
    expect(templateLifecycleRefusal(id, undefined), id).toBe(PROPOSE_TARGET_ERROR);
  }
}

/** The nine ruled ids are the nine catalog entries named above: a renamed catalog id cannot leave a rule behind. */
export function everyRuledIdIsACatalogEntry(): void {
  expect([...TEMPLATE_LIFECYCLE_RULED_IDS].sort()).toEqual([
    "assetTemplate.archive",
    "assetTemplate.instantiate",
    "assetTemplate.publish",
    "assetTemplate.update",
    "dashboardTemplate.archive",
    "dashboardTemplate.draft",
    "dashboardTemplate.instantiate",
    "dashboardTemplate.publish",
    "dashboardTemplate.update",
  ]);
  for (const id of TEMPLATE_LIFECYCLE_RULED_IDS) expect(catalogEntry(id), id).toBeDefined();
}
