import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `E4.3` PR 3 (U11) — the demo water plant at CSMOC Gauteng, held as text.
 *
 * **Why a drift gate at all (ADR 0073 decision 6, owner ruling Q3).**
 * `packages/db` cannot import the stock catalog in `apps/api` (plan fact 11),
 * so `packages/db/src/water-plant-demo-seed.ts` writes seed-side MIRROR
 * templates, `DEMO-WATER-<CLASS>`, whose six volume formulas are spelled by
 * hand. Nothing else holds them to the stock modules: a stock formula that
 * moves (a v6) would leave the demo computing the old one with every other
 * gate green. This file reads both sides as text and requires them equal,
 * byte for byte, per class and per code.
 *
 * **Why the parse is anchored and fails closed.** The stock modules' docblocks
 * spell the same formulas in prose (for example water-wtp.ts names
 * `kl_today = sum(...)` twice), and the seed module names each code five
 * times (once per class). So every read is scoped: the object literal that
 * holds `pointKey: "<code>"` is found by a forward, comment- and string-aware
 * brace scan, and the formula is taken from inside that literal only. Each
 * side must yield EXACTLY ONE non-empty match per code, or the claim fails
 * with a message naming the code — two `undefined`s never compare equal here.
 *
 * **Nothing is parsed at collection time.** Every read runs inside an `it()`,
 * so one red claim (for example a simulator claim below) cannot stop the file
 * from collecting and hide the drift gate's result. The
 * five classes and six codes are written out here rather than derived from
 * the seed text, so an empty parse cannot produce zero tests and pass.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(`${repoRoot}${rel}`, "utf8");

const SEED_MODULE = "packages/db/src/water-plant-demo-seed.ts";
const STOCK_DIR = "apps/api/src/admin/asset-templates/stock-catalog";

/** `[assetCode, stockClass, role]` — owner rulings Q4/Q10, plan U11. */
const CLASSES: readonly (readonly [string, string, string])[] = [
  ["WTR-WTP-01", "water-wtp", "intake"],
  ["WTR-RO-01", "water-ro", "internal"],
  ["WTR-CT-01", "water-cooling-tower", "internal"],
  ["WTR-STP-01", "water-stp", "reuse"],
  ["WTR-ETP-01", "water-etp", "discharge"],
];

/** The six volume codes each mirror carries (Q11: no cost, saving or recovery rows). */
const VOLUME_CODES = [
  "kl_today",
  "kl_this_month",
  "kl_this_year",
  "outlet_kl_today",
  "outlet_kl_this_month",
  "outlet_kl_this_year",
] as const;

/** Index past the string literal that opens at `start` (quote char `quote`). */
function skipString(source: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) {
      return i + 1;
    }
    i += 1;
  }
  return source.length;
}

/**
 * Every object literal (`{` … matching `}`) whose innermost open brace encloses
 * a CODE-position match of `anchor` (a sticky regex). Comments and string
 * literals are skipped, so a formula's own `{flow}` braces, a docblock that
 * spells a formula, and a backtick template in a SQL constant are all
 * invisible to both the brace stack and the anchor.
 */
function literalsAnchoredOn(source: string, anchor: RegExp): string[] {
  const sticky = new RegExp(anchor.source, "y");
  const opens: number[] = [];
  const closeOf = new Map<number, number>();
  const anchored: number[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? source.length : end + 2;
      continue;
    }
    if (ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      i = end < 0 ? source.length : end;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(source, i, ch);
      continue;
    }
    if (ch === "{") {
      opens.push(i);
      i += 1;
      continue;
    }
    if (ch === "}") {
      const open = opens.pop();
      if (open !== undefined) closeOf.set(open, i);
      i += 1;
      continue;
    }
    sticky.lastIndex = i;
    if (sticky.test(source)) {
      anchored.push(opens.length > 0 ? opens[opens.length - 1]! : -1);
    }
    i += 1;
  }
  return anchored.map((open) => {
    const close = closeOf.get(open);
    return open < 0 || close === undefined ? "" : source.slice(open, close + 1);
  });
}

