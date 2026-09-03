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

/**
 * `E5.1` pass C — one block per water plant class, each assertion a claim about
 * `docs/e5.1-derived-taglist-v1.md` rather than about the code. If the tag list
 * changes, these change with it, in the same PR.
 *
 * **A sibling file rather than more of `stock-catalog.spec.ts`**, which is at
 * 978 lines against the §4.5 1000-line cap. The cut is `F2.12`'s and it is by
 * *kind*: `stock-catalog.spec.ts` holds the mechanism's claims — `checkEntry`,
 * run over every catalog entry and over the inline fixtures — and this file
 * holds the transcription claims, one block per tag-list section. This file
 * carries §§5, 6 and 4 (STP, ETP, cooling tower); `water-classes-2.spec.ts`
 * carries §§1, 2 and 3 (WTP, RO, softener), for the same line-cap reason.
 *
 * **The generic claims are deliberately NOT restated here.** Pair-absence, the
 * alarm binding, the severity and category vocabularies parsed out of `0030`
 * and `0029`, the `meta.tier` iff rule, derived-point well-formedness, the KPI
 * cross-checks, the three maintenance vocabularies and key-set equality with
 * the DTO projection all run over every entry from `checkEntry` the moment a
 * class joins the pack index. What is here is only what the tag list asserts
 * and no schema can: the counts, the table order, the rows a class does **not**
 * declare, the `philosophy` object ADR 0040 decision 4 requires, and the
 * specific bindings the plan reasoned about.
 *
 * **The one claim this file adds that `checkEntry` deliberately does not make**
 * is the populated `philosophy` (plan §2): the six shipped electrical entries
 * carry none, so a catalog-wide assertion would fail six correct entries. It is
 * the water pack's property, so it is asserted per water entry.
 */

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

/** Memoized: three blocks in this file check the same five codes. */
let skillMemo: ReadonlySet<string> | undefined;
const skillVocabulary = (): ReadonlySet<string> => (skillMemo ??= seededSkills());

/** ADR 0019 §3's philosophy object, as stored — `Alarm` is a bare record. */
type Philosophy = Readonly<Record<string, unknown>>;

const philosophyOf = (alarm: Alarm): Philosophy | undefined => {
  const philosophy = (alarm as { philosophy?: unknown }).philosophy;
  return typeof philosophy === "object" && philosophy !== null
    ? (philosophy as Philosophy)
    : undefined;
};

/** A non-empty string, which is what `cause`, `impact` and `action` must be. */
const populated = (value: unknown): boolean => typeof value === "string" && value.trim().length > 0;

/**
 * Every alarm of a water entry carries a populated `philosophy` (ADR 0040
 * decision 4 — the first stock content anywhere to do so), and every `skill`
 * present is one of `0034`'s five seeded trades.
 *
 * Shared by the three blocks in this file because it is the pack's property and
 * not one class's; the per-class blocks name which rows carry a skill and which
 * deliberately do not.
 */
