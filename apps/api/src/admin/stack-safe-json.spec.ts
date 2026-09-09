import { cloneJson, exceedsDepth, isJsonContainer, rebuildDeep } from "./stack-safe-json";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * The depth at which the deep fixtures below are built.
 *
 * `F4.115` measured the recursive forms of these walkers failing somewhere in
 * the 1,700–2,000 band inside `bms-api-1` (node v20.20.2). 20,000 is an order
 * of magnitude above that, so a mutation back to recursion reddens on a Windows
 * dev machine, in CI and in the container alike. **It is not a claim about
 * where V8's stack limit is** — that number moves with the platform, the flags
 * and the frame size, which is exactly why nothing here asserts on it.
 */
const DEEP = 20_000;

/**
 * A chain of `depth` nested single-key objects with `"leaf"` at the bottom.
 *
 * Built with a loop. A recursive builder would throw before the function under
 * test does, and the spec would then be measuring itself.
 */
function chain(depth: number): unknown {
  let node: unknown = "leaf";
  for (let i = 0; i < depth; i += 1) {
    node = { next: node };
  }
  return node;
}

/**
 * Follows `chain`'s `next` links iteratively and returns the bottom value.
 *
 * The step ceiling is a runaway guard, not a bound on the fixture: a clone that
 * somehow became cyclic would otherwise hang the suite instead of failing it.
 */
function leafOf(value: unknown): unknown {
  let node = value;
  for (let steps = 0; steps <= DEEP + 1; steps += 1) {
    if (typeof node !== "object" || node === null || !("next" in node)) {
      return node;
    }
    node = (node as { next: unknown }).next;
  }
  return "RUNAWAY";
}

/**
 * The shape the shipped producers actually write, at the depth `F4.115` §3.4
 * derives the onboarding bound from: `draft` (1) → `rtus` (2) → `rtus[i]` (3) →
 * `config` (4) → `config.host` (5).
 *
 * `config`'s keys are deliberately **not** alphabetical and deliberately not in
 * the order `parseRtus` writes them either, so a clone that rebuilt them in any
 * sorted or reversed order is caught rather than accidentally agreeing.
 */
function draftShaped(): { rtus: { code: string; config: Record<string, unknown> }[] } {
  return {
    rtus: [
      {
        code: "RTU-1",
        config: { topic: "site/1/data", host: "broker.example", port: 8883, tls: true },
      },
    ],
  };
}

const CONFIG_KEY_ORDER = "topic,host,port,tls";

/**
 * `exceedsDepth` counts the value it is handed as level 1.
 *
 * That is the arithmetic every caller's constant is derived against — the
 * onboarding refusal hands it the draft object, so "the draft nests deeper than
 * ten levels" means ten counting the draft itself. Off by one here and both
 * limits silently mean something else.
 */
export function assertExceedsDepthCountsFromTheRoot(): void {
  assert(exceedsDepth(1, 1) === false, "a bare number is one level deep and cannot exceed 1");
  assert(exceedsDepth("leaf", 1) === false, "a bare string is one level deep and cannot exceed 1");
  assert(exceedsDepth(null, 1) === false, "null is a value, not a container");
  assert(
    exceedsDepth({ a: 1 }, 1) === true,
    "an object holding a number is two levels deep, so it exceeds a limit of 1",
  );
  assert(exceedsDepth({ a: 1 }, 2) === false, "an object holding a number does not exceed 2");
  assert(exceedsDepth([[1]], 2) === true, "arrays count as levels exactly as objects do");

  const draft = draftShaped();
  assert(
    exceedsDepth(draft, 5) === false,
    "the draft shape the shipped producers write reaches exactly five levels",
  );
  assert(
    exceedsDepth(draft, 4) === true,
    "the same shape must exceed four — without this the five above could be any number at all",
  );
}

/**
 * The walker does not recurse, which is the entire reason it exists.
 *
 * The `true` case below is here to be **discounted**: a recursive
 * implementation returns `true` at depth 11 without ever reaching the bottom of
 * the chain, so that assertion passes under the mutation this function is
 * written to catch. Only the `false` case — which must walk all 20,000 levels
 * to answer — distinguishes the two implementations.
 */
