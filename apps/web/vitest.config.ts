import { defineProject, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";

/**
 * Web tests inherit the app's own Vite config (ADR 0014) so the `@bms/shared`
 * alias and the React transform resolve exactly as they do at runtime.
 *
 * `environment: "node"` stays the default even now that jsdom is available
 * (ADR 0042 decision 2). Twenty of these files cover pure logic and do not want
 * a DOM; a component test opts in per file with a `// @vitest-environment
 * jsdom` docblock on its `.test.tsx` wrapper — the file Vitest collects.
 *
 * `.tsx` is included alongside `.ts` because a component test renders JSX
 * (decision 3). Without it the file would be collected by nothing, and
 * `tests/repo-invariants.test.ts` would not catch that: it fails a `.spec` with
 * no wrapper, not a wrapper nothing runs.
 */
export default mergeConfig(
  viteConfig,
  defineProject({
    test: {
      name: "web",
      environment: "node",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      setupFiles: ["./src/test-setup.ts"],
      /**
       * `F3.65c` — `index.css` only, so `import css from "./index.css?raw"` returns the file
       * (`test-setup.ts` appends it to jsdom; `test-role-tokens.ts` parses its two role blocks).
       * With CSS processing off (Vitest's default) a `?raw` import of it is `""`, and `node:fs`
       * does not typecheck in `apps/web` (no `node` types). Every other stylesheet stays
       * unprocessed. Anchored to `src/index.css` so no other `index.css` (a package's) matches;
       * the id Vitest tests carries the `?raw` query, so the anchor ends at `$` or `?` — a bare
       * `$` matches nothing and every theme spec reads empty tokens.
       */
      css: { include: [/src[\\/]index\.css(?:$|\?)/] },
    },
  }),
);
