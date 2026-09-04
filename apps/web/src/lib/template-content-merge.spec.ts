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
import type {
  TemplateAlarm,
  TemplateDashboardView,
  TemplateKpi,
  TemplateMaintenancePlan,
} from "@bms/shared";

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
      // `E1.3`: `health` became the sixth writable key when ADR 0050 decision 7
      // reopened the tier. It has no tab in this UI — it is in `maintenance`'s
      // class, carried through the merge rather than edited — but a stored
      // health section must not block a KPI-tab save, and that is what this
      // fixture proves by holding one.
      health: { bands: [{ code: "critical", label: "Critical", minScore: 0 }] },
    }),
  ) as StoredTemplateContent;

  assert(
    Object.keys(clean).length === 6,
    "the fixture must hold all six writable keys, or it proves less than it claims",
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
 * mean something in `E1.6`.
 *
 * The fixture keeps its `health` key, and the assertion about it INVERTED in
 * `E1.3`: it is now writable, so it must NOT be reported. That direction is the
 * one worth holding — a stale `reserved` entry here would fail every save on a
 * template that carries a valid health section, and the failure would name a
 * backlog item the author cannot act on.
 */
export function runUnwritableKeysAreClassifiedTests(): void {
  const stored = JSON.parse(
    '{"kpis":[],"health":{"bands":[]},"optimisation":{},"someFutureKey":1,"__proto__":{"x":1}}',
  ) as StoredTemplateContent;
  assert(Object.hasOwn(stored, "__proto__"), "fixture guard: __proto__ must be an own key");

  const problems = unwritableContentKeys(stored);
  const byKey = new Map(problems.map((problem) => [problem.key, problem]));

  assert(problems.length === 3, `expected 3 problems, got ${problems.length}`);
  assert(!byKey.has("kpis"), "a writable key is not a problem");
  assert(!byKey.has("health"), "health is writable since E1.3 — it must not be reported");

  assert(
    byKey.get("optimisation")?.reason === "reserved",
    "optimisation is reserved",
  );
  assert(
    byKey.get("optimisation")?.message.includes("E1.6") === true,
    "a reserved key names its own item",
  );

  assert(byKey.get("someFutureKey")?.reason === "unknown", "an unrecognized key is unknown");
  assert(byKey.get("__proto__")?.reason === "unsafe", "a pollution key is unsafe, not merely unknown");

  assert(!contentCanBeWrittenBack(stored), "this row cannot be written back");

  // The point of separating the two functions: the merge still carries the
  // reserved and unknown keys. Dropping them to make the request succeed would
  // be the silent-destruction defect this module exists to prevent, only harder
  // to notice.
  const merged = mergeTemplateContent(stored, { section: "kpis", value: [KPI] });
  assert(Object.hasOwn(merged, "optimisation"), "a reserved key is reported, not deleted");
  assert(Object.hasOwn(merged, "someFutureKey"), "an unknown key is reported, not deleted");
  // `health` survives for a different reason since `E1.3` — it is writable and
  // has no tab, so this merge carries it the way it carries `maintenance`.
  assert(Object.hasOwn(merged, "health"), "a writable key with no tab is carried, not deleted");
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

  // The real reserved section must still classify as reserved, or the fix could
  // have been "call everything unknown". `health` is in the same call on purpose
  // and must come back with nothing to say: it left the reserved map in `E1.3`,
  // and a test that only looked at `optimisation` would keep passing if the two
  // keys were swapped.
  const withReal = unwritableContentKeys({ health: { bands: [] }, optimisation: {} });
  const realByKey = new Map(withReal.map((problem) => [problem.key, problem]));
  assert(realByKey.get("optimisation")?.reason === "reserved", "optimisation is still reserved");
  assert(!realByKey.has("health"), "health is writable since E1.3, not reserved");
}

const MAINTENANCE: TemplateMaintenancePlan[] = [
  {
    title: "Membrane CIP",
    category: "preventive",
    generationMode: "calendar",
    safetyCritical: false,
    priority: "medium",
    estimatedMinutes: 120,
    intervalDays: 90,
  },
];

/**
 * `storedWithFutureKey()` plus a `health` section.
 *
 * `health` is the one section the API accepts, this merge carries and no tab
 * edits (ADR 0050 decision 7 reopened it; ADR 0050 Amendment 1 decision 5 keeps
 * it off the strip). A maintenance edit is the first write that could plausibly
 * drop it — the two shared a sentence in `template-content-merge.ts`'s docblock
 * until `F2.19` — so it is in this fixture rather than assumed.
 */
function storedWithHealth(): StoredTemplateContent {
  return JSON.parse(
    JSON.stringify({
      ...storedWithFutureKey(),
      health: { weights: { A: 1 } },
    }),
  ) as StoredTemplateContent;
}

/**
 * `mergeTemplateContent`'s fourth arm (`F2.19`, ADR 0038 Amendment 5 Part B).
 *
 * The arm itself is not new code — `maintenance` is an array, so
 * `[...patch.value]` already handled it, and `WRITABLE_KEYS` already listed it.
 * That is exactly why it is asserted: "the existing branch already does this"
 * is a claim, and the §3.1 finding this file opens with says what it costs if
 * it is wrong. The Maintenance tab is the first surface that sends this patch,
 * and the sections it must not destroy are the four beside it.
 */
export function runMaintenancePatchPreservesOtherSectionsTests(): void {
  const stored = storedWithHealth();
  const merged = mergeTemplateContent(stored, { section: "maintenance", value: MAINTENANCE });

  for (const key of ["kpis", "alarms", "dashboards", "health", "someFutureKey"]) {
    assert(
      JSON.stringify(merged[key]) === JSON.stringify(stored[key]),
      `${key} must survive a maintenance edit unchanged — got ${JSON.stringify(merged[key])}`,
    );
  }
  assert(
    JSON.stringify(merged.maintenance) === JSON.stringify(MAINTENANCE),
    `the edited section must be the new value — got ${JSON.stringify(merged.maintenance)}`,
  );
  assert(merged.contentVersion === 1, "a stored contentVersion is carried through");
  assert(
    Object.keys(merged).sort().join(",") === Object.keys(stored).sort().join(","),
    "the merge must add no key and remove none",
  );
  assert(
    merged.maintenance !== MAINTENANCE,
    "the maintenance value is copied, not the same reference",
  );

  // The other direction: editing another section must not touch a stored
  // maintenance plan. `runPreservesEveryOtherKeyTests` already covers `kpis`;
  // this is the one that would catch a dashboards write that special-cased the
  // array sections and lost this one.
  const dashboardEdit = mergeTemplateContent(stored, { section: "dashboards", value: DASHBOARDS });
  assert(
    JSON.stringify(dashboardEdit.maintenance) === JSON.stringify(stored.maintenance),
    "editing dashboards must not touch maintenance",
  );
}

/**
 * An empty maintenance section is written as `[]`, never a deletion.
 *
 * Removing the last plan and deleting the section are different intents, and
 * the second must be asked for. The array precedent is
 * `runEmptySectionWritesAnArrayTests`; this proves the fourth arm follows it,
 * because "remove every plan" is a real thing an author does on this tab.
 */
export function runEmptyMaintenanceSectionIsKeptTests(): void {
  const stored = storedWithHealth();
  const merged = mergeTemplateContent(stored, { section: "maintenance", value: [] });

  assert(Object.hasOwn(merged, "maintenance"), "the key must still exist");
  assert(Array.isArray(merged.maintenance), "the value must be an array");
  assert((merged.maintenance as unknown[]).length === 0, "the array must be empty");
  assert(
    JSON.stringify(merged.health) === JSON.stringify(stored.health),
    "emptying maintenance must not touch health",
  );

  const bare = mergeTemplateContent({ contentVersion: 1 }, { section: "maintenance", value: [] });
  assert(Object.hasOwn(bare, "maintenance"), "a first edit creates the section even when empty");
  assert(
    Object.keys(bare).sort().join(",") === "contentVersion,maintenance",
    `no other key may appear — got ${Object.keys(bare).join(",")}`,
  );
}

const DASHBOARDS: Record<string, TemplateDashboardView> = {
  overview: { featured: ["A", "B"] },
  detail: { featured: ["A"], widgets: [] },
};

/**
 * `mergeTemplateContent`'s third arm (`F3.1e`, ADR 0038 Amendment 4).
 *
 * A dashboards patch is a **record**, not an array — `TemplateContentPatch`'s
 * two existing members both spread `[...patch.value]`. This proves the
 * record write preserves every section it does not own, on the same §3.1
 * finding the first test in this file pins for the array sections.
 */
export function runDashboardsPatchPreservesOtherSectionsTests(): void {
  const stored = storedWithFutureKey();
  const merged = mergeTemplateContent(stored, { section: "dashboards", value: DASHBOARDS });

  for (const key of ["kpis", "alarms", "maintenance", "someFutureKey"]) {
    assert(
      JSON.stringify(merged[key]) === JSON.stringify(stored[key]),
      `${key} must survive a dashboards edit unchanged — got ${JSON.stringify(merged[key])}`,
    );
  }
  assert(
    JSON.stringify(merged.dashboards) === JSON.stringify(DASHBOARDS),
    `the edited section must be the new value — got ${JSON.stringify(merged.dashboards)}`,
  );
  assert(
    Object.keys(merged).sort().join(",") === Object.keys(stored).sort().join(","),
    "the merge must add no key and remove none",
  );

  // The other direction: editing kpis must not touch a stored dashboards.
  const kpiEdit = mergeTemplateContent(stored, { section: "kpis", value: [KPI] });
  assert(
    JSON.stringify(kpiEdit.dashboards) === JSON.stringify(stored.dashboards),
    "editing kpis must not touch dashboards",
  );
}

/**
 * An empty dashboards record is written as `{}`, never a deletion — the
 * record precedent of `runEmptySectionWritesAnArrayTests`. Deleting the last
 * view is a real intent `buildDashboardsPayload` already expresses this way;
 * this proves the merge layer carries `{}` through rather than dropping the
 * key.
 */
export function runEmptyDashboardsRecordIsKeptTests(): void {
  const stored = storedWithFutureKey();
  const merged = mergeTemplateContent(stored, { section: "dashboards", value: {} });

  assert(Object.hasOwn(merged, "dashboards"), "the key must still exist");
  assert(
    typeof merged.dashboards === "object" && merged.dashboards !== null,
    "the value must be an object",
  );
  assert(Object.keys(merged.dashboards as object).length === 0, "the record must be empty");

  const bare = mergeTemplateContent({ contentVersion: 1 }, { section: "dashboards", value: {} });
  assert(Object.hasOwn(bare, "dashboards"), "a first edit creates the section even when empty");
}

/**
 * The record copy is a filtered loop, not a spread — `merged[key] = value`
 * must never run with `key === "__proto__"`. Built with `JSON.parse`, per the
 * file docblock: an object literal never creates an own `__proto__` property,
 * so a literal fixture would prove nothing.
 */
export function runDashboardsPatchDropsUnsafeViewNamesTests(): void {
  // `prototype` carries a `polluted` marker, and both are deliberate.
  //
  // The loop below asserts over all three of `UNSAFE_KEYS`, but this fixture
  // used to contain only two of them — so the `prototype` iteration checked a
  // key that was never in the input, and deleting `"prototype"` from
  // `UNSAFE_KEYS` left this test green. Found by the correctness review of
  // `F3.1e`. The fixture must carry every key the loop names, or the loop is
  // asserting over absence.
  const patch = JSON.parse(
    '{"__proto__":{"featured":["A"]},"constructor":{"featured":["A"]},' +
      '"prototype":{"featured":["A"],"polluted":true},"overview":{"featured":["A"]}}',
  ) as Record<string, TemplateDashboardView>;

  assert(
    Object.hasOwn(patch, "__proto__"),
    "fixture guard: build this with JSON.parse — an object literal creates no own __proto__ key",
  );
  assert(Object.keys(patch).includes("constructor"), "fixture guard: constructor is an own key");
  assert(Object.keys(patch).includes("prototype"), "fixture guard: prototype is an own key");

  const merged = mergeTemplateContent({ contentVersion: 1 }, { section: "dashboards", value: patch });
  const dashboards = merged.dashboards as Record<string, unknown>;

  for (const key of ["__proto__", "constructor", "prototype"]) {
    assert(
      !Object.hasOwn(dashboards, key),
      `${key} must not be copied into the merged dashboards record — got ${JSON.stringify(
        Object.keys(dashboards),
      )}`,
    );
  }
  // This assertion was decorative until the fixture gained a `polluted` marker:
  // nothing in the input wrote that key, so it could never have failed. It now
  // reads a value the fixture actually carries, on the one key whose whole
  // purpose is to reach `Object.prototype`. Kept rather than deleted, because a
  // filter that let `prototype` through *and* assigned into it is precisely the
  // failure this arm exists to prevent — and it would not be visible in
  // `Object.keys(dashboards)`.
  assert(
    ({} as Record<string, unknown>).polluted === undefined,
    "Object.prototype must not have been polluted — a `prototype` view name reached it",
  );
  assert(Object.hasOwn(dashboards, "overview"), "the legitimate view survives");

  // The reason the filter is not optional, restated for the record arm: a
  // spread carries __proto__ through as an own property.
  const spread = { ...patch };
  assert(
    Object.hasOwn(spread, "__proto__"),
    "object spread does carry an own __proto__ key — that is why the filter exists",
  );
}

/** The merged record does not alias the caller's object. */
export function runDashboardsPatchDoesNotAliasTests(): void {
  const stored = storedWithFutureKey();
  const source: Record<string, TemplateDashboardView> = { overview: { featured: ["A"] } };
  const merged = mergeTemplateContent(stored, { section: "dashboards", value: source });

  source.overview = { featured: ["A", "B"] };
  assert(
    JSON.stringify((merged.dashboards as Record<string, unknown>).overview) ===
      JSON.stringify({ featured: ["A"] }),
    "the merged section must not alias the caller's record",
  );
  assert(merged !== stored, "the merge returns a new object");
  assert(merged.dashboards !== source, "the dashboards value is copied, not the same reference");
}
