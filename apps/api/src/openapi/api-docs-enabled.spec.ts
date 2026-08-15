import { expect } from "vitest";

import { areApiDocsEnabled } from "./api-docs-enabled";

/**
 * `F4.20` / ADR 0029 Amendment 2. Assertions only (§4.6).
 *
 * The case that earns its place is the last one: **production with nothing
 * set** must be off. Everything else here is symmetry; that one is the
 * amendment's entire safety property, because where docs are enabled they are
 * unauthenticated.
 */
export function testExplicitTrueWinsEverywhere(): void {
  expect(areApiDocsEnabled({ API_DOCS_ENABLED: "true", NODE_ENV: "production" })).toBe(true);
  expect(areApiDocsEnabled({ API_DOCS_ENABLED: "TRUE", NODE_ENV: "production" })).toBe(true);
  expect(areApiDocsEnabled({ API_DOCS_ENABLED: " true ", NODE_ENV: "production" })).toBe(true);
}

export function testExplicitFalseWinsEverywhere(): void {
  expect(areApiDocsEnabled({ API_DOCS_ENABLED: "false", NODE_ENV: "development" })).toBe(false);
  expect(areApiDocsEnabled({ API_DOCS_ENABLED: "false" })).toBe(false);
}

export function testDefaultsOnOutsideProduction(): void {
  expect(areApiDocsEnabled({ NODE_ENV: "development" })).toBe(true);
  expect(areApiDocsEnabled({ NODE_ENV: "test" })).toBe(true);
  expect(areApiDocsEnabled({}), "an unset NODE_ENV is not production").toBe(true);
}

export function testDefaultsOffInProduction(): void {
  expect(
    areApiDocsEnabled({ NODE_ENV: "production" }),
    "with nothing set, production must not serve the docs. Where they are served they " +
      "are UNAUTHENTICATED — the whole inventory of routes, including the ADR 0017 " +
      "operations matrix and the ADR 0012 credential endpoints — so this default is the " +
      "amendment's only safety property.",
  ).toBe(false);
  expect(areApiDocsEnabled({ NODE_ENV: " Production " })).toBe(false);
}

/**
 * A value nobody meant — `1`, `yes`, `on` — is **not** treated as true.
 *
 * Deliberate: the failure directions are not symmetric. Reading a typo as
 * "enabled" publishes the API inventory; reading it as "not enabled" costs
 * someone a puzzled minute. Only the exact word turns it on.
 */
export function testUnrecognisedValuesFallThroughToTheDefault(): void {
  expect(areApiDocsEnabled({ API_DOCS_ENABLED: "1", NODE_ENV: "production" })).toBe(false);
  expect(areApiDocsEnabled({ API_DOCS_ENABLED: "yes", NODE_ENV: "production" })).toBe(false);
  expect(areApiDocsEnabled({ API_DOCS_ENABLED: "on", NODE_ENV: "production" })).toBe(false);
  // ...and in development the same unrecognised value leaves them on, because
  // the default there is on. The variable is a switch, not an incantation.
  expect(areApiDocsEnabled({ API_DOCS_ENABLED: "1", NODE_ENV: "development" })).toBe(true);
}