function assertPhilosophyRows(code: string, alarms: readonly Alarm[]): void {
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

// ---------------------------------------------------------------------------
// §5 — `water-stp`
// ---------------------------------------------------------------------------

const STP_CODE = "water-stp";

/**
 * §5's 18 table rows in the **document's own order**, which is the order
 * `sortOrder` follows. Plan §5.1 lists the same 18 grouped by tier; the
 * document is the authority on order, and the plan says so.
 */
const STP_POINT_KEYS: readonly string[] = [
  "influent_flow_klh",
  "effluent_flow_klh",
  "aeration_do_mgl",
  "mlss_mgl",
  "effluent_turbidity_ntu",
  "effluent_tss_mgl",
  "effluent_ph",
  "effluent_cl2_residual_mgl",
  "effluent_bod_mgl",
  "effluent_cod_mgl",
  "blower_status",
  "blower_current_a",
  "ras_flow_klh",
  "clarifier_sludge_level_pct",
  "eq_tank_level_pct",
  "treated_tank_level_pct",
  "mbr_tmp_bar",
  "uv_status",
];

/**
 * §5's seven alarm bullets become **nine** rows: DO splits into low and high
 * (two meanings, two responses — the document writes them as one bullet with a
 * slash), and *"effluent turbidity/TSS high"* splits into two because the entry
 * declares two points.
 */
const STP_ALARM_CODES: readonly string[] = [
  "do_low",
  "do_high",
  "mlss_out_of_band",
  "effluent_turbidity_high",
  "effluent_tss_high",
  "chlorine_residual_low",
  "blower_trip",
  "mbr_tmp_high",
  "eq_tank_high",
];

/** Which point each alarm binds — §5.1's table, read across. */
const STP_ALARM_BINDINGS: Readonly<Record<string, string>> = {
  do_low: "aeration_do_mgl",
  do_high: "aeration_do_mgl",
  mlss_out_of_band: "mlss_mgl",
  effluent_turbidity_high: "effluent_turbidity_ntu",
  effluent_tss_high: "effluent_tss_mgl",
  chlorine_residual_low: "effluent_cl2_residual_mgl",
  blower_trip: "blower_status",
  mbr_tmp_high: "mbr_tmp_bar",
  eq_tank_high: "eq_tank_level_pct",
};

/**
 * The five rows where one of `0034`'s seeded trades genuinely answers (plan
 * §12 ruling 6). Every other STP row is process chemistry and carries **no**
 * `skill`: `bms.alarm_skills` has no `process` trade, and routing a DO or MLSS
 * excursion to Controls or Mechanical would send the wrong person.
 */
const STP_ALARM_SKILLS: Readonly<Record<string, string>> = {
  do_high: "controls",
  chlorine_residual_low: "controls",
  blower_trip: "mechanical",
  mbr_tmp_high: "mechanical",
  eq_tank_high: "civil",
};

/** The four rows §5.1 marks *(no skill — process)*. */
const STP_PROCESS_ALARMS: readonly string[] = [
  "do_low",
  "mlss_out_of_band",
  "effluent_turbidity_high",
  "effluent_tss_high",
];

/**
 * `water-stp` against `docs/e5.1-derived-taglist-v1.md` §5 (plan §5.1). The
 * first water entry authored, and the escalation checkpoint of plan §3 keys on
 * it: what it proves is the six-module split, the pack index, the prefix map,
 * the alarm-philosophy shape and the `M/X` dual-tier rule.
 */
function checkStp(): void {
  const entry = requireStockEntry(STP_CODE);

  assert(
    entry.assetType === "stp",
    `${STP_CODE}.assetType must be "stp" (plan §12 ruling 4) — got "${entry.assetType}"`,
  );
  assert(
    entry.domain === "water",
    `${STP_CODE}.domain must be "water" — assertAssetDomain checks it against bms.asset_domains ` +
      `at import time, and 0029 seeds the code; got "${entry.domain}"`,
  );
  assert(
    entry.stockVersion === 1,
    `${STP_CODE} is a first release — stockVersion 1, got ${String(entry.stockVersion)}`,
  );

  // ---- 18 points, 11 core + 5 extended + 2 manual + 0 derived -------------

  assert(
    entry.points.length === 18,
    `tag list §5 has 18 table rows and this class authors no derived code, so the entry declares ` +
      `18 points — got ${entry.points.length}`,
  );

  const tierCount = (tier: string): number =>
    entry.points.filter((point) => point.meta?.tier === tier).length;
  const derivedPoints = entry.points.filter((point) => point.kind === "derived");
  assert(
    tierCount("core") === 11,
    `§5 marks 11 rows tier C; the entry marks ${tierCount("core")} core`,
  );
  assert(
    tierCount("extended") === 5,
    `§5 marks 5 rows tier X; the entry marks ${tierCount("extended")} extended`,
  );
  assert(
    tierCount("manual") === 2,
    `§5 marks one row M and one M/X, whose first-listed tier wins, so 2 rows are manual; the ` +
      `entry marks ${tierCount("manual")}`,
  );
  assert(
    derivedPoints.length === 0,
    `§5's four derived codes are ALL deferred (plan §5.0) and plan §12 ruling 7 refuses ` +
      `recovery_pct here — the STP's own derived quantity is reuse, and hydraulic recovery shown ` +
      `where an operator expects reuse is the silent-wrong failure. The entry authors ` +
      `${derivedPoints.length}: ${derivedPoints.map((point) => point.pointKey).join(", ")}`,
  );

  entry.points.forEach((point, index) => {
    assert(
      point.sortOrder === index,
      `${STP_CODE} points must be in the tag list's own order — ${point.pointKey} has sortOrder ` +
        `${point.sortOrder} at index ${index}`,
    );
  });

  const declaredKeys = entry.points.map((point) => point.pointKey);
  assert(
    declaredKeys.join(",") === STP_POINT_KEYS.join(","),
    `${STP_CODE} declares the wrong keys or the wrong order. Expected §5's table order:\n  ` +
      `${STP_POINT_KEYS.join(", ")}\nGot:\n  ${declaredKeys.join(", ")}`,
  );

  const keySet = new Set(declaredKeys);
  assert(keySet.size === 18, `${STP_CODE}: no point key may repeat`);

  // ---- the dual-tier row, asserted by name -------------------------------

  const cod = entry.points.find((point) => point.pointKey === "effluent_cod_mgl");
  assert(
    cod?.meta?.tier === "manual",
    `${STP_CODE} must file effluent_cod_mgl as meta.tier "manual". §5 spells its tier "M/X" and ` +
      `§6 spells the same code "X/M"; the first-listed tier wins (plan §5), so the STP files it ` +
      `manual and the ETP files it extended. meta.tier says what THAT plant type typically fits, ` +
      `not what the code is — this is the one place in the pack where one code legitimately ` +
      `carries two tiers. Got "${String(cod?.meta?.tier)}".`,
  );
  assert(
    cod?.required === false,
    `${STP_CODE}.effluent_cod_mgl must be required: false — both halves of M/X are optional, so ` +
      `only meta.tier differs between the two entries; got ${String(cod?.required)}`,
  );

  // ---- no KPI, and the reason is structural ------------------------------

  const content = (entry.content ?? {}) as Record<string, unknown>;
  assert(
    !("kpis" in content),
    `${STP_CODE} carries a content.kpis key, and the water pack authors NONE — plan §5.0. This is ` +
      "a structural consequence of the tag list and not a deferral of effort: every ratio §5 " +
      "names AND bms-calc-v1 can express is a NAMED derived code, so it becomes a point (an " +
      "alarm can then bind it); every ratio it names that the grammar cannot express is deferred. " +
      "All four of §5's are deferred, so there is nothing left for a KPI to be. The key must be " +
      "ABSENT and not an empty array — §9.5 step 7 checks the imported draft for no kpis key.",
  );

  // ---- §5's four deferred derived codes, none of them a point key --------

  for (const code of DEFERRED_DERIVED_CODES[STP_CODE]) {
    assert(
      !keySet.has(code),
      `${STP_CODE} declares "${code}", one of §5's deferred derived codes. ` +
        `${deferralReason(STP_CODE)}`,
    );
  }

  // ---- 9 alarms, every one a populated philosophy row --------------------

  const alarms = alarmsOf(entry);
  assert(
    alarms.length === 9,
    "§5's seven bullets become 9 rows — DO splits into low and high (two meanings, two " +
      'responses), and "effluent turbidity/TSS high" splits into two because the entry declares ' +
      `two points; the entry carries ${alarms.length}`,
  );
  assert(
    alarms.map((alarm) => alarm.code).join(",") === STP_ALARM_CODES.join(","),
    `${STP_CODE} alarm codes must be §5's, in order:\n  ${STP_ALARM_CODES.join(", ")}\nGot:\n  ` +
      `${alarms.map((alarm) => alarm.code).join(", ")}`,
  );

  for (const [code, pointKey] of Object.entries(STP_ALARM_BINDINGS)) {
    const bound = alarms.find((alarm) => alarm.code === code)?.pointKey;
    assert(
      bound === pointKey,
      `the ${code} alarm must bind ${pointKey}; got ${String(bound)}. An alarm may only reference ` +
        "a key the same template declares (assertContentRefsResolve), and the two DO rows bind " +
        "one point at two bands, the same shape the feeder's under- and over-voltage rows take.",
    );
  }

  assertPhilosophyRows(STP_CODE, alarms);

  // ---- which rows carry a skill, and which deliberately do not -----------

  const skillOf = (code: string): unknown => philosophyOf(alarms.find((a) => a.code === code) ?? ({} as Alarm))?.skill;
  for (const [code, skill] of Object.entries(STP_ALARM_SKILLS)) {
    assert(
      skillOf(code) === skill,
      `${STP_CODE} alarm "${code}" must carry philosophy.skill "${skill}" — plan §12 ruling 6 ` +
        "sets one only where one of 0034's five trades genuinely answers: mechanical for a pump, " +
        "blower or fan, electrical for a motor, controls for an analyser or dosing controller, " +
        `civil for a tank, bund or pond. Got ${String(skillOf(code))}.`,
    );
  }
  for (const code of STP_PROCESS_ALARMS) {
    assert(
      skillOf(code) === undefined,
      `${STP_CODE} alarm "${code}" carries philosophy.skill ${String(skillOf(code))}, and it must ` +
        "carry none. It is a process-chemistry row: bms.alarm_skills holds electrical, " +
        "mechanical, hvac, controls and civil, and NO process trade, so plan §12 ruling 6 omits " +
        "the field rather than routing a DO, MLSS, turbidity or TSS excursion to the wrong trade. " +
        "A process skill is a separate backlog row with its own migration; when it lands, these " +
        "four rows gain a skill in a stockVersion 2.",
    );
  }

  // ---- the CPCB consent row carries a meaning and no number --------------

  const tssHigh = alarms.find((alarm) => alarm.code === "effluent_tss_high");
  const consentStrings = [
    String(tssHigh?.message ?? ""),
    ...Object.values(philosophyOf(tssHigh ?? ({} as Alarm)) ?? {}).map((value) => String(value)),
  ];
  for (const text of consentStrings) {
    assert(
      !/\d/.test(text),
      `${STP_CODE} alarm "effluent_tss_high" carries a digit in "${text}". TSS is a CPCB Schedule ` +
        "VI discharge-consent parameter: the consent value is per site and per consent and is set " +
        "at commissioning (ADR 0040 decision 4), so this row carries the MEANING and never a " +
        "limit — not in the message and not inside the philosophy either, which is the half a " +
        "pair-absence check cannot see. A number shipped to every organization unread is a number " +
        "somebody will believe.",
    );
  }

  // ---- 4 maintenance plans, none of them safety-critical -----------------

  const plans = maintenanceOf(entry);
  assert(plans.length === 4, `plan §5.7 authors 4 STP maintenance plans; the entry carries ${plans.length}`);

  const safetyCritical = plans.filter((plan) => plan.safetyCritical === true);
  assert(
    safetyCritical.length === 0,
    `no STP plan is safetyCritical — the pack's three are the ETP guard pond, the cooling tower ` +
      `Legionella program and the WTP chlorine dosing service (plan §5.7), and none of them is ` +
      `here. Got ${safetyCritical.length}: ${safetyCritical.map((plan) => plan.title).join("; ")}`,
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

  for (const plan of plans) {
    assert(
      typeof plan.intervalDays === "number" && plan.intervalDays >= 1 && plan.intervalDays <= 730,
      `${STP_CODE} maintenance "${plan.title}" has intervalDays ${String(plan.intervalDays)} — ` +
        "templateMaintenancePlanSchema caps it at 730, so a longer task cannot be authored here " +
        "at all and must not be rounded into range",
    );
    assert(
      typeof plan.estimatedMinutes === "number" &&
        plan.estimatedMinutes >= 5 &&
        plan.estimatedMinutes <= 1440,
      `${STP_CODE} maintenance "${plan.title}" has estimatedMinutes ` +
        `${String(plan.estimatedMinutes)} — the schema's bound is 5..1440`,
    );
  }

  // ---- provenance ---------------------------------------------------------

  const description = entry.description ?? "";
  for (const needle of ["e5.1-derived-taglist-v1.md", "§5", "PROVISIONAL"]) {
    assert(
      description.includes(needle),
      `${STP_CODE}.description must contain "${needle}" — the stamp plus the citation is the ` +
        "provenance (ADR 0052 decision 6), the section is what makes the citation checkable, and " +
        "PROVISIONAL is the tag list's own status: this content is derived from published " +
        `practice and the client's reference dashboards, not client-confirmed. Got: "${description}"`,
    );
  }
}

/**
 * Every per-class block in this file. Called by `water-classes.test.ts`, its
 * **name-sibling** wrapper — `tests/repo-invariants.test.ts` matches the pair
 * by name, and a spec imported from a differently-named wrapper still runs but
 * is absent from coverage, which is the half the import cannot fix.
 */
export function runWaterClassEntryTests(): void {
  checkStp();
}
