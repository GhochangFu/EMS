// @vitest-environment jsdom
import { describe, it } from "vitest";

import {
  clearsWhenTheSessionEnds,
  clearsWhenTheUserChanges,
  keepsTheCacheOnAnUnrelatedStoreChange,
  keepsTheCacheWhenMeResetsTheSameSession,
  keepsTheCacheWhenTheTokenIsRenewedForTheSameUser,
} from "./query-cache-session.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * jsdom because `useAuthStore` persists to `localStorage`.
 */
describe("F4.156 query cache bound to the session", () => {
  it("clears the cache when the session ends", () => {
    clearsWhenTheSessionEnds();
  });

  it("clears the cache when the user changes", () => {
    clearsWhenTheUserChanges();
  });

  it("keeps the cache when /me re-sets the same session", () => {
    keepsTheCacheWhenMeResetsTheSameSession();
  });

  it("keeps the cache when the token is renewed for the same user", () => {
    keepsTheCacheWhenTheTokenIsRenewedForTheSameUser();
  });

  it("keeps the cache on an unrelated store change", () => {
    keepsTheCacheOnAnUnrelatedStoreChange();
  });
});
