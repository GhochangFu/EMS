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
      // Measured 2026-08-04 with ADR 0017's write gate and F4.11 landed:
      // statements 4.47 · branches 2.72 · functions 4.72 · lines 4.59.
      // (F4.4 baseline was 3.60 · 1.86 · 3.37 · 3.72.)
      //
      // Set just below each so a regression trips the gate while normal churn
      // does not. Ratchet up, never down (§4.6).
      thresholds: {
        statements: 4.4,
        branches: 2.6,
        functions: 4.6,
        lines: 4.5,
      },
    },
  },
});
