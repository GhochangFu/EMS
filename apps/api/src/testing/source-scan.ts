import { expect } from "vitest";

/**
 * Helpers for the controller **source scans** — the specs that read a
 * `*.controller.ts` file as text because `F4.20` records that esbuild emits no
 * `design:paramtypes` here, so a Nest module cannot be instantiated to ask the
 * router what it matched. What can be checked is the declaration order the
 * router reads, and whether a handler's body calls its guard.
 *
 * **Why a helper rather than `indexOf`.** Both stock controllers carry a class
 * docblock that quotes `@Get("stock")` and `@Get(":id")` — in the right
 * order — some forty lines before the real decorators. A bare
 * `source.indexOf('@Get("stock")')` found the *comment*, so the route-order
 * assertion passed with the routes in either order. `F2.13`'s code review
 * surfaced it when a new assertion hit a docblock's `@Post(":id/…")` mention
 * first. `decoratorAt` matches only where the literal begins a line, after
 * indentation, which a comment never does.
 */

/** Offset of `literal` where it begins a line, or `-1` — like `indexOf`, anchored. */
export function decoratorAt(source: string, literal: string): number {
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^[ \\t]*${escaped}`, "m").exec(source);
  return match ? match.index + match[0].length - literal.length : -1;
}

/**
 * The text of one handler: from its `async name(` to the next route decorator
 * at a line start. Fails loudly if either anchor is missing, so a rename
 * cannot turn the caller's assertion vacuous.
 */
export function methodBody(source: string, start: string, nextDecorator: string): string {
  const from = source.indexOf(start);
  expect(from, `the controller must declare ${start}`).toBeGreaterThan(-1);
  const rest = source.slice(from + start.length);
  const toRel = decoratorAt(rest, nextDecorator);
  expect(toRel, `a route decorator must follow ${start}`).toBeGreaterThan(-1);
  return source.slice(from, from + start.length + toRel);
}