export function assertExceedsDepthIsIterative(): void {
  const deep = chain(DEEP);

  assert(
    exceedsDepth(deep, DEEP + 1) === false,
    "a 20,000-deep chain must be walked to the bottom and answered, not thrown out of",
  );
  assert(
    exceedsDepth(deep, 10) === true,
    "the same chain exceeds 10 — it exits at level 11 and would pass recursively too",
  );
}

/**
 * A clone is independent of its source, and reproduces its key order.
 *
 * Key order is not cosmetic here. `onboarding-redaction.spec.ts` asserts over
 * `JSON.stringify` of a cloned draft, and the jsonb text the API writes is the
 * serialisation of this object — so a clone that rebuilt keys in stack order
 * would change bytes on the wire and in the column.
 */
export function assertCloneJsonIsIndependentAndOrdered(): void {
  const source = draftShaped();
  const clone = cloneJson(source);

  clone.rtus[0].config.host = "changed.example";
  assert(
    source.rtus[0].config.host === "broker.example",
    "writing to the clone must not reach the source",
  );
  clone.rtus[0].code = "RTU-2";
  assert(source.rtus[0].code === "RTU-1", "array elements must be cloned, not shared");

  assert(
    Object.keys(clone.rtus[0].config).join(",") === CONFIG_KEY_ORDER,
    `the clone must reproduce the source's key order, got: ${Object.keys(clone.rtus[0].config).join(",")}`,
  );
  assert(
    Object.keys(source.rtus[0].config).join(",") === CONFIG_KEY_ORDER,
    "the source's own key order must be untouched by the clone",
  );
}

/**
 * An own `__proto__` survives the clone as an own data property.
 *
 * This is a **non-regression, not a fix** — `structuredClone` preserves it
 * today and the iterative replacement has to keep doing so. The reachable
 * vector is `_secrets`: `draftRtuSchema.code` has no charset regex, so an RTU
 * whose code is the literal `__proto__` is stored under that key by `setBlob`,
 * `JSON.stringify` emits it, jsonb keeps it, and `JSON.parse` hands it back as
 * an own property on the next read. A clone written `target[key] = child`
 * invokes `Object.prototype`'s accessor instead: the key vanishes, the copy is
 * reparented, `ownBlob` then returns `null` and the credential is dropped with
 * `credentialsSet` flipped false — the M4 / `E8.4` class of defect.
 *
 * The fixture comes from `JSON.parse` rather than an object literal because
 * that is how a stored draft actually arrives, and because an object literal
 * `{ __proto__: … }` sets the prototype instead of defining the key.
 */
export function assertCloneJsonKeepsProtoAsData(): void {
  const stored = JSON.parse('{"_secrets":{"__proto__":{"c":"Y2lwaGVy","iv":"aXY="}}}') as {
    _secrets: Record<string, unknown>;
  };
  assert(
    Object.prototype.hasOwnProperty.call(stored._secrets, "__proto__"),
    "the fixture itself must carry __proto__ as an own property, or this proves nothing",
  );

  const clone = cloneJson(stored);

  assert(
    Object.prototype.hasOwnProperty.call(clone._secrets, "__proto__"),
    "the clone must keep __proto__ as an own data property",
  );
  assert(
    Object.getPrototypeOf(clone._secrets) === Object.prototype,
    "the clone must not be reparented by its own __proto__ key",
  );
  const bare: Record<string, unknown> = {};
  assert(bare.c === undefined, "no bare object may have been polluted by the clone");
}

/**
 * The clone does not recurse either, and it copies every level it walks.
 *
 * `structuredClone` is the mutation this catches, and it is the one that shipped
 * — three call sites of it are what made a deeply nested stored draft answer 500
 * on every later read, including the `PATCH` that would repair it.
 */
export function assertCloneJsonIsIterative(): void {
  const deep = chain(DEEP);
  const clone = cloneJson(deep);

  assert(clone !== deep, "the clone must be a new object, not the source");
  assert(
    leafOf(clone) === "leaf",
    "the bottom of a 20,000-deep clone must be reachable, so every level was copied",
  );
}

