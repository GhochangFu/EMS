import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** Reads a file with its comments removed — see `tests/f4.63-query-retry-wiring.test.ts`. */
function source(relative: string): string {
  return readFileSync(join(repoRoot, relative), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * `F4.156` — the session-bound cache is only worth having if it is wired in.
 *
 * `apps/web/src/lib/query-cache-session.spec.ts` proves the rule; deleting the
 * one call in `main.tsx` would leave every one of those assertions green while
 * the next user in a tab inherited the previous user's cache again. `main.tsx`
 * is the only production `QueryClient`, and no behavioural spec reaches it, so
 * a source scan is what is left (the `F4.63` precedent).
 *
 * The call must sit at module scope — column 0, not inside an effect, where
 * StrictMode would subscribe twice — and bind the same `queryClient` the
 * provider receives.
 */
const BOUND_AT_MODULE_SCOPE = /^bindQueryCacheToSession\(\s*useAuthStore\s*,\s*queryClient\s*\);/m;

const main = source("apps/web/src/main.tsx");

describe("F4.156 — the query cache is bound to the session in main.tsx", () => {
  it("main.tsx constructs queryClient and hands it to QueryClientProvider (positive control)", () => {
    expect(/const queryClient = new QueryClient\(/.test(main)).toBe(true);
    expect(/<QueryClientProvider client=\{queryClient\}>/.test(main)).toBe(true);
  });

  it("main.tsx imports bindQueryCacheToSession and useAuthStore", () => {
    expect(
      /import \{ bindQueryCacheToSession \} from "\.\/lib\/query-cache-session"/.test(main),
    ).toBe(true);
    expect(/import \{ useAuthStore \} from "\.\/stores\/auth-store"/.test(main)).toBe(true);
  });

  it("main.tsx binds useAuthStore to queryClient at module scope", () => {
    expect(BOUND_AT_MODULE_SCOPE.test(main)).toBe(true);
  });

  it("positive control — a copy without the call reads as unbound", () => {
    const unbound = main.replace(BOUND_AT_MODULE_SCOPE, "");
    expect(unbound).not.toBe(main);
    expect(BOUND_AT_MODULE_SCOPE.test(unbound)).toBe(false);
  });
});
