import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const WEB_DIR = "apps/web/src/components/widgets/mimic-symbol-libraries";

/** Every library with a generated web shapes module: 0090's three and 0092's three. */
const PREFIXES = ["TABLER", "LUCIDE", "MDI", "QET", "WMPID", "DRAWIO"] as const;

const BOX_MIN = -1;
const BOX_MAX = 25;

/** The `<PREFIX>_SHAPES` record's body lines, one `"key": [shapes],` each; fails closed. */
function shapeEntries(prefix: string): Array<{ key: string; body: string }> {
  const source = read(`${WEB_DIR}/${prefix.toLowerCase()}.generated.ts`);
  const decl = source.indexOf(`export const ${prefix}_SHAPES`);
  if (decl < 0) throw new Error(`no ${prefix}_SHAPES`);
  const open = source.indexOf("> = {", decl);
  const close = source.indexOf("\n};", open);
  if (open < 0 || close < 0) throw new Error(`${prefix}_SHAPES: no record body`);
  return source
    .slice(open + "> = {".length, close)
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const m = /^\s*"([^"]+)": (\[.*\]),$/.exec(line);
      if (!m) throw new Error(`${prefix}_SHAPES: unparsed line: ${line.slice(0, 120)}`);
      return { key: m[1] as string, body: m[2] as string };
    });
}

/** Every `["tag", { … }]` in a shapes body, its attributes as a map. */
function shapesOf(body: string): Array<{ tag: string; attrs: Record<string, string> }> {
  return [...body.matchAll(/\["([^"]*)",\s*\{([^}]*)\}\]/g)].map((m) => ({
    tag: m[1] as string,
    attrs: Object.fromEntries(
      [...(m[2] as string).matchAll(/([A-Za-z_$][\w$]*)\s*:\s*"([^"]*)"/g)].map((a) => [a[1] as string, a[2] as string]),
    ),
  }));
}

/**
 * Every absolute coordinate of one shape, x and y flattened in order; `null` for a shape with a
 * `transform` (it keeps its source coordinates). A path contributes each command's endpoint —
 * the current point after it, relative commands resolved; control points, arc radii, rotation
 * and flags are not coordinates of the box and are not read.
 */
function shapeCoordinates(tag: string, a: Record<string, string>): number[] | null {
  if (a.transform !== undefined) return null;
  const num = (name: string): number[] => (a[name] === undefined ? [] : [Number(a[name])]);
  switch (tag) {
    case "circle":
    case "ellipse":
      return [...num("cx"), ...num("cy")];
    case "rect": {
      const x = Number(a.x ?? 0);
      const y = Number(a.y ?? 0);
      return [x, y, x + Number(a.width ?? 0), y + Number(a.height ?? 0)];
    }
    case "line":
      return [...num("x1"), ...num("y1"), ...num("x2"), ...num("y2")];
    case "polyline":
    case "polygon":
      return (a.points ?? "")
        .trim()
        .split(/[\s,]+/)
        .filter((t) => t !== "")
        .map(Number);
    case "path":
      return pathEndpoints(a.d ?? "");
    default:
      throw new Error(`unknown shape tag ${tag}`);
  }
}

const ARGS: Readonly<Record<string, number>> = { m: 2, l: 2, t: 2, h: 1, v: 1, c: 6, s: 4, q: 4, a: 7, z: 0 };