/**
 * **The half of the shared walk that `cloneJson` owns: which values it descends
 * into.**
 *
 * `cloneJson` and `scrubSecrets` are one traversal parameterised by a container
 * predicate, and the two predicates are deliberately different.
 * `isJsonContainer` here checks the prototype, so a `Date` or a `Map` is copied
 * **by reference**; `onboarding-redaction.ts` passes a wider "any non-null
 * object" predicate that descends into those and rebuilds them as `{}`, which
 * is what its recursive `Object.entries` form did and what a reviewer verified
 * the iterative rewrite still did.
 *
 * Nothing asserted that difference until `F4.115`'s review sweep, and after the
 * traversal was shared it became a one-word mutation: passing `isJsonContainer`
 * to the scrub compiles and every other assertion in both suites stays green.
 * This function and `assertScrubSecretsRebuildsANonJsonObject` are the pair that
 * pins it, one from each side.
 *
 * Not a claim that `cloneJson` is a full `structuredClone` replacement — it is
 * the opposite claim, and the docblock on `cloneJson` states the same narrowing
 * as a contract.
 */
export function assertCloneJsonReturnsANonJsonObjectByReference(): void {
  const when = new Date("2026-09-09T00:00:00.000Z");
  const seen = new Map<string, number>([["a", 1]]);
  const source = { rtus: [{ config: { installedAt: when, counts: seen } }] };

  const clone = cloneJson(source);

  assert(
    clone.rtus[0].config.installedAt === when,
    "a Date is not a JSON container, so the clone must carry the same object across",
  );
  assert(
    clone.rtus[0].config.counts === seen,
    "a Map is not a JSON container either, so it is carried across the same way",
  );
  assert(clone.rtus[0].config !== source.rtus[0].config, "the plain object around them is copied");
}

/**
 * The shape the leaf-visitor assertions below are measured on: a leaf directly
 * under an object, a leaf directly under an array, a leaf under an object inside
 * an array, and one non-string leaf. Four leaves, one per position the walk has.
 *
 * **A factory and not a shared constant.** Each of the five functions below
 * calls it and gets its own object, so no one of them can reach another through
 * a value it happened to write.
 *
 * ---
 *
 * **The second visitor, and the half of the walk it owns: every leaf, in both
 * branches.**
 *
 * `KeyVisitor` sees an object key and runs before the value under it is read,
 * so it cannot decide anything about a *value* — "this string is longer than
 * 255 characters" is invisible to it. `F4.107` needs exactly that decision, and
 * the choice was one shared parameter here or a fourth traversal in the
 * onboarding module. §4.8 says the parameter.
 *
 * **Five properties, five exported functions, five `it()`s** — and that split is
 * `F4.107`'s review, not the original shape. They were one function with five
 * fixture blocks and fourteen `assert` calls run from a single `it()`. `assert`
 * throws, so blocks three, four and five never executed once block one or two
 * failed: the docblock claimed each property "has its own mutation" while the
 * suite could only ever report the first of them. The five:
 *
 * 1. `assertRebuildDeepOffersALeafInBothBranches` — an object's value and an
 *    array's element are both leaves, at any level.
 * 2. `assertRebuildDeepDeclinesAndNeverOffersAContainer` — `null` declines, and
 *    a container is descended into rather than offered.
 * 3. `assertTheKeyVisitorAnswersBeforeTheLeafVisitor` — a key the key visitor
 *    replaced is not offered to the leaf visitor.
 * 4. `assertALeafReplacedByUndefinedIsNotADecline` — the implementation trap,
 *    which is not a property of the walk but of how it is written.
 * 5. `assertRebuildDeepWithoutALeafVisitorIsUnchanged` — the default path.
 */
function leafShaped(): { a: string; list: [string, { b: string }]; when: number } {
  return { a: "x", list: ["y", { b: "z" }], when: 1 };
}

/**
 * **Both branches consult the leaf visitor**, and it is carried all the way
 * down.
 *
 * An object's own value, an array's element and a string under an object inside
 * an array are all leaves. One assert per position, because dropping the object
 * branch's call and dropping the array branch's call are two different defects
 * and each leaves the other position green.
 *
 * The declined number belongs here rather than in the decline case below: this
 * visitor answers `null` for it, so a walk that wrote `undefined` in place of
 * everything it was not asked to replace would be caught by the same fixture.
 */
