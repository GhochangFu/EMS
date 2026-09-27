import { readFileSync } from "node:fs";
import { relative } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot } from "./support/source-scan";
import { pendingButtons, pendingButtonsMissingAriaBusy, webSourceFiles } from "./support/pending-button-scan";

/**
 * `F4.164` U5 — a `<button>` whose label swaps on a pending flag ("Save" → "Saving…") must
 * carry `aria-busy={<that flag>}`.
 *
 * **Why this rule exists.** The label swap is the only pending signal most of these buttons
 * give, and a screen reader does not announce a text change inside a focused button. U4 added
 * `aria-busy` to every such site; this gate keeps the next one from shipping without it. A
 * jsdom spec per component cannot see a *new* component that forgot the attribute, so the rule
 * is a source scan.
 *
 * **Why the scanner is not a regex.** The opening tag is split from the children at the first
 * `>` at brace depth 0, outside a string. A bare `>` regex cuts at the `=>` of
 * `onClick={() => …}` and moves every attribute after it — including `aria-busy` — into the
 * children, where the check cannot see it. It also cuts at the `>` of a Tailwind
 * `className="[&>svg]:…"`.
 *
 * **What counts as a pending flag** (collected from the children and, since `F4.168`, from the
 * `aria-label={…}` expression — a swapping `aria-label` is a label too):
 *  - any `X.isPending` or `X.isFetchingNextPage` anywhere in those, where `X` is an
 *    identifier or a dotted chain (`props.saveM.isPending`), and `?.` counts as `.`
 *    (`saveM?.isPending`). The surrounding condition does not matter:
 *    `importM.isPending && importM.variables === entry.code ? …` is caught;
 *  - a bare identifier used as `ident ? "…ing…" : …` — a local flag such as `deleting` or a
 *    hoisted `importingThis`. The branch must be a word ending in `ing` followed by an
 *    ellipsis, so `commitResult ? "Committed" : …` does not capture `commitResult`.
 *
 * The opening tag then needs `aria-busy={…}` whose expression contains every captured flag as
 * the full token (`saveM.isPending`, not merely `saveM`), not negated by a leading `!`.
 *
 * **NOT covered — these shapes escape the scan today:** `saveM.status === "pending"`; a label
 * without an ellipsis (`saving ? "Saving" : "Save"`); an inverted ternary
 * (`!deleting ? "Delete" : "Deleting…"`); `deleting && "Deleting…"`; a label computed into a
 * variable before the `<button>`; a flag read through a call (`m().isPending` is captured only
 * from `isPending`'s own object onward); a pending label on a component that is not a literal
 * `<button>` (for example a design-system `<Button>`).
 *
 * **Fails closed on the parse.** A `<button` whose opening tag the scanner cannot delimit, or
 * whose `</button>` it cannot find before the next `<button`, is a finding of its own. Comment
 * blanking never blanks a span that contains `<button`.
 *
 * Lives in `tests/` because `apps/web`'s tsconfig carries no node types; `typecheck:tests` lists
 * it by hand. The scanner lives in `tests/support/pending-button-scan.ts`, shared with `F4.168`.
 */

function scanTree(): { findings: string[]; segments: number } {
  const findings: string[] = [];
  let segments = 0;
  for (const full of webSourceFiles()) {
    const src = readFileSync(full, "utf8");
    const rel = relative(repoRoot, full).split("\\").join("/");
    segments += pendingButtons(src).length;
    findings.push(...pendingButtonsMissingAriaBusy(src, rel));
  }
  return { findings, segments };
}

/** A pending button with an arrow in `onClick` and a multi-line label. `busy` goes AFTER the arrow. */
function fixture(busy = "", label = `{save.isPending\n        ? "Saving…"\n        : "Save"}`): string {
  return [
    "export function Form() {",
    "  return (",
    "    <button",
    '      type="button"',
    "      onClick={() => go()}",
    `      ${busy}`,
    '      className="rounded [&>svg]:h-4"',
    "    >",
    `      ${label}`,
    "    </button>",
    "  );",
    "}",
  ].join("\n");
}

