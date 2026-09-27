import { readFileSync } from "node:fs";
import { relative } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot } from "./support/source-scan";
import {
  bystanderMarkers,
  disabledPendingButtonFindings,
  disabledPendingButtons,
  webSourceFiles,
} from "./support/pending-button-scan";

/**
 * `F4.168` — a `<button>` whose `disabled` expression reads a pending flag must announce the
 * pending state: its accessible name changes while the flag is true, and it carries
 * `aria-busy={<that flag>}`.
 *
 * **Why this rule exists.** `F4.164` gated the buttons whose label already swaps. A button that
 * is only disabled while a mutation runs goes silent to a screen reader: the name stays "Save"
 * and nothing says why it stopped working. The gate is keyed on `disabled`, so a new site that
 * disables on a pending flag and forgets the name is caught.
 *
 * **The rule, per `<button>` whose `disabled` reads pending tokens `D`:**
 *  - `D` is every `X.isPending` / `X.isFetching…` member, and every bare identifier resolved
 *    recursively through same-file `const NAME = …;` definitions (`!canSubmit` → `busy` →
 *    `createM.isPending`), or named by the pending vocabulary when it has no definition that
 *    resolves (`busy`, `pending`, `deleting`, `…Pending`, `…Busy`, and the U4 prop names);
 *  - the name source is the `aria-label` when the tag has one (a string `aria-label` is static),
 *    else the children. It must pend on a token in `D`;
 *  - `aria-busy` must name that token, not negated;
 *  - a declared bystander (`data-pending-bystander="<flag>"`) keeps its name: the flag must
 *    resolve into `D` and the tag must carry no `aria-busy`. A marker on a button whose
 *    `disabled` does not pend is a finding;
 *  - a `<button` the scanner cannot delimit is a finding.
 *
 * **Decisions.**
 *  - **D1** `isLoading` / `isError` are not pending tokens.
 *  - **D2** the accessible name is the `aria-label` when present. A string `aria-label` over
 *    swapping children is therefore a static name: the gate found a 34th site of that shape
 *    (`dashboard-template-detail-page.tsx`, "Confirm instantiate") that the plan's count missed.
 *  - **D3** a bystander is declared, not inferred.
 *  - **D4** per-row buttons key the pending name on `m.variables`; `disabled` stays shared.
 *
 * **NOT covered — these shapes escape the scan today:**
 *  - a prop-shaped swapped identifier: with `busy = saving || clearing`, a label on the sibling
 *    prop passes, because both are in `D` (H9b pins the gap);
 *  - a flag whose name is outside `PENDING_VOCAB` and has no same-file definition that resolves
 *    to a pending token: its button is out of scope;
 *  - `isLoading` / `isError` (D1): a button disabled only on them is out of scope;
 *  - a pending button that is a component (`<Button>`) rather than a literal `<button>`;
 *  - a label computed into a variable before the `<button>`: the children read the variable,
 *    and the name counts only if that variable resolves through a same-file `const` to a token
 *    in `D`;
 *  - WHICH mutation drives the name: the gate checks THAT the name pends on a token in `D`. A
 *    per-row key that is removed (`const deactivatingThis = updateM.isPending`, no
 *    `m.variables` check) or props swapped at a call site (`saving={clearOverrideM.isPending}`)
 *    still pass; the jsdom specs hold those;
 *  - a token anywhere in the children's `{…}` counts, even one that only changes a class or adds
 *    a spinner (`<span className={save.isPending ? "a" : "b"}>Save</span>`,
 *    `{save.isPending && <Spinner />}Save`). Requiring a string-literal branch was not taken: it
 *    would reject the actions map (`actionPending[action] ? pendingActionLabel(…) : …`, a call
 *    branch) and still accept a `className` ternary, whose branches are strings;
 *  - `negatedAt` sees only a bare `!flag`: `aria-busy={!(flag)}`, `{flag ? false : true}` and a
 *    negated local (`const idle = !flag`) all pass;
 *  - `definitionOf` is file-scoped, not component-scoped: two components in one file that each
 *    define `busy` are unioned;
 *  - `disabled={props.busy}` and `disabled={isBusy()}` give an empty `D`: a member other than
 *    `isPending` / `isFetching…` and a call are not read, so the button is out of scope.
 *
 * Lives in `tests/` because `apps/web`'s tsconfig carries no node types; `typecheck:tests` lists
 * it by hand. The scanner lives in `tests/support/pending-button-scan.ts`, shared with `F4.164`.
 */

type Bystander = { file: string; marker: string; name: string };

function scanTree(): { findings: string[]; buttons: number; bystanders: Bystander[] } {
  const findings: string[] = [];
  let buttons = 0;
  const bystanders: Bystander[] = [];
  for (const full of webSourceFiles()) {
    const src = readFileSync(full, "utf8");
    const rel = relative(repoRoot, full).split("\\").join("/");
    buttons += disabledPendingButtons(src).length;
    findings.push(...disabledPendingButtonFindings(src, rel));
    for (const b of bystanderMarkers(src)) bystanders.push({ file: rel, marker: b.marker, name: b.name });
  }
  return { findings, buttons, bystanders };
}

