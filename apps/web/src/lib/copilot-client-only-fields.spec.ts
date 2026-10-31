import { expect } from "vitest";

import { catalogEntry } from "@bms/shared/copilot";

import { clientOnlyFieldsFor } from "./copilot-client-only-fields";

/**
 * `F4.279` (ADR 0099 Amendment 8 Q11, Q12; owner ruling Q10) — which
 * `clientOnly` boxes a Confirm card shows for a stored change, and which must
 * parse before Confirm. Vitest entry point: the sibling `.test.ts`.
 */

const ORG = "11111111-1111-4111-8111-111111111111";

function shown(id: string, body: Record<string, unknown>) {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(id);
  return clientOnlyFieldsFor(entry, body, null)
    .filter((field) => field.shown)
    .map((field) => [field.path, field.required]);
}

/** An email create shows no box. */
export function anEmailCreateShowsNoBox(): void {
  expect(shown("notificationChannel.create", { organizationId: ORG, code: "ops", name: "Ops", kind: "email", config: { to: ["a@example.test"] } })).toEqual([]);
}

/** A webhook create shows both boxes: the URL required, the secret optional. */
export function aWebhookCreateShowsBothBoxes(): void {
  expect(shown("notificationChannel.create", { organizationId: ORG, code: "hook", name: "Hook", kind: "webhook" })).toEqual([
    ["secret", false],
    ["config.url", true],
  ]);
}

/** A webhook update without `config` shows the secret box only; its kind is read from the stored recipients. */
export function aWebhookUpdateWithoutConfigShowsTheSecretOnly(): void {
  expect(shown("notificationChannel.update", { name: "Hook 2", recipients: [{ channelId: "c", name: "Hook", kind: "webhook", targets: [] }] })).toEqual([
    ["secret", false],
  ]);
}

/** A webhook update that replaces `config` asks for the URL too. */
export function aWebhookUpdateThatReplacesConfigAsksForTheUrl(): void {
  expect(shown("notificationChannel.update", { kind: "webhook", config: {} })).toEqual([
    ["secret", false],
    ["config.url", true],
  ]);
}

/** The URL box checks a URL; the secret box checks the route's own rule (at least eight characters). */
export function theSchemasAreTheRoutesRules(): void {
  const entry = catalogEntry("notificationChannel.create");
  if (!entry) throw new Error("notificationChannel.create");
  const [secret, url] = clientOnlyFieldsFor(entry, { kind: "webhook" }, null);
  expect([
    url?.schema?.safeParse("not a url").success,
    url?.schema?.safeParse("https://hooks.example.test/x").success,
    secret?.schema?.safeParse("short").success,
    secret?.schema?.safeParse("long-enough-secret").success,
  ]).toEqual([false, true, false, true]);
}

/** `F4.289`: a rule batch's `excludedRows` shows no box and is not required (the row checkboxes set it). */
export function theBatchExcludedRowsShowNoBox(): void {
  const entry = catalogEntry("rule.createBatch");
  if (!entry) throw new Error("rule.createBatch");
  expect(clientOnlyFieldsFor(entry, { rules: [] }, null).map((field) => [field.path, field.shown, field.required])).toEqual([
    ["excludedRows", false, false],
  ]);
}

/** Any other entry's `clientOnly` field is shown and required, as before. */
export function anotherEntrysFieldIsRequired(): void {
  const entry = catalogEntry("notificationChannel.create");
  if (!entry) throw new Error("notificationChannel.create");
  const fixture = { ...entry, id: "fixture.password", clientOnly: ["code"] };
  expect(clientOnlyFieldsFor(fixture, {}, null).map((field) => [field.path, field.shown, field.required])).toEqual([["code", true, true]]);
}
