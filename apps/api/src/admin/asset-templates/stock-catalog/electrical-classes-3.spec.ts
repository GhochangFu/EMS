import { CALC_DIALECT_V2 } from "@bms/shared";

import { STOCK_ASSET_TEMPLATE_CATALOG } from "./stock-catalog";
import { alarmsOf, assert, FEEDER_CODE } from "./stock-catalog.spec";

/**
 * `E4.1c` — the feeder / incomer class (`electrical-feeder`) against
 * `docs/electrical-derived-taglist-v1.md` §1 and against ADR 0070 decision 8.
 *
 * **A third electrical class-spec file, and the reason is the §4.5 cap, twice
 * over.** The block below lived in `stock-catalog.spec.ts` from `F2.13`, and
 * that file stood at 999 lines when `E4.1c` arrived with six `bms-calc-v3`
 * derived rows to pin (plan design decision 17). `electrical-classes.spec.ts`
 * (952) and `electrical-classes-2.spec.ts` hold the other five electrical
 * classes; the cut is by line budget only, the `electrical-classes-2` rule —
 * the three could be concatenated with no edit.
 *
 * **Two kinds of claim, kept apart.** `runFeederTagListBlock` is the `F2.13`
 * block moved whole — every assertion in it is a claim about tag list §1 (the
 * 33 rows, the 17 C / 16 X split, no M row, `kwh_today` measured, the eleven
 * alarm rows, `overload` on `current_a`) or about `F2.8`'s three `v2` rows.
 * The exported `assert*` functions after it are `E4.1c`'s: one per claim, so
 * the wrapper runs one `it()` per claim and a later block cannot hide behind
 * an earlier `assert` that throws first.
 *
 * The generic claims (pair-absence, alarm bindings, the vocabularies, the
 * `meta.tier` iff rule, derived-point well-formedness — including that every
 * `v2`/`v3` formula parses under its dialect and names only declared keys)
 * are `checkEntry`'s in `stock-catalog.spec.ts` and are not restated.
 */
export function runFeederTagListBlock(): void {
  const codes = STOCK_ASSET_TEMPLATE_CATALOG.map((entry) => entry.code);

  // ---- the feeder class, against its tag list -----------------------------

  const feeder = STOCK_ASSET_TEMPLATE_CATALOG.find((entry) => entry.code === FEEDER_CODE);
  assert(
    feeder !== undefined,
    `the catalog must ship "${FEEDER_CODE}" (plan §5) — found only: ${codes.join(", ") || "(nothing)"}`,
  );
  if (!feeder) return;

  // The tag list's 33 rows — 17 C and 16 X — plus `F2.8`'s three derived rows,
  // in order (`sortOrder` 0…35). The measured half is a transcription claim about
  // `docs/electrical-derived-taglist-v1.md` §1; the derived half is not in that
  // document at all and is not counted against it. `optional` is measured-only
  // for the same reason: a derived row is optional too, and folding the two
  // together would let a lost tag-list row hide behind a new formula.
  assert(feeder.points.length === 36, `tag list §1's 33 rows + F2.8's 3 derived; the entry declares ${feeder.points.length}`);
  const required = feeder.points.filter((point) => point.required);
  const optional = feeder.points.filter((point) => point.kind === "measured" && !point.required);
  assert(required.length === 17, `17 rows are tier C (required); got ${required.length}`);
  assert(optional.length === 16, `16 measured rows are tier X (optional); got ${optional.length}`);
  feeder.points.forEach((point, index) => {
    assert(
      point.sortOrder === index,
      `points must be in the tag list's own order — ${point.pointKey} has sortOrder ${point.sortOrder} at index ${index}`,
    );
  });
  const feederKeys = new Set(feeder.points.map((point) => point.pointKey));
  assert(feederKeys.size === 36, "no point key may repeat");

  // **The three derived rows are `F2.8`'s, not the tag list's** — ruling 1 of that
  // row's gate (PUE lives on the site's incomer and nowhere else), and ADR 0055
  // decision 6's worked example made concrete: two aggregates and the ratio of the
  // two derived siblings decision 7 admits. The order is the ratio's own reading
  // order, so a later append cannot put `pue` above the inputs it divides.
  const derived = feeder.points.filter((point) => point.kind === "derived");
  assert(
    derived.length === 3 && derived.map((point) => point.pointKey).join(",") === "site_kw,it_kw,pue",
    `F2.8 ruling 1 authors site_kw, it_kw and pue on the incomer, in that order; got ` +
      `${derived.map((point) => point.pointKey).join(", ") || "(none)"}`,
  );
  assert(
    derived.every((point) => point.formulaDialect === CALC_DIALECT_V2),
    `every F2.8 derived row is "${CALC_DIALECT_V2}" — two of them aggregate over a scope, which ` +
      `only v2 can express; got ${derived.map((point) => String(point.formulaDialect)).join(", ")}`,
  );

  // The tier marking is `checkEntry`'s from F2.12 Task 3 on — the iff rule
  // there subsumes the C/X pair this block used to assert, and says more (it
  // also constrains `manual` rows and derived points, which the old rule could
  // not express). What stays feeder-specific is §1's own claim: no M row.
  const manual = feeder.points.filter((point) => point.meta?.tier === "manual");
  assert(
    manual.length === 0,
    `tag list §1 has no M column — ${FEEDER_CODE} marks ${manual.map((p) => p.pointKey).join(", ")} manual`,
  );

  // kwh_today is C/D and authored MEASURED (plan §5): no bms-calc-v1 formula
  // can express energy-today, and a placeholder is the guessing ADR 0019 refuses.
  const kwhToday = feeder.points.find((point) => point.pointKey === "kwh_today");
  assert(
    kwhToday !== undefined && kwhToday.required && kwhToday.kind === "measured",
    "kwh_today (tier C/D) must be required and measured",
  );

  // The feeder's "no derived point, no kpis" guard moved to
  // `stock-catalog-deferrals.spec.ts` with the ledger it cites — it is a
  // deferral claim, and `DEFERRAL_REASON` is the text it fails with.

  // Eleven philosophy rows. Pair-absence, the binding, the message, the
  // severity and the category are `checkEntry`'s from F2.12 Task 3 on — every
  // one of them is a property of a STOCK catalog, not of this class. The count
  // is §1's own claim and stays here.
  const alarms = alarmsOf(feeder);
  assert(alarms.length === 11, `plan §5 authors 11 alarm rows; the entry carries ${alarms.length}`);

  // The overload row binds current_a, not the deferred load_pct (ruled 2026-09-02).
  const overload = alarms.find((alarm) => alarm.code === "overload");
  assert(
    overload !== undefined && overload.pointKey === "current_a",
    `the overload alarm must bind current_a (load_pct is deferred); got ${String(overload?.pointKey)}`,
  );
}
