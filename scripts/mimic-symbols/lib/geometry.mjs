/**
 * `F3.32f` / ADR 0086 decision 9 (plan D6) — the geometry the source converters share: 2×3
 * affine matrices in SVG order `[a, b, c, d, e, f]` (x' = a·x + c·y + e, y' = b·x + d·y + f),
 * the fit into the 24-unit glyph box, number formatting, and baking a matrix into a shape's own
 * coordinates. Pure: no I/O. `tests/f3.32f-mimic-symbol-converters.test.ts` holds its claims.
 */

export function identity() {
  return [1, 0, 0, 1, 0, 0];
}

/** `m1 · m2`: the matrix that applies `m2` first, then `m1` (SVG transform-list order). */
export function multiply(m1, m2) {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function fromTranslate(tx, ty = 0) {
  return [1, 0, 0, 1, tx, ty];
}

export function fromScale(sx, sy = sx) {
  return [sx, 0, 0, sy, 0, 0];
}

export function fromMatrix(a, b, c, d, e, f) {
  return [a, b, c, d, e, f];
}

/** A rotation by `degrees`, about (`cx`, `cy`) when given. */
export function fromRotate(degrees, cx = 0, cy = 0) {
  const r = (degrees * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const rotate = [cos, sin, -sin, cos, 0, 0];
  if (cx === 0 && cy === 0) return rotate;
  return multiply(multiply(fromTranslate(cx, cy), rotate), fromTranslate(-cx, -cy));
}

export function fromSkewX(degrees) {
  return [1, 0, Math.tan((degrees * Math.PI) / 180), 1, 0, 0];
}

export function fromSkewY(degrees) {
  return [1, Math.tan((degrees * Math.PI) / 180), 0, 1, 0, 0];
}

const TRANSFORM_ITEM = /\s*([A-Za-z]+)\s*\(([^)]*)\)\s*,?/y;

/**
 * An SVG transform list (a source file's, so whitespace and commas are lenient) as one matrix,
 * composed left to right. Throws on an unknown function, a wrong argument count or stray text.
 */
export function parseTransformList(text) {
  let m = identity();
  const source = String(text ?? "").trim();
  TRANSFORM_ITEM.lastIndex = 0;
  let at = 0;
  while (at < source.length) {
    TRANSFORM_ITEM.lastIndex = at;
    const hit = TRANSFORM_ITEM.exec(source);
    if (!hit) throw new Error(`transform: cannot read ${JSON.stringify(source.slice(at, at + 40))}`);
    at = TRANSFORM_ITEM.lastIndex;
    const name = hit[1];
    const args = hit[2].trim() === "" ? [] : hit[2].trim().split(/[\s,]+/).map(Number);
    if (args.some((n) => !Number.isFinite(n))) throw new Error(`transform: ${name} has a non-number argument`);
    const n = args.length;
    const want = (ok) => {
      if (!ok) throw new Error(`transform: ${name} with ${n} arguments`);
    };
    let step;
    if (name === "matrix") {
      want(n === 6);
      step = fromMatrix(...args);
    } else if (name === "translate") {
      want(n === 1 || n === 2);
      step = fromTranslate(args[0], args[1] ?? 0);
    } else if (name === "scale") {
      want(n === 1 || n === 2);
      step = fromScale(args[0], args[1] ?? args[0]);
    } else if (name === "rotate") {
      want(n === 1 || n === 3);
      step = fromRotate(args[0], args[1] ?? 0, args[2] ?? 0);
    } else if (name === "skewX") {
      want(n === 1);
      step = fromSkewX(args[0]);
    } else if (name === "skewY") {
      want(n === 1);
      step = fromSkewY(args[0]);
    } else {
      throw new Error(`transform: unknown function ${name}`);
    }
    m = multiply(m, step);
  }
  return m;
}

/** The point (`x`, `y`) under `m`, as `[x', y']`. */
export function apply(m, x, y) {
  const [a, b, c, d, e, f] = m;
  return [a * x + c * y + e, b * x + d * y + f];
}

/** A vector under `m`'s linear part only (a relative path coordinate). */
function applyLinear(m, dx, dy) {
  const [a, b, c, d] = m;
  return [a * dx + c * dy, b * dx + d * dy];
}

/** No rotation and no skew: every shape can take the matrix into its own coordinates. */
export function isBakeable(m) {
  return m[1] === 0 && m[2] === 0;
}

/** The matrix that fits the box into 24×24 by one uniform scale, its centre on (12, 12). */
export function normaliseTo24({ x, y, w, h }) {
  const side = Math.max(w, h);
  if (!(side > 0)) throw new Error(`normaliseTo24: box ${w}×${h} has no size`);
  const s = 24 / side;
  return [s, 0, 0, s, 12 - s * (x + w / 2), 12 - s * (y + h / 2)];
}

/** At most two decimals, no exponent, no `-0`. Throws on a value that is not finite. */
export function format(n) {
  if (!Number.isFinite(n)) throw new Error(`format: ${n} is not a finite number`);
  const r = Math.round(n * 100) / 100;
  if (r === 0) return "0";
  const text = String(r);
  if (/e/i.test(text)) throw new Error(`format: ${n} is out of range`);
  return text;
}

const COMMANDS = "MmZzLlHhVvCcSsQqTtAa";
/** Arguments per command letter (upper case). */
const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** Path data as `[{ cmd, args: number[][] }]`, one group of arguments per implicit repetition. */
function parsePath(d) {
  const text = String(d);
  let i = 0;
  const skip = () => {
    while (i < text.length && /[\s,]/.test(text[i])) i += 1;
  };
  const number = () => {
    skip();
    const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(text.slice(i));
    if (!m) throw new Error(`path: expected a number at ${i} in ${JSON.stringify(text.slice(0, 60))}`);
    i += m[0].length;
    return Number(m[0]);
  };
  const flag = () => {
    skip();
    const ch = text[i];
    if (ch !== "0" && ch !== "1") throw new Error(`path: expected an arc flag at ${i}`);
    i += 1;
    return Number(ch);
  };
  const out = [];
  skip();
  while (i < text.length) {
    const cmd = text[i];
    if (!COMMANDS.includes(cmd)) throw new Error(`path: unexpected ${JSON.stringify(cmd)} at ${i}`);
    i += 1;
    const upper = cmd.toUpperCase();
    const groups = [];
    if (upper === "Z") {
      out.push({ cmd, args: [] });
      skip();
      continue;
    }
    do {
      const group = [];
      for (let k = 0; k < ARITY[upper]; k += 1) group.push(upper === "A" && (k === 3 || k === 4) ? flag() : number());
      groups.push(group);
      skip();
    } while (i < text.length && !COMMANDS.includes(text[i]));
    out.push({ cmd, args: groups });
  }
  return out;
}

/** An arc's radii and rotation under a bakeable `m`; throws when an ellipse would need a skew. */
function bakeArc(m, rx, ry, rotation) {
  const [a, , , d] = m;
  const sa = Math.abs(a);
  const sd = Math.abs(d);
  const turn = ((rotation % 180) + 180) % 180;
  let radii;
  if (turn === 0) radii = [rx * sa, ry * sd];
  else if (turn === 90) radii = [rx * sd, ry * sa];
  else if (sa === sd) radii = [rx * sa, ry * sa];
  else throw new Error("not bakeable: a rotated arc under a non-uniform scale");
  // A reflection in one axis turns the arc the other way.
  return [...radii, a * d < 0 ? -rotation : rotation];
}

/**
 * Path data with `m` taken into its coordinates. Absolute points take the whole matrix, relative
 * ones its linear part; `H`/`V` take the axis scale and offset; an arc's radii scale by `|a|` and
 * `|d|` and its sweep flag flips under a reflection (`a·d < 0`). A leading `m` is absolute (SVG),
 * so it is written as `M`. Throws `not bakeable` when `m` rotates or skews.
 */
export function bakePath(d, m) {
  if (!isBakeable(m)) throw new Error("not bakeable: the matrix rotates or skews");
  const [a, , , dd, e, f] = m;
  const parts = [];
  parsePath(d).forEach(({ cmd, args }, index) => {
    const upper = cmd.toUpperCase();
    const relative = cmd !== upper;
    if (upper === "Z") {
      parts.push(cmd);
      return;
    }
    const groups = args.map((group, g) => {
      const leadingMove = index === 0 && g === 0 && cmd === "m";
      const abs = !relative || leadingMove;
      const pt = (x, y) => (abs ? apply(m, x, y) : applyLinear(m, x, y));
      switch (upper) {
        case "H":
          return [relative ? a * group[0] : a * group[0] + e];
        case "V":
          return [relative ? dd * group[0] : dd * group[0] + f];
        case "A": {
          const [rx, ry, rotation] = bakeArc(m, group[0], group[1], group[2]);
          const sweep = a * dd < 0 ? 1 - group[4] : group[4];
          return [rx, ry, rotation, group[3], sweep, ...pt(group[5], group[6])];
        }
        default: {
          const out = [];
          for (let k = 0; k < group.length; k += 2) out.push(...pt(group[k], group[k + 1]));
          return out;
        }
      }
    });
    if (cmd === "m" && index === 0) {
      parts.push(`M${groups[0].map(format).join(" ")}`);
      if (groups.length > 1) parts.push(`l${groups.slice(1).flat().map(format).join(" ")}`);
      return;
    }
    parts.push(`${cmd}${groups.flat().map(format).join(" ")}`);
  });
  return parts.join(" ");
}

const num = (attrs, name) => {
  const v = attrs[name];
  if (v === undefined || v === "") return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`shape: ${name} ${JSON.stringify(v)} is not a number`);
  return n;
};

