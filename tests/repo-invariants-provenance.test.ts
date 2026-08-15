import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * Value-provenance invariants (ADR 0028, `F4.39`).
 *
 * Split out of `repo-invariants.test.ts` rather than appended to it: that file
 * was at 997 lines and the checks below take it past the AGENTS.md §4.5 cap of
 * 1000. Raised by the `F4.39` compliance review, which also supplied three of
 * the five checks here — each one a mutation that survived the first version.
 */
describe("value provenance", () => {
  it("no control-room value is synthesized, and static ones carry their marker", () => {
    // ADR 0027 answered "is this reading current?" and assumed the thing on
    // screen was a reading. Two ways that failed:
    //
    // 1. **Values the gate cannot reach** — `BATT-1 · 384 V` was a string
    //    literal, found on the deployed page asserting a confident voltage
    //    while twelve breakers beside it correctly read `OFFLINE`.
    // 2. **Values the gate reaches, gates correctly, and that are fabricated
    //    anyway** — `Voltage Y` was the measured R phase `+ 0.7`. It blanked
    //    when the incomer died and moved when the real reading moved, which is
    //    what made it convincing. The battery page's 32-cell grid was the same
    //    trick at scale, from one string voltage.
    //
    // Only (2) is machine-checkable in general, so that is what the first half
    // asserts. The rest pins specific values, because "is this number real?" is
    // not decidable from source.
    const pages = ["overview", "sld", "ups", "battery", "it", "hvac", "env"].map(
      (name) => [name, `apps/web/src/pages/control-room-${name}-page.tsx`] as const,
    );
    const sources = new Map(
      pages.map(([name, rel]) => [
        name,
        readFileSync(join(repoRoot, rel), "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^[ \t]*\/\/.*$/gm, ""),
      ]),
    );
    const offenders: string[] = [];

    // **Scoped to `freshValue(`'s first argument, deliberately.** A general
    // "slice field ± numeric literal" search is unusable here: these pages are
    // SVG and every diagram coordinate (`cy + 4`, `y - 29`, `x + w / 2`) would
    // fire. `freshValue(...)` is the construct that *declares* "this is a gated
    // measurement", so an offset applied inside it is precisely the claim being
    // policed.
    //
    // **Known evasion, pinned separately below**: hoisting the arithmetic one
    // line up (`const voltageY = q1.voltage + 0.7`) moves it out of the
    // construct and this scan does not see it. Verified by mutation — the
    // hoisted form reintroduced `Voltage Y` in full with the whole suite green.
    // A named constant or `* 1.01` escapes the same way.
    for (const [name, src] of sources) {
      for (let i = src.indexOf("freshValue("); i >= 0; i = src.indexOf("freshValue(", i + 1)) {
        let depth = 0;
        let end = i + "freshValue(".length;
        for (; end < src.length; end += 1) {
          const ch = src[end];
          if (ch === "(") depth += 1;
          else if (ch === ")") {
            if (depth === 0) break;
            depth -= 1;
          } else if (ch === "," && depth === 0) break;
        }
        const firstArg = src.slice(i + "freshValue(".length, end);
        if (/[A-Za-z_$][\w$]*\s*[+\-]\s*\d/.test(firstArg)) {
          offenders.push(
            `control-room-${name}-page.tsx offsets a measurement inside freshValue: ` +
              `${firstArg.trim()} — that labels one instrument's reading as another's`,
          );
        }
      }
    }

    // Census of static values that must stay marked. A literal that has been
    // *removed* is not an offence — deleting an invented number is a valid fix,
    // and pinning its presence would forbid that.
    const marked: Array<readonly [string, string]> = [
      ["sld", "11 kV INCOMER"],
      ["sld", "XFMR 100 kVA"],
      ["sld", "MAIN BUS 415V"],
      ["sld", "UPS OUT BUS 230V"],
      ["hvac", "AC-1 LEAD · AC-2 STANDBY"],
      ["hvac", "Standby auto-start in"],
      ["ups", "32 cells · 12V VRLA"],
      // These two sit in bare SVG text nodes rather than component props, and
      // both were missed by the source census — found by looking at the
      // deployed pages. Pinned because that is the blind spot: a sweep written
      // around `value=`/`sub=` props does not see `>setpoint 22.0C<`.
      ["hvac", "setpoint 22.0C"],
      ["overview", "11 kV"],
    ];
    for (const [name, literal] of marked) {
      const src = sources.get(name) ?? "";
      for (let i = src.indexOf(literal); i >= 0; i = src.indexOf(literal, i + 1)) {
        // **"Am I inside the element", not "does the file mention it".** The
        // F4.38 finding was that a file-wide token search is satisfied by an
        // unrelated call elsewhere in the same file — and these pages now use
        // the marker in several places each, so a file-wide check would be
        // decoy-satisfied by construction.
        const before = src.slice(0, i);
        const open = Math.max(
          before.lastIndexOf("<StaticValue"),
          before.lastIndexOf("<StaticTspan"),
        );
        const close = Math.max(
          before.lastIndexOf("</StaticValue>"),
          before.lastIndexOf("</StaticTspan>"),
        );
        if (open < 0 || close > open) {
          offenders.push(
            `control-room-${name}-page.tsx renders "${literal}" outside a provenance marker — ` +
              "static data must be visibly distinct from a live reading (ADR 0028 decision 3)",
          );
        }
      }
    }

    // **The census list cannot hold the battery cell grid**, and the mutation
    // run proved it: deleting the grid's marker left every check green. The
    // list asserts "this literal, if present, is wrapped" — so removing the
    // wrapper *and* its text reads as a legitimate deletion. For the grid that
    // is exactly the dangerous edit: 32 synthesized voltages stay on screen and
    // the one thing saying so disappears.
    //
    // Scoped to the component that renders the grid, not the file.
    const batt = sources.get("battery") ?? "";
    const gridAt = batt.indexOf("string.cells.map(");
    if (gridAt < 0) {
      offenders.push(
        "control-room-battery-page.tsx no longer renders a recognisable cell grid — " +
          "if it was removed, drop this check with it",
      );
    } else {
      const fnAt = batt.lastIndexOf("\nfunction ", gridAt);
      const body = batt.slice(fnAt < 0 ? 0 : fnAt, gridAt);
      if (!/<StaticValue\s+kind="simulated"/.test(body)) {
        offenders.push(
          "control-room-battery-page.tsx renders the per-cell grid without marking it simulated — " +
            "no RTU profile carries per-cell points, so all 32 voltages come from one string reading",
        );
      }
    }

    // **A box that renders a gated value must be able to render offline.**
    // Found on the deployed page, twice: `SldBox` was unconditionally green
    // because every box was static before `F4.39`, so the first version left a
    // dead battery string showing `— V` inside a confident green outline on a
    // diagram where green means energised. Adding the prop then missed the HVAC
    // load branches, which is the same defect one call site over — an em-dash
    // was again the only signal. Scoped to the element, so a call passing a
    // literal `sub` is correctly ignored.
    const sld = sources.get("sld") ?? "";
    for (let i = sld.indexOf("<SldBox"); i >= 0; i = sld.indexOf("<SldBox", i + 1)) {
      const close = sld.indexOf("/>", i);
      const element = sld.slice(i, close < 0 ? sld.length : close);
      if (/freshValue\s*\(/.test(element) && !/\boffline=/.test(element)) {
        offenders.push(
          "control-room-sld-page.tsx renders a gated value in an SldBox without passing `offline` — " +
            "the box stays green while its value blanks, so an em-dash is the only sign it is dead",
        );
      }
    }

    // Regression pins for the values `F4.39` removed or replaced. Each was
    // invented and each read as a diagnostic.
    //
    // The first two came from the compliance review, and the first is the more
    // serious finding of the whole item: **restoring the two literal battery
    // voltages — verbatim the defect that raised F4.39 — passed every check.**
    // It is invisible to ADR 0027's invariant too, because the page still calls
    // `isStale` elsewhere. The lesson is AGENTS.md §4.4's: mutate against the
    // shapes you did not write, not only the one you did.
    const removed: Array<readonly [string, RegExp, string]> = [
      ["sld", /38[46] V/, "a hardcoded battery string voltage"],
      ["sld", /label="Voltage [YB]"/, "a synthesized phase voltage"],
      ["hvac", /"96%"|"82%"/, "an invented health index"],
      ["hvac", /Imbalance \d/, "an invented run-hour tolerance verdict"],
      ["hvac", /Elapsed"/, "an invented changeover countdown"],
      ["battery", /\bavgCellV\b/, "an average of synthesized cell voltages"],
    ];
    for (const [name, pattern, what] of removed) {
      if (pattern.test(sources.get(name) ?? "")) {
        offenders.push(
          `control-room-${name}-page.tsx reintroduces ${what} (removed by F4.39, ADR 0028)`,
        );
      }
    }

    // **Known limit.** This cannot decide whether a *new* number is real — only
    // that the known ones stay honest and that the one machine-checkable
    // fabrication pattern stays absent within the construct it scans. ADR 0028
    // decision 7 records why marking every static value (denominators,
    // headings, hints) would make the marker meaningless rather than safer.
    expect(
      offenders,
      `ADR 0028 violated: ${offenders.join("; ")}. A value may be labelled as a measurement of X ` +
        "only if it comes from telemetry that measures X; anything static must render through " +
        "StaticValue/StaticTspan so an operator can tell it is not a reading.",
    ).toEqual([]);
  });

  it("the provenance marker actually renders", () => {
    // **The F4.37 class: a guard that is correct and simply never runs.**
    // Raised by the F4.39 compliance review, which gutted both components so
    // they returned `{children}` with no marker. Every page still wrapped its
    // static values correctly, `value-provenance.spec.ts` still passed — it
    // tests the lookup tables, not the rendering — and **no marker appeared
    // anywhere in the application**. The whole suite stayed green.
    //
    // Every other check in this file asserts that call sites *use* the wrapper.
    // This is the one that asserts the wrapper does something.
    const src = readFileSync(
      join(repoRoot, "apps/web/src/components/static-value.tsx"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");

    const offenders: string[] = [];
    for (const component of ["StaticValue", "StaticTspan"]) {
      const at = src.indexOf(`export function ${component}`);
      if (at < 0) {
        offenders.push(`${component} is no longer exported from static-value.tsx`);
        continue;
      }
      const end = src.indexOf("\n}", at);
      const body = end < 0 ? src.slice(at) : src.slice(at, end);
      // Scoped to the component body, per the F4.38 rule — the other
      // component's marker logic in the same file must not satisfy this.
      if (!/provenanceMarker\s*\(/.test(body)) {
        offenders.push(`${component} does not consult provenanceMarker`);
      }
      if (!/\{\s*marker/.test(body)) {
        offenders.push(`${component} never renders the marker it computed`);
      }
      if (!/PROVENANCE_TITLE\[/.test(body)) {
        offenders.push(`${component} drops the hover text that spells the marker out`);
      }
    }

    expect(
      offenders,
      `ADR 0028 decision 3 violated: ${offenders.join("; ")}. The marker components are the only ` +
        "thing distinguishing nameplate, setpoint and simulated data from live readings — every " +
        "other invariant here checks that call sites use them, so if they render nothing the " +
        "pages are silently back to where F4.39 started.",
    ).toEqual([]);
  });
});
