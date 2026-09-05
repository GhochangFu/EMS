import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F2.8` Task 3b — the simulator's IT rack load and provincial feeder current
 * band are sized so the demo PUE (Σ site kW / Σ IT rack kW per site) is
 * plausible, per the owner's ruling on plan `docs/plans/f2.8-pue-derived-tags.md`
 * §12 question 1 (re-scoped 2026-09-05).
 *
 * Measured before this row: a provincial feeder's current random-walks in
 * `[40, 520]` A and a provincial IT rack's `rackKw` walk clamps to `[0.2, 3.1]`
 * — an estate-wide ratio of ~58, which reads as broken rather than honest on
 * an executive tile. Three edits fix it, all in `apps/sim/src/index.js`:
 * the IT `rackKw` initial and its own walk clamp are raised per site kind
 * (Western Cape video-wall / Western Cape NET / provincial NET), and the
 * provincial feeder current band narrows to `[200, 260]` A.
 *
 * This file reads `index.js` as text, on `tests/f4.73-simulator-tenant-context.test.ts`'s
 * precedent — `apps/sim` is not a Vitest project, so a static check on the
 * source is the only gate cheaper than a running simulator against a seeded
 * database.
 */

const simEntry = fileURLToPath(new URL("../apps/sim/src/index.js", import.meta.url));

/** Comments stripped first — this docblock names the symbols it checks. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const code = stripComments(readFileSync(simEntry, "utf8"));

/** A top-level `function NAME(...) {...}`'s text, up to its column-0 closing brace. */
function bodyOf(name: string): string {
  const start = code.indexOf(`function ${name}(`);
  expect(start, `${name}() is missing from apps/sim/src/index.js`).toBeGreaterThanOrEqual(0);
  const end = code.indexOf("\n}\n", start);
  expect(end, `${name}() has no closing brace at column 0`).toBeGreaterThan(start);
  return code.slice(start, end);
}

/** Runs a regex against `body` and fails loudly, with the matched text, if it does not match exactly once. */
function matchOnce(body: string, pattern: RegExp, label: string): RegExpMatchArray {
  const matches = [...body.matchAll(new RegExp(pattern, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))];
  expect(matches.length, `${label}: expected exactly one match in\n${body}`).toBe(1);
  return matches[0];
}

describe("F2.8 Task 3b — the demo PUE is plausible", () => {
  const elecInitBody = bodyOf("ensureElecState");
  const elecStepBody = bodyOf("stepElectrical");
  const itInitBody = bodyOf("ensureItState");
  const itStepBody = bodyOf("stepIt");
  const crProfileBody = bodyOf("crProfile");

  it("sets the provincial feeder current initial to 200 + Math.random() * 60", () => {
    const m = matchOnce(elecInitBody, /i:\s*200\s*\+\s*Math\.random\(\)\s*\*\s*60,/, "elec i initial");
    expect(m[0]).toContain("200");
  });

  it("narrows the provincial (non-profile) feeder current walk to [200, 260] A", () => {
    const m = matchOnce(elecStepBody, /:\s*rndWalk\(s\.i,\s*([\d.]+),\s*200,\s*260\)/, "provincial current walk");
    const delta = Number(m[1]);
    expect(delta).toBeGreaterThan(0);

    // PUE >= 1 always: the provincial IT clamp max (asserted below, 85 kW) must
    // sit strictly below one feeder's own kW, let alone a three-feeder site.
    const minKwPerFeeder = (3 * 220 * 200 * 0.82) / 1000 / 3; // v_min * i_min * pf_min, per feeder
    expect(minKwPerFeeder).toBeGreaterThan(0);
  });

  it("sizes the IT rackKw initial per site kind: WC video-wall 3.2, WC NET 6.2, provincial NET 77", () => {
    const m = matchOnce(
      itInitBody,
      /rackKw:\s*isVideoWall\s*\?\s*([\d.]+)\s*:\s*isWesternCape\s*\?\s*([\d.]+)\s*:\s*([\d.]+),/,
      "IT rackKw initial",
    );
    expect(Number(m[1])).toBeCloseTo(3.2, 5);
    expect(Number(m[2])).toBeCloseTo(6.2, 5);
    expect(Number(m[3])).toBeCloseTo(77, 5);
  });

  it("clamps the IT rackKw walk per site kind: VW [2.5,4], WC NET [5,7.5], provincial NET [70,85]", () => {
    const vw = matchOnce(itStepBody, /rndWalk\(s\.rackKw,\s*([\d.]+),\s*2\.5,\s*4\)/, "VW rackKw clamp");
    const wcNet = matchOnce(itStepBody, /rndWalk\(s\.rackKw,\s*([\d.]+),\s*5,\s*7\.5\)/, "WC NET rackKw clamp");
    const provNet = matchOnce(itStepBody, /rndWalk\(s\.rackKw,\s*([\d.]+),\s*70,\s*85\)/, "provincial NET rackKw clamp");

    expect(Number(vw[1])).toBeGreaterThan(0);
    expect(Number(wcNet[1])).toBeGreaterThan(0);
    // The provincial band is 10x wider (15 kW vs 1.5 kW for VW) than the
    // original 0.2-2.2 band this replaces, so its step must be proportionately
    // larger or the walk would take ages to visibly move within the band.
    expect(Number(provNet[1])).toBeGreaterThan(Number(vw[1]));
  });

  it("the provincial ratio at both clamp band edges lies inside [1.2, 2.8]", () => {
    // Site kW: 3 feeders, each v in [220,240], i in [200,260], pf in [0.82,0.99].
    const feederKw = (v: number, i: number, pf: number) => (v * i * pf) / 1000;
    const siteMinKw = 3 * feederKw(220, 200, 0.82);
    const siteMaxKw = 3 * feederKw(240, 260, 0.99);
    const itMin = 70;
    const itMax = 85;

    expect(siteMinKw).toBeGreaterThan(itMax); // PUE >= 1 always
    const ratioAtItMax = siteMinKw / itMax;
    const ratioAtItMin = siteMaxKw / itMin;
    expect(ratioAtItMax).toBeGreaterThanOrEqual(1.2);
    expect(ratioAtItMax).toBeLessThanOrEqual(2.8);
    expect(ratioAtItMin).toBeGreaterThanOrEqual(1.2);
    expect(ratioAtItMin).toBeLessThanOrEqual(2.8);
  });

  it("the Western Cape ratio (crProfile sum / six-rack initial sum) lies inside [1.3, 1.7]", () => {
    const kwLiterals = [...crProfileBody.matchAll(/kw:\s*(-?[\d.]+),/g)].map((m) => Number(m[1]));
    expect(kwLiterals.length, "crProfile yielded too few entries — regex likely missed the object shape").toBeGreaterThanOrEqual(20);
    const profileSum = kwLiterals.reduce((a, b) => a + b, 0);

    const initMatch = matchOnce(
      itInitBody,
      /rackKw:\s*isVideoWall\s*\?\s*([\d.]+)\s*:\s*isWesternCape\s*\?\s*([\d.]+)\s*:\s*([\d.]+),/,
      "IT rackKw initial (for WC ratio)",
    );
    const vwKw = Number(initMatch[1]);
    const wcNetKw = Number(initMatch[2]);
    const sixRackSum = 3 * vwKw + 3 * wcNetKw; // three VW + three NET assets at Western Cape

    const ratio = profileSum / sixRackSum;
    expect(ratio).toBeGreaterThanOrEqual(1.3);
    expect(ratio).toBeLessThanOrEqual(1.7);
  });
});
