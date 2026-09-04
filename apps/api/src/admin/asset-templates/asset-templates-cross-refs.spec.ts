import { crossRefPointKeys } from "./asset-templates-cross-refs";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function keys(points: Parameters<typeof crossRefPointKeys>[0]): string[] {
  return crossRefPointKeys(points)
    .map((point) => point.pointKey)
    .sort();
}

/**
 * `F2.9` / ADR 0055 — the point keys a `bms-calc-v2` formula names *inside* its
 * own text, which no foreign key can see.
 */
export function runCrossRefPointKeyTests(): void {
  assert(
    keys([
      { pointKey: "A", kind: "measured" },
      { pointKey: "D", kind: "derived", formula: "{A}", formulaDialect: "bms-calc-v1" },
    ]).length === 0,
    "a bms-calc-v1 formula has no cross references — its every `{ref}` is a local key " +
      "`template_points_point_key_fkey` already holds",
  );

  assert(
    keys([
      {
        pointKey: "total_kw",
        kind: "derived",
        formula: "sum({kw} @site) / sum({kw} @group('IT_LOAD'))",
        formulaDialect: "bms-calc-v2",
      },
    ]).join(",") === "kw",
    "an aggregate's point key must be reported once, however many scopes name it",
  );

  assert(
    keys([
      {
        pointKey: "loss",
        kind: "derived",
        formula: "{TX_01.kwh} - {TX_02.kwh}",
        formulaDialect: "bms-calc-v2",
      },
    ]).join(",") === "kwh",
    "a qualified reference names a point key too — the asset code resolves at evaluation " +
      "time, but the key must exist in the catalog now",
  );

  assert(
    keys([
      {
        pointKey: "mixed",
        kind: "derived",
        formula: "sum({kw} @site) + {local}",
        formulaDialect: "bms-calc-v2",
      },
    ]).join(",") === "kw",
    "a local reference is NOT a cross reference — it is already declared in the array and " +
      "checked by the sibling rule, and reporting it here would double-count",
  );

  // Totality. `publish` re-validates *stored* rows, which zod never saw: a row
  // written before this guard, or by the seed, can hold anything. A throw here
  // would turn a publish into a 500.
  assert(
    keys([
      { pointKey: "broken", kind: "derived", formula: "sum({kw}", formulaDialect: "bms-calc-v2" },
      { pointKey: "empty", kind: "derived", formula: null, formulaDialect: "bms-calc-v2" },
      { pointKey: "no-dialect", kind: "derived", formula: "sum({kw} @site)", formulaDialect: null },
      { pointKey: "measured", kind: "measured", formula: "sum({kw} @site)", formulaDialect: "bms-calc-v2" },
      { pointKey: "loose" },
    ]).length === 0,
    "an unparseable, dialect-less, formula-less or measured row must yield no keys rather " +
      "than throwing — this runs over stored rows on the publish path",
  );

  assert(
    keys([
      { pointKey: "a", kind: "derived", formula: "sum({kw} @site)", formulaDialect: "bms-calc-v2" },
      { pointKey: "b", kind: "derived", formula: "avg({kw} @domain('hvac'))", formulaDialect: "bms-calc-v2" },
      { pointKey: "c", kind: "derived", formula: "sum({kwh} @site)", formulaDialect: "bms-calc-v2" },
    ]).join(",") === "kw,kwh",
    "keys must be de-duplicated across points — the catalog read is one `IN` list",
  );
}