/** Each endpoint of SVG path data, absolute. An arc's two flags may be written without a separator. */
function pathEndpoints(d: string): number[] {
  let i = 0;
  const skip = (): void => {
    while (i < d.length && /[\s,]/.test(d[i] as string)) i += 1;
  };
  const number = (): number => {
    skip();
    const m = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i.exec(d.slice(i));
    if (!m) throw new Error(`path data: no number at ${i} in ${d.slice(0, 60)}`);
    i += m[0].length;
    return Number(m[0]);
  };
  const flag = (): number => {
    skip();
    const c = d[i];
    if (c !== "0" && c !== "1") throw new Error(`path data: no arc flag at ${i} in ${d.slice(0, 60)}`);
    i += 1;
    return Number(c);
  };
  const out: number[] = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let cmd = "";
  for (;;) {
    skip();
    if (i >= d.length) break;
    if (/[A-Za-z]/.test(d[i] as string)) {
      cmd = d[i] as string;
      i += 1;
    } else if (cmd === "") throw new Error(`path data: no command at ${i}`);
    else if (cmd === "M") cmd = "L";
    else if (cmd === "m") cmd = "l";
    const lower = cmd.toLowerCase();
    const count = ARGS[lower];
    if (count === undefined) throw new Error(`path data: unknown command ${cmd}`);
    if (lower === "z") {
      x = sx;
      y = sy;
      out.push(x, y);
      continue;
    }
    const args: number[] = [];
    for (let k = 0; k < count; k += 1) args.push(lower === "a" && (k === 3 || k === 4) ? flag() : number());
    const ox = cmd === lower ? x : 0;
    const oy = cmd === lower ? y : 0;
    if (lower === "h") x = ox + (args[0] as number);
    else if (lower === "v") y = oy + (args[0] as number);
    else {
      x = ox + (args[count - 2] as number);
      y = oy + (args[count - 1] as number);
    }
    if (lower === "m") {
      sx = x;
      sy = y;
    }
    out.push(x, y);
  }
  return out;
}

/**
 * `F3.32f` slice 2 review fix / ADR 0086 decision 9 — every vendored glyph stays inside its
 * 24-unit box. The grammar parse, the colour scan, the three-way key gate and S17 all passed while
 * `wmpid:compressor` (a `16mm` root with no viewBox, its unit stripped rather than converted to
 * px) drew about 3.8× too large and off centre. This scan reads every absolute coordinate of each
 * shape without a `transform` in the six generated web modules and requires it in [-1, 25].
 * Assertions inline, no `.spec` sibling (§4.6).
 *
 * Mutation that reddens the per-library claim: in `boxOf` (`scripts/mimic-symbols/sources/wmpid.mjs`)
 * return the bare number again and regenerate `--only wmpid` → the WMPID claim lists
 * `wmpid:compressor`.
 */
describe("F3.32f — every vendored glyph fits its 24-unit box", () => {
  for (const prefix of PREFIXES) {
    it(`every ${prefix} coordinate of an untransformed shape is inside [${BOX_MIN}, ${BOX_MAX}]`, () => {
      const entries = shapeEntries(prefix);
      let coordinates = 0;
      const outside: string[] = [];
      for (const { key, body } of entries) {
        for (const { tag, attrs } of shapesOf(body)) {
          const values = shapeCoordinates(tag, attrs);
          if (values === null) continue;
          coordinates += values.length;
          const bad = values.find((v) => !(v >= BOX_MIN && v <= BOX_MAX));
          if (bad !== undefined) outside.push(`${key} ${tag} ${bad}`);
        }
      }
      // Positive control: the scan read more coordinates than the module has keys.
      expect(coordinates, `${prefix} coordinates read`).toBeGreaterThan(entries.length);
      expect(outside).toEqual([]);
    });
  }

  it("flags the shipped compressor's out-of-box arc endpoint (positive control)", () => {
    const values = shapeCoordinates("path", { d: "M5.32 49.63 A21.26 21.26 0 1 1 5.32 49.71" }) ?? [];
    expect(values).toEqual([5.32, 49.63, 5.32, 49.71]);
    expect(values.some((v) => v > BOX_MAX)).toBe(true);
  });

  it("reads a circle's centre, not its radius", () => {
    expect(shapeCoordinates("circle", { cx: "30", cy: "12", r: "2" })).toEqual([30, 12]);
  });

  it("resolves relative commands from the current point and skips arc radii and rotation", () => {
    expect(shapeCoordinates("path", { d: "M2 2 l3 4 h1 v-2 a179.97 28.8 45 0 1 1 1 z" })).toEqual([2, 2, 5, 6, 6, 6, 6, 4, 7, 5, 2, 2]);
  });

  it("reads two arc flags written without a separator", () => {
    expect(shapeCoordinates("path", { d: "M1 1a2 2 0 011 1" })).toEqual([1, 1, 2, 2]);
  });

  it("skips a shape that carries a transform", () => {
    expect(shapeCoordinates("path", { d: "M37.2 13.36 L90 90", transform: "matrix(1,0,0,1,0,0)" })).toBeNull();
  });
});