/** A point list as pairs; throws on an odd count. */
function parsePoints(text) {
  const values = String(text).trim().split(/[\s,]+/).filter((t) => t !== "").map(Number);
  if (values.length % 2 !== 0 || values.some((n) => !Number.isFinite(n))) throw new Error("shape: points is not a list of pairs");
  const pairs = [];
  for (let k = 0; k < values.length; k += 2) pairs.push([values[k], values[k + 1]]);
  return pairs;
}

/**
 * One shape with `m` (and its own `transform`, when it has one) taken into its coordinates;
 * the result carries geometry attributes only, formatted. A `circle` under a non-uniform scale
 * becomes an `ellipse`; a `rect` under a reflection keeps a positive width and height.
 */
export function bakeShape([tag, attrs], m) {
  const whole = attrs.transform ? multiply(m, parseTransformList(attrs.transform)) : m;
  if (!isBakeable(whole)) throw new Error("not bakeable: the matrix rotates or skews");
  const [a, , , d] = whole;
  const sa = Math.abs(a);
  const sd = Math.abs(d);
  const out = {};
  const put = (name, value) => {
    out[name] = format(value);
  };
  switch (tag) {
    case "circle": {
      const [cx, cy] = apply(whole, num(attrs, "cx"), num(attrs, "cy"));
      const r = num(attrs, "r");
      put("cx", cx);
      put("cy", cy);
      if (sa === sd) {
        put("r", r * sa);
        return ["circle", out];
      }
      put("rx", r * sa);
      put("ry", r * sd);
      return ["ellipse", out];
    }
    case "ellipse": {
      const [cx, cy] = apply(whole, num(attrs, "cx"), num(attrs, "cy"));
      put("cx", cx);
      put("cy", cy);
      put("rx", num(attrs, "rx") * sa);
      put("ry", num(attrs, "ry") * sd);
      return ["ellipse", out];
    }
    case "rect": {
      const x = num(attrs, "x");
      const y = num(attrs, "y");
      const [x1, y1] = apply(whole, x, y);
      const [x2, y2] = apply(whole, x + num(attrs, "width"), y + num(attrs, "height"));
      put("x", Math.min(x1, x2));
      put("y", Math.min(y1, y2));
      put("width", Math.abs(x2 - x1));
      put("height", Math.abs(y2 - y1));
      if (attrs.rx !== undefined) put("rx", num(attrs, "rx") * sa);
      if (attrs.ry !== undefined) put("ry", num(attrs, "ry") * sd);
      return ["rect", out];
    }
    case "line": {
      const [x1, y1] = apply(whole, num(attrs, "x1"), num(attrs, "y1"));
      const [x2, y2] = apply(whole, num(attrs, "x2"), num(attrs, "y2"));
      put("x1", x1);
      put("y1", y1);
      put("x2", x2);
      put("y2", y2);
      return ["line", out];
    }
    case "polyline":
    case "polygon": {
      out.points = parsePoints(attrs.points ?? "")
        .map(([x, y]) => apply(whole, x, y).map(format).join(","))
        .join(" ");
      return [tag, out];
    }
    case "path":
      out.d = bakePath(attrs.d ?? "", whole);
      return ["path", out];
    default:
      throw new Error(`shape: <${tag}> cannot be baked`);
  }
}
