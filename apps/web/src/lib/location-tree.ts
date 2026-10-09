/**
 * `F2.10` (ADR 0098) — the web's view of the location tree.
 *
 * Pure helpers over any list of `{ id, name, parentId }` nodes, so both
 * `AdminLocationDto` (`GET /admin/locations`) and `AccessLocation`
 * (`GET /auth/me`) fit. Both producers null a parent the caller cannot read,
 * so `parentId: null` means "a root for this caller"; a `parentId` not in the
 * list (only a stale persisted scope can carry one) is treated as a root too.
 *
 * Siblings keep the input order. The API sorts locations by name, which is
 * ADR 0098 B10's "siblings by name", and a flat list therefore comes back in
 * exactly the order it went in. A visited set ends a planted cycle: each node
 * is listed once, whatever the data says.
 */
export type LocationTreeNode = {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
};

export type LocationTreeOption = {
  id: string;
  name: string;
  depth: number;
  /** `"— "` once per level, then the name — a dash survives `<option>` whitespace collapse. */
  label: string;
};

/** Children by parent id, in input order; an orphan or a root lands under `null`. */
function childrenByParent<T extends LocationTreeNode>(nodes: readonly T[]): Map<string | null, T[]> {
  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<string | null, T[]>();
  for (const n of nodes) {
    const key = n.parentId !== null && ids.has(n.parentId) ? n.parentId : null;
    const list = children.get(key);
    if (list) {
      list.push(n);
    } else {
      children.set(key, [n]);
    }
  }
  return children;
}

/**
 * The nodes depth-first, root depth 0, each child right after its parent.
 * `nameOf` replaces the name in the label (the calc-parameter picker prefixes
 * the code inside the dashes); `name` stays the node's own.
 */
export function locationTreeOptions<T extends LocationTreeNode>(
  nodes: readonly T[],
  nameOf: (node: T) => string = (node) => node.name,
): LocationTreeOption[] {
  const children = childrenByParent(nodes);
  const visited = new Set<string>();
  const out: LocationTreeOption[] = [];
  const walk = (n: T, depth: number): void => {
    if (visited.has(n.id)) {
      return;
    }
    visited.add(n.id);
    out.push({ id: n.id, name: n.name, depth, label: "— ".repeat(depth) + nameOf(n) });
    for (const child of children.get(n.id) ?? []) {
      walk(child, depth + 1);
    }
  };
  for (const root of children.get(null) ?? []) {
    walk(root, 0);
  }
  // A cycle has no root to start from; list what is left at depth 0, once each.
  for (const n of nodes) {
    walk(n, 0);
  }
  return out;
}

/** The node and every descendant in the list. */
export function subtreeIds(nodes: readonly LocationTreeNode[], rootId: string): Set<string> {
  const children = childrenByParent(nodes);
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (out.has(id)) {
      continue;
    }
    out.add(id);
    for (const child of children.get(id) ?? []) {
      stack.push(child.id);
    }
  }
  return out;
}

/** The node's ancestors in the list, nearest first, excluding the node. */
export function ancestorIds(nodes: readonly LocationTreeNode[], id: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let parentId = byId.get(id)?.parentId ?? null;
  while (parentId !== null && byId.has(parentId) && !seen.has(parentId)) {
    out.push(parentId);
    seen.add(parentId);
    parentId = byId.get(parentId)?.parentId ?? null;
  }
  return out;
}

/** The ids with at least one child in the list. */
export function interiorNodeIds(nodes: readonly LocationTreeNode[]): Set<string> {
  const ids = new Set(nodes.map((n) => n.id));
  const out = new Set<string>();
  for (const n of nodes) {
    if (n.parentId !== null && ids.has(n.parentId) && n.parentId !== n.id) {
      out.add(n.parentId);
    }
  }
  return out;
}
