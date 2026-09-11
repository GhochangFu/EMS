import { CALC_DIALECT, parseFormula } from "@bms/shared";

import { rowDialect } from "./template-points-grid";
import type { PointGridProblem, TemplatePointRow } from "./template-points-grid";

/**
 * The within-template cycle mirror (`F2.22` item 7; the owner's Q5 ruling).
 *
 * ## The server is the authority; this is wording
 *
 * `templatePointsBodySchema` refuses a template whose derived points form a
 * dependency cycle among themselves, through `templateCycles`
 * (`apps/api/src/calc/calc-graph.ts`). `apps/web` cannot import `apps/api`,
 * and moving that function into `packages/shared` would move the definition
 * ADR 0055 part (a) machine-holds under `apps/api/src`. So this module
 * re-implements the rule on the grid's rows, in the same way `draftProblems`
 * mirrors the draft schema: a save the server would refuse is reported here
 * first, on the row and field the tab renders by, in the server's own words —
 * and the server's refusal stands whether or not this module agrees. The
 * message is copied byte for byte from `asset-templates.schema.ts:341-347`
 * with the member list as data, and the wording gate
 * `tests/f2.22-editor-mirrors-server-wording.test.ts` (`F2.22` T9) holds the
 * two copies together.
 *
 * ## The rule, as `templateCycles` states it
 *
 * A template has no location. At save time `@site` resolves to the template's
 * own declared keys and nothing else; `@domain` and `@group` resolve to
 * nothing, because no template is in a domain or a group; and every
 * `{CODE.key}` resolves to `null`, because a template has no assets. So:
 *
 * - a **node** is a derived row whose formula parses under `rowDialect`;
 * - an **edge** is a local `{ref}` to a node, or a `@site` aggregate whose
 *   `pointKey` is a node's key — the one cross-asset form a template resolves,
 *   and the one that makes a site sum over the point's own key a one-edge
 *   cycle (the declaring asset is a member of its own site);
 * - a row is **on a cycle** when it can reach itself along the edges, and the
 *   cycle's members are the nodes it reaches that reach it back, in row order.
 *
 * One problem per member, on `formula`: either end of a two-point cycle is a
 * legitimate place to break it, and neither is more at fault.
 *
 * ## Where this narrows the server's node set, and why that is safe
 *
 * The server builds a node for a `v1` row too. This module does not: under
 * `v1` a local reference to a derived row is already refused by the linter
 * (`validateDerivedFormula`) and by `brokenFormulaRefs`, on the same field —
 * and the tab renders the first problem per field, so a second sentence about
 * the same edge would never be seen. A `v1` formula has no cross references,
 * so a `v1` row's only edges are local refs, and every one of those to a
 * derived row carries a blocking refusal on that row already. Leaving `v1`
 * rows out therefore cannot let a save through that the server refuses; it
 * only changes which of two sentences a `v2` row on a mixed cycle sees, and
 * the server's remains the one that counts.
 *
 * A row that is not derived, has no formula, or does not parse is skipped: the
 * linter already refuses the last, and calling it a cycle a second time would
 * be wrong.
 */
export function templateCycleProblems(rows: readonly TemplatePointRow[]): PointGridProblem[] {
  type Node = { key: string; row: number; refs: readonly string[]; siteKeys: readonly string[] };

  // One node per key, first row wins — the server drops a later duplicate the
  // same way, and the grid reports the duplicate key itself.
  const nodes: Node[] = [];
  const nodeByKey = new Map<string, Node>();
  rows.forEach((row, index) => {
    const key = row.pointKey.trim();
    const formula = (row.formula ?? "").trim();
    if (row.kind !== "derived" || key === "" || formula === "" || nodeByKey.has(key)) {
      return;
    }
    const dialect = rowDialect(row);
    if (dialect === CALC_DIALECT) {
      // The `v1` half of the rule is the linter's — see the docblock.
      return;
    }
    const parsed = parseFormula(formula, { dialect });
    if (!parsed.ok) {
      return;
    }
    const node: Node = {
      key,
      row: index,
      refs: parsed.refs,
      siteKeys: parsed.crossRefs.flatMap((ref) =>
        ref.kind === "aggregate" && ref.scope.kind === "site" ? [ref.pointKey] : [],
      ),
    };
    nodes.push(node);
    nodeByKey.set(key, node);
  });

  // `dependsOn.get(x)` holds every node `x` reads — the arrow goes from the
  // reader to the read, so a self-loop is `dependsOn.get(x).has(x)`.
  const dependsOn = new Map<string, Set<string>>();
  for (const node of nodes) {
    const deps = new Set<string>();
    for (const ref of [...node.refs, ...node.siteKeys]) {
      if (nodeByKey.has(ref)) {
        deps.add(ref);
      }
    }
    dependsOn.set(node.key, deps);
  }

  const problems: PointGridProblem[] = [];
  for (const node of nodes) {
    const downstream = reachableFrom(node.key, dependsOn);
    if (!downstream.has(node.key)) {
      continue;
    }
    const members = nodes
      .filter((other) => downstream.has(other.key) && reachableFrom(other.key, dependsOn).has(node.key))
      .map((other) => other.key);
    problems.push({
      row: node.row,
      field: "formula",
      message:
        `This point's formula lies on a dependency cycle. The points on it are: ` +
        `${members.join(", ")}. None of them can ever compute — each waits on ` +
        "another, so all of them stay unwritten. Only this template's own points are in " +
        "view when it saves: @site resolves to the keys declared here, and @domain, @group " +
        "and {CODE.key} resolve to nothing until assets exist. This check therefore reports " +
        "the cycle it found and cannot rule out one that appears once the template is " +
        "instantiated beside other assets.",
    });
  }
  return problems;
}

/** Every key reachable from `start` along one or more `dependsOn` edges. */
function reachableFrom(start: string, dependsOn: ReadonlyMap<string, ReadonlySet<string>>): Set<string> {
  const seen = new Set<string>();
  const stack: string[] = [...(dependsOn.get(start) ?? [])];
  while (stack.length > 0) {
    const key = stack.pop() as string;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const dep of dependsOn.get(key) ?? []) {
      if (!seen.has(dep)) stack.push(dep);
    }
  }
  return seen;
}