/** The one literal holding `anchor`, or an error naming `what`. */
function soleLiteral(source: string, anchor: RegExp, what: string): string {
  const found = literalsAnchoredOn(source, anchor);
  if (found.length !== 1 || found[0] === "") {
    throw new Error(`${what}: expected exactly one object literal, found ${found.length}`);
  }
  return found[0]!;
}

/** The one non-empty capture of `pattern` in `text`, or an error naming `what`. */
function soleCapture(text: string, pattern: RegExp, what: string): string {
  const matches = [...text.matchAll(new RegExp(pattern.source, "g"))];
  const value = matches[0]?.[1];
  if (matches.length !== 1 || value === undefined || value === "") {
    throw new Error(`${what}: expected exactly one non-empty match, found ${matches.length}`);
  }
  return value;
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pointKeyAnchor = (code: string): RegExp => new RegExp(`pointKey:\\s*"${escape(code)}"`);
const DERIVED_FORMULA = /derived\(\s*"((?:[^"\\]|\\.)*)"/;
const SEED_FORMULA = /formula:\s*"((?:[^"\\]|\\.)*)"/;

/** The seed's class literal for `assetCode`. */
function seedClass(assetCode: string): string {
  return soleLiteral(
    read(SEED_MODULE),
    new RegExp(`assetCode:\\s*"${escape(assetCode)}"`),
    `${SEED_MODULE} class ${assetCode}`,
  );
}

/** The stock module's formula for `code`, from inside its `pointKey` literal only. */
function stockFormula(stockClass: string, code: string): string {
  const file = `${STOCK_DIR}/${stockClass}.ts`;
  const literal = soleLiteral(read(file), pointKeyAnchor(code), `${file} pointKey "${code}"`);
  return soleCapture(literal, DERIVED_FORMULA, `${file} pointKey "${code}" derived(`);
}

/** The seed's formula for `code` inside `assetCode`'s class literal only. */
function seedFormula(assetCode: string, code: string): string {
  const what = `${SEED_MODULE} ${assetCode} pointKey "${code}"`;
  const literal = soleLiteral(seedClass(assetCode), pointKeyAnchor(code), what);
  return soleCapture(literal, SEED_FORMULA, `${what} formula`);
}

describe("E4.3 U11 — the parse helpers bite (anti-vacuity)", () => {
  it("skips a docblock spelling and a string brace, and finds the one code literal", () => {
    const fixture = [
      "/** `kl_today = sum({x}, today)` and pointKey: \"kl_today\" in prose */",
      'const s = "{ pointKey: \\"kl_today\\" }";',
      'const rows = [{ ...derived("sum({x}, today)", { a: 1 }), pointKey: "kl_today" }];',
    ].join("\n");
    const literal = soleLiteral(fixture, pointKeyAnchor("kl_today"), "fixture");
    expect(soleCapture(literal, DERIVED_FORMULA, "fixture derived(")).toBe("sum({x}, today)");
  });

  it("fails closed, naming the code, when a code is absent", () => {
    expect(() => stockFormula("water-wtp", "no_such_code")).toThrow(/no_such_code.*found 0/);
  });
});

describe("E4.3 U11 — the seed declares exactly the five demo classes", () => {
  it("names the five asset codes, and no others, as class literals", () => {
    const code = read(SEED_MODULE);
    const declared = literalsAnchoredOn(code, /assetCode:\s*"/).map((literal) =>
      soleCapture(literal, /assetCode:\s*"([^"]+)"/, "assetCode"),
    );
    expect(declared.sort()).toEqual(CLASSES.map(([assetCode]) => assetCode).sort());
  });
});

describe("E4.3 U11 — each demo class mirrors the stock class it names", () => {
  for (const [assetCode, stockClass] of CLASSES) {
    it(`${assetCode} names stock class ${stockClass}`, () => {
      expect(soleCapture(seedClass(assetCode), /stockClass:\s*"([^"]+)"/, `${assetCode} stockClass`)).toBe(
        stockClass,
      );
    });
  }
});

