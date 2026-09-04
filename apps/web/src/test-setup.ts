/**
 * Vitest setup for `apps/web` (ADR 0042).
 *
 * Registers the `@testing-library/jest-dom` matchers so a component test can
 * say `expect(el).toBeInTheDocument()` — a claim about the screen — rather than
 * asserting on a node list's length.
 *
 * Safe in the `node` environment too: the import only extends Vitest's
 * `expect`, and the pure-logic tests that never touch a DOM simply do not use
 * the matchers.
 */
import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

/**
 * `F4.90` — the `findBy*` timeout, raised from testing-library's 1000 ms
 * default because **1000 ms is not a ceiling this project clears comfortably.**
 *
 * Two `apps/web` suites had been timing out on `findBy*` with no diagnosis —
 * `F4.82` on `dashboard-templates-page`, `F4.90` on
 * `asset-template-stock-view-page`. Both rows recorded the symptom; neither
 * recorded a mechanism, and `F4.82`'s row argued *against* a timeout cause on
 * the grounds that a `mockResolvedValue` settles in a microtask. The numbers
 * below say otherwise, and they are measurements rather than an argument.
 *
 * **The knob is this one, not `testTimeout`.** The row said "raise
 * `testTimeout` or the `findBy` timeout"; they are different knobs with
 * distinguishable failures. The verbatim text was
 * `TestingLibraryElementError: Unable to find role="link"`, which is
 * testing-library's `asyncUtilTimeout`, not Vitest's 5000 ms `testTimeout`.
 *
 * **Dose-response, `dashboard-templates-page` alone, 6 runs per cell** — the
 * failure rate at a given `asyncUtilTimeout` measures P(wait > T) directly,
 * which counting rare failures does not:
 *
 * | 100 ms | 200 ms | 400 ms | 700 ms | 1000 ms | 1500 ms | 2500 ms |
 * | ------ | ------ | ------ | ------ | ------- | ------- | ------- |
 * | 6/6    | 6/6    | 6/6    | 1/6    | 0/6     | 0/6     | 0/6     |
 *
 * So the typical wait is **400–700 ms against a 1000 ms limit — headroom of
 * about 1.5x**, and the ~5% tail (3 failures in 55 isolated runs) simply
 * crosses a ceiling it was always close to. A "rare multi-second stall" story
 * needs ~20x headroom and is refuted by the 400 ms column.
 *
 * **Why these two files and not the other 24.** `admin-route.test.tsx` runs its
 * four cases in 13–105 ms in the same environment, so jsdom is not slow here in
 * general. The two flaky files are this project's heaviest admin renders, which
 * makes one shared ceiling a better explanation than two page-specific bugs —
 * and predicts that the next flake will be whichever render grows heaviest.
 *
 * **What this does and does not cost, because raising a timeout reads as
 * weakening a gate and this one is not.** An `asyncUtilTimeout` governs how
 * long we wait before declaring failure, never whether a wrong assertion can
 * pass: a genuinely broken page still goes red, 5 s later instead of 1 s. What
 * it does cost is a slower red, and the accidental performance signal the tight
 * default was giving.
 *
 * **The question this hides, recorded so it is not lost.** A page whose fetches
 * are all `mockResolvedValue` should not need 400–700 ms to paint when a gated
 * route needs 25 ms. Raising the ceiling silences that number rather than
 * answering it. That is a separate row, not this one.
 *
 * Safe in the `node` environment: `configure` only writes a config object, and
 * the pure-logic files that never touch a DOM never read it.
 */
configure({ asyncUtilTimeout: 5000 });
