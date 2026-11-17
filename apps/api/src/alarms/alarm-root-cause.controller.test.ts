import { describe, it } from "vitest";

import {
  aNonUuidIdIsRefusedBeforeAnyRead,
  theScopeIsResolvedBeforeTheService,
  theServiceReceivesTheScopeUnchanged,
  theServicesNotFoundPassesThrough,
} from "./alarm-root-cause.controller.spec";

/** `E2.3` — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
describe("E2.3 — GET /alarms/:id/root-cause-suggestions (controller, stub services)", () => {
  it("a non-UUID id is a 400 before readableAssetIds or the service runs", () => aNonUuidIdIsRefusedBeforeAnyRead());
  it("the service receives readableAssetIds' value unchanged (array, [], null)", () =>
    theServiceReceivesTheScopeUnchanged());
  it("readableAssetIds runs before the service", () => theScopeIsResolvedBeforeTheService());
  it("the service's NotFoundException passes through", () => theServicesNotFoundPassesThrough());
});
