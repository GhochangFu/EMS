import { defineProject } from "vitest/config";

/**
 * API tests (ADR 0014). Mostly pure functions and Zod schemas with no I/O.
 *
 * `*.integration.test.ts` is the documented exception (`F4.10`): it talks to a
 * real Postgres because the behaviour under test *is* the SQL. Those files gate
 * themselves on `DATABASE_URL` — skipped without one, hard-failed under `CI` —
 * so this project stays runnable on a machine with no stack up.
 */
export default defineProject({
  test: {
    name: "api",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
