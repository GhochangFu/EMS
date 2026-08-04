import { defineProject, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";

/**
 * Web tests inherit the app's own Vite config (ADR 0014) so the `@bms/shared`
 * alias and the React transform resolve exactly as they do at runtime.
 *
 * `environment: "node"` is correct while every test here covers pure logic.
 * Component tests will need `jsdom` — add it (and the dependency ADR) then,
 * not speculatively now.
 */
export default mergeConfig(
  viteConfig,
  defineProject({
    test: {
      name: "web",
      environment: "node",
      include: ["src/**/*.test.ts"],
    },
  }),
);