describe("E4.3 U11 — the balance role of each demo asset (ADR 0073 decision 1)", () => {
  for (const [assetCode, , role] of CLASSES) {
    it(`${assetCode} is ${role}`, () => {
      expect(
        soleCapture(seedClass(assetCode), /role:\s*"([^"]+)"/, `${assetCode} role`),
        `${assetCode} has the wrong water balance role: the balance would count it in the wrong column`,
      ).toBe(role);
    });
  }
});

describe("E4.3 U11 — the drift gate: each mirror formula equals the stock formula byte for byte", () => {
  for (const [assetCode, stockClass] of CLASSES) {
    for (const code of VOLUME_CODES) {
      it(`${assetCode} ${code} equals ${stockClass}.ts`, () => {
        expect(
          seedFormula(assetCode, code),
          `${SEED_MODULE} ${assetCode} ${code} drifted from ${stockClass}.ts — the demo would compute a formula the stock class no longer ships`,
        ).toBe(stockFormula(stockClass, code));
      });
    }
  }
});

describe("E4.3 U11 — each mirror declares every flow its formulas read", () => {
  for (const [assetCode] of CLASSES) {
    it(`${assetCode}'s six formulas read only its declared measured flows`, () => {
      const literal = seedClass(assetCode);
      const flowsText = soleCapture(literal, /measuredFlowKeys:\s*\[([^\]]*)\]/, `${assetCode} measuredFlowKeys`);
      const declared = new Set([...flowsText.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
      const read_ = VOLUME_CODES.flatMap((code) =>
        [...seedFormula(assetCode, code).matchAll(/\{([a-z0-9_]+)\}/g)].map((m) => m[1]),
      );
      expect(read_.filter((key) => !declared.has(key))).toEqual([]);
    });
  }

  // `measuredFlowKeys` feeds the asset_points catalog rows; `flowRows` feeds the
  // template's measured rows. The claim above reads the first list, so this one
  // holds the two equal — otherwise a template could declare a flow other than
  // the one its formulas read, and no claim here would see it.
  for (const [assetCode] of CLASSES) {
    it(`${assetCode}'s template flow rows are exactly its measuredFlowKeys`, () => {
      const literal = seedClass(assetCode);
      const flowsText = soleCapture(literal, /measuredFlowKeys:\s*\[([^\]]*)\]/, `${assetCode} measuredFlowKeys`);
      const declared = [...flowsText.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
      const rowsText = soleCapture(literal, /flowRows:\s*\[([\s\S]*?)\n\s*\],/, `${assetCode} flowRows`);
      const rows = [...rowsText.matchAll(/pointKey:\s*"([^"]+)"/g)].map((m) => m[1]).sort();
      expect(rows).toEqual(declared);
    });
  }
});

/** Comments and string literals blanked, so prose naming a call is not a call. */
function codeOnly(source: string): string {
  const blank = (match: string): string => " ".repeat(match.length);
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/[^\n]*/g, blank)
    .replace(/`(?:\\.|[^`\\])*`/g, blank)
    .replace(/"(?:\\.|[^"\\])*"/g, blank);
}

function soleCallAt(code: string, call: string): number {
  const at = code.indexOf(call);
  if (at < 0) throw new Error(`seed.ts does not call ${call}`);
  if (code.indexOf(call, at + 1) >= 0) throw new Error(`seed.ts runs ${call} twice`);
  return at;
}

describe("E4.3 U11 — seed.ts runs seedWaterPlantDemo where both of its dependencies hold", () => {
  it("runs it after seedPointKeyCatalog (template_points.point_key is an FK into bms.point_keys)", () => {
    const code = codeOnly(read("packages/db/src/seed.ts"));
    expect(soleCallAt(code, "await seedPointKeyCatalog(pool);")).toBeLessThan(
      soleCallAt(code, "await seedWaterPlantDemo(pool, eskomOrgId);"),
    );
  });

  it("runs it before seedAssetTemplateHealth", () => {
    const code = codeOnly(read("packages/db/src/seed.ts"));
    expect(
      soleCallAt(code, "await seedWaterPlantDemo(pool, eskomOrgId);"),
      "seedWaterPlantDemo must run BEFORE seedAssetTemplateHealth. After it, on a cold database, " +
        "HEALTH_TEMPLATE_PIN_SQL pins the five template_id IS NULL water assets to BASELINE-WATER " +
        "(which then declares no point, so seedAssetTemplateHealth throws unusable = 1), and the " +
        "mirror pin, predicated on template_id IS NULL, would match nothing.",
    ).toBeLessThan(soleCallAt(code, "await seedAssetTemplateHealth(pool, eskomOrgId);"));
  });
});

/**
 * The SELECT of `assignEskomAssetRtus` — the first backtick template inside
 * that function's body — with its SQL `--` comments removed (so a filter that
 * is commented out does not count) and its whitespace collapsed. Fails closed,
 * naming what is missing, if the function or its SELECT cannot be found.
 */
function assignRtusSelectSql(): string {
  const source = read("packages/db/src/hierarchy-seed.ts");
  const start = source.indexOf("export async function assignEskomAssetRtus(");
  if (start < 0) throw new Error("assignEskomAssetRtus is missing from hierarchy-seed.ts");
  const end = source.indexOf("\n}\n", start);
  if (end < 0) throw new Error("assignEskomAssetRtus has no closing brace at column 0");
  const body = source.slice(start, end);
  const open = body.indexOf("`");
  const close = open < 0 ? -1 : body.indexOf("`", open + 1);
  if (close < 0) throw new Error("assignEskomAssetRtus has no SQL template");
  const sql = body
    .slice(open + 1, close)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");
  if (!/^\s*SELECT\b/.test(sql)) throw new Error("assignEskomAssetRtus's first SQL template is not its SELECT");
  return sql;
}

