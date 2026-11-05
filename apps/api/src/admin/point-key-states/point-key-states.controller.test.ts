import { describe, it } from "vitest";

import {
  aMalformedIdIsA400BeforeTheService,
  aRefusalFromTheServicePassesThrough,
  theCreateRoutePassesTheRawBody,
  theIdRoutesCallTheirOwnMethods,
  theListRouteCallsList,
  theRoutesAreMountedWithA204Delete,
} from "./point-key-states.controller.spec";

/** `F4.309` — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.309 — the admin point-key-states routes (plan C6)", () => {
  it("mounts at admin/point-key-states, DELETE :id answering 204", () => theRoutesAreMountedWithA204Delete());
  it("lists for the caller", () => theListRouteCallsList());
  it("hands the raw create body to the service", () => theCreateRoutePassesTheRawBody());
  it("passes the service's refusals through, and maps a ZodError on PATCH to 400", () =>
    aRefusalFromTheServicePassesThrough());
  it("answers 400 for a malformed id without reaching the service", () => aMalformedIdIsA400BeforeTheService());
  it("sends PATCH :id to update and DELETE :id to remove", () => theIdRoutesCallTheirOwnMethods());
});
