import { defineProject } from "vitest/config";

/** API unit tests: pure functions and Zod schemas, no I/O (ADR 0014). */
export default defineProject({
  test: {
    name: "api",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
