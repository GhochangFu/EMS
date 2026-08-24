import { defineProject } from "vitest/config";

/**
 * `@bms/db` tests (`F4.16`). Without this project vitest never discovers a
 * `.test.ts` here — `packages/db` had no test story until the role-password
 * script needed one that runs with no database (ADR 0014 spec/test split).
 */
export default defineProject({
  test: {
    name: "db",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
