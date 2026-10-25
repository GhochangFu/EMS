import { expect } from "vitest";

import { canonicalJson } from "../canonical-json";
import { withoutPaths, withPaths } from "./client-only";

/**
 * `F4.279` (ADR 0099 Amendment 8, Q12) — a `clientOnly` entry may name a
 * nested path (`config.url`). One helper strips it for the API's hash and sets
 * it for the web's Confirm, so the two sides cannot drift. No database.
 */

const BODY = { name: "Hook", config: { url: "https://hooks.example.test/x", to: ["a@example.test"] } };

/** A dotted path strips the nested key. */
export function aDottedPathStripsTheNestedKey(): void {
  expect(withoutPaths(BODY, ["config.url"])).toEqual({ name: "Hook", config: { to: ["a@example.test"] } });
}

/** A top-level path strips the top-level key. */
export function aTopLevelPathStripsTheKey(): void {
  expect(withoutPaths({ name: "Hook", secret: "s3cret-value" }, ["secret"])).toEqual({ name: "Hook" });
}

/** A body without the path is left as it was (the same canonical JSON). */
export function anAbsentPathIsANoOp(): void {
  const body = { name: "Hook", config: { to: ["a@example.test"] } };
  expect(canonicalJson(withoutPaths(body, ["config.url", "secret"]))).toBe(canonicalJson(body));
}

/** The strip copies; the caller's body keeps its key. */
export function theStripDoesNotMutateTheBody(): void {
  const body = { config: { url: "https://hooks.example.test/x" } };
  withoutPaths(body, ["config.url"]);
  expect(body.config.url).toBe("https://hooks.example.test/x");
}

/** A typed value is written at its nested path, beside the keys already there. */
export function aTypedValueIsSetAtItsPath(): void {
  expect(withPaths({ name: "Hook", config: { to: ["a@example.test"] } }, { "config.url": "https://hooks.example.test/x" })).toEqual({
    name: "Hook",
    config: { to: ["a@example.test"], url: "https://hooks.example.test/x" },
  });
}

/** The object on the way is created when the body has none. */
export function theObjectOnTheWayIsCreated(): void {
  expect(withPaths({ name: "Hook" }, { "config.url": "https://hooks.example.test/x" })).toEqual({
    name: "Hook",
    config: { url: "https://hooks.example.test/x" },
  });
}

/** A blank value sets nothing (an untyped optional secret is omitted). */
export function aBlankValueSetsNothing(): void {
  expect(withPaths({ name: "Hook" }, { secret: "" })).toEqual({ name: "Hook" });
}