describe("E4.3 U11 — the water domain reaches the RTU and group derivations", () => {
  it("DOMAIN_RTU_SUFFIX names water as WATER (owner ruling Q4)", () => {
    const literal = soleLiteral(
      read("packages/db/src/hierarchy-seed.ts"),
      /electrical:\s*"ELEC"/,
      "hierarchy-seed.ts DOMAIN_RTU_SUFFIX",
    );
    expect(soleCapture(literal, /\bwater:\s*"([^"]+)"/, "DOMAIN_RTU_SUFFIX water")).toBe("WATER");
  });

  // Owner ruling R3 (2026-09-24): the WATER RTU exists at every location, but
  // assignEskomAssetRtus selects a water asset only when its code starts with
  // WTR-. Without the filter every non-manual ESKOM water asset is moved to
  // SIM-RTU-<loc>-WATER and flipped to telemetrySource simulator on each boot;
  // apps/sim feeds it nothing (R2), and ingest drops a real meter's readings.
  it("assignEskomAssetRtus selects a water asset only when its code starts with WTR- (owner ruling R3)", () => {
    expect(assignRtusSelectSql()).toContain("AND (a.domain <> 'water' OR a.code LIKE 'WTR-%')");
  });

  it("demoGroupCodesForAsset files a water asset under the water group alone", () => {
    const source = read("packages/db/src/asset-groups-seed.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const start = source.indexOf("export function demoGroupCodesForAsset(");
    if (start < 0) throw new Error("demoGroupCodesForAsset is missing from asset-groups-seed.ts");
    const body = source.slice(start, source.indexOf("\n}\n", start)).replace(/\s+/g, " ");
    expect(body).toContain('if (domain === "water") { return ["water"]; }');
  });
});

/**
 * `E4.3` U12 — `apps/sim/src/index.js` dispatches by domain with an
 * electrical default (plan fact 14); without `stepWater` the five water
 * assets would emit `kw`/`voltage_l1_v` instead of their flows. Written with
 * U11 so U12 had its red test waiting. What the claims below hold, and what
 * they do not:
 *
 * - The per-class claims hold each ENTRY of `stepWater`'s `WATER_FLOWS` table
 *   (the key set written under a class name) equal to the seed's
 *   `measuredFlowKeys` for that class, plus its named extras. An entry that
 *   carries another class's keys, or drops one of its own, reddens.
 * - They do NOT see which entry an asset reads. That is `waterClassOf`'s
 *   answer, and the class-map claims below hold it separately: exactly five
 *   `-X-` infix to class pairs, each infix `-X-` returning class `X`, and the
 *   `WTR-` guard first (owner ruling R2). Before those claims, a
 *   `waterClassOf` that sent `-WTP-` to `RO` left every claim here green.
 * - Neither reads the walk's numbers; the balance figures are the stack's.
 */
const SIM_WATER_FLOW_KEYS = [
  "raw_water_flow_klh",
  "treated_water_flow_klh",
  "feed_flow_klh",
  "permeate_flow_klh",
  "reject_flow_klh",
  "makeup_flow_klh",
  "blowdown_flow_klh",
  "circ_flow_klh",
  "influent_flow_klh",
  "effluent_flow_klh",
  "ras_flow_klh",
  "discharge_flow_klh",
] as const;

/** apps/sim/src/index.js with its comments removed. */
function simCode(): string {
  return read("apps/sim/src/index.js")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function simBodyOf(name: string): string {
  const code = simCode();
  const start = code.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name}() is missing from apps/sim/src/index.js`);
  const end = code.indexOf("\n}\n", start);
  if (end < 0) throw new Error(`${name}() has no closing brace at column 0`);
  return code.slice(start, end);
}

/** The module-scope `WATER_POINT_KEYS` list; fails closed on a missing or empty list. */
function bannerWaterPointKeys(): string[] {
  const inner = soleCapture(simCode(), /const WATER_POINT_KEYS = \[([^\]]*)\]/, "apps/sim WATER_POINT_KEYS");
  const keys = [...inner.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]!);
  if (keys.length === 0) throw new Error("apps/sim WATER_POINT_KEYS: found no keys");
  return keys;
}

/** Every key of every `<CLASS>: { ... }` entry of stepWater's WATER_FLOWS; fails closed on none. */
function waterFlowsKeyUnion(): string[] {
  const table = soleCapture(simBodyOf("stepWater"), /const WATER_FLOWS = \{([\s\S]*?)\n\s*\};/, "stepWater WATER_FLOWS");
  const entries = [...table.matchAll(/\b[A-Z]+:\s*\{([^{}]*)\}/g)].map((m) => m[1]!);
  if (entries.length === 0) throw new Error("stepWater WATER_FLOWS: found no class entry");
  const keys = entries.flatMap((inner) => [...inner.matchAll(/([a-z0-9_]+)\s*:/g)].map((m) => m[1]!));
  if (keys.length === 0) throw new Error("stepWater WATER_FLOWS: found no flow keys");
  return keys;
}

/**
 * Extras `stepWater` emits beyond the class's `measuredFlowKeys` (E4.3 U11):
 * realistic third flows no balance formula reads. Exact, not a superset check
 * — a class's `WATER_FLOWS` entry must list precisely its `measuredFlowKeys`
 * plus this list, no more and no fewer, or a swapped/dropped key reddens the
 * claim below.
 */
const SIM_ONLY_FLOWS: Record<string, readonly string[]> = {
  WTP: [],
  RO: ["reject_flow_klh"],
  CT: ["circ_flow_klh"],
  STP: ["ras_flow_klh"],
  ETP: [],
};

/** `[assetCode, stockClass, role, infixClass]`. */
const CLASSES_WITH_INFIX: readonly (readonly [string, string, string, string])[] = [
  ["WTR-WTP-01", "water-wtp", "intake", "WTP"],
  ["WTR-RO-01", "water-ro", "internal", "RO"],
  ["WTR-CT-01", "water-cooling-tower", "internal", "CT"],
  ["WTR-STP-01", "water-stp", "reuse", "STP"],
  ["WTR-ETP-01", "water-etp", "discharge", "ETP"],
];

/**
 * The one `<CLASS>: { key: number, ... }` entry of `stepWater`'s `WATER_FLOWS`
 * table, as a key set. No entry's values nest braces, so a plain (non
 * brace-stack) capture is exact here; fails closed, naming the class, on zero
 * or more than one match, or on a match with no keys inside it — an empty set
 * must never equal an empty set.
 */
function simFlowKeysFor(klass: string): string[] {
  const body = simBodyOf("stepWater");
  const inner = soleCapture(body, new RegExp(`\\b${klass}:\\s*\\{([^{}]*)\\}`), `stepWater WATER_FLOWS.${klass}`);
  const keys = [...inner.matchAll(/([a-z0-9_]+)\s*:/g)].map((m) => m[1]!);
  if (keys.length === 0) {
    throw new Error(`stepWater WATER_FLOWS.${klass}: found no flow keys — an empty set must not equal an empty set`);
  }
  return keys;
}

describe("E4.3 U12 — apps/sim emits the demo plant's flows", () => {
  it('tick() dispatches row.domain === "water"', () => {
    expect(simBodyOf("tick")).toContain('row.domain === "water"');
  });

  // The claim above and a bare "stepWater(" check both stay green when the
  // water arm calls stepElectrical while stepWater( appears elsewhere in
  // tick(). This one reads the arm itself.
  it('tick()\'s row.domain === "water" arm calls stepWater(row.id, row.code)', () => {
    expect(simBodyOf("tick")).toMatch(/row\.domain\s*===\s*"water"\s*\?\s*stepWater\(\s*row\.id\s*,\s*row\.code\s*\)/);
  });

  // WATER_POINT_KEYS is the startup banner's hand-kept copy of the keys
  // stepWater emits; removing one from it left every other claim green.
  it("the banner's WATER_POINT_KEYS equals, as a set, the union of stepWater's WATER_FLOWS keys", () => {
    expect([...new Set(bannerWaterPointKeys())].sort()).toEqual([...new Set(waterFlowsKeyUnion())].sort());
  });

  it("stepWater() names the twelve distinct flow keys (thirteen per-class flows)", () => {
    const body = simBodyOf("stepWater");
    // The plan's thirteen flows hold twelve distinct keys: the STP and the ETP
    // both emit influent_flow_klh. There is no thirteenth key to look for.
    expect(SIM_WATER_FLOW_KEYS.filter((key) => !body.includes(key))).toEqual([]);
  });

  // A `stepWater` that names all twelve keys somewhere in its body still
  // passes the claim above even if its WTP entry lists the RO keys — and
  // then the WTP's `kl_today`/`outlet_kl_today` calc rows read nothing.
  // This claim reads each WATER_FLOWS ENTRY's key set and holds it equal to
  // the seed's `measuredFlowKeys` for that class, plus the one realistic extra
  // (if any) the class carries — taken from the seed module, not repeated by
  // hand, so a `measuredFlowKeys` edit in U11's file cannot silently pass here.
  // It does not see which entry an asset reads; the waterClassOf claims below
  // hold that.
  for (const [assetCode, , , klass] of CLASSES_WITH_INFIX) {
    it(`${assetCode}'s -${klass}- flows equal the seed's measuredFlowKeys plus its realistic extras`, () => {
      const literal = seedClass(assetCode);
      const flowsText = soleCapture(literal, /measuredFlowKeys:\s*\[([^\]]*)\]/, `${assetCode} measuredFlowKeys`);
      const measured = [...flowsText.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
      const expected = [...measured, ...SIM_ONLY_FLOWS[klass]!].sort();
      const actual = simFlowKeysFor(klass).sort();
      expect(actual, `apps/sim/src/index.js stepWater's ${klass} flows do not match ${assetCode}'s measuredFlowKeys`).toEqual(
        expected,
      );
    });
  }
});

/**
 * Every `code.includes("-X-")) return "Y"` pair in `waterClassOf`'s body, as
 * `[infix, class]`. Fails closed: a body that yields no pair throws, naming
 * the function, so a reformatted or renamed body can never pass as zero
 * pairs that trivially match.
 */
function classPairsIn(body: string): (readonly [string, string])[] {
  const pairs = [...body.matchAll(/code\.includes\(\s*"-([A-Z]+)-"\s*\)\s*\)\s*return\s+"([A-Z]+)"/g)].map(
    (m) => [m[1]!, m[2]!] as const,
  );
  if (pairs.length === 0) {
    throw new Error('waterClassOf: parsed no code.includes("-X-")) return "Y" pair — the class map is not held');
  }
  return pairs;
}

describe("E4.3 U12 — waterClassOf sends each infix to its own class (anti-vacuity)", () => {
  it("the pair parser fails closed on a body with no pair", () => {
    expect(() => classPairsIn("function waterClassOf(code) {\n  return null;")).toThrow(/parsed no/);
  });
});

describe("E4.3 U12 — waterClassOf sends each infix to its own class", () => {
  it("parses exactly five infix-to-class pairs", () => {
    expect(classPairsIn(simBodyOf("waterClassOf")).map(([infix]) => infix).sort()).toEqual(
      CLASSES_WITH_INFIX.map(([, , , klass]) => klass).sort(),
    );
  });

  for (const [assetCode, , , klass] of CLASSES_WITH_INFIX) {
    it(`-${klass}- (${assetCode}) returns class ${klass}`, () => {
      const matching = classPairsIn(simBodyOf("waterClassOf")).filter(([infix]) => infix === klass);
      expect(matching.length, `waterClassOf has ${matching.length} -${klass}- branches, wanted exactly one`).toBe(1);
      expect(
        matching[0]![1],
        `waterClassOf sends -${klass}- to ${matching[0]![1]}: ${assetCode} would emit another class's flows`,
      ).toBe(klass);
    });
  }

  it("returns null for any code that does not start with WTR- (owner ruling R2), before any infix test", () => {
    const body = simBodyOf("waterClassOf").replace(/\s+/g, " ");
    const guard = body.indexOf('if (!code.startsWith("WTR-")) return null;');
    expect(guard, "waterClassOf does not return null for a non-WTR- code").toBeGreaterThan(-1);
    expect(guard, "waterClassOf tests an infix before the WTR- guard").toBeLessThan(body.indexOf("code.includes("));
  });
});

