import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RAW_READ_ALLOWLIST, rawErrorMessageReads, scannedWebFiles } from "./support/error-message-scan";
import { repoRoot } from "./support/source-scan";

/**
 * `F4.204` — a refused request reaches the screen through `apiErrorMessage`, never as the raw
 * `.message` of the error the `apps/web/src/api` modules throw. That message is the response
 * body, so a raw read shows a Nest envelope (`{"statusCode":409,"message":…}`) where a sentence
 * belongs. `F4.197` fixed the Users and Asset Groups pages; this gate holds every other site.
 *
 * **Scanned:** every `.ts` / `.tsx` file under `apps/web/src`, minus specs, tests,
 * `test-setup.ts`, the throwers under `api/`, and `lib/api-error-message.ts` (the one place
 * that must read the raw text). Exempt by path, never by a comment marker.
 *
 * **A finding** is `X.message` (or `X?.message`), `String(X)`, `X.toString()` or `` `${X}` ``
 * where `X` is error-shaped by the parser alone (no type checker — a program over the web tree
 * costs tens of seconds in a suite pinned to two workers):
 *  - S1 a `catch (X)` variable;
 *  - S2 a parameter annotated with an `Error` class (`Error`, `ApiError`, `TypeError`, a union
 *    that holds one), or `unknown` for a `.message` read;
 *  - S3 the first parameter of an `onError` property or method, of a `.catch(…)` callback, or of
 *    the rejection callback of `.then(ok, …)`;
 *  - S4 `(… as Error)` and the other `Error` classes, and a variable annotated or cast that way;
 *  - S5 a property chain ending in `.error` or `.failureReason` (`query.error`, `m.error?.message`);
 *  - S6 `error` destructured from a query hook (`useQuery`, `useMutation`, `useInfiniteQuery`,
 *    `useAlarmsQuery`), or an `error` prop destructured in a parameter list (`.message` only).
 * The nearest declaration of the name wins, so a shadowing local is not an error.
 * `String(X)`, `toString()` and `` `${X}` `` count because `String(new ApiError(body))` renders
 * `ApiError: {json}` — the same envelope by another road. None exists today.
 *
 * **Allowlisted:** exactly the reads in `RAW_READ_ALLOWLIST`, each a raw read that is not
 * rendered raw. T3 proves the allowlist is the only thing hiding them, T5 that no entry is stale.
 * An entry matches a file and a read's text, not its use: a second, rendered read of the same
 * text in the same file fails T5, but an allowlisted read changed in place to a render does not.
 *
 * **False positives** are possible and the allowlist is the way out: S5 matches a DTO field named
 * `error` read through `String` or a template (`` `${row.error}` ``), and S2 matches a parser that
 * narrows an `unknown` body with a record guard and reads its `.message`.
 *
 * **Not covered.** An error held in an unannotated variable or in state (`const f = q.error;
 * f.message`); a destructured `message` (`onError: ({ message }) => …`, `catch ({ message })`);
 * an `instanceof` guard on a custom subclass; a read through a helper the shapes do not name; a
 * message assembled by concatenation. The parse is syntactic, so a renamed import
 * (`import { ApiError as E }`) is not an `Error` class annotation.
 */

function reads(src: string): string[] {
  return rawErrorMessageReads(src, "fixture.tsx");
}

