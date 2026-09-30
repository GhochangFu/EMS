import { MIMIC_NUMBER_RE, MIMIC_PATH_DATA_RE, MIMIC_SHAPE_ATTRS, MIMIC_TRANSFORM_RE, mimicShapeSchema } from "./mimic-shapes";

/**
 * `F3.32f` / ADR 0086 decision 9 — the shape grammar a library glyph may draw, `transform`
 * included. Assertions live here; `mimic-shapes.test.ts` is the Vitest entry point (ADR 0014).
 * One claim per exported function.
 *
 * The refusal claims test `MIMIC_TRANSFORM_RE` directly, not through the schema: the schema's own
 * `.max(256)` would keep the length claim green if the expression lost its bound.
 * Mutations that redden these claims: drop `"transform"` from `MIMIC_SHAPE_ATTRS` →
 * `shapeAttrsAreTheFifteenPlusTransformLast`; replace `MIMIC_TRANSFORM_RE` with `/.*\/` → every
 * `transformRefuses*` claim.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function accepts(value: string): void {
  assert(MIMIC_TRANSFORM_RE.test(value), `transform ${JSON.stringify(value)} should be accepted`);
}

function refuses(value: string): void {
  assert(!MIMIC_TRANSFORM_RE.test(value), `transform ${JSON.stringify(value)} should be refused`);
}

/** A value of exactly `length` characters made of valid `scale(1)` functions and one filler. */
function transformOfLength(length: number): string {
  const unit = "scale(1) ";
  const head = unit.repeat(Math.floor((length - 8) / unit.length));
  const tail = `scale(${"1".repeat(length - head.length - "scale()".length)})`;
  const value = `${head}${tail}`;
  assert(value.length === length, `built ${value.length}, wanted ${length}`);
  return value;
}

/** The fifteen geometry names of ADR 0084 decision 5, then `transform` (ADR 0086 decision 9). */
export function shapeAttrsAreTheFifteenPlusTransformLast(): void {
  const expected = ["d", "cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "x1", "y1", "x2", "y2", "points", "transform"];
  assert(JSON.stringify(MIMIC_SHAPE_ATTRS) === JSON.stringify(expected), `attrs: ${JSON.stringify(MIMIC_SHAPE_ATTRS)}`);
}

export function transformAcceptsMatrix(): void {
  accepts("matrix(1,0,0,1,0,0)");
}

export function transformAcceptsTranslate(): void {
  accepts("translate(1.5,-2)");
}

export function transformAcceptsScale(): void {
  accepts("scale(.5)");
}

export function transformAcceptsRotateAboutACentre(): void {
  accepts("rotate(90,12,12)");
}

export function transformAcceptsSkewX(): void {
  accepts("skewX(10)");
}

export function transformAcceptsSkewY(): void {
  accepts("skewY(-3)");
}

export function transformAcceptsTwoFunctionsJoinedByOneSpace(): void {
  accepts("translate(1 2) scale(2)");
}

/** Positive control for the length refusal: 256 characters of valid functions pass. */
export function transformAcceptsTwoHundredFiftySixCharacters(): void {
  accepts(transformOfLength(256));
}

export function transformRefusesAUrl(): void {
  refuses("url(#a)");
}

export function transformRefusesAJavascriptUrl(): void {
  refuses("javascript:x");
}

export function transformRefusesANonNumberArgument(): void {
  refuses("matrix(a,0,0,1,0,0)");
}

export function transformRefusesASemicolon(): void {
  refuses("translate(1;2)");
}

export function transformRefusesTwoHundredFiftySevenCharacters(): void {
  refuses(transformOfLength(257));
}

export function transformRefusesTwoSpaces(): void {
  refuses("translate(1  2)");
}

export function transformRefusesATrailingComma(): void {
  refuses("matrix(1,0,0,1,0,0,)");
}

export function transformRefusesALeadingSpace(): void {
  refuses(" scale(1)");
}

/** `x` is not an SVG path command. */
export function pathDataRefusesALetterOutsideTheCommandSet(): void {
  assert(MIMIC_PATH_DATA_RE.test("M0 0 L1 1"), "positive control: M0 0 L1 1 should pass");
  assert(!mimicShapeSchema.safeParse(["path", { d: "M0 0 L1 1 x" }]).success, "d with x should be refused");
}

/** `.strict()`: a colour attribute is not geometry. */
export function aShapeWithAnUnknownAttributeIsRefused(): void {
  assert(mimicShapeSchema.safeParse(["circle", { r: "2" }]).success, "positive control: a bare circle should parse");
  assert(!mimicShapeSchema.safeParse(["circle", { r: "2", fill: "red" }]).success, "fill should be refused");
}

export function aShapeWithATransformParses(): void {
  const parsed = mimicShapeSchema.safeParse(["rect", { x: "1", y: "2", width: "3", height: "4", transform: "matrix(2,0,0,-1,0,24)" }]);
  assert(parsed.success, `rect with a transform: ${parsed.success ? "" : parsed.error.message}`);
}

/** Milliseconds one `re.test(value)` takes. */
function timed(re: RegExp, value: string): { matched: boolean; ms: number } {
  const start = performance.now();
  const matched = re.test(value);
  return { matched, ms: performance.now() - start };
}

/**
 * ReDoS (review blocker): a 20,000-digit run with a trailing letter is refused in linear time.
 * The ambiguous `\d+\.?\d*` took ~1.4 s on this input (O(n²)); the unambiguous form takes ~0 ms.
 */
export function aLongDigitRunIsRefusedInLinearTime(): void {
  const { matched, ms } = timed(MIMIC_NUMBER_RE, `${"1".repeat(20_000)}x`);
  assert(!matched, "a digit run ending in x should be refused");
  assert(ms < 100, `MIMIC_NUMBER_RE took ${Math.round(ms)} ms on a 20,000-digit run`);
}

/**
 * ReDoS (review blocker): `matrix(` with six 16-digit runs and a trailing `x` is refused in linear
 * time. The ambiguous number multiplied its backtracking across the six (seconds at 16 digits,
 * no end at 40); the unambiguous one does not.
 */
export function sixLongMatrixNumbersAreRefusedInLinearTime(): void {
  const { matched, ms } = timed(MIMIC_TRANSFORM_RE, `matrix(${Array(6).fill("1".repeat(16)).join(",")}x`);
  assert(!matched, "an unclosed matrix should be refused");
  assert(ms < 100, `MIMIC_TRANSFORM_RE took ${Math.round(ms)} ms on six 16-digit numbers`);
}

/** Plan D1: a number may carry `+`, and an exponent in `e` or `E` with a sign — editors emit both. */
export function signedExponentsAreNumbers(): void {
  for (const value of ["1", "1.", "1.5", ".5", "-2e-3", "1e5", "+1E-5", "1E+2"]) {
    assert(MIMIC_NUMBER_RE.test(value), `${value} should be a number`);
  }
  for (const value of ["a", "1.2.3", "1e", ".", "--1", "1e1.5"]) {
    assert(!MIMIC_NUMBER_RE.test(value), `${value} should be refused`);
  }
}

/** Plan D1: path data, points and a transform take an exponent too (`1.5e-4`, Inkscape's output). */
export function exponentsParseInPathDataPointsAndTransform(): void {
  assert(mimicShapeSchema.safeParse(["path", { d: "m 0,0 1.5e-4,2 L1E+2 3" }]).success, "d with 1.5e-4 should parse");
  assert(mimicShapeSchema.safeParse(["polyline", { points: "0,0 1e-3,2" }]).success, "points with 1e-3 should parse");
  accepts("translate(1E-5,+2)");
}
