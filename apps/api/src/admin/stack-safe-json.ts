/**
 * Stack-safe walks over caller-supplied JSON — a depth check and a deep copy.
 *
 * **One reason, both functions: recursion over caller-supplied JSON is the bug
 * these look for.** `JSON.parse` is iterative in V8, so a request body or a
 * jsonb column can arrive nested thousands of levels deep having cost the
 * caller a few kilobytes. `JSON.stringify`, `structuredClone` and every
 * hand-written recursive walker are **not** iterative, so the next thing that
 * touches that value throws a `RangeError` — which is not a `ZodError` and not
 * an `HttpException`, so Nest answers 500. `F4.115` measured that on a stored
 * onboarding draft: 12 KB of body nested 2,000 deep was accepted and stored,
 * and every later read of the session 500'd, **including the `PATCH` that would
 * have repaired it**.
 *
 * `admin/` level rather than inside either consumer, on the precedent of
 * `spreadsheet-guard.ts`: a guard shared by two admin paths gets its own module
 * one directory above both of them.
 *
 * **The limits that use `exceedsDepth` are deliberately not here.** Template
 * `content` bounds itself at `MAX_CONTENT_DEPTH` and the onboarding draft at
 * `MAX_ONBOARDING_DRAFT_DEPTH`; they are different numbers because they are
 * derived from different shapes, and each stays in the file that derived it.
 * The walker is the shared vocabulary; the bound is a judgement the surface
 * owns.
 */

/** Iterative — a recursive depth check would be the very bug it looks for. */
export function exceedsDepth(value: unknown, limit: number): boolean {
  const stack: { node: unknown; depth: number }[] = [{ node: value, depth: 1 }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) {
      break;
    }
    if (frame.depth > limit) {
      return true;
    }
    const { node, depth } = frame;
    if (Array.isArray(node)) {
      for (const child of node) {
        stack.push({ node: child, depth: depth + 1 });
      }
    } else if (node !== null && typeof node === "object") {
      for (const child of Object.values(node)) {
        stack.push({ node: child, depth: depth + 1 });
      }
    }
  }
  return false;
}

/**
 * True for the two containers JSON can express, and for nothing else.
 *
 * The prototype check is what makes the docblock on `cloneJson` true rather
 * than aspirational: anything that is not a plain object or an array — a
 * `Date`, a `Map`, a class instance — is copied by reference instead of being
 * flattened into an empty object.
 */
function isJsonContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return true;
  }
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

/**
 * Assigns without invoking a setter.
 *
 * `target.__proto__ = child` is swallowed by `Object.prototype`'s accessor: the
 * key is lost and the copy is reparented onto whatever the caller supplied.
 * `__proto__` is reachable as a real key here — `JSON.parse` returns it as an
 * own data property, and `onboarding-redaction.ts` stores credentials under an
 * RTU code that may be exactly that string. `setBlob` in that file is the same
 * defence, written for the same reason.
 */
function define(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/**
 * A deep copy of a JSON value, computed with a stack instead of the call stack.
 *
 * A drop-in replacement for `structuredClone` **on JSON only**, and the
 * narrowing is a contract rather than an oversight: every value handed to this
 * came from `JSON.parse` of a jsonb column or of a request body, so it is
 * acyclic and holds only objects, arrays, strings, numbers, booleans and
 * `null`. There is no seen-set, because a `Map` per node to defend against an
 * input JSON cannot express is a real cost against no real risk. A value that
 * is not a plain object or an array is returned by reference — including a
 * `Date` or a `Map`, which `structuredClone` would have cloned and this does
 * not.
 *
 * Two properties are preserved on purpose, and both are load-bearing:
 *
 * - **Key insertion order.** Each container's children are defined in one loop
 *   over the source's own key order, so the order is fixed at that moment and
 *   never depends on the stack's LIFO order. The response body's bytes and the
 *   jsonb text are this serialisation.
 * - **`__proto__` as an own data property**, via `define` above.
 */
export function cloneJson<T>(value: T): T {
  if (!isJsonContainer(value)) {
    return value;
  }

  const root: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
  const stack: { source: Record<string, unknown> | unknown[]; target: object }[] = [
    { source: value, target: root },
  ];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) {
      break;
    }
    const { source, target } = frame;
    if (Array.isArray(source)) {
      const out = target as unknown[];
      for (let index = 0; index < source.length; index += 1) {
        const child = source[index];
        if (isJsonContainer(child)) {
          const shell: Record<string, unknown> | unknown[] = Array.isArray(child) ? [] : {};
          out[index] = shell;
          stack.push({ source: child, target: shell });
        } else {
          out[index] = child;
        }
      }
    } else {
      for (const key of Object.keys(source)) {
        const child = source[key];
        if (isJsonContainer(child)) {
          const shell: Record<string, unknown> | unknown[] = Array.isArray(child) ? [] : {};
          define(target, key, shell);
          stack.push({ source: child, target: shell });
        } else {
          define(target, key, child);
        }
      }
    }
  }

  return root as T;
}
