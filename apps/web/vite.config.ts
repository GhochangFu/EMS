import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const dir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    /**
     * Bundle shared TS directly so Vite does not rely on CJS named export
     * heuristics.
     *
     * **Array form, most specific first, and that is load-bearing.** Vite
     * matches a string `find` as a PREFIX, so a lone `"@bms/shared"` entry
     * rewrites `@bms/shared/contracts` to `…/src/index.ts/contracts` — a path
     * that cannot exist. `tsc` resolves the subpath correctly through the
     * package's `exports` map and says nothing, so the failure surfaces only
     * at `vite build`, pointing at a file nobody wrote.
     *
     * Found by `F4.23`'s spike (ADR 0030) the first time anything in `apps/web`
     * imported a subpath. It was latent until then: `@bms/shared/ingest` is
     * used only by `apps/ingest`, which does not go through Vite. **Every
     * subpath added to `packages/shared` needs an entry here, above the bare
     * one.**
     */
    alias: [
      {
        find: "@bms/shared/contracts",
        replacement: resolve(dir, "../../packages/shared/src/contracts/index.ts"),
      },
      {
        find: "@bms/shared/ingest",
        replacement: resolve(dir, "../../packages/shared/src/ingest.ts"),
      },
      { find: "@bms/shared", replacement: resolve(dir, "../../packages/shared/src/index.ts") },
    ],
  },
  server: {
    port: 5173,
  },
});
