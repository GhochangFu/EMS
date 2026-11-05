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
 * Each `CALC_FUNCTION_ARITY` key has exactly one `function` entry, and no
 * entry calls a name outside the grammar's functions, aggregates, window
 * functions and `hours`.
 *
 * Mutation: replace the map over `CALC_FUNCTION_ARITY` with a hand list that
 * drops `clamp`.
 */
export function runFunctionsComeFromTheConstantTests(): void {
  const grammar = new Set<string>([
    ...Object.keys(CALC_FUNCTION_ARITY),
    ...CALC_AGGREGATE_FNS,
    ...CALC_WINDOW_FNS,
    "hours",
  ]);
  const v1Functions = formulaHelpEntries(CALC_DIALECT).filter((entry) => entry.group === "function");
  for (const name of Object.keys(CALC_FUNCTION_ARITY)) {
    const matching = v1Functions.filter((entry) => entry.label === name);
    assert(matching.length === 1, `${name} must have exactly one function entry, got ${matching.length}`);
  }
  for (const dialect of CALC_DIALECTS) {
    for (const entry of formulaHelpEntries(dialect)) {
      const name = calledName(entry);
      assert(name === null || grammar.has(name), `${entry.label} calls ${name}, which the grammar does not carry`);
    }
  }
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
 * Mutation: rename the entry's call to `hour(`.
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

/**
 * `v3 ⊇ v2 ⊇ v1` by label — ADR 0070's superset order: a newer dialect never
 * teaches less.
 *
 * Mutation: gate the function entries on `!isCrossAssetDialect`.
 */
export function runDialectsAreSupersetsTests(): void {
  const labels = (dialect: (typeof CALC_DIALECTS)[number]) =>
    new Set(formulaHelpEntries(dialect).map((entry) => entry.label));
  const v1 = labels(CALC_DIALECT);
  const v2 = labels(CALC_DIALECT_V2);
  const v3 = labels(CALC_DIALECT_V3);
  const missing = [...[...v1].filter((label) => !v2.has(label)), ...[...v2].filter((label) => !v3.has(label))];
  assert(missing.length === 0, `a newer dialect must carry every older entry, missing ${JSON.stringify(missing)}`);
  assert(v3.size > v2.size && v2.size > v1.size, "each newer dialect must add entries");
}

/**
 * Every `insert` is non-empty, and a function entry inserts its own name and
 * an opening parenthesis.
 *
 * Mutation: insert `abs` without the parenthesis.
 */
export function runInsertsAreUsableTests(): void {
  for (const dialect of CALC_DIALECTS) {
    for (const entry of formulaHelpEntries(dialect)) {
      assert(entry.insert.length > 0, `${entry.label} must insert something`);
      if (entry.group === "function") {
        assert(entry.insert === `${entry.label}(`, `${entry.label} must insert "${entry.label}(", got ${entry.insert}`);
      }
    }
  }
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
