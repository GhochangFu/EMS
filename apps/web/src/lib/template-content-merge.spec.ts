/**
 * Read-merge-write for template `content` (`F2.5`, ADR 0038 — Unit 6).
 *
 * ## Why the fixtures use `JSON.parse`
 *
 * `{ __proto__: 1 }` written as an object literal is special-cased by the
 * language: it sets the object's `[[Prototype]]` and creates **no own
 * property**. A prototype-pollution test built from a literal therefore hands
 * the merge nothing to drop and goes green having proved nothing at all.
 *
 * `JSON.parse('{"__proto__":1}')` does define an own property, which is also
 * how a stored row would come to hold one — the column arrives over HTTP as
 * JSON. Every such fixture here is parsed, and each test asserts
 * `Object.hasOwn` on the fixture **before** using it, so nobody can later
 * "tidy" it into a literal and quietly disarm the check.
 */
import type { TemplateAlarm, TemplateKpi } from "@bms/shared";

import {
  contentCanBeWrittenBack,
  mergeTemplateContent,
  unwritableContentKeys,
  type StoredTemplateContent,
} from "./template-content-merge";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const KPI: TemplateKpi = {
  code: "EFF",
  name: "Efficiency",
  expression: "{A} / {B}",
  pointKeys: ["A", "B"],
  dialect: "bms-calc-v1",
};

const ALARM: TemplateAlarm = {
  code: "HIGH_TEMP",
  pointKey: "A",
  operator: "gt",
  thresholdValue: 80,
  severity: "critical",
  message: "Temperature above 80",
};

/** A row holding one of every writable section, plus a key from before ADR 0019. */
function storedWithFutureKey(): StoredTemplateContent {
  return JSON.parse(
    JSON.stringify({
      contentVersion: 1,
      kpis: [{ ...KPI, code: "OLD" }],
      alarms: [ALARM],
      maintenance: [{ title: "Quarterly service", intervalDays: 90 }],
      dashboards: { overview: { featured: ["A", "B"] } },
      someFutureKey: { nested: [1, 2, 3] },
    }),
  ) as StoredTemplateContent;
}

/**
 * Everything the merge does not touch comes out byte-identical.
 *
 * This is the §3.1 finding: `PATCH` replaces `content` wholesale, so a tab that
 * sent only its own section would delete the `maintenance` plans this UI does
 * not even display.
 */
export function runPreservesEveryOtherKeyTests(): void {
  const stored = storedWithFutureKey();
  const merged = mergeTemplateContent(stored, { section: "kpis", value: [KPI] });

  for (const key of ["maintenance", "dashboards", "someFutureKey", "alarms"]) {
    assert(
      JSON.stringify(merged[key]) === JSON.stringify(stored[key]),
      `${key} must survive the merge unchanged — got ${JSON.stringify(merged[key])}`,
    );
  }
  assert(merged.contentVersion === 1, "a stored contentVersion is carried through");
  assert(
    JSON.stringify(merged.kpis) === JSON.stringify([KPI]),
    `the edited section must be the new value — got ${JSON.stringify(merged.kpis)}`,
  );
  assert(
    Object.keys(merged).sort().join(",") === Object.keys(stored).sort().join(","),
    "the merge must add no key and remove none",
  );
}

/** Editing alarms leaves KPIs alone, and the other way round. */
export function runEachSectionIsIndependentTests(): void {
  const stored = storedWithFutureKey();

  const alarmEdit = mergeTemplateContent(stored, { section: "alarms", value: [] });
  assert(
    JSON.stringify(alarmEdit.kpis) === JSON.stringify(stored.kpis),
    "editing alarms must not touch kpis",
  );

  const kpiEdit = mergeTemplateContent(stored, { section: "kpis", value: [KPI] });
  assert(
    JSON.stringify(kpiEdit.alarms) === JSON.stringify(stored.alarms),
    "editing kpis must not touch alarms",
  );
}

/**
 * An empty array is written as `[]`, not as a deletion.
 *
 * Removing the last KPI and deleting the KPI section are different intents. The
 * second one must be asked for; inferring it from an empty array would make a
 * key disappear from stored content because someone emptied a table.
 */
export function runEmptySectionWritesAnArrayTests(): void {
  const stored = storedWithFutureKey();
  const merged = mergeTemplateContent(stored, { section: "kpis", value: [] });

  assert(Object.hasOwn(merged, "kpis"), "the key must still exist");
  assert(Array.isArray(merged.kpis), "the value must be an array");
  assert((merged.kpis as unknown[]).length === 0, "the array must be empty");

  // The same on a row that never had the section at all: it gains `[]`, which
  // is what the author just authored, not a key invented for them.
  const bare = mergeTemplateContent({ contentVersion: 1 }, { section: "alarms", value: [] });
  assert(Array.isArray(bare.alarms), "a first edit creates the section");
  assert(
    Object.keys(bare).sort().join(",") === "alarms,contentVersion",
    `no other key may appear — got ${Object.keys(bare).join(",")}`,
  );
}