describe("F4.204 — the scanner's shapes", () => {
  it("H1 an annotated onError parameter's message is a finding", () => {
    const src = ["const m = useMutation({", "  onError: (err: Error) => setError(err.message),", "});"].join("\n");
    expect(reads(src)).toEqual(["fixture.tsx:2 err.message"]);
  });

  it("H2 an unannotated onError parameter's message is a finding", () => {
    const src = "const m = useMutation({ onError: (err) => setError(err.message) });";
    expect(reads(src)).toEqual(["fixture.tsx:1 err.message"]);
  });

  it("H3 a catch variable's message, through a cast, is a finding", () => {
    const src = ["try {", "  run();", "} catch (err) {", "  setError((err as Error).message);", "}"].join("\n");
    expect(reads(src)).toEqual(["fixture.tsx:4 (err as Error).message"]);
  });

  it("H3b an unknown parameter narrowed by instanceof Error is a finding", () => {
    const src = 'function show(err: unknown) { return err instanceof Error ? err.message : "x"; }';
    expect(reads(src)).toEqual(["fixture.tsx:1 err.message"]);
  });

  it("H4 a query's and a mutation's error message are findings", () => {
    const src = ["const a = <p>{q.error.message}</p>;", "const b = <p>{m.error?.message}</p>;"].join("\n");
    expect(reads(src)).toEqual(["fixture.tsx:1 q.error.message", "fixture.tsx:2 m.error?.message"]);
  });

  it("H5 a cast query error's message is a finding", () => {
    expect(reads("const a = <p>{(listQ.error as Error).message}</p>;")).toEqual([
      "fixture.tsx:1 (listQ.error as Error).message",
    ]);
  });

  it("H6 error destructured from useQuery is error-shaped", () => {
    const src = ["const { error } = useQuery({ queryKey: [] });", "const a = <p>{error.message}</p>;"].join("\n");
    expect(reads(src)).toEqual(["fixture.tsx:2 error.message"]);
  });

  it("H7 String(err) and a template over err are findings", () => {
    const src = ["useMutation({ onError: (err) => {", "  setA(String(err));", "  setB(`failed: ${err}`);", "} });"].join(
      "\n",
    );
    expect(reads(src)).toEqual(["fixture.tsx:2 String(err)", "fixture.tsx:3 ${err}"]);
  });

  it("H8 a DTO's message field is not a finding", () => {
    const src = [
      "const a = <p>{alarm.message}</p>;",
      "const b = problem.message;",
      "const c = built.message;",
      "const d = result.message;",
    ].join("\n");
    expect(reads(src)).toEqual([]);
  });

  it("H9 a plain callback parameter named error is not a finding", () => {
    expect(reads("const all = errors.map((error) => error.message);")).toEqual([]);
  });

  it("H10 a read in a comment, a string or JSX text is not a finding", () => {
    const src = [
      "// setError(err.message)",
      "/** shows {err.message} */",
      'const s = "err.message";',
      "const j = <p>err.message and q.error.message</p>;",
    ].join("\n");
    expect(reads(src)).toEqual([]);
  });

  it("H11 a read routed through apiErrorMessage is not a finding", () => {
    expect(reads("useMutation({ onError: (err: Error) => setError(apiErrorMessage(err)) });")).toEqual([]);
  });

  it("H12 the gallery panel's shape is a finding (only the allowlist hides the real one)", () => {
    const src = 'const f = (cause: unknown) => cause instanceof Error ? cause.message : String(cause ?? "");';
    expect(reads(src)).toEqual(["fixture.tsx:1 cause.message"]);
  });

  it("H13 JSON.parse over an error message is a finding (only the allowlist hides the real one)", () => {
    const src = "function f(err: unknown) { if (err instanceof Error) return JSON.parse(err.message); }";
    expect(reads(src)).toEqual(["fixture.tsx:1 err.message"]);
  });

  it("H14 a shadowing local that is not an error is not a finding", () => {
    const src = ["useMutation({ onError: (err) => {", '  { const err = { message: "x" }; show(err.message); }', "} });"].join(
      "\n",
    );
    expect(reads(src)).toEqual([]);
  });

  it("H15 a .catch callback's parameter is error-shaped", () => {
    expect(reads("load().catch((err) => setError(err.message));")).toEqual(["fixture.tsx:1 err.message"]);
  });

  it("H16 an <img onError> event parameter is not error-shaped", () => {
    expect(reads('const i = <img src="/a.png" alt="" onError={(e) => log(e.message)} />;')).toEqual([]);
  });

  it("H17 a variable cast or annotated as Error is error-shaped", () => {
    const src = ["const a = cause as Error;", "const b: ApiError = make();", "show(a.message, b.message);"].join("\n");
    expect(reads(src)).toEqual(["fixture.tsx:3 a.message", "fixture.tsx:3 b.message"]);
  });

  it("H18 String over an unknown formatter value is not a finding, String over a catch variable is", () => {
    const src = [
      "function display(value: unknown) { return `${String(value)}s`; }",
      "try { run(); } catch (err) { show(String(err)); }",
    ].join("\n");
    expect(reads(src)).toEqual(["fixture.tsx:2 String(err)"]);
  });

  it("H19 an onError method shorthand's parameter is error-shaped", () => {
    const src = "useMutation({ onError(err) { setError(err.message); } });";
    expect(reads(src)).toEqual(["fixture.tsx:1 err.message"]);
  });

  it("H20 a .then rejection callback's parameter is error-shaped", () => {
    expect(reads("load().then(ok, (err) => setError(err.message));")).toEqual(["fixture.tsx:1 err.message"]);
  });

  it("H21 a union with Error and an Error subclass annotation are error-shaped", () => {
    const src = [
      "useMutation({ onError: (err: Error | null) => setA(err?.message) });",
      "function f(err: TypeError) { return err.message; }",
    ].join("\n");
    expect(reads(src)).toEqual(["fixture.tsx:1 err?.message", "fixture.tsx:2 err.message"]);
  });

  it("H22 an error prop destructured in the parameter list is error-shaped", () => {
    const src = "function Banner({ error }: { error: Error }) { return <p>{error.message}</p>; }";
    expect(reads(src)).toEqual(["fixture.tsx:1 error.message"]);
  });

  it("H23 error destructured from a named query hook is error-shaped", () => {
    const src = ["const { data, error } = useAlarmsQuery();", "const a = <p>{error.message}</p>;"].join("\n");
    expect(reads(src)).toEqual(["fixture.tsx:2 error.message"]);
  });

  it("H24 a query's failureReason message and an error's toString() are findings", () => {
    const src = ["const a = <p>{q.failureReason?.message}</p>;", "load().catch((err) => setError(err.toString()));"].join(
      "\n",
    );
    expect(reads(src)).toEqual(["fixture.tsx:1 q.failureReason?.message", "fixture.tsx:2 err.toString()"]);
  });
});

