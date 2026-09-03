import { readRepoFile } from "../../../testing/repo-root";
import { DEFERRED_DERIVED_CODES, deferralReason } from "./stock-catalog-deferrals.spec";
import { assert, maintenanceOf, type Alarm } from "./stock-catalog.spec";
import type { StockAssetTemplateEntry } from "./types";

/**
 * `E5.2` Task 2 — **the transcription helpers, pack-neutral**, with their own
 * negative self-tests.
 *
 * Every stock pack transcribes a tag list: a table of points, a table of
 * alarms, a set of formulas, a philosophy on every row, and a citation. `E5.1`
 * wrote those helpers inside `water-classes.spec.ts` and exported them to its
 * two siblings — the right call for one pack. `E5.2` is the second pack to need
 * them and `E5.3` will be the third, and a mechanical spec importing a *water*
 * spec for `assertPointTable` would be reading as if the mechanical pack were a
 * water one. So they live here, and two signatures widen (below) rather than
 * hardcoding one pack's document and one pack's domain.
 *
 * **Not a bare `.ts`, and not a helpers-only spec with an empty wrapper.** A
 * plain module in this directory would need a `STOCK_ASSET_RELS` entry in
 * `tests/f2.13-asset-stock-catalog-vocabulary.test.ts`, which scans catalog
 * *content* for point keys — these helpers are assertions, not content. And a
 * `.spec.ts` whose wrapper ran nothing would be exactly the dead-artefact shape
 * `tests/repo-invariants.test.ts` exists to refuse. So the wrapper runs
 * `runStockTranscriptionSelfTests()` and that function holds **three negative
 * self-tests**: proof that the three helpers whose failure would be silent can
 * actually fail.
 *
 * **Why those three.**
 *
 *  1. `skillVocabulary()` parses `0034`'s five trades out of the migration
 *     text. The parser already throws on no match, but nothing said WHICH five
 *     it should find — so a migration that seeded a sixth, or renamed one,
 *     would leave every `philosophy.skill` assertion checking a set nobody had
 *     read. It is the anti-vacuity that was implicit until now.
 *  2. `assertSkillAssignment` gained its partition check from the `E5.1` code
 *     review (§13 item 7): `skillOf` returns `undefined` for a code that does
 *     not exist, so a misspelled process row passed the "carries no skill"
 *     assertion vacuously. The fix landed with **no test proving it can fire**,
 *     which is the same class of hole one layer up. This is that test.
 *  3. `assertPointTable`'s unit column is the one field no other check in this
 *     repository reads, and `U+00B5` MICRO SIGN against `U+03BC` GREEK SMALL
 *     LETTER MU is the failure that is invisible on screen. The `E5.1` code
 *     reviewer ran that mutation by hand once; this makes it permanent.
 *
 * `stock-transcription.test.ts` is the **name-sibling** wrapper —
 * `tests/repo-invariants.test.ts` pairs the two by name, and a spec run from a
 * differently-named wrapper still executes but is absent from coverage.
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
 * insert is reshaped, and the check would become a decoration. Self-test 1
 * pins the five codes it must find, which is the half the throw cannot say.
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

/** Memoized: every per-class block in every pack checks the same five codes. */
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
 * and this comparison is the only thing that tells them apart — self-test 3
 * below is what proves the comparison can see the difference.
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
 * Every alarm of a pack that authors philosophies carries a populated one, and
 * every `skill` present is one of `0034`'s five seeded trades.
 *
 * ADR 0040 decision 4 made this the water pack's property and ADR 0053 decision
 * 5 makes it the mechanical pack's. It is **not** a catalog-wide claim: the six
 * electrical entries predate both decisions and carry none, so `checkEntry`
 * cannot make it and each pack's blocks make it per entry.
 */
