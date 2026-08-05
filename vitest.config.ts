import { defineConfig } from "vitest/config";

/**
 * Root test config (ADR 0014). Each app owns a project config so `apps/web`
 * can inherit its Vite resolution while `apps/api` stays a plain node project.
 *
 * Coverage thresholds start at the measured baseline rather than the
 * `AGENTS.production.md` §10 targets (80% lines / 70% branches). With this few
 * specs those numbers are not reachable yet, and a declared-but-unmet gate is
 * worse than none. Ratchet these upward as features land with their tests;
 * §10 stays the destination.
 */
export default defineConfig({
  test: {
    projects: [
      "apps/api",
      "apps/web",
      "apps/ingest",
      {
        test: {
          name: "repo",
          environment: "node",
          include: ["tests/**/*.test.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html", "lcov"],
      reportsDirectory: "coverage",
      // Untested files count too, so the denominator is the real source tree
      // rather than a flattering subset. `apps/web` is scoped to `src/lib`
      // because everything above it is React components with no test story
      // yet — including them would report a number that says nothing.
      include: [
        "apps/api/src/**/*.ts",
        "apps/web/src/lib/**/*.ts",
        "apps/ingest/src/**/*.js",
      ],
      // Vitest excludes `*.spec.*` and `*.test.*` from coverage by default and
      // that cannot be overridden by listing them here — verified empirically:
      // no spec file appears in lcov.info either way. So coverage CANNOT detect
      // a `.spec.ts` that no wrapper runs. `tests/repo-invariants.test.ts` is
      // what actually catches that; do not rely on this gate for it.
      exclude: ["**/*.spec.ts", "**/*.test.ts", "**/*.test.js", "**/*.d.ts"],
      // Measured 2026-08-05 with F4.10's access-control integration tests:
      // statements 7.12 · branches 4.53 · functions 9.44 · lines 7.14.
      // (F4.11 was 4.47 · 2.72 · 4.72 · 4.59; F4.4 baseline 3.60 · 1.86 · 3.37 · 3.72.)
      //
      // Set just below each so a regression trips the gate while normal churn
      // does not. Ratchet up, never down (§4.6).
      //
      // These numbers assume `F4.10` ran, which requires a reachable
      // `DATABASE_URL` — without one it skips and coverage falls to roughly
      // 4.59 · 2.74 · 4.89 · 4.68, tripping the gate. That is intended: the
      // gate should measure a complete run, not a partial one. CI always has
      // the database (`db:migrate` → `db:seed` → `test:coverage`), so this only
      // affects a local `pnpm test:coverage` with no stack up — and the skipped
      // suite prints the reason and the command to fix it. Do NOT lower these
      // to make a database-less run pass.
      thresholds: {
        statements: 7.0,
        branches: 4.4,
        functions: 9.3,
        lines: 7.0,
      },
    },
  },
});