export function assertRebuildDeepOffersALeafInBothBranches(): void {
  const upper = rebuildDeep(leafShaped(), isJsonContainer, undefined, (value) =>
    typeof value === "string" ? { value: "L" } : null,
  ) as { a: string; list: [string, { b: string }]; when: number };

  assert(upper.a === "L", "an object's own string value must be offered to the leaf visitor");
  assert(upper.list[0] === "L", "an array element is a leaf too, and must be offered");
  assert(
    upper.list[1].b === "L",
    "a string nested under an array element must be offered — the walk carries the visitor down",
  );
  assert(upper.when === 1, "a value the visitor declined must be carried across unchanged");
}

/**
 * **`null` declines, and a container is never offered.**
 *
 * The decline protocol is `KeyVisitor`'s: the source's value is carried across
 * unchanged. And the visitor decides about *leaves* — a walk that offered it an
 * object would let a caller replace a subtree it never asked about, and
 * `shedOverLongStrings` would then be handed `[object Object]` questions it has
 * no answer for.
 *
 * The count is here rather than in its own function because it is what makes the
 * two claims above claims about the whole walk: without it they are satisfied by
 * a visitor consulted at the two positions the asserts name and nowhere else.
 */
export function assertRebuildDeepDeclinesAndNeverOffersAContainer(): void {
  const source = leafShaped();
  const seen: unknown[] = [];
  const untouched = rebuildDeep(source, isJsonContainer, undefined, (value) => {
    seen.push(value);
    return null;
  }) as typeof source;

  assert(untouched.a === "x", "a visitor answering null must leave the source's value in place");
  assert(seen.includes(1), "a number is a leaf and must be offered, not only a string");
  assert(
    seen.every((value) => !isJsonContainer(value)),
    `no container may be offered to the leaf visitor, got: ${seen.filter((v) => isJsonContainer(v)).length} of them`,
  );
  assert(seen.length === 4, `every leaf exactly once — 4 expected, saw ${seen.length}`);
}

/**
 * **A key the key visitor already replaced is not offered to the leaf visitor**,
 * so the two visitors cannot both act on one position.
 *
 * Running the leaf visitor first would also read the source's value, which is
 * the getter the key visitor's ordering exists to avoid — the secret under a
 * secret-looking key is never touched, and that is `scrubSecrets`'s whole
 * guarantee.
 */
export function assertTheKeyVisitorAnswersBeforeTheLeafVisitor(): void {
  const offered: unknown[] = [];
  const scrubbed = rebuildDeep(
    { secret: "hunter2", keep: "plain" },
    isJsonContainer,
    (key) => (key === "secret" ? { value: "[REDACTED]" } : null),
    (value) => {
      offered.push(value);
      return { value: "L" };
    },
  ) as { secret: string; keep: string };

  assert(
    !offered.includes("hunter2"),
    "a value under a key the key visitor replaced must never be offered to the leaf visitor",
  );
  assert(
    scrubbed.secret === "[REDACTED]",
    "the key visitor still wins — its replacement is not overwritten by the leaf visitor",
  );
  assert(scrubbed.keep === "L", "and a key it declined is still offered as usual");
}

/**
 * `{ value: undefined }` is a **replacement**, not a decline.
 *
 * Not a property of the walk but of how it is written: `visitLeaf?.(child)?.value
 * ?? child` collapses the two answers into one, and every other assertion in
 * this file still passes under that form. Only this one refuses it.
 */
export function assertALeafReplacedByUndefinedIsNotADecline(): void {
  const replaced = rebuildDeep({ a: "x" }, isJsonContainer, undefined, () => ({
    value: undefined,
  })) as Record<string, unknown>;

  assert(
    Object.prototype.hasOwnProperty.call(replaced, "a"),
    "a leaf replaced by undefined keeps its key — the value was replaced, not deleted",
  );
  assert(
    replaced.a === undefined,
    "{ value: undefined } is a replacement, not a decline: `?.value ?? child` collapses the two",
  );
}

/**
 * The default path — no leaf visitor at all — copies the value.
 *
 * The positive half of the pair above: a fix for the `??` trap that reached for
 * `visitLeaf === undefined ? … : …` in the wrong place would drop the value of
 * every leaf on the two callers that pass no leaf visitor, and `cloneJson` is
 * one of them.
 */
export function assertRebuildDeepWithoutALeafVisitorIsUnchanged(): void {
  const cloned = cloneJson({ a: "x" });
  assert(cloned.a === "x", "the default path — no leaf visitor at all — must copy the value");
}
