// `@bms/shared`, not `@bms/shared/contracts` — apps/api compiles with
// moduleResolution "node" and ignores the exports map (ADR 0030 Amendment 2;
// see apps/api/src/admin/asset-templates/asset-templates-content.schema.ts).
import { automationRuleOperatorSchema } from "@bms/shared";

import { compare } from "../rules/rule-evaluation";
import { SQL_COMPARATOR, firesCaseSql } from "./in-range-sql";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Maps a generated SQL comparison symbol to a JS predicate, so SQL/TS parity
 * can be checked without a database and without `eval`/`new Function` (the
 * repo forbids both — `tests/adr-0036-calc-dsl-no-eval.test.ts`). Closed on
 * purpose: an unrecognised symbol is a bug in the fixture, not something to
 * evaluate dynamically.
 */
const JS_PREDICATE: Record<string, (value: number, threshold: number) => boolean> = {
  ">": (value, threshold) => value > threshold,
  ">=": (value, threshold) => value >= threshold,
  "<": (value, threshold) => value < threshold,
  "<=": (value, threshold) => value <= threshold,
  "=": (value, threshold) => value === threshold,
};

function testExhaustiveAgainstLiveVocabulary(): void {
  assert(
    JSON.stringify(Object.keys(SQL_COMPARATOR).sort()) ===
      JSON.stringify([...automationRuleOperatorSchema.options].sort()),
    "SQL_COMPARATOR must cover exactly the live AutomationRuleOperator vocabulary, " +
      `got ${JSON.stringify(Object.keys(SQL_COMPARATOR).sort())} vs ` +
      `${JSON.stringify([...automationRuleOperatorSchema.options].sort())}`,
  );
}

function testNoElseAndOneWhenPerOperator(): void {
  const sql = firesCaseSql("value", "operator", "threshold_value");

  assert(
    !/\bELSE\b/i.test(sql),
    "the generated CASE must never carry an ELSE — an unevaluatable rule must read as NULL " +
      "(skipped), never as false (did not fire); see the docblock on firesCaseSql",
  );

  const whenCount = sql.match(/\bWHEN\b/gi)?.length ?? 0;
  const operatorCount = Object.keys(SQL_COMPARATOR).length;
  assert(
    whenCount === operatorCount,
    `expected exactly one WHEN arm per operator (${operatorCount}), got ${whenCount}`,
  );

  // The WHEN arms must actually be generated from SQL_COMPARATOR, not just
  // counted right by coincidence — every operator literal and every symbol
  // must appear.
  for (const [operator, symbol] of Object.entries(SQL_COMPARATOR)) {
    assert(
      sql.includes(`WHEN '${operator}' THEN value ${symbol} threshold_value`),
      `expected a WHEN arm for '${operator}' using symbol ${JSON.stringify(symbol)}, got:\n${sql}`,
    );
  }
}

function testSqlMatchesCompareOverAGrid(): void {
  const values = [-1, 0, 0.5, 1, 2];
  const thresholds = [0, 1];

  for (const operator of automationRuleOperatorSchema.options) {
    const symbol = SQL_COMPARATOR[operator];
    const predicate = JS_PREDICATE[symbol];
    assert(predicate !== undefined, `no JS predicate fixture for symbol ${JSON.stringify(symbol)}`);

    for (const value of values) {
      for (const threshold of thresholds) {
        const sqlSide = predicate(value, threshold);
        const tsSide = compare(value, operator, threshold);
        assert(
          sqlSide === tsSide,
          `SQL/TS parity broke for ${operator} (symbol ${symbol}): value=${value} threshold=${threshold} ` +
            `sql=${sqlSide} ts=${tsSide}`,
        );
      }
    }
  }
}

function testIdentifierGuardRejectsUnsafeExpressions(): void {
  const rejects = [
    "value with space",
    "value'quote",
    "value;drop",
    "value -- comment",
  ];
  for (const bad of rejects) {
    let threw = false;
    try {
      firesCaseSql(bad, "operator", "threshold_value");
    } catch (error) {
      threw = error instanceof Error;
    }
    assert(threw, `firesCaseSql must reject valueExpr ${JSON.stringify(bad)}`);
  }

  // Each argument position must be checked independently.
  for (const argPosition of [0, 1, 2] as const) {
    const args: [string, string, string] = ["value", "operator", "threshold_value"];
    args[argPosition] = "not safe";
    let threw = false;
    try {
      firesCaseSql(args[0], args[1], args[2]);
    } catch (error) {
      threw = error instanceof Error;
    }
    assert(threw, `firesCaseSql must reject an unsafe expression in argument position ${argPosition}`);
  }
}

function testIdentifierGuardAcceptsBareAndQualifiedNames(): void {
  // Must not throw.
  firesCaseSql("value", "operator", "threshold_value");
  firesCaseSql("pv.value", "r.operator", "r.threshold_value");
}

/** Assertions for ADR 0050 decision 2's SQL in-range fragment (ADR 0014, §4.6). */
export async function runInRangeSqlTests(): Promise<void> {
  testExhaustiveAgainstLiveVocabulary();
  testNoElseAndOneWhenPerOperator();
  testSqlMatchesCompareOverAGrid();
  testIdentifierGuardRejectsUnsafeExpressions();
  testIdentifierGuardAcceptsBareAndQualifiedNames();
}