/**
 * `contentVersion` is never invented.
 *
 * ADR 0019: absent means 1, and no migration backfills it. The envelope's
 * `.default(1)` supplies it on write. Adding it here would mean a template
 * gained a field because an author opened a tab, and would break the
 * byte-identical property the first test asserts.
 */
export function runDoesNotInventContentVersionTests(): void {
  const merged = mergeTemplateContent({ kpis: [] }, { section: "kpis", value: [KPI] });
  assert(
    !Object.hasOwn(merged, "contentVersion"),
    `contentVersion must not be added — got ${JSON.stringify(merged)}`,
  );
  assert(
    Object.keys(merged).join(",") === "kpis",
    `only the edited section may be present — got ${Object.keys(merged).join(",")}`,
  );
}

/**
 * Prototype-pollution keys are not carried through.
 *
 * `safeKeySchema` rejects all three server-side, so a stored row holding one
 * predates ADR 0019 and cannot be written back whatever this function does. The
 * merge must not be the thing that reintroduces them.
 *
 * The first two assertions are the guard on the fixture itself: they fail if
 * the object is ever rewritten as a literal, which would make the rest vacuous.
 */
export function runDropsUnsafeKeysTests(): void {
  const stored = JSON.parse(
    '{"__proto__":{"polluted":true},"constructor":1,"prototype":2,"kpis":[],"maintenance":[]}',
  ) as StoredTemplateContent;

  assert(
    Object.hasOwn(stored, "__proto__"),
    "fixture guard: build this with JSON.parse — an object literal creates no own __proto__ key",
  );
  assert(Object.keys(stored).includes("constructor"), "fixture guard: constructor is an own key");

  const merged = mergeTemplateContent(stored, { section: "kpis", value: [KPI] });

  for (const key of ["__proto__", "constructor", "prototype"]) {
    assert(
      !Object.hasOwn(merged, key),
      `${key} must not be copied into the merged object — got ${JSON.stringify(
        Object.keys(merged),
      )}`,
    );
  }
  assert(
    ({} as Record<string, unknown>).polluted === undefined,
    "Object.prototype must not have been polluted",
  );
  assert(
    JSON.stringify(merged.maintenance) === JSON.stringify(stored.maintenance),
    "the legitimate keys still survive",
  );

  // The reason the filter is not optional: a spread carries `__proto__` through
  // as an own property, so the plain-looking implementation would fail the
  // assertions above. Asserted, not asserted-about-in-a-comment.
  const spread = { ...stored };
  assert(
    Object.hasOwn(spread, "__proto__"),
    "object spread does carry an own __proto__ key — that is why the filter exists",
  );
}

/** The caller's stored object is never written to. */
export function runDoesNotMutateStoredTests(): void {
  const stored = storedWithFutureKey();
  const before = JSON.stringify(stored);
  const merged = mergeTemplateContent(stored, { section: "kpis", value: [KPI] });
  assert(JSON.stringify(stored) === before, "the stored content must not be modified in place");

  // And the new section is a copy, so a later edit of the caller's array cannot
  // reach into the object already handed to the mutation.
  const source = [KPI];
  const copied = mergeTemplateContent(stored, { section: "kpis", value: source });
  source.push({ ...KPI, code: "SECOND" });
  assert(
    (copied.kpis as unknown[]).length === 1,
    "the merged section must not alias the caller's array",
  );
  assert(merged !== stored, "the merge returns a new object");
}

/**
 * A row the contract still accepts reports nothing.
 *
 * Every writable key is exercised, so the list in the module cannot lose one
 * without this failing. The authority is `contentEnvelopeSchema`
 * (`apps/api/src/admin/asset-templates/asset-templates-content.schema.ts:288`),
 * which `apps/web` cannot import — the two copies are checked against each
 * other by hand, and this test is what makes a drift visible.
 */
export function runCleanContentIsWritableTests(): void {
  const clean = JSON.parse(
    JSON.stringify({
      contentVersion: 1,
      kpis: [KPI],
      alarms: [ALARM],
      maintenance: [{ title: "Quarterly service", intervalDays: 90 }],
      dashboards: { overview: { featured: ["A"] } },
    }),
  ) as StoredTemplateContent;

  assert(
    Object.keys(clean).length === 5,
    "the fixture must hold all five writable keys, or it proves less than it claims",
  );
  assert(
    unwritableContentKeys(clean).length === 0,
    `a conforming row reports nothing — got ${JSON.stringify(unwritableContentKeys(clean))}`,
  );
  assert(contentCanBeWrittenBack(clean), "a conforming row can be written back");
  assert(contentCanBeWrittenBack({}), "an empty content object is writable");
}

/**
 * The three ways a stored key fails a write, each named separately.
 *
 * A reserved key gets the server's own wording, because "not part of the
 * contract" would send an author looking for a typo in a key that is going to
 * mean something in `E1.1`.
 */