/**
 * The PR 3 sweep review: the verify pin count pairs each demo asset code with its
 * own class's template code. A revert to a `DEMO-WATER-` prefix match stays green
 * on every fresh database (no demo asset is pinned to another mirror there), so
 * the pairing is held here by text. SQL comments are stripped first.
 */
function verifyWaterSql(): string {
  const source = read("packages/db/src/verify-hierarchy-seed.ts").replace(/--.*$/gm, "");
  const at = source.indexOf("AS eskom_water_assets_on_demo_templates");
  if (at < 0) throw new Error("eskom_water_assets_on_demo_templates is missing from verify-hierarchy-seed.ts");
  const start = source.lastIndexOf("(SELECT COUNT(*)", at);
  if (start < 0) throw new Error("the pin count's SELECT was not found");
  return source.slice(start, at);
}

describe("E4.3 PR 3 sweep — the verify pin count pairs each demo asset with its own template", () => {
  it("pairs the asset codes ($2) with the template codes ($3) through unnest", () => {
    expect(verifyWaterSql().replace(/\s+/g, " ")).toContain(
      "(a.code, t.code) IN ( SELECT x.asset_code, x.template_code FROM unnest($2::varchar[], $3::varchar[])",
    );
  });

  it("does not match the pin by a DEMO-WATER- prefix", () => {
    expect(verifyWaterSql()).not.toMatch(/LIKE\s+'DEMO-WATER-/);
  });

  it("binds DEMO_WATER_TEMPLATE_CODES as $3, after the asset codes", () => {
    const source = read("packages/db/src/verify-hierarchy-seed.ts");
    expect(source).toMatch(/\[\s*eskomOrgId,\s*DEMO_WATER_ASSET_CODES,\s*DEMO_WATER_TEMPLATE_CODES\s*\]/);
  });
});
