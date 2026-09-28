import { describe, expect, it } from "vitest";

import { HAND, type HandEntry, rewriteSource, tokenStreamViolations } from "../scripts/codemods/f3.65b-role-classes";

/**
 * `F3.65b` — fixtures for the one-shot role-class codemod `scripts/codemods/f3.65b-role-classes.ts`
 * (plan `docs/plans/f3.65b-pages-on-roles.md` §3 D1–D4, U1). The codemod rewrites every palette
 * class `tests/support/colour-scan.ts` counts into the role class `tests/support/colour-role-map.ts`
 * resolves it to, plus the context rules of D2 and the hand table of D4. These cases hold the
 * rules on small inline sources; the tree itself is held by `tests/f3.65-colour-roles-gate.test.ts`
 * once the codemod has run. One claim per `it()`: an `expect` that throws hides every later one.
 *
 * `F3.65c` deletes the codemod, and this file with it.
 */

const FILE = "components/fixture.tsx";

/** Rewrite `src` as `FILE` with no hand entries (or `hand`), and return the new source. */
function out(src: string, hand: HandEntry[] = []): string {
  return rewriteSource(src, { file: FILE, hand }).out;
}

describe("F3.65b role-class codemod", () => {
  it("K1 bg-red-600 becomes bg-critical", () => {
    expect(out(`<div className="p-2 bg-red-600" />`)).toBe(`<div className="p-2 bg-critical" />`);
  });

  it("K2a the hover: variant is kept (hover:bg-bms-green-dark -> hover:bg-accent-strong)", () => {
    expect(out(`const c = "hover:bg-bms-green-dark";`)).toBe(`const c = "hover:bg-accent-strong";`);
  });

  it("K2b the after: variant is kept (after:bg-red-600 -> after:bg-critical)", () => {
    expect(out(`const c = "after:bg-red-600";`)).toBe(`const c = "after:bg-critical";`);
  });

  it("K2c the disabled: variant is kept (disabled:bg-gray-300 -> disabled:bg-line-strong)", () => {
    expect(out(`const c = "disabled:bg-gray-300";`)).toBe(`const c = "disabled:bg-line-strong";`);
  });

  it("K3a a numeric opacity is kept (bg-black/40 -> bg-scrim/40)", () => {
    expect(out(`const c = "bg-black/40";`)).toBe(`const c = "bg-scrim/40";`);
  });

  it("K3b an arbitrary opacity is kept (bg-white/[.06] -> bg-surface/[.06])", () => {
    expect(out(`const c = "bg-white/[.06]";`)).toBe(`const c = "bg-surface/[.06]";`);
  });

  it("K4 a compareOver row targets its alpha class (border-emerald-300 -> border-accent/20)", () => {
    expect(out(`const c = "border border-emerald-300";`)).toBe(`const c = "border border-accent/20";`);
  });

  it("K5a text-white beside an opaque bg-bms-green becomes text-on-accent", () => {
    expect(out(`const c = "bg-bms-green text-white";`)).toBe(`const c = "bg-accent text-on-accent";`);
  });

  it("K5b text-white beside bg-red-600 becomes text-on-dark", () => {
    expect(out(`const c = "bg-red-600 text-white";`)).toBe(`const c = "bg-critical text-on-dark";`);
  });

  it("K5c text-white beside bg-red-600 is listed for review", () => {
    const { review } = rewriteSource(`const c = "bg-red-600 text-white";`, { file: FILE, hand: [] });
    expect(review.map((r) => `${r.line} ${r.from} -> ${r.to}`)).toEqual(["1 text-white -> text-on-dark"]);
  });

  it("K5d text-white beside a translucent bg-bms-green/20 becomes text-on-dark", () => {
    expect(out(`const c = "bg-bms-green/20 text-white";`)).toBe(`const c = "bg-accent/20 text-on-dark";`);
  });

  it("K5e text-white beside hover:bg-bms-green-dark becomes text-on-accent", () => {
    expect(out(`const c = "hover:bg-bms-green-dark text-white";`)).toBe(
      `const c = "hover:bg-accent-strong text-on-accent";`,
    );
  });

  it("K5f the two branches of a ternary are separate strings", () => {
    const src = "const c = `px-2 ${on ? \"bg-bms-green text-white\" : \"text-white\"}`;";
    expect(out(src)).toBe("const c = `px-2 ${on ? \"bg-accent text-on-accent\" : \"text-on-dark\"}`;");
  });

  it("K6a a bms-green class under focus: becomes the focus role", () => {
    expect(out(`const c = "border focus:border-bms-green";`)).toBe(`const c = "border focus:border-focus";`);
  });

  it("K6b a bms-green class under focus-visible: becomes the focus role", () => {
    expect(out(`const c = "focus-visible:outline-bms-green";`)).toBe(`const c = "focus-visible:outline-focus";`);
  });

  it("K6c ring-bms-green/50 becomes ring-focus/50", () => {
    expect(out(`const c = "ring-2 ring-bms-green/50";`)).toBe(`const c = "ring-2 ring-focus/50";`);
  });

  it("K7a a HAND entry wins over the rules", () => {
    const hand = [{ file: FILE, line: 2, from: "bg-white", to: "bg-on-dark" }];
    expect(out(`const a = "bg-white";\nconst b = "bg-white";`, hand)).toBe(`const a = "bg-surface";\nconst b = "bg-on-dark";`);
  });

  it("K7b a HAND entry whose from is not on its line throws naming file:line", () => {
    const hand = [{ file: FILE, line: 1, from: "bg-white/40", to: "bg-on-dark/40" }];
    expect(() => out(`const a = "bg-white";`, hand)).toThrow(`${FILE}:1`);
  });

  it("K7c a HAND entry already applied (its to is on the line) is a no-op, not a throw", () => {
    const hand = [{ file: FILE, line: 1, from: "bg-white", to: "bg-on-dark" }];
    expect(out(`const a = "bg-on-dark";`, hand)).toBe(`const a = "bg-on-dark";`);
  });

  it("K7d a HAND entry for another file is ignored", () => {
    const hand = [{ file: "components/other.tsx", line: 1, from: "bg-white", to: "bg-on-dark" }];
    expect(out(`const a = "bg-white";`, hand)).toBe(`const a = "bg-surface";`);
  });

  it("K7e HAND holds the nine D4 entries, OQ3 and OQ4 applied", () => {
    expect(HAND.map((h) => `${h.file}:${h.line} ${h.from} -> ${h.to}`).sort()).toEqual(
      [
        "components/system-status-indicator.tsx:49 bg-white/40 -> bg-on-dark/40",
        "components/rules-panel.tsx:407 bg-white -> bg-on-dark",
        "components/admin/asset-templates-page-tab-strip.tsx:65 text-white/80 -> text-on-accent/80",
        "pages/crac-page.tsx:96 bg-gray-200 -> bg-well-deep",
        "pages/sld-page.tsx:92 bg-gray-200 -> bg-well-deep",
        "components/report-schedules.tsx:513 bg-bms-ink -> bg-chrome",
        "components/reports-panel.tsx:395 bg-bms-ink -> bg-chrome",
        "components/control-room/scoped-action-link.tsx:17 text-gray-500 -> text-neutral-ink",
        "components/rules-panel.tsx:72 text-gray-500 -> text-neutral-ink",
      ].sort(),
    );
  });

  it("K8 an unmapped class (bg-zinc-500) throws naming file:line", () => {
    expect(() => out(`const a = "p-1";\nconst b = "bg-zinc-500";`)).toThrow(`${FILE}:2`);
  });

  it("K9 a class inside a comment is untouched", () => {
    const src = `// bg-red-600 was the old fill\n/* text-white */ const c = "bg-red-600";`;
    expect(out(src)).toBe(`// bg-red-600 was the old fill\n/* text-white */ const c = "bg-critical";`);
  });

  it("K10 a second run over the output changes nothing", () => {
    const first = out(`const c = "bg-bms-green text-white hover:bg-bms-green-dark border-emerald-300";`);
    const second = rewriteSource(first, { file: FILE, hand: [] });
    expect({ out: second.out, rewrites: second.rewrites.length }).toEqual({ out: first, rewrites: 0 });
  });

  it("K11a the token-stream check passes an honest rewrite", () => {
    expect(tokenStreamViolations(`a "bg-red-600 p-2" b`, `a "bg-critical p-2" b`, [3])).toEqual([]);
  });

  it("K11b the token-stream check fails an edit at an unlogged token", () => {
    expect(tokenStreamViolations(`a "bg-red-600 p-2" b`, `a "bg-critical p-3" b`, [3])).not.toEqual([]);
  });

  it("K11c the token-stream check fails a dropped token", () => {
    expect(tokenStreamViolations(`a "bg-red-600 p-2" b`, `a "bg-critical" b`, [3])).not.toEqual([]);
  });

  it("K11d a HAND target that is not a role in index.css fails the file's self-check", () => {
    const hand = [{ file: FILE, line: 1, from: "bg-white", to: "bg-not-a-role" }];
    expect(() => out(`const a = "bg-white";`, hand)).toThrow(
      /components\/fixture\.tsx: D3 self-check failed[\s\S]*"not-a-role"/,
    );
  });

  it("K12a a .spec.tsx path is refused", () => {
    expect(() => rewriteSource(`const c = "bg-red-600";`, { file: "components/x.spec.tsx", hand: [] })).toThrow(
      /refuses a spec or test file/,
    );
  });

  it("K12b a .test.ts path is refused", () => {
    expect(() => rewriteSource(`const c = "bg-red-600";`, { file: "lib/x.test.ts", hand: [] })).toThrow(/refuses a spec or test file/);
  });
});