/** Scanned once per run: T1, T3 and T5 read the same tree, and a walk per case is slow under load. */
let treeFindings: string[] | undefined;
function tree(): string[] {
  treeFindings ??= scannedWebFiles().flatMap((file) =>
    rawErrorMessageReads(readFileSync(join(repoRoot, file), "utf8"), file),
  );
  return treeFindings;
}

/** `true` when an allowlist entry names this finding (`file:line read`, line ignored). */
function allowed(finding: string, list = RAW_READ_ALLOWLIST): boolean {
  return list.some((entry) => finding.startsWith(`${entry.file}:`) && finding.endsWith(` ${entry.read}`));
}

describe("F4.204 — the web tree", () => {
  it("T1 no raw error message reaches the screen outside the allowlist", { timeout: 60_000 }, () => {
    expect(tree().filter((f) => !allowed(f))).toEqual([]);
  });

  it("T2 the walk reached the tree", () => {
    const files = scannedWebFiles();
    expect(files.filter((f) => f.endsWith(".tsx")).length).toBeGreaterThanOrEqual(190);
    expect(files.filter((f) => f.endsWith(".ts")).length).toBeGreaterThanOrEqual(140);
  });

  it("T3 the scanner finds each allowlisted read, so the allowlist is what hides them", { timeout: 60_000 }, () => {
    const hidden = tree()
      .filter((f) => allowed(f))
      .map((f) => f.replace(/:\d+ /, " "))
      .sort();
    expect(hidden).toEqual([
      "apps/web/src/components/assets/asset-image-gallery.tsx query.error.message",
      "apps/web/src/components/assets/asset-images-panel.tsx cause.message",
      "apps/web/src/pages/admin/users-feedback.tsx err.message",
    ]);
  });

  it("T4 the throwers and the parser of the raw text are not scanned", () => {
    const files = scannedWebFiles();
    expect(files.filter((f) => f.startsWith("apps/web/src/api/"))).toEqual([]);
    expect(files).not.toContain("apps/web/src/lib/api-error-message.ts");
    expect(files.filter((f) => /\.(spec|test)\.tsx?$/.test(f) || f.endsWith("/test-setup.ts"))).toEqual([]);
    expect(files).toContain("apps/web/src/lib/api-error.ts");
  });

  it("T5 every allowlist entry names exactly one live read", { timeout: 60_000 }, () => {
    for (const entry of RAW_READ_ALLOWLIST) {
      expect(
        tree().filter((f) => allowed(f, [entry])),
        `${entry.file} ${entry.read}`,
      ).toHaveLength(1);
    }
  });
});
