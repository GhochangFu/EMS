import { createRequire } from "node:module";

import { defineProject } from "vitest/config";

/**
 * API tests (ADR 0014). Mostly pure functions and Zod schemas with no I/O.
 *
 * `*.integration.test.ts` is the documented exception (`F4.10`): it talks to a
 * real Postgres because the behaviour under test *is* the SQL. Those files gate
 * themselves on `DATABASE_URL` — skipped without one, hard-failed under `CI` —
 * so this project stays runnable on a machine with no stack up.
 */
const requireFromHere = createRequire(import.meta.url);

export default defineProject({
  /**
   * `F3.85` PR 1 — one `zod` instance for the api project. The write-body schemas now live in
   * `@bms/shared`, whose compiled CJS `require`s `zod/index.cjs`, while an api spec's own
   * `import "zod"` resolves the ESM build; a controller's `err instanceof ZodError` then fails
   * for a body its own schema refused (`parse-stored-contract.ts` records the same split).
   * Production is one CommonJS graph and never splits. Pinning the specifier to the CJS entry
   * makes Vitest resolve as production does.
   */
  resolve: {
    alias: [{ find: /^zod$/, replacement: requireFromHere.resolve("zod") }],
  },
  test: {
    name: "api",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
