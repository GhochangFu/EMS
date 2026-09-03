import { readRepoFile } from "../../../testing/repo-root";
import {
  alarmsOf,
  assert,
  DEFERRED_DERIVED_CODES,
  deferralReason,
  maintenanceOf,
  requireStockEntry,
  type Alarm,
} from "./stock-catalog.spec";
import type { StockAssetTemplateEntry } from "./types";

/**
 * `E5.1` pass C — one block per water plant class, each assertion a claim about
 * `docs/e5.1-derived-taglist-v1.md` rather than about the code. If the tag list
 * changes, these change with it, in the same PR.
 *
 * **Three sibling files rather than more of `stock-catalog.spec.ts`**, which is
 * at 978 lines against the §4.5 1000-line cap. The cut is `F2.12`'s and it is
 * by *kind*: `stock-catalog.spec.ts` holds the mechanism's claims —
 * `checkEntry`, run over every catalog entry and over the inline fixtures — and
 * these files hold the transcription claims, one block per tag-list section.
 * **Two entries per file, because two proved to be the cap**: the STP block
 * alone is ~150 lines on top of this file's shared half, and the plan's
 * original three-plus-three split projected past 1000 by Task 6. This file
 * carries §5 (STP) and §6 (ETP); `water-classes-2.spec.ts` carries §4 (cooling
 * tower) and §1 (WTP); `water-classes-3.spec.ts` carries §2 (RO) and §3
 * (softener). **The shared half below is exported and imported by both**, the
 * shape `electrical-classes-2.spec.ts` already uses against
 * `stock-catalog.spec.ts` — and not a plain helper module, because a bare `.ts`
 * in this directory would need a `STOCK_ASSET_RELS` entry in
 * `tests/f2.13-asset-stock-catalog-vocabulary.test.ts` (moving that count off
 * 16) while a helpers-only `.spec.ts` would need a wrapper that runs nothing.
 *
 * **The generic claims are deliberately NOT restated here.** Pair-absence, the
 * alarm binding, the severity and category vocabularies parsed out of `0030`
 * and `0029`, the `meta.tier` iff rule, derived-point well-formedness, the KPI
 * cross-checks, the three maintenance vocabularies and key-set equality with
 * the DTO projection all run over every entry from `checkEntry` the moment a
 * class joins the pack index. What is here is only what the tag list asserts
 * and no schema can.
 *
 * **The claim this file adds that `checkEntry` deliberately does not make** is
 * the populated `philosophy` (plan §2): the six shipped electrical entries
 * carry none, so a catalog-wide assertion would fail six correct entries. It is
 * the water pack's property, so it is asserted per water entry.
 */

// ===========================================================================
// The shared half — exported for `water-classes-2.spec.ts` and `-3`.
// ===========================================================================

/**
 * The five `bms.alarm_skills` codes migration `0034` seeds, parsed from the
 * migration text and never retyped — the discipline `stock-catalog.spec.ts`
 * holds for `0029`'s categories and `0030`'s severities.
 *
 * A local copy of that parser rather than an import, because `seededCodes` is
 * private to that file and this one reads a different table in a different
 * migration. `assertTemplateAlarmVocabularies` closes `philosophy.skill`
 * against the live table at import time; parsing the migration means a skill
 * nobody seeds fails here first, at build time, instead of as a 400 on a
 * client's import.
 *
 * **Throwing on no match is load-bearing**, exactly as it is there: an empty
 * set would make every membership check below vacuously true the moment the
 * insert is reshaped, and the check would become a decoration.
 */