/**
 * Every `data-pending-bystander` marker in the tree, exactly. A bystander keeps its name while a
 * sibling action pends, so the gate cannot tell a real bystander from a pending button marked to
 * silence it (H11e). A new marker is therefore a reviewed diff to this list.
 */
const BYSTANDER_ALLOWLIST: Bystander[] = [
  { file: "apps/web/src/components/assets/point-calc-override-panel.tsx", marker: "busy", name: "Close" },
  { file: "apps/web/src/components/report-schedules.tsx", marker: "deleting", name: "Edit" },
];

/**
 * A `<button>` with an arrow in `onClick` BEFORE `attrs`, a `[&>svg]` class after them, and
 * `label` as its children. `prelude` lines go above the component; `<button` is on line
 * `prelude.length + 3`.
 */
function fixture(attrs: string[], label: string, prelude: string[] = []): string {
  return [
    ...prelude,
    "export function Form() {",
    "  return (",
    "    <button",
    '      type="button"',
    "      onClick={() => go()}",
    ...attrs.map((a) => `      ${a}`),
    '      className="rounded [&>svg]:h-4"',
    "    >",
    `      ${label}`,
    "    </button>",
    "  );",
    "}",
  ].join("\n");
}

const SWAP = `{save.isPending ? "Saving…" : "Save"}`;