describe("F4.164: a pending label-swap <button> carries aria-busy", () => {
  it("G1 flags a pending button with an arrow in onClick and no aria-busy, exactly once", () => {
    expect(pendingButtonsMissingAriaBusy(fixture())).toEqual([
      "<source>:3 label pends on save.isPending but the <button> has no aria-busy",
    ]);
  });

  it("G2 passes the same button with aria-busy={save.isPending} after the arrow", () => {
    expect(pendingButtonsMissingAriaBusy(fixture("aria-busy={save.isPending}"))).toEqual([]);
  });

  it("G3 flags an aria-busy that names a different flag than the label", () => {
    expect(pendingButtonsMissingAriaBusy(fixture("aria-busy={other.isPending}"))).toHaveLength(1);
  });

  it("G3b flags an aria-busy on the same object but another flag (save.isSuccess)", () => {
    expect(pendingButtonsMissingAriaBusy(fixture("aria-busy={save.isSuccess}"))).toHaveLength(1);
  });

  it("G3c flags a negated aria-busy (!save.isPending)", () => {
    expect(pendingButtonsMissingAriaBusy(fixture("aria-busy={!save.isPending}"))).toHaveLength(1);
  });

  it("G3d passes a hoisted local flag named in aria-busy (importingThis)", () => {
    expect(
      pendingButtonsMissingAriaBusy(
        fixture("aria-busy={importingThis}", `{importingThis ? "Importing…" : "Import"}`),
      ),
    ).toEqual([]);
  });

  it('G4 flags a local `deleting ? "Deleting…"` label with no aria-busy', () => {
    const findings = pendingButtonsMissingAriaBusy(
      fixture("", `{deleting ? "Deleting…" : "Delete"}`),
    );
    expect(findings).toEqual(["<source>:3 label pends on deleting but the <button> has no aria-busy"]);
  });

  it("G4b captures commitMutation, not commitResult, from the nested committed/committing ternary", () => {
    const findings = pendingButtonsMissingAriaBusy(
      fixture("", `{commitResult ? "Committed" : commitMutation.isPending ? "Committing…" : "Commit"}`),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("commitMutation.isPending");
    expect(findings[0]).not.toContain("commitResult");
  });

  it("G4d passes the nested committed/committing ternary with aria-busy={commitMutation.isPending}", () => {
    expect(
      pendingButtonsMissingAriaBusy(
        fixture(
          "aria-busy={commitMutation.isPending}",
          `{commitResult ? "Committed" : commitMutation.isPending ? "Committing…" : "Commit"}`,
        ),
      ),
    ).toEqual([]);
  });

  it("G4c a `{` before a later `{/* … */}` JSX comment does not blank the button between them", () => {
    // Regression: a comment blanker that matched `\{\s*\/\*…\*\/\s*\}` lazily ran from a type
    // literal's `{ /** doc */` to a JSX comment's `*/}` far below and hid three real sites.
    const src = [
      "type P = {",
      "  /** doc */",
      "  id: string;",
      "};",
      fixture(),
      "const x = <div>{/* note */}</div>;",
    ].join("\n");
    expect(pendingButtonsMissingAriaBusy(src)).toHaveLength(1);
  });

  it("G7 a regex literal with a quote in an earlier button's onClick does not hide a later pending button", () => {
    const src = [
      `const a = <button onClick={() => setQ(q.replace(/'/g, ""))}>Clear</button>;`,
      fixture(),
    ].join("\n");
    expect(pendingButtonsMissingAriaBusy(src).length).toBeGreaterThanOrEqual(1);
  });

  it("G8 a `/*` inside a regex literal does not blank a later pending button", () => {
    const src = ["const re = /[/*]/;", fixture(), "/** doc */", "const n = 1;"].join("\n");
    expect(pendingButtonsMissingAriaBusy(src)).toEqual([
      "<source>:4 label pends on save.isPending but the <button> has no aria-busy",
    ]);
  });

  it("G8b a `/*` inside a glob string does not blank a later pending button", () => {
    const src = ['const glob = "src/**/*.tsx";', fixture(), "/** doc */"].join("\n");
    expect(pendingButtonsMissingAriaBusy(src)).toHaveLength(1);
  });

  it("G8d a `/*` after a space inside a string does not blank a later pending button", () => {
    // The code-position rule admits this opener; only the "never blank a <button" bound holds it.
    const src = ['const s = "a /* b";', fixture(), "/** doc */"].join("\n");
    expect(pendingButtonsMissingAriaBusy(src)).toHaveLength(1);
  });

  it("G8c an unterminated <button> tag is a finding, not a silent stop", () => {
    const findings = pendingButtonsMissingAriaBusy("const b = <button onClick={() => go(}");
    expect(findings).toEqual(["<source>:1 scanner could not parse the <button> tag"]);
  });

  it("G9 flags a label on a nested chain (props.save.isPending) with no aria-busy", () => {
    const findings = pendingButtonsMissingAriaBusy(
      fixture("", `{props.save.isPending ? "Saving…" : "Save"}`),
    );
    expect(findings).toEqual([
      "<source>:3 label pends on props.save.isPending but the <button> has no aria-busy",
    ]);
  });

  it("G9b passes the nested chain with aria-busy={props.save.isPending}", () => {
    expect(
      pendingButtonsMissingAriaBusy(
        fixture("aria-busy={props.save.isPending}", `{props.save.isPending ? "Saving…" : "Save"}`),
      ),
    ).toEqual([]);
  });

  it("G10 flags an optional-chained label (save?.isPending) with no aria-busy", () => {
    const findings = pendingButtonsMissingAriaBusy(fixture("", `{save?.isPending ? "Saving…" : "Save"}`));
    expect(findings).toEqual(["<source>:3 label pends on save.isPending but the <button> has no aria-busy"]);
  });

  it("G5 every pending button under apps/web/src names its flag in aria-busy", () => {
    const { findings } = scanTree();
    expect(findings, `pending buttons without a matching aria-busy:\n${findings.join("\n")}`).toEqual([]);
  });

  it("G6 the scan found at least 69 pending-button segments (a broken walk would pass G5 vacuously)", () => {
    expect(scanTree().segments).toBeGreaterThanOrEqual(69);
  });
});
