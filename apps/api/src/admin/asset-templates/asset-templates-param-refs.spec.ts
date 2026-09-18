import { paramRefKeys } from "./asset-templates-param-refs";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `E4.1a` / ADR 0070 decision 4 — the `$key`s a `bms-calc-v3` formula names
 * inside its own text, which the save-time vocabulary check hands to
 * `CalcParametersService.unknownKeys`. Pure and total: a formula that does
 * not parse yields nothing and never throws — the parse error is the schema's
 * to report, and this function runs after it.
 */
export function runParamRefKeyTests(): void {
  assert(
    paramRefKeys([
      { pointKey: "A", kind: "measured" },
      { pointKey: "D", kind: "derived", formula: "{A}", formulaDialect: "bms-calc-v1" },
      { pointKey: "S", kind: "derived", formula: "sum({A} @site)", formulaDialect: "bms-calc-v2" },
    ]).length === 0,
    "a v1 or v2 formula has no parameter references",
  );

  assert(
    paramRefKeys([
      { pointKey: "COST", kind: "derived", formula: "{kw} * $energy_tariff_per_kwh", formulaDialect: "bms-calc-v3" },
      { pointKey: "CO2", kind: "derived", formula: "{kw} * $grid_carbon_factor_kgco2_per_kwh + $energy_tariff_per_kwh", formulaDialect: "bms-calc-v3" },
    ]).join(",") === "energy_tariff_per_kwh,grid_carbon_factor_kgco2_per_kwh",
    "every distinct $key across the v3 points, once, in first-appearance order",
  );

  assert(
    paramRefKeys([{ pointKey: "BAD", kind: "derived", formula: "{kw} * $", formulaDialect: "bms-calc-v3" }]).length === 0,
    "an unparseable v3 formula yields nothing and does not throw",
  );
  assert(
    paramRefKeys([{ pointKey: "M", kind: "measured", formula: "$f", formulaDialect: "bms-calc-v3" }]).length === 0,
    "a measured point's formula is never read",
  );
  assert(
    paramRefKeys([{ pointKey: "N", kind: "derived", formula: null, formulaDialect: "bms-calc-v3" }]).length === 0,
    "a derived point without a formula yields nothing",
  );

  // KPI expressions are read too: a v3 KPI names keys the same way
  assert(
    paramRefKeys([], [{ expression: "{kw} * $rated_kw", dialect: "bms-calc-v3" }, { expression: "{a} + $x", dialect: "bms-calc-v2" }]).join(",") ===
      "rated_kw",
    "a v3 KPI expression contributes its keys; a v2 one cannot hold a $ and contributes nothing",
  );
}
