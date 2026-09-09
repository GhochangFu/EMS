/**
 * Stack-safe walks over caller-supplied JSON — a depth check, one rebuild
 * traversal, and the deep copy that is its JSON-only specialisation.
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
 *
 * **One rebuild traversal, two parameters (`F4.115` review).** `cloneJson` here
 * and `scrubSecrets` in `onboarding-redaction.ts` shipped as two copies of the
 * same stack of `{source, target}` frames, differing in one `if` and in which
 * values they descend into — §4.8's "a vocabulary is declared once", broken the
 * day it was extracted. `rebuildDeep` is that walk; each caller supplies a
 * container predicate and, optionally, a per-key visitor. The **predicates stay
 * different on purpose** and the difference is behaviour, not taste: see
 * `isJsonContainer` below and `isContainer` in `onboarding-redaction.ts`, with
 * one assertion pinning each side.
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
 * Which values `rebuildDeep` descends into and reconstructs, as against the
 * ones it carries across untouched.
 *
 * **It narrows to `object`, and that is the honest type** — `F4.115`'s review
 * found both predicates declaring `value is Record<string, unknown> | unknown[]`
 * while the wider of the two deliberately returns `true` for a `Date` and a
 * `Map`, neither of which is a `Record<string, unknown>`. Harmless at every call
 * site, because the walk only ever reads a container through `Object.keys` and
 * `Reflect.get`, both of which take a plain `object` — so nothing needed the
 * narrower claim in the first place.
 */
export type ContainerPredicate = (value: unknown) => value is object;

/**
 * An optional per-key visitor: `{ value }` to write that in place of the
 * source's value under `key`, or `null` to walk the source's value as usual.
 *
 * **Object keys only.** An array index is never offered to it, which is what
 * keeps `scrubSecrets`'s "no index is ever tested against `isSecretKey`" true
 * now that the two walks are one.
 *
 * That last sentence is **structural and not pinned by a test, because the one
 * visitor that exists cannot observe it**: an index reaches a visitor as a
 * decimal string, and no decimal string satisfies `isSecretKey`, so the scrub's
 * output is identical either way. Measured, not assumed — the mutation that
 * offers `String(index)` to the visitor in the array branch reddens nothing in
 * either suite. A visitor keyed on anything else **would** observe it, which is
 * why the guarantee is written down: the recursive form had it by construction,
 * and the second visitor to be added here would need it back.
 */
export type KeyVisitor = (key: string) => { value: unknown } | null;

/**
 * True for the two containers JSON can express, and for nothing else.
 *
 * The prototype check is what makes the docblock on `cloneJson` true rather
 * than aspirational: anything that is not a plain object or an array — a
 * `Date`, a `Map`, a class instance — is copied by reference instead of being
 * flattened into an empty object.
 *
 * **Narrower than the predicate `onboarding-redaction.ts` passes, on purpose.**
 * That one is any non-null object and rebuilds a `Date` as `{}`, matching what
 * its recursive `Object.entries` form did. Do not collapse the two into one
 * predicate: `assertCloneJsonReturnsANonJsonObjectByReference` and
 * `assertScrubSecretsRebuildsANonJsonObject` fail on opposite sides of that
 * change.
 */
function isJsonContainer(value: unknown): value is object {
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
 * **The one rebuild traversal.** Reconstructs a value with an explicit stack
 * instead of the call stack, descending into whatever `isContainer` accepts and
 * carrying everything else across by reference.
 *
 * Two callers, and they differ only in the two parameters: `cloneJson` below
 * passes the JSON-only predicate and no visitor; `scrubSecrets` in
 * `onboarding-redaction.ts` passes the any-object predicate and a visitor that
 * answers `[REDACTED]` for a secret-looking key. They were two copies of this
 * body until `F4.115`'s review.
 *
 * Three properties this shape gives both of them:
 *
 * - **Key insertion order.** Each container's children are defined in one loop
 *   over the source's own key order, so the order is fixed at that moment and
 *   never depends on the stack's LIFO order. The response body's bytes and the
 *   jsonb text are this serialisation.
 * - **`__proto__` as an own data property**, via `define` above. `target[key] =`
 *   would invoke `Object.prototype`'s accessor: the key vanishes and the copy is
 *   reparented. Array elements are assigned by index, where no such accessor
 *   exists.
 * - **The visitor runs before the source's value is read**, so a replaced key's
 *   getter is never invoked — the recursive form's order, kept.
 *
 * There is no seen-set. Both callers' inputs are acyclic by construction (each
 * came from `JSON.parse` of a jsonb column or of a request body), and a `Map`
 * per node to defend against an input JSON cannot express is a real cost
 * against no real risk. A cyclic value handed to this hangs rather than throws;
 * do not widen a caller to one without adding that set.
 */
export function rebuildDeep(
  value: unknown,
  isContainer: ContainerPredicate,
  visitKey?: KeyVisitor,
): unknown {
  if (!isContainer(value)) {
    return value;
  }

  const root: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
  const stack: { source: object; target: object }[] = [{ source: value, target: root }];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) {
      break;
    }
    const { source, target } = frame;
    if (Array.isArray(source)) {
      const out = target as unknown[];
      for (let index = 0; index < source.length; index += 1) {
        const child: unknown = source[index];
        if (isContainer(child)) {
          const shell: Record<string, unknown> | unknown[] = Array.isArray(child) ? [] : {};
          out[index] = shell;
          stack.push({ source: child, target: shell });
        } else {
          out[index] = child;
        }
      }
      continue;
    }
    for (const key of Object.keys(source)) {
      const replacement = visitKey?.(key) ?? null;
      if (replacement !== null) {
        define(target, key, replacement.value);
        continue;
      }
      // `Reflect.get` rather than an index expression, so no cast is needed to
      // read a child out of an `object` — and it reads exactly what
      // `source[key]` read, own getter included.
      const child: unknown = Reflect.get(source, key);
      if (isContainer(child)) {
        const shell: Record<string, unknown> | unknown[] = Array.isArray(child) ? [] : {};
        define(target, key, shell);
        stack.push({ source: child, target: shell });
      } else {
        define(target, key, child);
      }
    }
  }

  return root;
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
 * Two properties are preserved on purpose, and both are load-bearing — key
 * insertion order, and `__proto__` as an own data property. `rebuildDeep`
 * above owns both; this function is that walk with the JSON-only predicate and
 * no key visitor.
 */
export function cloneJson<T>(value: T): T {
  return rebuildDeep(value, isJsonContainer) as T;
}
