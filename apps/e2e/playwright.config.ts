import { randomBytes } from "node:crypto";

import { defineConfig, devices } from "@playwright/test";

import { API_URL, BASE_URL, REPO_ROOT } from "./src/api.js";

/**
 * ADR 0100 — Playwright end-to-end suite for the critical user paths.
 *
 * It tests the built web bundle (`vite preview` on 127.0.0.1:5173, local
 * auth) against the API run from `apps/api/dist` in local auth, on the
 * Postgres and Redis the environment names, with `apps/sim` writing
 * telemetry. Every server is started here with `reuseExistingServer: false`:
 * a running compose container fails the run with "port in use" rather than
 * letting the suite test the OIDC bundle by mistake.
 *
 * `BASE_URL` is checked by `assertLocalBaseUrl` when `src/api.ts` loads, so
 * the suite never reaches a shared deployment (decision 6).
 */
const REQUIRED_ENV = ["DATABASE_URL", "DATABASE_URL_AUTH", "DATABASE_URL_TENANT", "DATABASE_URL_FLEET"] as const;
const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
if (missing.length > 0) {
  throw new Error(
    `E2E config: ${missing.join(", ")} unset. Export the database URLs the API and the sim need ` +
      "(see .github/workflows/e2e.yml or docs/local-setup.md).",
  );
}

// Playwright loads this file again in every worker. Setting the variables on
// `process.env` once keeps one secret and one run id per run: the workers
// inherit the main process's environment.
const JWT_SECRET: string = (process.env.JWT_SECRET ??= randomBytes(32).toString("hex"));
process.env.E2E_RUN_ID ??= `E2E-${Date.now().toString(36).toUpperCase()}`;

/** `process.env` with the unset entries dropped, plus the overrides. */
function envWith(overrides: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) base[key] = value;
  }
  return { ...base, ...overrides };
}

// The first run after `pnpm build` once exceeded 60 s to bring the three servers
// up on a Windows machine; later runs took about 25 s in total.
const SERVER_START_MS = 120_000;

const apiPort = new URL(API_URL).port || "4000";
const webPort = new URL(BASE_URL).port || "5173";
const webHost = new URL(BASE_URL).hostname;

export default defineConfig({
  testDir: "specs",
  testMatch: "**/*.e2e.ts",
  globalSetup: "./global-setup.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      name: "api",
      command: "node apps/api/dist/main.js",
      cwd: REPO_ROOT,
      url: `${API_URL}/health/ready`,
      timeout: SERVER_START_MS,
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
      env: envWith({
        PORT: apiPort,
        AUTH_MODE: "local",
        OIDC_ISSUER: "",
        JWT_SECRET,
        LOG_LEVEL: "warn",
        OTEL_SDK_DISABLED: "true",
      }),
    },
    {
      name: "web",
      command: `pnpm --filter web exec vite preview --host ${webHost} --port ${webPort} --strictPort`,
      cwd: REPO_ROOT,
      url: `${BASE_URL}/`,
      timeout: SERVER_START_MS,
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
      env: envWith({}),
    },
    {
      name: "sim",
      command: "pnpm --filter sim start",
      cwd: REPO_ROOT,
      url: "http://127.0.0.1:9101/metrics",
      timeout: SERVER_START_MS,
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
      env: envWith({
        SIM_ASSET_COUNT: "all",
        SIM_RATE_HZ: "1",
        SIM_METRICS_PORT: "9101",
        SIM_SITE_NAMES: "",
      }),
    },
  ],
});