function seededSkills(): ReadonlySet<string> {
  const migration = readRepoFile("packages/db/drizzle/0034_alarm_enrichment.sql");
  const startNeedle = "INSERT INTO bms.alarm_skills (";
  const start = migration.indexOf(startNeedle);
  if (start < 0) {
    throw new Error("no INSERT INTO bms.alarm_skills found in 0034 — fix this parser, do not delete it");
  }
  const end = migration.indexOf("ON CONFLICT", start);
  if (end < 0) {
    throw new Error("unterminated INSERT INTO bms.alarm_skills — expected a trailing ON CONFLICT");
  }
  const codes = [...migration.slice(start, end).matchAll(/\(\s*'([a-z0-9_-]+)'/g)].map(
    (m) => m[1] as string,
  );
  if (codes.length === 0) {
    throw new Error("parsed zero codes out of the bms.alarm_skills insert — the parser is broken");
  }
  return new Set(codes);
}

/** Memoized: six blocks across three files check the same five codes. */
let skillMemo: ReadonlySet<string> | undefined;
export const skillVocabulary = (): ReadonlySet<string> => (skillMemo ??= seededSkills());

/** ADR 0019 §3's philosophy object, as stored — `Alarm` is a bare record. */
type Philosophy = Readonly<Record<string, unknown>>;

export const philosophyOf = (alarm: Alarm): Philosophy | undefined => {
  const philosophy = (alarm as { philosophy?: unknown }).philosophy;
  return typeof philosophy === "object" && philosophy !== null
    ? (philosophy as Philosophy)
    : undefined;
};

/** A non-empty string, which is what `cause`, `impact` and `action` must be. */
export const populated = (value: unknown): boolean =>
  typeof value === "string" && value.trim().length > 0;

/**
 * One row of a point transcription table — `[pointKey, tier, unit]`, in the
 * document's own row order, with `"derived"` for an authored formula and `null`
 * for a unit the vocabulary spells `""`.
 */
export type PointRow = readonly [pointKey: string, tier: string, unit: string | null];

/** One row of an alarm transcription table — `[code, pointKey, severity, category]`. */
export type AlarmRow = readonly [
  code: string,
  pointKey: string,
  severity: string,
  category: string,
];

/**
 * The whole point table, row for row, against the tag-list section it was
 * transcribed from.
 *
 * **`unit` is in the triple because nothing else in the repository checks it.**
 * `checkEntry` never reads a unit; `tests/f2.13`'s scan reads point *keys*
 * against the vocabulary and not their units. A template `unit` is an
 * **override**, so a wrong one here silently overrides the catalog's own unit
 * on every point of every asset the template instantiates, on every
 * organization that imports it — and `UNIT_BY_KEY`'s seed is
 * `COALESCE(existing, excluded)`, so the catalog value it is overriding cannot
 * be corrected afterwards either. `µS/cm` is U+00B5 MICRO SIGN and not U+03BC
 * GREEK SMALL LETTER MU; the two render identically and are different strings,
 * and this comparison is the only thing that tells them apart.
 *
 * `tier` and `sortOrder` travel in the same assertion so that one failure names
 * the row rather than sending a reader through three separate loops.
 */
export function assertPointTable(
  code: string,
  section: string,
  entry: StockAssetTemplateEntry,
  table: readonly PointRow[],
): void {
  assert(
    entry.points.length === table.length,
    `${code} declares ${entry.points.length} points; ${section} transcribes ${table.length}`,
  );
  const show = (row: PointRow): string => `${row[0]} | ${row[1]} | ${row[2] ?? "null"}`;
  entry.points.forEach((point, index) => {
    const tier = point.kind === "derived" ? "derived" : String(point.meta?.tier);
    const actual: PointRow = [point.pointKey, tier, point.unit ?? null];
    const expected = table[index];
    assert(
      expected !== undefined && show(actual) === show(expected),
      `${code} point at sortOrder ${index} disagrees with ${section}:\n  expected ` +
        `${expected === undefined ? "(no such row)" : show(expected)}\n  got      ${show(actual)}\n` +
        "The triple is pointKey | tier | unit. A wrong unit is the one of the three that no other " +
        "check in this repository would catch: a template unit OVERRIDES the catalog's on every " +
        "instantiated point, and the catalog's own value is seeded write-once, so the override " +
        "ships to every organization that imports this entry and cannot be corrected by a later " +
        "seed. Transcribe it from the tag list, not from memory.",
    );
    assert(
      point.sortOrder === index,
      `${code} points must be in ${section}'s own order — ${point.pointKey} has sortOrder ` +
        `${point.sortOrder} at index ${index}`,
    );
  });
}

/** The whole alarm table, row for row — `[code, pointKey, severity, category]`. */
export function assertAlarmTable(
  code: string,
  section: string,
  alarms: readonly Alarm[],
  table: readonly AlarmRow[],
): void {
  assert(
    alarms.length === table.length,
    `${code} carries ${alarms.length} alarms; ${section} transcribes ${table.length}`,
  );
  const show = (row: AlarmRow): string => row.join(" | ");
  alarms.forEach((alarm, index) => {
    const actual: AlarmRow = [alarm.code, alarm.pointKey, alarm.severity, String(alarm.category)];
    const expected = table[index];
    assert(
      expected !== undefined && show(actual) === show(expected),
      `${code} alarm at index ${index} disagrees with ${section}:\n  expected ` +
        `${expected === undefined ? "(no such row)" : show(expected)}\n  got      ${show(actual)}\n` +
        "The quad is code | pointKey | severity | category. checkEntry proves the severity and " +
        "the category are seeded vocabulary and that the point is declared; only this table says " +
        "they are the RIGHT ones — a critical row filed as info is a row nobody is paged for.",
    );
  });
}

/**
 * One authored derived point — `[pointKey, formula, maxInputAgeSeconds]`.
 */
export type DerivedRow = readonly [
  pointKey: string,
  formula: string,
  maxInputAgeSeconds: number | null,
];

/**
 * The authored formulas, **as literal strings**, and the one
 * `maxInputAgeSeconds` override in the row.
 *
 * `checkEntry` already proves each formula parses under `bms-calc-v1` and
 * references only measured points the same entry declares, that the dialect is
 * right, that the trigger is `streaming` with a null interval, and that a
 * derived point carries no `meta.tier`. What it cannot say is that the formula
 * is the RIGHT one: `{return_temp_c} - {supply_temp_c}` and
 * `{supply_temp_c} - {return_temp_c}` are both valid and one of them is range
 * and the other is its negative. So the string is asserted literally — a
 * "simplification" of a shipped formula is a silent behaviour change on every
 * organization that imported it, not a refactor.
 */
export function assertDerivedPoints(
  code: string,
  entry: StockAssetTemplateEntry,
  table: readonly DerivedRow[],
): void {
  const derivedPoints = entry.points.filter((point) => point.kind === "derived");
  assert(
    derivedPoints.length === table.length,
    `${code} authors ${derivedPoints.length} derived points; the plan authors ${table.length}: ` +
      `${table.map((row) => row[0]).join(", ")}`,
  );
  for (const [pointKey, formula, maxInputAgeSeconds] of table) {
    const point = derivedPoints.find((row) => row.pointKey === pointKey);
    assert(point !== undefined, `${code} must author the derived point ${pointKey}`);
    assert(
      point?.formula === formula,
      `${code}.${pointKey}'s formula must be exactly "${formula}" — got ` +
        `"${String(point?.formula)}". Two valid formulas over the same inputs can mean opposite ` +
        "things, so the string is asserted literally rather than parsed: a rewrite of a shipped " +
        "formula is a silent behaviour change on every organization that imported the entry.",
    );
    assert(
      point?.maxInputAgeSeconds === maxInputAgeSeconds,
      `${code}.${pointKey} must carry maxInputAgeSeconds ${String(maxInputAgeSeconds)}, got ` +
        `${String(point?.maxInputAgeSeconds)}. The default is 300 s and it is right for an input ` +
        "that arrives from the same controller at the same scan rate; an override says the input " +
        "is a slow site sensor, and at the default the formula silently never fires, which reads " +
        'as "the feature is broken" and is the harder failure to diagnose.',
    );
    assert(
      point?.required === false,
      `${code}.${pointKey} must be required: false — a computed point is fitted by nobody, so it ` +
        `can never be a site's required mapping; got ${String(point?.required)}`,
    );
  }
}

/**
 * Every alarm of a water entry carries a populated `philosophy` (ADR 0040
 * decision 4 — the first stock content anywhere to do so), and every `skill`
 * present is one of `0034`'s five seeded trades.
 */
export function assertPhilosophyRows(code: string, alarms: readonly Alarm[]): void {
  const skills = skillVocabulary();
  for (const alarm of alarms) {
    const philosophy = philosophyOf(alarm);
    assert(
      philosophy !== undefined,
      `${code} alarm "${alarm.code}" carries no philosophy object. ADR 0040 decision 4 requires ` +
        "one on every row of this pack: the threshold pair is deliberately absent (B7), so cause, " +
        "impact and action are all the meaning an operator gets. The six electrical entries " +
        "predate the decision and carry none, which is why checkEntry cannot make this claim " +
        "catalog-wide and this file makes it per water entry.",
    );
    for (const field of ["cause", "impact", "action"] as const) {
      assert(
        populated(philosophy?.[field]),
        `${code} alarm "${alarm.code}" has an empty or missing philosophy.${field} — an ISA-18.2 ` +
          "rationalization record with a blank field is a field the operator reads as an omission",
      );
    }
    const skill = philosophy?.skill;
    if (skill !== undefined) {
      assert(
        typeof skill === "string" && skills.has(skill),
        `${code} alarm "${alarm.code}" has philosophy.skill "${String(skill)}", which migration ` +
          `0034 does not seed into bms.alarm_skills (${[...skills].join(", ")}). ` +
          "assertTemplateAlarmVocabularies closes the set at import time, so an unseeded code is " +
          "a 400 on a client's import; it fails here instead.",
      );
    }
  }
}

/**
 * Which rows carry a `skill` and which deliberately carry none (plan §12 ruling
 * 6). Both halves matter: an omission asserted only by its absence from a map
 * is an omission nobody notices being filled in.
 */
export function assertSkillAssignment(
  code: string,
  alarms: readonly Alarm[],
  assigned: Readonly<Record<string, string>>,
  processRows: readonly string[],
): void {
  const skillOf = (alarmCode: string): unknown =>
    philosophyOf(alarms.find((alarm) => alarm.code === alarmCode) ?? ({} as Alarm))?.skill;
  for (const [alarmCode, skill] of Object.entries(assigned)) {
    assert(
      skillOf(alarmCode) === skill,
      `${code} alarm "${alarmCode}" must carry philosophy.skill "${skill}" — plan §12 ruling 6 ` +
        "sets one only where one of 0034's five trades genuinely answers: mechanical for a pump, " +
        "blower, fan or press, electrical for a motor, controls for an analyser or dosing " +
        `controller, civil for a tank, bund or pond. Got ${String(skillOf(alarmCode))}.`,
    );
  }
  for (const alarmCode of processRows) {
    assert(
      skillOf(alarmCode) === undefined,
      `${code} alarm "${alarmCode}" carries philosophy.skill ${String(skillOf(alarmCode))}, and ` +
        "it must carry none. It is a process-chemistry row: bms.alarm_skills holds electrical, " +
        "mechanical, hvac, controls and civil, and NO process trade, so plan §12 ruling 6 omits " +
        "the field rather than routing a chemistry excursion to the wrong trade. A process skill " +
        "is a separate backlog row with its own migration; when it lands, these rows gain a " +
        "skill in a stockVersion 2.",
    );
  }
}

/**
 * A discharge-consent row carries its CPCB Schedule VI **meaning** and never a
 * limit value (ADR 0040 decision 4) — in the message *and* inside every
 * `philosophy` string, which is the half `checkEntry`'s pair-absence check
 * cannot see.
 */
export function assertNoConsentNumbers(
  code: string,
  alarms: readonly Alarm[],
  consentRows: readonly string[],
): void {
  for (const alarmCode of consentRows) {
    const alarm = alarms.find((row) => row.code === alarmCode);
    assert(alarm !== undefined, `${code} declares no alarm "${alarmCode}"`);
    const strings = [
      String(alarm?.message ?? ""),
      ...Object.values(philosophyOf(alarm ?? ({} as Alarm)) ?? {}).map((value) => String(value)),
    ];
    for (const text of strings) {
      assert(
        !/\d/.test(text),
        `${code} alarm "${alarmCode}" carries a digit in "${text}". This is a CPCB Schedule VI ` +
          "discharge-consent parameter: the consent value is per site and per consent and is set " +
          "at commissioning (ADR 0040 decision 4), so the row carries the MEANING and never a " +
          "limit — not in the message and not inside the philosophy either. A number shipped to " +
          "every organization unread is a number somebody will believe.",
      );
    }
  }
}

/** The two schema bounds, per plan §5.7 — never rounded into range. */
export function assertMaintenanceBounds(code: string, entry: StockAssetTemplateEntry): void {
  for (const plan of maintenanceOf(entry)) {
    assert(
      typeof plan.intervalDays === "number" && plan.intervalDays >= 1 && plan.intervalDays <= 730,
      `${code} maintenance "${plan.title}" has intervalDays ${String(plan.intervalDays)} — ` +
        "templateMaintenancePlanSchema caps it at 730, so a longer task cannot be authored here " +
        "at all and must not be rounded into range",
    );
    assert(
      typeof plan.estimatedMinutes === "number" &&
        plan.estimatedMinutes >= 5 &&
        plan.estimatedMinutes <= 1440,
      `${code} maintenance "${plan.title}" has estimatedMinutes ${String(plan.estimatedMinutes)}` +
        " — the schema's bound is 5..1440",
    );
  }
}

/** `content.kpis` is ABSENT, not empty — plan §5.0, and §9.5 step 7 checks it. */
export function assertNoKpis(code: string, entry: StockAssetTemplateEntry, section: string): void {
  const content = (entry.content ?? {}) as Record<string, unknown>;
  assert(
    !("kpis" in content),
    `${code} carries a content.kpis key, and the water pack authors NONE — plan §5.0. This is a ` +
      `structural consequence of the tag list and not a deferral of effort: every ratio ${section} ` +
      "names AND bms-calc-v1 can express is a NAMED derived code, so it becomes a point (an alarm " +
      "can then bind it); every ratio it names that the grammar cannot express is deferred. The " +
      "key must be ABSENT and not an empty array — §9.5 step 7 checks the imported draft for no " +
      "kpis key.",
  );
}

/** This entry's own deferred derived codes, none of them a declared point key. */
export function assertDeferralsAbsent(
  code: keyof typeof DEFERRED_DERIVED_CODES,
  entry: StockAssetTemplateEntry,
): void {
  const keys = new Set(entry.points.map((point) => point.pointKey));
  for (const deferred of DEFERRED_DERIVED_CODES[code]) {
    assert(
      !keys.has(deferred),
      `${code} declares "${deferred}", one of its deferred derived codes. ${deferralReason(code)}`,
    );
  }
}

/** The stamp plus the citation is the provenance — ADR 0052 decision 6. */
export function assertProvenance(
  code: string,
  entry: StockAssetTemplateEntry,
  section: string,
): void {
  const description = entry.description ?? "";
  for (const needle of ["e5.1-derived-taglist-v1.md", section, "PROVISIONAL"]) {
    assert(
      description.includes(needle),
      `${code}.description must contain "${needle}" — the stamp plus the citation is the ` +
        "provenance (ADR 0052 decision 6), the section is what makes the citation checkable, and " +
        "PROVISIONAL is the tag list's own status: this content is derived from published " +
        `practice and the client's reference dashboards, not client-confirmed. Got: "${description}"`,
    );
  }
}

/** The header three claims every entry makes about itself. */
export function assertEntryIdentity(
  code: string,
  entry: StockAssetTemplateEntry,
  assetType: string,
): void {
  assert(
    entry.assetType === assetType,
    `${code}.assetType must be "${assetType}" (plan §12 ruling 4) — got "${entry.assetType}"`,
  );
  assert(
    entry.domain === "water",
    `${code}.domain must be "water" — assertAssetDomain checks it against bms.asset_domains at ` +
      `import time, and 0029 seeds the code; got "${entry.domain}"`,
  );
  assert(
    entry.stockVersion === 1,
    `${code} is a first release — stockVersion 1, got ${String(entry.stockVersion)}`,
  );
}

/** The count of points at one tier, `"derived"` included. */
export function tierCount(entry: StockAssetTemplateEntry, tier: string): number {
  return tier === "derived"
    ? entry.points.filter((point) => point.kind === "derived").length
    : entry.points.filter((point) => point.meta?.tier === tier).length;
}

/**
 * **The dual-tier claim, asserted from BOTH blocks** — `effluent_cod_mgl` is
 * `manual` on the STP (§5 spells it `M/X`) and `extended` on the ETP (§6 spells
 * it `X/M`), first-listed tier wins, both `required: false`.
 *
 * Called from each entry's block rather than once, because a single-entry
 * assertion would not show that the disagreement is deliberate: it is the only
 * place in the pack where one vocabulary code legitimately carries two tiers,
 * and `meta.tier` says what *that plant type* typically fits, not what the code
 * is. A sewage plant sends COD to a laboratory; an effluent plant with a
 * regulated discharge more often fits an online analyser.
 */
export function assertCodDualTier(): void {
  for (const [code, tier] of [
    ["water-stp", "manual"],
    ["water-etp", "extended"],
  ] as const) {
    const point = requireStockEntry(code).points.find(
      (row) => row.pointKey === "effluent_cod_mgl",
    );
    assert(
      point?.meta?.tier === tier,
      `${code} must file effluent_cod_mgl as meta.tier "${tier}". §5 spells its tier "M/X" and §6 ` +
        `spells the same code "X/M"; the first-listed tier wins (plan §5), so the STP files it ` +
        `manual and the ETP files it extended. Got "${String(point?.meta?.tier)}".`,
    );
    assert(
      point?.required === false,
      `${code}.effluent_cod_mgl must be required: false — both halves of the dual tier are ` +
        `optional, so only meta.tier differs between the two entries; got ${String(point?.required)}`,
    );
  }
}

// ===========================================================================
// §5 — `water-stp`
// ===========================================================================

const STP_CODE = "water-stp";

/**
 * §5's 18 table rows in the **document's own order**, which is the order
 * `sortOrder` follows — `[pointKey, tier, unit]`. Plan §5.1 lists the same 18
 * grouped by tier; the document is the authority on order.
 */
const STP_POINTS: readonly PointRow[] = [
  ["influent_flow_klh", "core", "KL/hr"],
  ["effluent_flow_klh", "core", "KL/hr"],
  ["aeration_do_mgl", "core", "mg/L"],
  ["mlss_mgl", "core", "mg/L"],
  ["effluent_turbidity_ntu", "core", "NTU"],
  ["effluent_tss_mgl", "extended", "mg/L"],
  ["effluent_ph", "core", "pH"],
  ["effluent_cl2_residual_mgl", "core", "mg/L"],
  ["effluent_bod_mgl", "manual", "mg/L"],
  ["effluent_cod_mgl", "manual", "mg/L"],
  ["blower_status", "core", null],
  ["blower_current_a", "core", "A"],
  ["ras_flow_klh", "extended", "KL/hr"],
  ["clarifier_sludge_level_pct", "extended", "%"],
  ["eq_tank_level_pct", "core", "%"],
  ["treated_tank_level_pct", "core", "%"],
  ["mbr_tmp_bar", "extended", "bar"],
  ["uv_status", "extended", null],
];

/**
 * §5's seven alarm bullets become **nine** rows: DO splits into low and high
 * (two meanings, two responses — the document writes them as one bullet with a
 * slash), and *"effluent turbidity/TSS high"* splits into two because the entry
 * declares two points.
 */
const STP_ALARMS: readonly AlarmRow[] = [
  ["do_low", "aeration_do_mgl", "critical", "operations"],
  ["do_high", "aeration_do_mgl", "info", "energy"],
  ["mlss_out_of_band", "mlss_mgl", "warning", "operations"],
  ["effluent_turbidity_high", "effluent_turbidity_ntu", "warning", "operations"],
  ["effluent_tss_high", "effluent_tss_mgl", "critical", "safety"],
  ["chlorine_residual_low", "effluent_cl2_residual_mgl", "critical", "safety"],
  ["blower_trip", "blower_status", "critical", "operations"],
  ["mbr_tmp_high", "mbr_tmp_bar", "warning", "operations"],
  ["eq_tank_high", "eq_tank_level_pct", "critical", "safety"],
];

/**
 * `water-stp` against `docs/e5.1-derived-taglist-v1.md` §5 (plan §5.1). The
 * first water entry authored, and plan §3's first escalation checkpoint keys on
 * it: what it proves is the six-module split, the pack index, the prefix map,
 * the alarm-philosophy shape and the `M/X` dual-tier rule.
 */
function checkStp(): void {
  const entry = requireStockEntry(STP_CODE);
  assertEntryIdentity(STP_CODE, entry, "stp");

  // ---- 18 points, 11 core + 5 extended + 2 manual + 0 derived -------------

  assert(
    tierCount(entry, "core") === 11 &&
      tierCount(entry, "extended") === 5 &&
      tierCount(entry, "manual") === 2 &&
      tierCount(entry, "derived") === 0,
    `§5 marks 11 rows C, 5 X, 1 M and 1 M/X (manual, first-listed wins), and this class authors ` +
      `no derived code — 11/5/2/0. Got ${tierCount(entry, "core")}/${tierCount(entry, "extended")}` +
      `/${tierCount(entry, "manual")}/${tierCount(entry, "derived")}`,
  );
  assertPointTable(STP_CODE, "§5", entry, STP_POINTS);
  assertCodDualTier();

  assert(
    tierCount(entry, "derived") === 0,
    "§5's four derived codes are ALL deferred (plan §5.0) and plan §12 ruling 7 refuses " +
      "recovery_pct here — the STP's own derived quantity is reuse, and hydraulic recovery shown " +
      "where an operator expects reuse is the silent-wrong failure",
  );
  assertNoKpis(STP_CODE, entry, "§5");
  assertDeferralsAbsent(STP_CODE, entry);

  // ---- 9 alarms, every one a populated philosophy row --------------------

  const alarms = alarmsOf(entry);
  assertAlarmTable(STP_CODE, "§5", alarms, STP_ALARMS);
  assertPhilosophyRows(STP_CODE, alarms);
  assertSkillAssignment(
    STP_CODE,
    alarms,
    {
      do_high: "controls",
      chlorine_residual_low: "controls",
      blower_trip: "mechanical",
      mbr_tmp_high: "mechanical",
      eq_tank_high: "civil",
    },
    ["do_low", "mlss_out_of_band", "effluent_turbidity_high", "effluent_tss_high"],
  );
  assertNoConsentNumbers(STP_CODE, alarms, ["effluent_tss_high"]);

  // ---- 4 maintenance plans, none of them safety-critical -----------------

  const plans = maintenanceOf(entry);
  assert(plans.length === 4, `plan §5.7 authors 4 STP maintenance plans; the entry carries ${plans.length}`);
  const safetyCritical = plans.filter((plan) => plan.safetyCritical === true);
  assert(
    safetyCritical.length === 0,
    `no STP plan is safetyCritical — the pack's three are the ETP guard pond, the cooling tower ` +
      `Legionella program and the WTP chlorine dosing service (plan §5.7), and none is here. Got ` +
      `${safetyCritical.length}: ${safetyCritical.map((plan) => plan.title).join("; ")}`,
  );

  const mbr = plans.find((plan) => plan.category === "condition_based");
  assert(
    mbr !== undefined && mbr.generationMode === "condition",
    `${STP_CODE} must carry exactly one condition_based plan generated in "condition" mode — the ` +
      "MBR clean-in-place, which is due when trans-membrane pressure rises and not on a date " +
      "(plan §5.7). Asserting the pair and not just the category is deliberate: a category with a " +
      `calendar generationMode is a condition plan in name only. Got category ` +
      `${String(mbr?.category)} / generationMode ${String(mbr?.generationMode)}.`,
  );
  assert(
    typeof mbr?.triggerSummary === "string" && mbr.triggerSummary.includes("mbr_tmp_bar"),
    `${STP_CODE}'s condition_based plan must name mbr_tmp_bar in its triggerSummary — the point ` +
      "the mbr_tmp_high alarm binds is the condition the plan is scheduled on, and nothing else " +
      "in the entry records which point that is",
  );
  assertMaintenanceBounds(STP_CODE, entry);
  assertProvenance(STP_CODE, entry, "§5");
}

// ===========================================================================
// §6 — `water-etp`
// ===========================================================================

const ETP_CODE = "water-etp";

/**
 * §6's 17 table rows in the document's own order — `[pointKey, tier, unit]`.
 * Five carry a `◆` in the document, meaning *read directly from the client's
 * own reference dashboards*: `neutralization_ph`, `bio_mlss_mgl`,
 * `settling_tss_mgl`, `clarifier_turbidity_ntu` and `discharge_flow_klh`. That
 * makes §6 the least provisional section in the pack, and those five the rows a
 * redline is least likely to move.
 */
const ETP_POINTS: readonly PointRow[] = [
  ["influent_flow_klh", "core", "KL/hr"],
  ["neutralization_ph", "core", "pH"],
  ["dosing_acid_lph", "extended", "L/hr"],
  ["dosing_alkali_lph", "extended", "L/hr"],
  ["bio_mlss_mgl", "core", "mg/L"],
  ["bio_do_mgl", "core", "mg/L"],
  ["settling_tss_mgl", "extended", "mg/L"],
  ["clarifier_turbidity_ntu", "extended", "NTU"],
  ["discharge_flow_klh", "core", "KL/hr"],
  ["discharge_ph", "core", "pH"],
  ["effluent_cod_mgl", "extended", "mg/L"],
  ["effluent_bod_mgl", "manual", "mg/L"],
  ["oil_grease_mgl", "manual", "mg/L"],
  ["sludge_holding_level_pct", "extended", "%"],
  ["filter_press_status", "extended", null],
  ["transfer_pump_status", "core", null],
  ["guard_pond_level_pct", "extended", "%"],
];

/**
 * §6's six alarm bullets become **eight** rows: *"COD/TSS high"* splits into
 * two because the entry declares two points, and *"dosing tank empty"* splits
 * into acid and alkali — two declared dosing lines, two reagents, two refills,
 * the same split `F2.12` made for *"cooling fan/pump failure"*.
 */
const ETP_ALARMS: readonly AlarmRow[] = [
  ["discharge_ph_out_of_consent", "discharge_ph", "critical", "safety"],
  ["discharge_cod_high", "effluent_cod_mgl", "critical", "safety"],
  ["settling_tss_high", "settling_tss_mgl", "warning", "operations"],
  ["bio_do_low", "bio_do_mgl", "critical", "operations"],
  ["acid_dosing_lost", "dosing_acid_lph", "warning", "operations"],
  ["alkali_dosing_lost", "dosing_alkali_lph", "warning", "operations"],
  ["guard_pond_high", "guard_pond_level_pct", "critical", "safety"],
  ["filter_press_fault", "filter_press_status", "warning", "operations"],
];

/**
 * `water-etp` against `docs/e5.1-derived-taglist-v1.md` §6 (plan §5.2) — the
 * entry with the regulatory alarms and the `X/M` dual-tier row, and zero
 * derived points, which is the opposite shape to the cooling tower's.
 */
function checkEtp(): void {
  const entry = requireStockEntry(ETP_CODE);
  assertEntryIdentity(ETP_CODE, entry, "etp");

  // ---- 17 points, 7 core + 8 extended + 2 manual + 0 derived --------------

  assert(
    tierCount(entry, "core") === 7 &&
      tierCount(entry, "extended") === 8 &&
      tierCount(entry, "manual") === 2 &&
      tierCount(entry, "derived") === 0,
    `§6 marks 7 rows C, 7 X and 1 X/M (extended, first-listed wins) and 2 M, and all four of its ` +
      `derived codes are deferred — 7/8/2/0. Got ${tierCount(entry, "core")}/` +
      `${tierCount(entry, "extended")}/${tierCount(entry, "manual")}/${tierCount(entry, "derived")}`,
  );
  assertPointTable(ETP_CODE, "§6", entry, ETP_POINTS);
  assertCodDualTier();
  assertNoKpis(ETP_CODE, entry, "§6");
  assertDeferralsAbsent(ETP_CODE, entry);

  // ---- the row §6's own alarm bullet asks for and does not declare --------

  const keys = new Set(entry.points.map((point) => point.pointKey));
  assert(
    !keys.has("dosing_tank_level_pct"),
    `${ETP_CODE} declares dosing_tank_level_pct, and it must not. §6's "dosing tank empty" bullet ` +
      "has no level point to bind: the table declares dosing RATES and no reagent tank level at " +
      "all. The acid_dosing_lost and alkali_dosing_lost rows bind the rates and say what a " +
      "collapse means, which is the honest encoding. A dosing tank level is a v2 REDLINE " +
      "CANDIDATE for the tag list, whose own instruction to the client is \"add what is missing\" " +
      "— it is not a key to invent here, because a point key is seeded into bms.point_keys, " +
      "foreign-keyed by 0058 and permanent, while a redline is free.",
  );

  // ---- 8 alarms, every one a populated philosophy row ---------------------

  const alarms = alarmsOf(entry);
  assertAlarmTable(ETP_CODE, "§6", alarms, ETP_ALARMS);
  assertPhilosophyRows(ETP_CODE, alarms);
  assertSkillAssignment(
    ETP_CODE,
    alarms,
    {
      acid_dosing_lost: "controls",
      alkali_dosing_lost: "controls",
      guard_pond_high: "civil",
      filter_press_fault: "mechanical",
    },
    ["discharge_ph_out_of_consent", "discharge_cod_high", "settling_tss_high", "bio_do_low"],
  );
  assertNoConsentNumbers(ETP_CODE, alarms, ["discharge_ph_out_of_consent", "discharge_cod_high"]);

  // ---- 4 maintenance plans, the guard pond the only critical one ----------

  const plans = maintenanceOf(entry);
  assert(plans.length === 4, `plan §5.7 authors 4 ETP maintenance plans; the entry carries ${plans.length}`);
  const safetyCritical = plans.filter((plan) => plan.safetyCritical === true);
  assert(
    safetyCritical.length === 1,
    `exactly one §6 plan is safetyCritical — the guard pond and bund inspection; got ` +
      `${safetyCritical.length}: ${safetyCritical.map((plan) => plan.title).join("; ") || "(none)"}`,
  );
  const pond = safetyCritical[0];
  assert(
    typeof pond?.title === "string" && pond.title.includes("Guard pond"),
    "the one safetyCritical ETP plan must be the guard pond and bund inspection — the pond is the " +
      "last containment before an unconsented discharge, and a bund breach IS the unconsented " +
      `discharge. Got: "${String(pond?.title)}"`,
  );
  assert(
    pond?.category === "safety_critical",
    `the guard pond plan must be category "safety_critical"; got "${String(pond?.category)}"`,
  );
  assertMaintenanceBounds(ETP_CODE, entry);
  assertProvenance(ETP_CODE, entry, "§6");
}

/**
 * Every per-class block in this file. Called by `water-classes.test.ts`, its
 * **name-sibling** wrapper — `tests/repo-invariants.test.ts` matches the pair
 * by name, and a spec imported from a differently-named wrapper still runs but
 * is absent from coverage, which is the half the import cannot fix.
 */
export function runWaterClassEntryTests(): void {
  checkStp();
  checkEtp();
}
