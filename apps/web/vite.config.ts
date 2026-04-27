import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const dir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      /** Bundle shared TS directly so Vite does not rely on CJS named export heuristics. */
      "@bms/shared": resolve(dir, "../../packages/shared/src/index.ts"),
    },
  },
  server: {
    port: 5173,
  },
});
