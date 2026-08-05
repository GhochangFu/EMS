import { defineProject } from "vitest/config";

/**
 * Ingest unit tests.
 *
 * Both extensions: the legacy pilot path is plain JS, and `F1.1` is adding the
 * adapter framework in TypeScript alongside it (ADR 0016 §6). The strangler
 * runs both for a while, so the runner has to see both.
 */
export default defineProject({
  test: {
    name: "ingest",
    environment: "node",
    include: ["src/**/*.test.js", "src/**/*.test.ts"],
  },
});
