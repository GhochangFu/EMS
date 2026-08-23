# ADR 0042 — Component testing for `apps/web`: jsdom, Testing Library, and where the line falls

## Status

**Accepted** — 2026-08-23, by the repository owner, ruled during the `F3.8`
build when `U8` reached the admin screen and found no way to test it. The
alternative offered — extract the page's logic into `src/lib` and verify the
render only in a browser — was ruled **against**: the owner chose the
dependency and the ADR.

## Context

`apps/web` has 20 test files and **not one of them renders a component.** Every
one covers a pure function in `src/lib` or a fetch wrapper in `src/api`, and
that is not an accident of neglect — `apps/web/vitest.config.ts` says so in its
own comment:

> `environment: "node"` is correct while every test here covers pure logic.
> Component tests will need `jsdom` — add it (and the dependency ADR) then,
> not speculatively now.

This is that moment. `F3.8` `U8` and `U9` (ADR 0041 decision 10) add two admin
screens and a readiness banner, and the plan's acceptance criteria for them are
render assertions: *"a webhook refused by the U4 guard must read as a refusal in
the UI, not as a silent no-op"*, and *"assert a `skipped_unconfigured` row is
present in the default render"*. Neither is a statement about a pure function.
Both are statements about what a person sees.

Three facts frame the choice.

**The logic-extraction alternative is real, and it is what the repository does
today.** `src/lib/alarm-details.ts`, `src/lib/asset-picker.ts`,
`src/lib/calc-decorations.ts` all exist because a page needed a decision tested
and the only testable place was a pure module. That pattern works, it costs no
dependency, and `vitest.config.ts`'s coverage denominator is scoped to
`apps/web/src/lib/**` precisely because that is where the tested code lives.

**But it does not reach the assertions `F3.8` needs.** "The refusal reaches the
operator" is a claim about a component rendering a string it received from a
mutation's error path. Extracting `refusalText(result)` and testing that
function proves the string is *composed* correctly and says nothing about
whether anything *renders* it — which is the exact failure mode the plan names
("a silent no-op"). A test that cannot fail on the thing it is written to catch
is what AGENTS.md §4.4 keeps a running list of.

**The gap compounds.** `apps/web` is the largest untested surface in the
repository, and every UI row after `F3.8` — `F3.9`, `F3.10`, the `E5.x` water
pack screens — meets the same wall. Deferring the decision once more spends the
same argument again at the next row.

This ADR is **§9.4-gated**: it adds four devDependencies to `apps/web`. It is
**not** a §10 promotion — no §6 line places testing infrastructure out of
scope, and it changes no product behaviour.

## Decision

1. **Add four devDependencies to `apps/web`, all test-only.**
   - `jsdom` — the DOM implementation Vitest runs against.
   - `@testing-library/react` — render and query.
   - `@testing-library/jest-dom` — the matchers that make an assertion read as
     a claim about the screen (`toBeInTheDocument`) rather than about a node
     list's length.
   - `@testing-library/user-event` — clicks and typing that go through the
     same event sequence a browser produces. `fireEvent` dispatches one
     synthetic event and would let a test pass on a control a real user cannot
     operate.

   Nothing here ships: all four are `devDependencies`, none is imported by
   `src/**` outside a test file, and the production bundle is unchanged.

2. **jsdom is opt-in per file, not the project default.** The project stays
   `environment: "node"`; a component test declares
   `// @vitest-environment jsdom` at the top. Switching the whole project would
   put a DOM under 20 pure-logic tests that do not need one and would slow every
   run to pay for two files.

3. **`include` widens to `src/**/*.test.tsx` alongside `src/**/*.test.ts`.**
   A component test is `.tsx` because it renders JSX; without this the file is
   collected by nothing and `tests/repo-invariants.test.ts` would not catch it
   (that rule fails an unwrapped `.spec`, not a wrapper nothing runs — the same
   trap `F3.8` `U1` hit with `packages/db`).

4. **The ADR 0014 spec/wrapper split still applies.** Assertions live in
   `*.spec.tsx`, the Vitest entry point is the sibling `*.test.tsx`, and the
   `@vitest-environment` docblock goes on the **wrapper**, because that is the
   file Vitest collects.

5. **Component tests assert what a person sees, not how it is built.** Query by
   role, label and text — never by class name, test id or component internals.
   A test that asserts the markup shape passes a refactor that breaks the screen
   and fails a refactor that does not.

6. **The coverage denominator does not move in this ADR.**
   `vitest.config.ts`'s `include` stays `apps/web/src/lib/**/*.ts`. Widening it
   to `src/pages/**` in the same change would move the denominator under
   thresholds measured against the old one, and that file's own comment forbids
   exactly that ("adding a path moves the denominator and every threshold below
   is a measurement against the current one"). Fold the page surface in at a
   deliberate ratchet, with a fresh measurement, in its own commit.

7. **This does not make component tests mandatory.** Pure logic still belongs in
   `src/lib` with a node test — that is cheaper and it stays the default. A
   component test is for a claim that can only be made about a render.

## Consequences

- `F3.8` `U8` and `U9` can assert what they were written to assert: the refusal
  text reaches the screen, the skip rows are visible by default, the banner
  appears when readiness reports `configured: false`.
- Every later UI row inherits the capability at no further cost, and the
  argument is not re-run per row.
- Test wall-clock rises slightly for the files that opt in; the other 20 are
  untouched.
- `apps/web`'s render surface remains **outside** the coverage gate until a
  separate, measured ratchet. Nobody should read this ADR as having raised the
  coverage floor.
- AGENTS.md §4.6's browser verification is unchanged and still required. A
  jsdom render is not a browser: it has no layout, no real network and no CSS.
  It proves the text is there, not that anyone can see it.
