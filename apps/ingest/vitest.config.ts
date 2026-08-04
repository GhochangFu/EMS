import { defineProject } from "vitest/config";

/** MQTT ingest unit tests. Plain JS, so `.test.js` rather than `.test.ts`. */
export default defineProject({
  test: {
    name: "ingest",
    environment: "node",
    include: ["src/**/*.test.js"],
  },
});
