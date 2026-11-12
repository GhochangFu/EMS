/**
 * The formula help list (`F4.314` PR 1, ADR 0038 Amendment 6 decision A1).
 *
 * The list is the editor's teaching, so each claim here is the one that keeps
 * it from teaching something the parser does not accept: an example that does
 * not parse, a function the grammar lost, a glyph the tokenizer refuses, a
 * `v2` form offered on a `v1` field, or a newer dialect that teaches less than
 * an older one. Each helper names the mutation that reddens it.
 */
import {
  CALC_AGGREGATE_FNS,
  CALC_DIALECT,
  CALC_DIALECT_V2,
  CALC_DIALECT_V3,
  CALC_DIALECTS,
  CALC_FUNCTION_ARITY,
  CALC_WINDOW_FNS,
  parseFormula,
  tokenize,
} from "@bms/shared";

import { formulaHelpEntries, type FormulaHelpEntry } from "./formula-help";
import { V3_PARAMETER_HELP } from "./template-calc-config";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The function name an entry inserts, for the entries that insert a call. */
function calledName(entry: FormulaHelpEntry): string | null {
  return (entry.group === "function" || entry.group === "window") && entry.insert.endsWith("(")
    ? entry.insert.slice(0, -1)
    : null;
}

/**
 * Every example parses under the dialect whose list carries it — the
 * `runReferenceFormsTests` pattern applied to the whole list.
 *
 * Mutation: misspell one example (`abs({kw}` for `abs({kw})`).
 */
export function runEveryExampleParsesTests(): void {
  for (const dialect of CALC_DIALECTS) {
    for (const entry of formulaHelpEntries(dialect)) {
      const parsed = parseFormula(entry.example, { dialect });
      assert(
        parsed.ok,
        `${entry.label}'s example ${JSON.stringify(entry.example)} must parse under ${dialect}: ${
          parsed.ok ? "" : JSON.stringify(parsed.errors)
        }`,
      );
    }
  }
}

/**
 * Each `CALC_FUNCTION_ARITY` key has exactly one `function` entry.
 *
 * Mutation: replace the map over `CALC_FUNCTION_ARITY` with a hand list that
 * drops `clamp`.
 */
export function runEachArityKeyHasOneFunctionEntryTests(): void {
  const v1Functions = formulaHelpEntries(CALC_DIALECT).filter((entry) => entry.group === "function");
  const counts = Object.keys(CALC_FUNCTION_ARITY).map(
    (name) => `${name}:${v1Functions.filter((entry) => entry.label === name).length}`,
  );
  const wrong = counts.filter((count) => !count.endsWith(":1"));
  assert(wrong.length === 0, `each arity key needs exactly one function entry, got ${JSON.stringify(wrong)}`);
}

/**
 * No entry calls a name outside the grammar's functions, aggregates, window
 * functions and `hours`.
 *
 * Mutation: rename the `hours` entry's insert to `hour(`.
 */
export function runNoEntryCallsOutsideTheGrammarTests(): void {
  const grammar = new Set<string>([
    ...Object.keys(CALC_FUNCTION_ARITY),
    ...CALC_AGGREGATE_FNS,
    ...CALC_WINDOW_FNS,
    "hours",
  ]);
  const outside = CALC_DIALECTS.flatMap((dialect) => formulaHelpEntries(dialect))
    .map(calledName)
    .filter((name): name is string => name !== null && !grammar.has(name));
  assert(outside.length === 0, `entries call names the grammar does not carry: ${JSON.stringify(outside)}`);
}

/**
 * Every glyph of an operator entry tokenizes to exactly one token before
 * `eof` under `v1` — the hold on the operators, which the tokenizer keeps
 * private and the list therefore restates.
 *
 * Mutation: add a `^` operator entry.
 */