export function runUnwritableKeysAreClassifiedTests(): void {
  const stored = JSON.parse(
    '{"kpis":[],"health":{"score":1},"optimisation":{},"someFutureKey":1,"__proto__":{"x":1}}',
  ) as StoredTemplateContent;
  assert(Object.hasOwn(stored, "__proto__"), "fixture guard: __proto__ must be an own key");

  const problems = unwritableContentKeys(stored);
  const byKey = new Map(problems.map((problem) => [problem.key, problem]));

  assert(problems.length === 4, `expected 4 problems, got ${problems.length}`);
  assert(!byKey.has("kpis"), "a writable key is not a problem");

  assert(byKey.get("health")?.reason === "reserved", "health is reserved");
  assert(
    byKey.get("health")?.message.includes("E1.1") === true,
    `the reserved message must name the blocking item — got ${byKey.get("health")?.message}`,
  );
  assert(
    byKey.get("optimisation")?.message.includes("E1.6") === true,
    "each reserved key names its own item, not a shared one",
  );

  assert(byKey.get("someFutureKey")?.reason === "unknown", "an unrecognized key is unknown");
  assert(byKey.get("__proto__")?.reason === "unsafe", "a pollution key is unsafe, not merely unknown");

  assert(!contentCanBeWrittenBack(stored), "this row cannot be written back");

  // The point of separating the two functions: the merge still carries the
  // reserved and unknown keys. Dropping them to make the request succeed would
  // be the silent-destruction defect this module exists to prevent, only harder
  // to notice.
  const merged = mergeTemplateContent(stored, { section: "kpis", value: [KPI] });
  assert(Object.hasOwn(merged, "health"), "a reserved key is reported, not deleted");
  assert(Object.hasOwn(merged, "someFutureKey"), "an unknown key is reported, not deleted");
}

/**
 * An inherited key is `unknown`, not `reserved`.
 *
 * `RESERVED_KEYS` is a plain object literal and `key` comes from
 * `Object.keys(stored)`, where `stored` is `z.record(z.unknown())` — arbitrary
 * JSON written before ADR 0019 tightened it. A bare `RESERVED_KEYS[key]`
 * lookup walks the prototype chain, so a stored key named `toString` returned
 * `Object.prototype.toString` — a function, therefore `!== undefined` — and
 * the key was classified **reserved**, with the native function source
 * interpolated into the sentence shown to the author:
 *
 *   "toString" is reserved for function toString() { [native code] } and is
 *   not yet specified.
 *
 * The save was refused either way, so nothing unsafe shipped. The author was
 * simply told nonsense about a key they could otherwise have been told to
 * remove.
 *
 * The existing classification test covers `health` (reserved),
 * `someFutureKey` (unknown) and `__proto__` (unsafe), and every one of them
 * passes with the defect present — none of the three is an inherited name.
 */
export function runInheritedKeyTests(): void {
  // `constructor` is deliberately absent: `UNSAFE_KEYS` catches it earlier, so
  // it never reaches the reserved lookup and would prove nothing here.
  const inherited = ["toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "toLocaleString"];

  // Anti-vacuity, and the point of the whole test: prove these names really do
  // resolve through the prototype chain on a plain literal. If a future
  // refactor made `RESERVED_KEYS` a null-prototype object, this guard would
  // fail loudly rather than let the cases below pass for a new reason.
  const probe: Record<string, string> = { health: "x" };
  for (const name of inherited) {
    assert(
      (probe as Record<string, unknown>)[name] !== undefined,
      `fixture guard: "${name}" must resolve through Object.prototype on a plain literal`,
    );
    assert(
      !Object.prototype.hasOwnProperty.call(probe, name),
      `fixture guard: "${name}" must not be an own key`,
    );
  }

  const stored: Record<string, unknown> = { kpis: [] };
  for (const name of inherited) {
    stored[name] = { anything: true };
  }

  const problems = unwritableContentKeys(stored);
  const byKey = new Map(problems.map((problem) => [problem.key, problem]));

  for (const name of inherited) {
    const problem = byKey.get(name);
    assert(problem !== undefined, `"${name}" must be reported as a problem`);
    assert(
      problem?.reason === "unknown",
      `"${name}" is an inherited name, not a reserved section — got ${problem?.reason}`,
    );
    // The message must never carry a function body. This is what the author
    // actually saw.
    assert(
      problem?.message.includes("[native code]") !== true,
      `"${name}" leaked a native function into its message: ${problem?.message}`,
    );
    assert(
      problem?.message.includes("function ") !== true,
      `"${name}" leaked a function into its message: ${problem?.message}`,
    );
  }

  // The real reserved sections must still classify as reserved, or the fix
  // could have been "call everything unknown".
  const withReal = unwritableContentKeys({ health: {}, optimisation: {} });
  const realByKey = new Map(withReal.map((problem) => [problem.key, problem]));
  assert(realByKey.get("health")?.reason === "reserved", "health is still reserved");
  assert(realByKey.get("optimisation")?.reason === "reserved", "optimisation is still reserved");
}