export function assertPhilosophyRows(code: string, alarms: readonly Alarm[]): void {
  const skills = skillVocabulary();
  for (const alarm of alarms) {
    const philosophy = philosophyOf(alarm);
    assert(
      philosophy !== undefined,
      `${code} alarm "${alarm.code}" carries no philosophy object. ADR 0040 decision 4 (water) ` +
        "and ADR 0053 decision 5 (mechanical) require one on every row of those packs: the " +
        "threshold pair is deliberately absent (B7), so cause, impact and action are all the " +
        "meaning an operator gets. The six electrical entries predate both decisions and carry " +
        "none, which is why checkEntry cannot make this claim catalog-wide and each pack's " +
        "blocks make it per entry.",
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
 * Which rows carry a `skill` and which deliberately carry none (`E5.1` §12
 * ruling 6; ADR 0053 decision 5). Both halves matter: an omission asserted only
 * by its absence from a map is an omission nobody notices being filled in.
 */
export function assertSkillAssignment(
  code: string,
  alarms: readonly Alarm[],
  assigned: Readonly<Record<string, string>>,
  unanswerableRows: readonly string[],
): void {
  // The two lists must partition the alarm set. `skillOf` returns `undefined`
  // for a code that does not exist, so a misspelled `unanswerableRows` entry would
  // otherwise pass the "carries no skill" assertion vacuously and that row's
  // skill-absence would be checked by nothing (code review, 2026-09-03).
  // Self-test 2 below is what proves this clause can fire.
  const known = new Set(alarms.map((alarm) => alarm.code));
  const listed = [...Object.keys(assigned), ...unanswerableRows];
  const unknown = listed.filter((alarmCode) => !known.has(alarmCode));
  assert(
    unknown.length === 0 && new Set(listed).size === listed.length && listed.length === alarms.length,
    `${code}: the assigned map and the no-trade list must partition the ${alarms.length} alarms — ` +
      `${listed.length} listed (${new Set(listed).size} distinct), unknown: [${unknown.join(", ")}].`,
  );
  const skillOf = (alarmCode: string): unknown =>
    philosophyOf(alarms.find((alarm) => alarm.code === alarmCode) ?? ({} as Alarm))?.skill;
  for (const [alarmCode, skill] of Object.entries(assigned)) {
    assert(
      skillOf(alarmCode) === skill,
      `${code} alarm "${alarmCode}" must carry philosophy.skill "${skill}" — a skill is set only ` +
        "where one of 0034's five trades genuinely answers: mechanical for a pump, blower, fan, " +
        "press, bearing, seal, compressor element or boiler mounting, electrical for a motor or a " +
        "drive, hvac for a chiller, an AHU or a refrigeration circuit, controls for an analyser, " +
        "a dosing controller, a setpoint or a short-cycling loop, civil for a tank, bund or pond. " +
        `Got ${String(skillOf(alarmCode))}.`,
    );
  }
  for (const alarmCode of unanswerableRows) {
    assert(
      skillOf(alarmCode) === undefined,
      `${code} alarm "${alarmCode}" carries philosophy.skill ${String(skillOf(alarmCode))}, and ` +
        "it must carry none. bms.alarm_skills holds electrical, mechanical, hvac, controls and " +
        "civil, and no trade in that table answers this row, so the field is omitted rather " +
        "than routing the alarm to the wrong trade. Three classes of row are unanswerable " +
        "so far: the water and mechanical packs' PROCESS-CHEMISTRY rows (pH, TDS, flue O2 — " +
        "F4.78 files the process trade); E5.3's LIFE-SAFETY and SECURITY rows (a fire alarm, " +
        "a forced door — the fire officer and the security desk answer those, and neither is " +
        "a maintenance trade); and E5.3's OCCUPANCY rows (a zone over capacity, a car park " +
        "full), which report a building's USE and need no responder at all — nothing is " +
        "broken and nobody is dispatched. When a trade lands for a class that wants one, its " +
        "rows gain a skill in a stockVersion 2.",
    );
  }
}

/**
 * A row whose limit is set by a regulator or a statute carries its **meaning**
 * and never a number (ADR 0040 decision 4, ADR 0053 decision 5) — in the
 * message *and* inside every `philosophy` string, which is the half
 * `checkEntry`'s pair-absence check cannot see.
 *
 * `why` is the caller's: the water pack passes the CPCB Schedule VI consent
 * sentence, the mechanical pack's boiler passes its IBR one. The rule is the
 * same and the regime is not, and a message naming the wrong regulator sends
 * the reader to the wrong document.
 *
 * Renamed from `assertNoConsentNumbers` in `E5.2` Task 2 for exactly that
 * reason: a discharge consent is one instance of the class, not the class.
 */
export function assertNoLimitNumbers(
  code: string,
  alarms: readonly Alarm[],
  rows: readonly string[],
  why: string,
): void {
  for (const alarmCode of rows) {
    const alarm = alarms.find((row) => row.code === alarmCode);
    assert(alarm !== undefined, `${code} declares no alarm "${alarmCode}"`);
    const strings = [
      String(alarm?.message ?? ""),
      ...Object.values(philosophyOf(alarm ?? ({} as Alarm)) ?? {}).map((value) => String(value)),
    ];
    for (const text of strings) {
      assert(
        !/\d/.test(text),
        `${code} alarm "${alarmCode}" carries a digit in "${text}". ${why} The row carries the ` +
          "MEANING and never a limit — not in the message and not inside the philosophy either. " +
          "A number shipped to every organization unread is a number somebody will believe.",
      );
    }
  }
}

/** The two schema bounds, per each plan's §5.7 — never rounded into range. */
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

/** `content.kpis` is ABSENT, not empty — each plan's §5.0, and §9.5 checks it. */
export function assertNoKpis(code: string, entry: StockAssetTemplateEntry, section: string): void {
  const content = (entry.content ?? {}) as Record<string, unknown>;
  assert(
    !("kpis" in content),
    `${code} carries a content.kpis key, and this pack authors NONE — see the pack's plan §5.0. ` +
      `This is a structural consequence of the tag list and not a deferral of effort: every ratio ` +
      `${section} names AND bms-calc-v1 can express is a NAMED derived code, so it becomes a ` +
      "point (an alarm can then bind it); every ratio it names that the grammar cannot express is " +
      "deferred. The key must be ABSENT and not an empty array — the import verification checks " +
      "the imported draft for no kpis key.",
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

/**
 * The stamp plus the citation is the provenance — ADR 0052 decision 6.
 *
 * **`sourceDoc` is a parameter since `E5.2` Task 2**, because a pack cites its
 * own tag list: `e5.1-derived-taglist-v1.md` for the water plants,
 * `e5.2-derived-taglist-v1.md` for the mechanical and HVAC machines. The two
 * parameters are both strings and adjacent, so a swapped pair would typecheck,
 * run and pass — the shape guard below is what refuses it: a document name ends
 * `.md` and a section reference starts `§`.
 */
export function assertProvenance(
  code: string,
  entry: StockAssetTemplateEntry,
  sourceDoc: string,
  section: string,
): void {
  assert(
    sourceDoc.endsWith(".md") && section.startsWith("§"),
    `assertProvenance(${code}, …, "${sourceDoc}", "${section}") has its last two arguments the ` +
      "wrong way round: sourceDoc is the tag list's file name (ending .md) and section is the " +
      "reference inside it (starting §). Both are strings, so nothing but this line can tell " +
      "them apart, and a swapped pair would still find both needles in the description and pass.",
  );
  const description = entry.description ?? "";
  for (const needle of [sourceDoc, section, "PROVISIONAL"]) {
    assert(
      description.includes(needle),
      `${code}.description must contain "${needle}" — the stamp plus the citation is the ` +
        "provenance (ADR 0052 decision 6), the section is what makes the citation checkable, and " +
        "PROVISIONAL is the tag list's own status: this content is derived from published " +
        `practice and the client's reference dashboards, not client-confirmed. Got: "${description}"`,
    );
  }
}

/**
 * The header three claims every entry makes about itself.
 *
 * **`domain` is a parameter since `E5.2` Task 2.** `E5.1` could assert
 * `"water"` outright; `E5.2` files four entries under `mechanical` and two
 * under `hvac` (ADR 0053 decision 2 — the code prefix spells the domain), so
 * the value is the caller's. A wrong one is self-catching: the assertion below
 * compares against what the entry declares.
 */
export function assertEntryIdentity(
  code: string,
  entry: StockAssetTemplateEntry,
  assetType: string,
  domain: string,
): void {
  assert(
    entry.assetType === assetType,
    `${code}.assetType must be "${assetType}" (the pack's plan rules it) — got "${entry.assetType}"`,
  );
  assert(
    entry.domain === domain,
    `${code}.domain must be "${domain}" — assertAssetDomain checks it against bms.asset_domains ` +
      `at import time, so a domain no seed has written is a 400 on a client's import; got ` +
      `"${entry.domain}"`,
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

// ===========================================================================
// The self-tests — the wrapper's reason to exist.
// ===========================================================================

/**
 * Two alarms: one carrying a `mechanical` skill, one a process-chemistry row
 * carrying none. The smallest set on which `assertSkillAssignment`'s partition
 * clause has something to say.
 */
const SELF_TEST_ALARMS: readonly Alarm[] = [
  {
    code: "blower_trip",
    pointKey: "blower_status",
    severity: "critical",
    category: "operations",
    message: "Blower stopped without a stop command.",
    philosophy: {
      cause: "Overload, belt failure or a drive fault.",
      impact: "Aeration is lost and the biology degrades.",
      action: "Attend the blower and restore aeration.",
      skill: "mechanical",
    },
  },
  {
    code: "do_low",
    pointKey: "aeration_do_mgl",
    severity: "critical",
    category: "operations",
    message: "Dissolved oxygen below the aeration band.",
    philosophy: {
      cause: "Aeration demand exceeds supply, or the probe has fouled.",
      impact: "The biology is stressed and the effluent degrades.",
      action: "Check the blower duty and clean or recalibrate the probe.",
    },
  },
];

/**
 * The two spellings self-test 3 is about — **U+00B5 MICRO SIGN** and **U+03BC
 * GREEK SMALL LETTER MU**. They render identically in every editor, terminal
 * and code review in this project, so the two constants below are indis-
 * tinguishable by reading and **their codepoints are asserted numerically** in
 * the self-test before either is used. Without that, an editor or a tool that
 * normalised one spelling into the other would turn the whole test into a
 * tautology — a mutation test comparing a string with itself — and nothing
 * would say so.
 *
 * `µS/cm` (the MICRO SIGN form) is what the water pack's conductivity rows
 * carry and what `UNIT_BY_KEY` seeds.
 */
const MICRO_SIGN_UNIT = "µS/cm";
const GREEK_MU_UNIT = "μS/cm";

/** One measured point, carrying the MICRO SIGN spelling the vocabulary uses. */
const SELF_TEST_ENTRY: StockAssetTemplateEntry = {
  code: "undeclared-transcription-self-test",
  name: "Transcription self-test fixture",
  assetType: "self_test",
  domain: "water",
  description: "Never shipped and never imported — a fixture for the helpers in this file.",
  stockVersion: 1,
  points: [
    {
      pointKey: "permeate_conductivity_uscm",
      label: "Permeate conductivity",
      unit: MICRO_SIGN_UNIT,
      kind: "measured",
      sourceDataKeyPattern: null,
      formula: null,
      formulaDialect: null,
      calcTrigger: null,
      calcIntervalSeconds: null,
      maxInputAgeSeconds: null,
      required: true,
      sortOrder: 0,
      meta: { tier: "core" },
    },
  ],
};

/** The message of whatever `run` threw, or `null` if it threw nothing. */
function refusalFrom(run: () => void): string | null {
  try {
    run();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export function runStockTranscriptionSelfTests(): void {
  // ---- 1. the skill vocabulary is exactly 0034's five trades --------------
  //
  // Sorted, so the claim is about the SET and not about the order of the
  // migration's own VALUES list. `seededSkills` already throws when it parses
  // nothing; what it cannot say is which codes it should have found, and every
  // `philosophy.skill` assertion in every pack is a membership test against
  // this set. A sixth code (the `process` trade F4.78 would add) must fail here
  // first, so that the packs' no-skill process rows are revisited deliberately
  // rather than silently becoming assignable.
  const skills = [...skillVocabulary()].sort().join(",");
  assert(
    skills === "civil,controls,electrical,hvac,mechanical",
    `migration 0034 must seed exactly electrical, mechanical, hvac, controls and civil into ` +
      `bms.alarm_skills — got "${skills}". If a trade was added, the packs' process-chemistry ` +
      "rows (which carry NO skill on purpose) have to be re-ruled before this line moves; if one " +
      "was removed, every entry that assigns it is now a 400 on a client's import.",
  );

  // ---- 2. assertSkillAssignment refuses a list that does not partition ----
  //
  // The positive control first: the correct call must NOT throw, or the
  // negative below proves nothing about the clause it is aimed at.
  const partitionControl = refusalFrom(() =>
    assertSkillAssignment(
      "self-test",
      SELF_TEST_ALARMS,
      { blower_trip: "mechanical" },
      ["do_low"],
    ),
  );
  assert(
    partitionControl === null,
    `assertSkillAssignment must accept a map and a process list that together name every alarm ` +
      `exactly once — got ${String(partitionControl)}`,
  );

  // The hole `E5.1` §13 item 7 closed, with the test that proves the fix can
  // fire. `skillOf` returns `undefined` for a code no alarm carries, so before
  // the partition clause a misspelled process row passed the "carries no
  // skill" assertion vacuously — and the row it was meant to cover was checked
  // by nothing, forever. `do_lwo` is that misspelling.
  const misspelled = refusalFrom(() =>
    assertSkillAssignment(
      "self-test",
      SELF_TEST_ALARMS,
      { blower_trip: "mechanical" },
      ["do_lwo"],
    ),
  );
  assert(
    misspelled !== null && /must partition/.test(misspelled) && /do_lwo/.test(misspelled),
    "assertSkillAssignment must refuse a process list naming an alarm code the entry does not " +
      "carry, and the message must name the unknown code — otherwise a typo silently exempts the " +
      `row it was written to cover. Got ${String(misspelled)}`,
  );

  // ---- 3. assertPointTable sees U+00B5 against U+03BC --------------------
  //
  // **First, that the two fixtures really are the two codepoints.** They are
  // visually identical, so nothing a reader or a reviewer can do distinguishes
  // them; if an editor, a formatter or a copy-paste ever normalised one into
  // the other, the mutation below would compare a string with itself, pass,
  // and report that the unit check is alive when it is checking nothing. This
  // is the assertion that makes the rest of this block mean what it says.
  assert(
    MICRO_SIGN_UNIT.codePointAt(0) === 0x00b5 && GREEK_MU_UNIT.codePointAt(0) === 0x03bc,
    "the two unit fixtures must be U+00B5 MICRO SIGN and U+03BC GREEK SMALL LETTER MU " +
      `respectively — got U+${(MICRO_SIGN_UNIT.codePointAt(0) ?? 0).toString(16).toUpperCase()} ` +
      `and U+${(GREEK_MU_UNIT.codePointAt(0) ?? 0).toString(16).toUpperCase()}. They render ` +
      "identically, so a normalisation would leave the mutation below comparing a string with " +
      "itself and passing — an alive-looking check that checks nothing.",
  );

  // The positive control: the same string, correctly spelled, must pass.
  const microControl = refusalFrom(() =>
    assertPointTable("self-test", "§0", SELF_TEST_ENTRY, [
      ["permeate_conductivity_uscm", "core", MICRO_SIGN_UNIT],
    ]),
  );
  assert(
    microControl === null,
    `assertPointTable must accept a table that matches the entry exactly — got ${String(microControl)}`,
  );

  // U+03BC GREEK SMALL LETTER MU where the entry carries U+00B5 MICRO SIGN.
  // The two render identically in every editor, terminal and code review in
  // this project, and a template `unit` is an OVERRIDE that ships to every
  // organization that imports the entry and cannot be corrected by a later
  // seed. This comparison is the only thing in the repository that tells them
  // apart; the `E5.1` code reviewer ran the mutation by hand once, and this
  // makes it permanent.
  const mu = refusalFrom(() =>
    assertPointTable("self-test", "§0", SELF_TEST_ENTRY, [
      ["permeate_conductivity_uscm", "core", GREEK_MU_UNIT],
    ]),
  );
  assert(
    mu !== null && /disagrees with/.test(mu) && /pointKey \| tier \| unit/.test(mu),
    "assertPointTable must refuse a unit spelled with U+03BC GREEK SMALL LETTER MU where the " +
      "entry carries U+00B5 MICRO SIGN. The two are visually identical and are different " +
      "strings; if this comparison ever stops distinguishing them, every unit in every pack is " +
      `checked by nothing. Got ${String(mu)}`,
  );
}