export function runOperatorsTokenizeTests(): void {
  const operators = formulaHelpEntries(CALC_DIALECT).filter((entry) => entry.group === "operator");
  assert(operators.length > 0, "the list must teach the operators");
  for (const entry of operators) {
    for (const glyph of entry.label.split(" ")) {
      let kinds: string[] = [];
      try {
        kinds = tokenize(glyph, { dialect: CALC_DIALECT }).map((token) => token.kind);
      } catch {
        kinds = [];
      }
      assert(
        kinds.length === 2 && kinds[0] !== "eof" && kinds[1] === "eof",
        `${JSON.stringify(glyph)} must tokenize to one token under v1, got ${JSON.stringify(kinds)}`,
      );
    }
  }
}

/**
 * `hours` is a parser literal held by no constant, so the list restates it;
 * this holds it to the parser: under `v3` the `hours` entry's example parses
 * to a window read.
 *
 * Mutation: change the entry's example to `{baseline_kwh} / 24` (no window).
 */
export function runHoursIsTheParsersTests(): void {
  const entry = formulaHelpEntries(CALC_DIALECT_V3).find((candidate) => calledName(candidate) === "hours");
  assert(entry !== undefined, "v3 must teach hours()");
  const parsed = entry ? parseFormula(entry.example, { dialect: CALC_DIALECT_V3 }) : null;
  assert(
    parsed !== null && parsed.ok && parsed.windowReads.length > 0,
    `hours' example must parse to a window read under v3, got ${JSON.stringify(parsed)}`,
  );
}

/**
 * The `v1` list carries no scope, parameter or window entry.
 *
 * Mutation: build the `v3` list for every dialect.
 */
export function runV1HasNoNewerGroupsTests(): void {
  const groups = formulaHelpEntries(CALC_DIALECT).map((entry) => entry.group);
  const newer = groups.filter((group) => group === "scope" || group === "parameter" || group === "window");
  assert(newer.length === 0, `v1 has no scope, parameter or window form, got ${JSON.stringify(newer)}`);
}

/**
 * The negative control: every entry the `v2` list adds over `v1` reads a
 * cross reference under `v2` and none under `v1` — refused or read as local,
 * it means something else there, so it must never be offered on a `v1` field.
 *
 * Mutation: change the `avg` aggregate's example to `{kw} * 2`.
 */
export function runV2OnlyExamplesAreNotV1Tests(): void {
  const v1Labels = new Set(formulaHelpEntries(CALC_DIALECT).map((entry) => entry.label));
  const added = formulaHelpEntries(CALC_DIALECT_V2).filter((entry) => !v1Labels.has(entry.label));
  assert(added.length > 0, "v2 must add entries over v1, or the control is vacuous");
  for (const entry of added) {
    const v2 = parseFormula(entry.example, { dialect: CALC_DIALECT_V2 });
    const v1 = parseFormula(entry.example, { dialect: CALC_DIALECT });
    assert(
      v2.ok && v2.crossRefs.length > 0 && (!v1.ok || v1.crossRefs.length === 0),
      `${entry.label}'s example must read a cross reference under v2 and none under v1`,
    );
  }
}

/** The labels of one dialect's list. */
function labelsOf(dialect: (typeof CALC_DIALECTS)[number]): Set<string> {
  return new Set(formulaHelpEntries(dialect).map((entry) => entry.label));
}

/**
 * `v3 ⊇ v2 ⊇ v1` by label — ADR 0070's superset order: a newer dialect never
 * teaches less.
 *
 * Mutation: gate the function entries on `!isCrossAssetDialect`.
 */
export function runDialectsAreSupersetsTests(): void {
  const v1 = labelsOf(CALC_DIALECT);
  const v2 = labelsOf(CALC_DIALECT_V2);
  const v3 = labelsOf(CALC_DIALECT_V3);
  const missing = [...[...v1].filter((label) => !v2.has(label)), ...[...v2].filter((label) => !v3.has(label))];
  assert(missing.length === 0, `a newer dialect must carry every older entry, missing ${JSON.stringify(missing)}`);
}

/**
 * Each newer dialect's list is strictly larger — `v2` and `v3` each teach
 * something the one before cannot.
 *
 * Mutation: build the `v2` list for `v3`.
 */
export function runEachNewerDialectAddsEntriesTests(): void {
  const sizes = CALC_DIALECTS.map((dialect) => labelsOf(dialect).size);
  assert(sizes[2] > sizes[1] && sizes[1] > sizes[0], `each newer dialect must add entries, got ${sizes.join(" < ")}`);
}

