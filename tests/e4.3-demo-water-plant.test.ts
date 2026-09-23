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
 * so one red claim (the U12 simulator claims below stay red until U12 lands)
 * cannot stop the file from collecting and hide the drift gate's result. The
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

describe("E4.3 U11 — the water domain reaches the RTU and group derivations", () => {
  it("DOMAIN_RTU_SUFFIX names water as WATER (owner ruling Q4)", () => {
    const literal = soleLiteral(
      read("packages/db/src/hierarchy-seed.ts"),
      /electrical:\s*"ELEC"/,
      "hierarchy-seed.ts DOMAIN_RTU_SUFFIX",
    );
    expect(soleCapture(literal, /\bwater:\s*"([^"]+)"/, "DOMAIN_RTU_SUFFIX water")).toBe("WATER");
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
 * `E4.3` U12 — EXPECTED RED UNTIL U12 LANDS. `apps/sim/src/index.js` dispatches
 * by domain with an electrical default (plan fact 14), so until U12 adds
 * `stepWater` the five water assets would emit `kw`/`voltage_l1_v`. Written
 * with U11 so U12 has its red test waiting; not skipped, so it cannot be
 * forgotten green.
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

function simBodyOf(name: string): string {
  const code = read("apps/sim/src/index.js")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const start = code.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name}() is missing from apps/sim/src/index.js`);
  const end = code.indexOf("\n}\n", start);
  if (end < 0) throw new Error(`${name}() has no closing brace at column 0`);
  return code.slice(start, end);
}

describe("E4.3 U12 (EXPECTED RED until U12) — apps/sim emits the demo plant's flows", () => {
  it('tick() dispatches row.domain === "water"', () => {
    expect(simBodyOf("tick")).toContain('row.domain === "water"');
  });

  it("tick() calls stepWater(", () => {
    expect(simBodyOf("tick")).toContain("stepWater(");
  });

  it("stepWater() names the twelve distinct flow keys (thirteen per-class flows)", () => {
    const body = simBodyOf("stepWater");
    // The plan's thirteen flows hold twelve distinct keys: the STP and the ETP
    // both emit influent_flow_klh. There is no thirteenth key to look for.
    expect(SIM_WATER_FLOW_KEYS.filter((key) => !body.includes(key))).toEqual([]);
  });
});