describe("F4.168: a <button> disabled while pending changes its name and carries aria-busy", () => {
  it("H1 flags a static label on a button disabled on save.isPending, exactly once", () => {
    expect(disabledPendingButtonFindings(fixture(["disabled={save.isPending}"], "Save"))).toEqual([
      "<source>:3 disabled pends on save.isPending but the name (children) does not change on it",
    ]);
  });

  it("H2 passes a label that swaps on the disabled flag with aria-busy on it", () => {
    expect(
      disabledPendingButtonFindings(fixture(["disabled={save.isPending}", "aria-busy={save.isPending}"], SWAP)),
    ).toEqual([]);
  });

  it("H3 flags a label and aria-busy on a flag other than the disabled one", () => {
    expect(
      disabledPendingButtonFindings(
        fixture(
          ["disabled={save.isPending}", "aria-busy={other.isPending}"],
          `{other.isPending ? "Saving…" : "Save"}`,
        ),
      ),
    ).toEqual(["<source>:3 disabled pends on save.isPending but the name (children) does not change on it"]);
  });

  it("H4 names only m.isPending from `!valid || m.isPending`", () => {
    expect(disabledPendingButtonFindings(fixture(["disabled={!valid || m.isPending}"], "Save"))).toEqual([
      "<source>:3 disabled pends on m.isPending but the name (children) does not change on it",
    ]);
  });

  it("H5 passes a derived `busy` in disabled with the label and aria-busy on one of its flags", () => {
    expect(
      disabledPendingButtonFindings(
        fixture(
          ["disabled={busy}", "aria-busy={saveM.isPending}"],
          `{saveM.isPending ? "Saving…" : "Save"}`,
          ["const busy = saveM.isPending || deleteM.isPending;"],
        ),
      ),
    ).toEqual([]);
  });

  it("H5b flags a derived `busy` whose label and aria-busy pend on a flag outside it", () => {
    expect(
      disabledPendingButtonFindings(
        fixture(
          ["disabled={busy}", "aria-busy={other.isPending}"],
          `{other.isPending ? "Saving…" : "Save"}`,
          ["const busy = saveM.isPending || deleteM.isPending;"],
        ),
      ),
    ).toEqual([
      "<source>:4 disabled pends on deleteM.isPending, saveM.isPending but the name (children) does not change on it",
    ]);
  });

  it("H6 resolves a two-level negated `!canSubmit` → `busy` → the mutations", () => {
    expect(
      disabledPendingButtonFindings(
        fixture(["disabled={!canSubmit}"], "Save", [
          "const busy = createM.isPending || updateM.isPending;",
          "const canSubmit = !invalid && !busy;",
        ]),
      ),
    ).toEqual([
      "<source>:5 disabled pends on createM.isPending, updateM.isPending but the name (children) does not change on it",
    ]);
  });

  it("H7 flags a negated aria-busy (!save.isPending) over a correct label", () => {
    expect(
      disabledPendingButtonFindings(fixture(["disabled={save.isPending}", "aria-busy={!save.isPending}"], SWAP)),
    ).toEqual([
      "<source>:3 name pends on save.isPending but aria-busy={!save.isPending} does not name it un-negated",
    ]);
  });

  it("H8 a `;` inside a useMemo arrow body does not cut the definition of `busy`", () => {
    expect(
      disabledPendingButtonFindings(
        fixture(["disabled={busy}"], "Save", [
          "const busy = useMemo(() => {",
          "  const ready = true;",
          "  return ready && saveM.isPending;",
          "}, [saveM]);",
        ]),
      ),
    ).toEqual(["<source>:7 disabled pends on saveM.isPending but the name (children) does not change on it"]);
  });

  it("H9 passes a prop-only flag (`pending`) that swaps the label and sets aria-busy", () => {
    expect(
      disabledPendingButtonFindings(
        fixture(["disabled={pending}", "aria-busy={pending}"], `{pending ? "Saving…" : "Save"}`),
      ),
    ).toEqual([]);
  });

  it("H9b documented gap: a label on the sibling prop of a shared `busy = saving || clearing` passes", () => {
    expect(
      disabledPendingButtonFindings(
        fixture(
          ["disabled={busy}", "aria-busy={clearing}"],
          `{clearing ? "Clearing override…" : "Save override"}`,
          ["const busy = saving || clearing;"],
        ),
      ),
    ).toEqual([]);
  });

  it("H10 flags a static aria-label over children that swap (the aria-label is the name)", () => {
    expect(
      disabledPendingButtonFindings(
        fixture(
          ["aria-label={`Import ${name}`}", "disabled={importM.isPending}", "aria-busy={importM.isPending}"],
          `{importM.isPending ? "Importing…" : "Import"}`,
        ),
      ),
    ).toEqual(["<source>:3 disabled pends on importM.isPending but the name (aria-label) does not change on it"]);
  });

  it("H10b passes an aria-label that swaps on the disabled flag", () => {
    expect(
      disabledPendingButtonFindings(
        fixture(
          [
            "aria-label={importM.isPending ? `Importing ${name}…` : `Import ${name}`}",
            "disabled={importM.isPending}",
            "aria-busy={importM.isPending}",
          ],
          `{importM.isPending ? "Importing…" : "Import"}`,
        ),
      ),
    ).toEqual([]);
  });

  it("H11 passes a declared bystander that names the disabled flag and has no aria-busy", () => {
    expect(
      disabledPendingButtonFindings(fixture(["disabled={busy}", 'data-pending-bystander="busy"'], "Close")),
    ).toEqual([]);
  });

  it("H11b flags a bystander marker that names a flag the disabled expression does not read", () => {
    expect(
      disabledPendingButtonFindings(fixture(["disabled={saving}", 'data-pending-bystander="deleting"'], "Close")),
    ).toEqual(['<source>:3 data-pending-bystander="deleting" names no pending flag of disabled (saving)']);
  });

  it("H11c flags a bystander that carries aria-busy", () => {
    expect(
      disabledPendingButtonFindings(
        fixture(["disabled={busy}", 'data-pending-bystander="busy"', "aria-busy={busy}"], "Close"),
      ),
    ).toEqual(["<source>:3 bystander of busy carries aria-busy; a bystander is not busy"]);
  });

  it("H11d flags a stray bystander marker on a button whose disabled does not pend", () => {
    expect(
      disabledPendingButtonFindings(fixture(["disabled={!valid}", 'data-pending-bystander="busy"'], "Close")),
    ).toEqual(["<source>:3 data-pending-bystander on a <button> whose disabled does not pend"]);
  });

  it("H11e flags a bystander marker on a button whose own name pends on the marked flag", () => {
    expect(
      disabledPendingButtonFindings(
        fixture(["disabled={save.isPending}", 'data-pending-bystander="save.isPending"'], SWAP),
      ),
    ).toEqual([
      "<source>:3 bystander's name (children) pends on save.isPending; a button that names the action is not a bystander",
    ]);
  });

  it("H12 an isLoading-only disabled is not pending (no finding)", () => {
    expect(disabledPendingButtonFindings(fixture(["disabled={q.isLoading}"], "Save"))).toEqual([]);
  });

  it("H13 passes an actions map whose label and aria-busy read a per-action pending record", () => {
    expect(
      disabledPendingButtonFindings(
        fixture(
          ["disabled={busy}", "aria-busy={actionPending[action]}"],
          "{actionPending[action] ? pendingActionLabel(action) : actionLabel(action)}",
          [
            "const busy = publishM.isPending || archiveM.isPending;",
            "const actionPending: Record<Action, boolean> = { publish: publishM.isPending, archive: archiveM.isPending };",
          ],
        ),
      ),
    ).toEqual([]);
  });

  it("H14 an unterminated <button> tag is a finding, not a silent stop", () => {
    expect(disabledPendingButtonFindings("const b = <button disabled={() => go(}")).toEqual([
      "<source>:1 scanner could not parse the <button> tag",
    ]);
  });

  it("H15 every <button> under apps/web/src disabled while pending changes its name and carries aria-busy", () => {
    const { findings } = scanTree();
    expect(findings, `buttons disabled while pending that do not announce it:\n${findings.join("\n")}`).toEqual([]);
  });

  it("H16 the scan found at least 77 buttons disabled while pending (a broken walk would pass H15 vacuously)", () => {
    expect(scanTree().buttons).toBeGreaterThanOrEqual(77);
  });

  it("H17 the real tree's data-pending-bystander markers are exactly the reviewed allowlist", () => {
    expect(scanTree().bystanders).toEqual(BYSTANDER_ALLOWLIST);
  });
});
