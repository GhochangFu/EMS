import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F2.13` — a stock asset-template catalog entry may not name a point key the
 * platform lacks (ADR 0052 Consequences, "vocabulary before content, enforced
 * twice" — this is the third and earliest time).
 *
 * `0058`'s foreign key refuses a `template_points` row whose key the platform
 * lacks, and `assertPointKeysActive` refuses the import before the insert is
 * attempted. Both fire at import time, on a running database, against a
 * catalog that already shipped. This fails it **before either, at build time**,
 * by scanning the catalog files as text against the `*_POINT_KEYS` arrays in
 * `packages/shared/src/constants.ts` — the arrays `point-keys-seed.ts` builds
 * `bms.point_keys` from, so a key outside them is one nothing can seed.
 *
 * **A new file rather than an extension of
 * `tests/f3.38-stock-catalog-vocabulary.test.ts`.** That one scans `section:`
 * lines and `assetRoleCode` values, and an asset-template catalog has neither.
 * The 6-line `*_POINT_KEYS` parser is **restated** rather than shared — `f3.38`
 * keeps its own copy, and a shared helper is a second thing to keep honest.
 *
 * **No `KEYS_AWAITING_A_VOCABULARY` analogue here, and there is no longer one
 * owed.** All 33 feeder keys were in the vocabulary from the day this file was
 * written (`F2.11` promoted the electrical class set). ADR 0052's Consequences
 * asked for such a list for the **water** keys *until* `E5.1` promoted them —
 * and `E5.1` promoted all 98 in the commit before `water.ts` landed, so no
 * water key ever reached this scan without a vocabulary to be checked against.
 * The list this file was told to write is one it must not write: an entry on it
 * would exempt a key the check at the foot of this file is now enforcing.
 * `f3.38`'s `stillOutside` clock keeps running on four DASHBOARD-template keys,
 * which are a different catalog and a separate backlog row.
 */

/** The one directory every stock catalog file lives in, packs and classes alike. */
const STOCK_CATALOG_DIR = "apps/api/src/admin/asset-templates/stock-catalog";

/**
 * **EVERY file that can hold entry data — every class module, not just every
 * pack.** `stock-catalog.ts` spreads the packs and `electrical.ts` spreads the
 * six class modules `F2.12` split it into, and this scan reads TEXT, so it can
 * follow neither spread: **a class module missing from this list has its
 * `pointKey` values checked against no vocabulary at all, and every assertion
 * below stays green while checking less.**
 *
 * **A hand list that must grow with every future class is exactly the thing
 * that goes stale**, so it is no longer the only thing holding that line: the
 * directory cross-check below fails the build the moment a `.ts` file appears
 * in `STOCK_CATALOG_DIR` and is neither listed here nor named in
 * `STOCK_ASSET_SCAN_EXEMPT`. That is what `F2.13`'s docblock asked for in
 * prose and could only ask for. A new pack (`mechanical.ts` for `E5.2`,
 * `facility.ts` for `E5.3`) still belongs here the day it lands, and the
 * anti-vacuity lower bounds below move with it.
 *
 * **`E5.1` is the first time the cross-check did the work it was written for.**
 * The water pack's seven files were created in the commit before this one, and
 * that commit was red here — on the cross-check alone, naming all seven — until
 * they were listed. That is the failure mode this list is for, caught by the
 * check rather than by whoever happened to remember.
 */
const STOCK_ASSET_RELS = [
  `${STOCK_CATALOG_DIR}/stock-catalog.ts`,
  `${STOCK_CATALOG_DIR}/electrical.ts`,
  `${STOCK_CATALOG_DIR}/point-fields.ts`,
  `${STOCK_CATALOG_DIR}/electrical-feeder.ts`,
  `${STOCK_CATALOG_DIR}/electrical-transformer.ts`,
  `${STOCK_CATALOG_DIR}/electrical-dg-set.ts`,
  `${STOCK_CATALOG_DIR}/electrical-ups.ts`,
  `${STOCK_CATALOG_DIR}/electrical-solar-pv.ts`,
  `${STOCK_CATALOG_DIR}/electrical-apfc.ts`,
  // The water pack — `E5.1`, one index and six plant modules, listed in the
  // ADR 0040 ruling 2 authoring order `water.ts` itself uses.
  `${STOCK_CATALOG_DIR}/water.ts`,
  `${STOCK_CATALOG_DIR}/water-stp.ts`,
  `${STOCK_CATALOG_DIR}/water-etp.ts`,
  `${STOCK_CATALOG_DIR}/water-cooling-tower.ts`,
  `${STOCK_CATALOG_DIR}/water-wtp.ts`,
  `${STOCK_CATALOG_DIR}/water-ro.ts`,
  `${STOCK_CATALOG_DIR}/water-softener.ts`,
  // The mechanical/utility pack — `E5.2`, one index and six machine modules, in
  // ADR 0053 decision 1's document order. **The index is listed here in the
  // commit that CREATES it** (plan Task 5), before it holds a single entry: the
  // directory cross-check below is red the moment a `.ts` file appears in the
  // catalog directory unaccounted for, so a pack index and its listing are one
  // commit by construction. `mechanical.ts` exports an empty array on purpose
  // (`E5.1` §13 item 1 — no skeleton modules with placeholder points), so it
  // contributes no reference to the bounds below.
  //
  // **The six class modules join one per entry commit** — `mechanical-pump.ts`,
  // `mechanical-vfd.ts`, `mechanical-compressor.ts`, `hvac-chiller.ts`,
  // `hvac-ahu.ts`, `mechanical-boiler.ts`, two of them `hvac-*` under the
  // mechanical index because ADR 0053 decision 2 files a chiller and an AHU
  // under the domain their keys already live in. Each of those commits adds one
  // line here as well as to `mechanical.ts`; the cross-check makes forgetting a
  // build failure rather than a silently unscanned module.
  `${STOCK_CATALOG_DIR}/mechanical.ts`,
  `${STOCK_CATALOG_DIR}/mechanical-pump.ts`,
  `${STOCK_CATALOG_DIR}/mechanical-vfd.ts`,
  `${STOCK_CATALOG_DIR}/mechanical-compressor.ts`,
  `${STOCK_CATALOG_DIR}/hvac-chiller.ts`,
  `${STOCK_CATALOG_DIR}/hvac-ahu.ts`,
  `${STOCK_CATALOG_DIR}/mechanical-boiler.ts`,
  // The facility/smart-building pack — `E5.3`, one index and (in PR 1) seven
  // class modules, in the document's section order. **The index is listed here
  // in the commit that CREATES it** (plan Task 3), before it holds a single
  // entry, for the same reason `mechanical.ts` was: the directory cross-check
  // below is red the moment a `.ts` file appears in the catalog directory
  // unaccounted for, so a pack index and its listing are one commit by
  // construction. `facility.ts` exports an empty array on purpose (`E5.1` §13
  // item 1 — no skeleton modules with placeholder points), so it contributes no
  // reference to the bounds below until Task 4.
  //
  // **The class modules join one per entry commit** — `facility-lighting-zone.ts`
  // (§1), `facility-fire-panel.ts` (§2), `facility-access-door.ts` (§3),
  // `facility-occupancy-zone.ts` (§4), `facility-parking-level.ts` (§5),
  // `environment-iaq-node.ts` (§6) and `facility-bas-gateway.ts` (§7), then
  // `mechanical-lift.ts` (§8a) and `mechanical-escalator.ts` (§8b) in PR 2.
  // **Three domains under one index**, and that is deliberate: ADR 0054
  // decision 2 files the IAQ node under `environment` — the domain whose
  // vocabulary already holds its temperature and humidity keys — and the lift
  // and the escalator under `mechanical`, while the module name follows the
  // entry code the way `water-stp.ts` does.
  `${STOCK_CATALOG_DIR}/facility.ts`,
  `${STOCK_CATALOG_DIR}/facility-lighting-zone.ts`,
  `${STOCK_CATALOG_DIR}/facility-fire-panel.ts`,
  `${STOCK_CATALOG_DIR}/facility-access-door.ts`,
  `${STOCK_CATALOG_DIR}/facility-occupancy-zone.ts`,
  `${STOCK_CATALOG_DIR}/facility-parking-level.ts`,
  `${STOCK_CATALOG_DIR}/environment-iaq-node.ts`,
  `${STOCK_CATALOG_DIR}/facility-bas-gateway.ts`,
  `${STOCK_CATALOG_DIR}/mechanical-lift.ts`,
  `${STOCK_CATALOG_DIR}/mechanical-escalator.ts`,
] as const;

/**
 * The only files in `STOCK_CATALOG_DIR` that may go unscanned: types, which
 * carry no string literal a point key could hide in. `*.spec.ts` and
 * `*.test.ts` are filtered before this list is consulted — they are the
 * catalog's own assertions, not catalog content.
 */
const STOCK_ASSET_SCAN_EXEMPT = ["types.ts"] as const;

const STOCK_LABEL = STOCK_ASSET_RELS.map((rel) => basename(rel)).join(" + ");

/**
 * Every file that declares a shared `*_POINT_KEYS` array, in the order
 * `point-keys-seed.ts` imports them. Restated from `f3.38`, on purpose (see
 * the file docblock).
 *
 * **`E5.3` made this a list, and the reason is a rule and not a preference.**
 * `packages/shared/src/constants.ts` reached 927 lines, and AGENTS.md §4.5's
 * 1000-line cap is read WHOLE-FILE by `.githooks/pre-commit.mjs:191-194`, so
 * the facility pack's 104 codes could not be appended there. They live in
 * `packages/shared/src/facility-point-keys.ts` instead — plan
 * `docs/plans/e5.3-facility-domain-pack.md` §4.5 and §12 ruling 1, a
 * correction to ADR 0054 decision 3's *"three arrays in `constants.ts`"*.
 *
 * **A THIRD ENTRY BELONGS HERE THE DAY A THIRD FILE DECLARES ONE**, with its
 * floor below — the same instruction `STOCK_ASSET_RELS` above already carries.
 * The parse is per file and the floor is per file because a union bound cannot
 * see which source supplied it: a mistyped path leaves the other file's 396
 * codes clearing any floor set before the split.
 */
const POINT_KEY_SOURCE_RELS = [
  "packages/shared/src/constants.ts",
  "packages/shared/src/facility-point-keys.ts",
] as const;

/**
 * The minimum number of codes each source must yield, per file and never as
 * one total. Both are actuals after `E5.3` PR 1 — `constants.ts` 396,
 * `facility-point-keys.ts` 104.
 */
const POINT_KEY_SOURCE_FLOOR: Readonly<Record<string, number>> = {
  "packages/shared/src/constants.ts": 396,
  // 206 since E5.3 PR 2: 104 (FACILITY_CLASS_POINT_KEYS + ENVIRONMENT_CLASS_POINT_KEYS) +
  // VERTICAL_TRANSPORT_CLASS_POINT_KEYS's 102.
  "packages/shared/src/facility-point-keys.ts": 206,
};

/** The sources as one list, for an assertion message. */
const POINT_KEY_SOURCE_LABEL = POINT_KEY_SOURCE_RELS.join(" + ");

/**
 * Every code the point-key catalog can seed — the union of the `*_POINT_KEYS`
 * arrays. Restated from `f3.38`, on purpose (see the file docblock).
 */
const pointKeyVocabulary = (source: string): ReadonlySet<string> => {
  const keys = new Set<string>();
  for (const block of source.matchAll(/export const [A-Z_]*POINT_KEYS = \[([^\]]*)\]/g)) {
    for (const literal of block[1]!.matchAll(/"([a-z0-9_]+)"/g)) {
      keys.add(literal[1]!);
    }
  }
  return keys;
};

/**
 * Every `pointKey: "…"` in a catalog file — a template point's key AND an
 * alarm's `pointKey` reference, both matched by the same regex, both required
 * to exist.
 *
 * **`\bpointKey:` does NOT match `pointKeys:`** — the KPI array form
 * (`content.kpis[].pointKeys: [...]`). `F2.13` carried that as an instruction
 * rather than a check, because the catalog had no KPIs and a scan for a form
 * no file yet contained would have been a regex nobody could test. `F2.12`
 * authored the form; `scanKpiPointKeys` below is that second scan, and the
 * membership check runs over the union of the two.
 *
 * **The instruction that survives is for a THIRD form.** If a future content
 * section names a point key some other way — a dashboard widget's own
 * `pointKeys`, a health model's weights, a `sourcePointKey` — it needs a third
 * scanner and a third self-test beside these two, or its references are
 * checked by nothing here and every assertion below stays green while
 * checking less.
 */
const scanCatalog = (source: string): string[] =>
  [...source.matchAll(/\bpointKey:\s*"([^"]+)"/g)].map((match) => match[1]!);

/**
 * Every member of every `pointKeys: [ "…", "…" ]` array — the KPI array form,
 * matched in two stages so an inner literal cannot escape its array: the outer
 * match stops at the first `]`, and the inner one takes the quoted strings
 * inside that slice.
 *
 * **Deliberately the complement of `scanCatalog`, never its superset.** One
 * regex matching both forms would count each KPI reference twice — the length
 * bound below would rise while the set of checked references did not. The
 * disjointness self-test is what holds the two apart.
 */
const scanKpiPointKeys = (source: string): string[] =>
  [...source.matchAll(/\bpointKeys:\s*\[([^\]]*)\]/g)].flatMap((match) =>
    [...match[1]!.matchAll(/"([^"]+)"/g)].map((literal) => literal[1]!),
  );

/**
 * The one string all three parser self-tests below run over. It was inline in
 * the first self-test until `F2.12` added a second scanner; the disjointness
 * claim is only worth anything if both scanners see the SAME text, so the
 * fixture moved out here rather than being copied. Its first three lines are
 * unchanged: a point row, an alarm row, and a KPI row carrying the array form.
 *
 * The fourth KPI **wraps its array across lines**, which is the shape a real
 * four-reference KPI takes once a formatter has been near it. `[^\]]*` matches
 * a newline, so the scan handles it — but a self-test over a single-line array
 * alone would not prove that, and a wrapped array is what pass C writes.
 */
const SCANNER_FIXTURE = [
  '{ pointKey: "voltage_vry", label: "x" },',
  '  alarms: [{ code: "a", pointKey: "current_a" }],',
  '  kpis: [{ code: "k", pointKeys: ["kw", "kva"] }, { code: "m", pointKeys: [',
  '    "dga_h2_ppm",',
  '    "dga_ch4_ppm",',
  "  ] }],",
].join("\n");

describe("F2.13 the stock asset-template catalog names point keys that exist", () => {
  const stockSources = STOCK_ASSET_RELS.map((rel) => read(rel));
  /** Both forms, one set: a declared point, an alarm's binding, a KPI's member. */
  const pointKeys = stockSources.flatMap((source) => [
    ...scanCatalog(source),
    ...scanKpiPointKeys(source),
  ]);
  // **Parsed per source file, then unioned** — never over a concatenation.
  // The per-file sets are what the floors in the anti-vacuity block read, so a
  // source that yields nothing names itself instead of hiding behind the other
  // one's codes.
  const vocabularyBySource = new Map<string, ReadonlySet<string>>(
    POINT_KEY_SOURCE_RELS.map((rel) => [rel, pointKeyVocabulary(read(rel))]),
  );
  const vocabulary = new Set(
    [...vocabularyBySource.values()].flatMap((codes) => [...codes]),
  );

  it("every file in STOCK_ASSET_RELS exists and is non-empty", () => {
    for (const rel of STOCK_ASSET_RELS) {
      expect(statSync(join(repoRoot, rel)).size, `${rel} is empty`).toBeGreaterThan(0);
    }
  });

  /**
   * The other direction, and the one that keeps the hand list honest: every
   * `.ts` file in the catalog directory is either scanned or explicitly
   * exempt. A new class module is a build failure until it is named.
   */
  it("every .ts file in the stock-catalog directory is scanned or explicitly exempt", () => {
    const onDisk = readdirSync(join(repoRoot, STOCK_CATALOG_DIR))
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".spec.ts") && !name.endsWith(".test.ts"))
      .sort();
    const accounted = [...STOCK_ASSET_RELS.map((rel) => basename(rel)), ...STOCK_ASSET_SCAN_EXEMPT].sort();
    expect(
      onDisk,
      `${STOCK_CATALOG_DIR} holds a .ts file this scan does not account for. Add it to ` +
        "STOCK_ASSET_RELS, or to STOCK_ASSET_SCAN_EXEMPT if it genuinely holds no entry data — " +
        "and say which in the commit. An unlisted class module has its pointKey values checked " +
        "against no vocabulary at all, and every assertion here stays green while checking less.",
    ).toEqual(accounted);
  });

  /**
   * The parser self-test: the scanner over a known string returns exactly the
   * two keys in it — and NOT the `pointKeys:` array member beside them.
   */
  it("the scanner finds exactly the pointKey values in a fixture, and ignores pointKeys arrays", () => {
    expect(scanCatalog(SCANNER_FIXTURE)).toEqual(["voltage_vry", "current_a"]);
  });

  /**
   * The second scanner's own self-test, over the same fixture: the KPI array
   * form and only it. `F2.13` could leave nothing but an instruction here —
   * a scan for a form no catalog file carried yet would have been a regex
   * nobody could test. `F2.12` authored the form, so this is now a check.
   */
  it("the KPI scanner finds exactly the pointKeys array members in a fixture", () => {
    expect(scanKpiPointKeys(SCANNER_FIXTURE)).toEqual(["kw", "kva", "dga_h2_ppm", "dga_ch4_ppm"]);
  });

  /**
   * And the two scanners partition the file rather than overlapping. One regex
   * matching both forms would count every KPI reference twice — inflating the
   * length bound below while checking nothing new, which is the silent
   * failure this file exists to prevent.
   */
  it("the two scanners' outputs over the fixture are disjoint", () => {
    const fromKpiArrays = new Set(scanKpiPointKeys(SCANNER_FIXTURE));
    const overlap = scanCatalog(SCANNER_FIXTURE).filter((key) => fromKpiArrays.has(key));
    expect(
      overlap,
      "the two scans returned the same key — a regex that matches both pointKey: and pointKeys: " +
        "double-counts every KPI reference and the length bound below stops meaning anything",
    ).toEqual([]);
  });

  /**
   * Anti-vacuity, real rather than parser-only. Every assertion below is "no
   * member of a scanned set is bad"; a regex that silently stops matching turns
   * all of them green. These are lower bounds read off the catalog as it stands.
   */
  it("the scan actually found the catalog and the vocabulary", () => {
    // 248 = 172 declared points (feeder 33 + transformer 30 + DG 38 + UPS 31 +
    // PV 26 + APFC 14) + 64 alarm pointKey references (11 + 15 + 13 + 12 + 7 +
    // 6, matched by scanCatalog) + 12 KPI pointKeys members (0 + 6 + 2 + 0 + 2
    // + 2, matched by scanKpiPointKeys). MEASURED off the six class modules in
    // F2.12 Task 8, not copied from the plan: plan §4.4 predicted 247 from 63
    // alarm references, and the UPS carries 12 rather than 11 because §4's
    // "battery replace / self-test failed" bullet splits into two rows binding
    // two different declared points. Plan §8's own figure of 248 reconciles.
    //
    // **391 since `E5.1` pass C, and staged the way `F2.12` staged its own.**
    // The bound stayed at 248 through passes A and B, because the six water
    // modules were skeletons carrying one point each and moving it to 254 would
    // have recorded a skeleton as though it were content. It moves here, in the
    // commit that authors the last of the six, **re-measured off the built
    // files rather than copied from the plan**: 248 + 143 water references =
    // **391**, where the 143 is 103 declared water point rows + 40 water alarm
    // `pointKey` references. The KPI-member count stays 12, because the water
    // pack authors no `content.kpis` at all — `water.ts` records why that is
    // structural rather than a deferral of effort. The measurement agrees with
    // plan §4.6's prediction exactly, so no row was dropped or misspelled.
    //
    // **Staged a third time for `E5.2`, and deliberately NOT moved by the
    // commit that declared the mechanical pack** (plan Task 5). That commit
    // adds `mechanical.ts` to the list above and the file exports an empty
    // array, so it contributed zero references; moving the bound then would
    // have recorded content that did not exist.
    //
    // **584 since plan Task 11 — MEASURED off the built files with this file's
    // own two scanners, not copied from the plan**: 391 + 141 declared
    // mechanical/HVAC point rows + 52 alarm references (pump 20/10, VFD 15/7,
    // compressor 23/7, chiller 30/9, AHU 28/8, boiler 25/11). The measurement
    // agrees with plan §4.6's prediction exactly, so no row was dropped or
    // misspelled anywhere in the pack. The KPI member count stays 12 for the
    // third pack running — ADR 0053 decision 6 authors no `content.kpis`
    // either, and `mechanical.ts` records why that is structural rather than a
    // deferral of effort. A count below this is a dropped or misspelled row and
    // not slack.
    //
    // **744 since `E5.3` plan Task 10 — MEASURED off the built files with this
    // file's own two scanners after the BAS gateway landed, never copied from
    // the plan**: 584 + 114 declared facility/environment point rows (15 + 24 +
    // 17 + 11 + 17 + 17 + 13, the seven PR 1 entries in document order) + 46
    // alarm references (4 + 11 + 7 + 4 + 7 + 6 + 7). Equal to plan §4.6's
    // prediction, which is the check: §4.6 says to read this number off the
    // files and treat any other value as a dropped or misspelled row rather
    // than as slack, and it agreed. The KPI member count stays 12 for the
    // FOURTH pack running — ADR 0054 decision 6 authors no `content.kpis`
    // either, and `facility.ts` records why that is structural. PR 2 moves this
    // to 897 with the lift and the escalator.
    //
    // **897 since `E5.3` plan Task 14 — MEASURED off the built files with this
    // file's own two scanners after the escalator landed, by raising the bound
    // past any possible value and reading vitest's received number, never by
    // copying the plan's prediction and watching it pass** (a bound set to the
    // predicted value proves only `>= predicted`). 744 + the lift's 97 (80
    // declared point rows + 17 alarm references) + the escalator's 56 (41 + 15)
    // = **897**, equal to plan §4.6's prediction, which is the check §4.6 asks
    // for: any other value is a dropped or misspelled row and not slack. The KPI
    // member count stays 12 for the FIFTH pack running. **This is the pack's
    // final value** — no `E5.3` commit follows the escalator.
    expect(pointKeys.length, `no pointKey found in ${STOCK_LABEL} — the scan is blind`).toBeGreaterThanOrEqual(897);
    // 168 distinct, so a copy-pasted repetition cannot satisfy the bound above
    // alone: 33 feeder + 30 transformer + 38 DG + 29 UPS (battery_v and
    // ambient_temp_c repeat) + 25 PV (ambient_temp_c) + 13 APFC (thd_v_pct,
    // which the feeder declares). Measured, and equal to plan §4.4's
    // prediction — a distinct count below this is a DROPPED OR MISSPELLED point
    // row, not slack, because checkEntry already forces every alarm and KPI
    // reference to be a key its own entry declares.
    //
    // Staged with the length bound above and for the same reason, and moved in
    // the same commit. **266 = 168 + the water pack's 98 distinct codes**, zero
    // of which overlap the electrical vocabulary — measured off the built files
    // at `E5.1` Task 9, and equal to plan §4.6's prediction.
    //
    // **143 water references over 98 distinct keys is not an error**, and the
    // gap is three different legitimate things: an alarm binds a key its own
    // entry already declares (40 of the 143 are alarm references);
    // `recovery_pct` is one code authored on two plants (`water-wtp` over its
    // intake and product streams, `water-ro` over feed and permeate — one
    // MEANING, two formulas, ADR 0051 Amendment 6 decision 5); and four codes
    // recur between §1/§5 and §5/§6 of the tag list itself.
    //
    // **382 since plan Task 11**, staged with the length bound above and moved
    // in the same commit, and measured the same way: 266 + the mechanical
    // pack's 128 distinct keys (94 new table codes + 21 reused + 13 promoted
    // derived codes) − **the 12 the electrical and water modules already
    // name**, which are eleven of the twenty-one reused codes plus
    // `fuel_level_pct`, the DG set's day-tank level that plan §12 ruling 1
    // reuses for the boiler rather than minting a second spelling. The nine
    // reused `HVAC_POINT_KEYS` codes are named by no shipped module, which is
    // why the subtraction is 12 and not 21. Equal to plan §4.6's prediction, so
    // the overlap arithmetic held as well as the transcription: the length
    // bound above says no row was dropped, and this one says no key was
    // double-counted or quietly duplicated.
    //
    // **490 since `E5.3` plan Task 10**, measured the same way and in the same
    // commit as the length bound above: 382 + the facility pack's 108 distinct
    // keys — its 104 VOCABULARY codes (100 new table codes plus the 4
    // promotions, which are MEMBERS of the two arrays and not a separate
    // addend) plus the 4 REUSED codes its entries reference and never
    // redeclare (`smoke_state`, `leak_state`, `temperature_c`,
    // `humidity_pct`), with
    // **nothing subtracted**, because not one of the 108 is named by an
    // electrical, water or mechanical module. That zero overlap is the pack's
    // own claim: a building's lighting, fire, access, occupancy, parking, air
    // quality and gateway rows share no spelling with a plant's, and the
    // near-misses that look like a shared code are deliberately not one
    // (`zone_kw` against `kw`, `burn_hours_h` against `run_hours_h`,
    // `door_open_state` against `door_state`, `no2_ppb` against `no2_ppm`) —
    // `packages/shared/src/facility-point-keys.ts` lists them all with the
    // reason each was kept as spelled. 744 references over 490 distinct keys is
    // not an error either: 46 of the references are alarm bindings onto rows
    // their own entry already declares, and the pack's 114 declared rows are
    // 108 distinct codes because **six are declared on two entries each** —
    // `occupancy_pct` (one code, two formulas, the `recovery_pct` shape),
    // `co_ppm` (the dual-tier row, core on the parking level and extended on
    // the air quality node), `sensor_battery_pct`, `entry_count`, `exit_count`
    // and `occupancy_state`, every one of them a code the tag list itself
    // repeats between sections. Equal to plan
    // §4.6's prediction, so the overlap arithmetic held as well as the
    // transcription.
    //
    // **592 since `E5.3` plan Task 14**, measured the same way and in the same
    // commit as the length bound above — the bound was raised past any possible
    // value and the received number read off vitest, rather than set to the
    // plan's figure and watched to pass. 490 + the vertical-transport pack's
    // **102** distinct keys: the lift and the escalator declare 121 rows over a
    // 110-code union (80 + 41 less the **eleven** codes both entries declare —
    // `controller_comms_ok`, `motor_current_a`, `motor_temp_c`, `brake_state`,
    // `brake_temp_c`, `passenger_count`, `kw`, `kwh_total`, `run_hours_h`,
    // `annual_inspection_due`, `brake_test_result`), less the **eight** of that
    // union already in the set: `controller_comms_ok`, which PR 1's access door
    // declares, and `motor_current_a`, `motor_temp_c`, `kw`, `kwh_total`,
    // `run_hours_h`, `start_count` and `vibration_mms`, which `E5.2`'s modules
    // name. Equal to plan §4.6's prediction. (§4.6's own parenthetical
    // decomposition reads "107 + 3 promoted"; PR 2 promotes **four** points over
    // three codes across the two entries and the total it predicts is right, so
    // the arithmetic reconciles by a different route to the same 102.) **The
    // pack's final value**: no `E5.3` commit follows the escalator, and this is
    // the number that says nothing in either entry was double-counted or
    // quietly duplicated while the length bound above says nothing was dropped.
    expect(new Set(pointKeys).size, "fewer distinct keys than the twenty-seven classes declare").toBeGreaterThanOrEqual(592);
    // 396 = the 289 E5.1 left (F2.11's 139 ELECTRICAL_CLASS_POINT_KEYS plus
    // F2.12's six promotions, plus the other arrays, plus E5.1's 98-code
    // WATER_CLASS_POINT_KEYS) + E5.2 pass A's 107-code
    // MECHANICAL_CLASS_POINT_KEYS + HVAC_CLASS_POINT_KEYS, disjoint by
    // construction — the same number f3.38 and f3.39 now hold. **Already at
    // its final value for this row**, unlike the two bounds above: pass A
    // landed every mechanical/hvac code, so nothing pass C authors can move
    // it. Leaving it at 289 would have stayed green with all 107 new codes
    // parsed as nothing at all, which is the silent failure this file exists
    // to end.
    //
    // **500 since `E5.3` PR 1** — 396 + the facility pack's 104
    // (`docs/plans/e5.3-facility-domain-pack.md` §4.4/§4.6), and already at
    // its final value for PR 1 for the same reason as `E5.2`: pass A1 lands
    // every facility and environment code, so nothing the seven entry commits
    // author can move it.
    //
    // **Per source FIRST.** The union cannot say which file supplied it, so a
    // mistyped second path would leave `constants.ts`'s 396 clearing a union
    // floor of 396 with the whole facility pack parsed as nothing — the exact
    // shape of blindness this block exists to catch, arriving in the commit
    // that made two sources possible.
    for (const rel of POINT_KEY_SOURCE_RELS) {
      // The floor must be DECLARED, not defaulted: a third source added
      // without an entry would fall back to one code and pass for free.
      const floor = POINT_KEY_SOURCE_FLOOR[rel];
      expect(
        floor,
        `${rel} has no POINT_KEY_SOURCE_FLOOR entry, so its anti-vacuity floor is ` +
          "whatever the fallback happens to be. Declare the number of codes that " +
          "file holds.",
      ).toBeGreaterThan(0);
      expect(
        vocabularyBySource.get(rel)?.size ?? 0,
        `${rel} yielded fewer point-key codes than it declares — the scan of that ` +
          "file is blind, and the check below would pass on the other source's codes " +
          "alone. Fix the path or the array declaration; do not lower this floor.",
      ).toBeGreaterThanOrEqual(floor ?? 1);
    }
    // 602 since E5.3 PR 2: 500 + VERTICAL_TRANSPORT_CLASS_POINT_KEYS's 102, disjoint by
    // construction.
    expect(vocabulary.size, `no *_POINT_KEYS array parsed out of ${POINT_KEY_SOURCE_LABEL}`).toBeGreaterThanOrEqual(602);
  });

  it("every catalog pointKey is a code a *_POINT_KEYS array holds", () => {
    const unknown = [...new Set(pointKeys.filter((key) => !vocabulary.has(key)))].sort();
    expect(
      unknown,
      `${STOCK_LABEL} names a pointKey that exists in no *_POINT_KEYS array. 0058's foreign key ` +
        "refuses a template_points row whose key the platform lacks, and assertPointKeysActive " +
        "refuses the import before the insert — this fails it before either, at build time. Promote " +
        "the key into the pack's *_POINT_KEYS array first (ADR 0051 Amendment 6's shape), or spell " +
        `it the way ${POINT_KEY_SOURCE_LABEL} spells it.`,
    ).toEqual([]);
  });
});