/**
 * Every `insert` is non-empty — a click must append something.
 *
 * Mutation: give the `{key}` entry an empty insert.
 */
export function runInsertsAreNonEmptyTests(): void {
  const empty = CALC_DIALECTS.flatMap((dialect) => formulaHelpEntries(dialect)).filter(
    (entry) => entry.insert.length === 0,
  );
  assert(empty.length === 0, `entries insert nothing: ${JSON.stringify(empty.map((entry) => entry.label))}`);
}

/**
 * A function entry inserts its own name and an opening parenthesis.
 *
 * Mutation: insert `abs` without the parenthesis.
 */
export function runFunctionInsertsOpenTheCallTests(): void {
  const wrong = CALC_DIALECTS.flatMap((dialect) => formulaHelpEntries(dialect)).filter(
    (entry) => entry.group === "function" && entry.insert !== `${entry.label}(`,
  );
  assert(wrong.length === 0, `function entries must insert "<label>(", got ${JSON.stringify(wrong)}`);
}

/**
 * Labels are unique within a dialect's list, because the component names each
 * button `Insert <label>` and two buttons with one name cannot be told apart.
 *
 * Mutation: label the window `sum` entry `sum`.
 */
export function runLabelsAreUniqueTests(): void {
  for (const dialect of CALC_DIALECTS) {
    const labels = formulaHelpEntries(dialect).map((entry) => entry.label);
    const repeated = labels.filter((label, index) => labels.indexOf(label) !== index);
    assert(repeated.length === 0, `${dialect} repeats ${JSON.stringify(repeated)}`);
  }
}

/** The `$key` entry's text under `v3`. */
function parameterSays(): string {
  return formulaHelpEntries(CALC_DIALECT_V3).find((entry) => entry.group === "parameter")?.says ?? "";
}

/**
 * The `$key` entry's text is `V3_PARAMETER_HELP`'s own words — a suffix of it,
 * not a restatement.
 *
 * Mutation: restate the text by hand ("a named parameter, nearest scope wins").
 */
export function runParameterTextIsTheHelpsTests(): void {
  const says = parameterSays();
  assert(says.length > 0 && V3_PARAMETER_HELP.endsWith(says), `the $key text must end V3_PARAMETER_HELP, got ${says}`);
}

/**
 * The `$key` entry's text drops the sentence's lead, which the label shows.
 *
 * Mutation: use `V3_PARAMETER_HELP` whole.
 */
export function runParameterTextDropsTheLeadTests(): void {
  assert(parameterSays() !== V3_PARAMETER_HELP, "the $key text must not repeat the label's $key lead");
}

/**
 * The lead is cut at the dash, not inside `$key`: the text starts neither
 * with `$` nor with the `ey` a cut two characters early would leave.
 *
 * Mutation: slice two characters before the dash.
 */
export function runParameterTextIsCutAtTheDashTests(): void {
  const says = parameterSays();
  assert(!says.startsWith("$") && !says.startsWith("ey"), `the $key text is cut in the wrong place: ${says}`);
}

/**
 * `F4.353` (ADR 0070 Amendment 8): the `delta` window entry says what happens
 * when the counter fell — the calc writes nothing for that run
 * (`window_decreasing`) — so an author does not read a missing value as a fault.
 * Checked on every dialect that lists window functions, so a dialect added
 * later cannot carry an older sentence.
 *
 * Mutation: restore "last minus first, for cumulative counters" alone.
 */
export function runDeltaNamesTheFallingCounterRefusalTests(): void {
  const deltas = CALC_DIALECTS.flatMap((dialect) => formulaHelpEntries(dialect)).filter(
    (entry) => entry.group === "window" && entry.label === "delta over a window",
  );
  assert(deltas.length > 0, "at least one dialect lists the delta window entry");
  for (const entry of deltas) {
    assert(
      entry.says.includes("for cumulative counters") && entry.says.includes("if the counter fell") &&
        entry.says.includes("window_decreasing"),
      `the delta entry must name the falling-counter refusal, got: ${entry.says}`,
    );
  }
}
