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
