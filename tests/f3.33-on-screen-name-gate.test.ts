import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

import { VERVE_LOGO } from "../apps/web/src/components/verve-logo-data";
import { webColourSourceFiles } from "./support/colour-scan";
import { repoRoot, walk } from "./support/source-scan";

/**
 * `F3.33` — the on-screen name gate, inverted by `F4.398` (ADR 0142 decision 7 and Amendment 1,
 * plan `docs/plans/f4.398-verve-on-screen-name.md` U1). `Verve` replaces `IONSiTE NEXUS` wherever
 * a user reads the product name (ADR 0142 decision 1); this file fails when `TRINETRA` or the
 * `IONSiTE NEXUS` name comes back. The file keeps its `F3.33` name (decision 6).
 *
 * **Scanned**, comments blanked first — by the TypeScript parser for `.ts` / `.tsx`, so a `//` or
 * `/*` inside a string, a template or JSX text stays text; `<!-- -->` and each `<script>` body's
 * comments for `.html`; `/* *\/` for `.css` — then every `/trinetra|\bion\s?site|nexus/gi` match
 * reported as `file:line`. The leading `\b` is Amendment 1 item 6: without it `siteZoneOf` and
 * `StationSiteHalves` ("…ion site…") are false hits (N6k).
 *  - every `.ts` / `.tsx` / `.css` file under `apps/web/src`, minus specs, tests and
 *    `test-setup.ts` (`webColourSourceFiles()`) — N1;
 *  - `apps/web/index.html` — N2b, its `<title>` text — N2a, and its icon link with the favicon
 *    file, byte-equal to the approved tile asset — N2c;
 *  - every `.ts` file under `apps/api/src`, minus `*.spec.ts`, `*.test.ts` and `src/testing/`, plus every
 *    `packages/shared/src/contracts/*-writes.ts` (the API's write bodies and their refusal
 *    messages, moved there by F3.85) — N3, N9b;
 *  - `infra/keycloak/bms-realm.json` — its parsed `displayName` only (N4);
 *  - the OpenAPI title and the Swagger site title as exact literals (N10a, N10b), because the
 *    OpenAPI document needs a Nest app and is not unit-testable here (§4.6, `F4.20`);
 *  - the old logo image is gone (N11).
 *
 * **Allowlisted literals** (ADR 0083 decision 5, kept by ADR 0142 decision 6): exactly two,
 * blanked before the scan — `x-trinetra-signature` (the webhook header a receiver verifies) and
 * `trinetra@localhost` (the `SMTP_FROM` development default). N5 proves the allowlist is the only
 * thing hiding them.
 *
 * **Kept tokens** (ADR 0142 decision 6, Amendment 1 item 7): the colour-profile key `nexus`, the
 * design-system key `nexus-soft` and the symbol `NEXUS_SOFT_CHART_TYPE` are stored or code names,
 * not text a user reads. The list is **token-exact**, read from the parser: a string literal whose
 * whole text is `nexus` or `nexus-soft`, or an identifier that is exactly `nexus` or
 * `NEXUS_SOFT_CHART_TYPE`. A substring allowlist cannot work (the bare literal `nexus` would blank
 * every hit). JSX text is never a kept token. N5b names the five files the kept list hides; N6i
 * and N6j hold its edges.
 *
 * **Spelling** (N8): every `verve` word in the scanned sources — one not joined to a letter, a
 * digit, `_`, `/` or `-`, nor preceded by `.` or followed by `.` and a letter, so file names, import
 * paths and `verve-pulse` ids do not count while a name that ends a sentence does (N8b) — is
 * exactly `Verve`, with at least one in the web files and one in the api files.
 *
 * **The logo** (Amendment 1): N12 holds the pulse's paint in the eight gradient assets under
 * `docs/brand/verve/` — one filled path, one fill, a reference to the single `verve-pulse`
 * gradient, no stroke, no `style` attribute or `<style>` block that could repaint it. N13 holds the web's logo data module equal to the two logo assets (view
 * box, gradient axis, the five stops per tone, both path strings, the letter ink).
 *
 * **Liveness** of the scanner itself: N5 and N5b (the regex finds what the two lists hide), N6
 * and N6f (comments do not count), N6b–N6e, N6g, N6h (comment markers inside strings, JSX text
 * and HTML attributes are text), N6i–N6k (the kept list and the word boundary), N7 (the match is
 * case-insensitive), N9 and N9b (the walkers reach the real trees and the contracts write bodies).
 *
 * **Not covered.**
 *  - The realm JSON is not text-scanned as a whole; only `displayName` is checked.
 *  - A name built at runtime or by concatenation (`"NEX" + "US"`) is invisible.
 *  - Everything outside the scanned set: `apps/sim`, `apps/ingest`, `packages/*` (except the
 *    contracts `*-writes.ts` above), seeds, specs, tests, `apps/api/src/testing/`, migrations,
 *    and repository documents (TRINETRA stays the internal name there).
 *  - A Keycloak realm that is already imported keeps the old display name until an admin edits it.
 *  - The scan matches text, not meaning: outside the kept list, a code identifier or file name
 *    spelling an old name inside the scanned sources counts as a hit.
 *  - A kept token is kept wherever it stands: a user-visible string that is exactly `nexus` or
 *    `nexus-soft` (lower case) would pass.
 *  - The kept list is not applied inside an `.html` `<script>` body or a `.css` file.
 *  - N12 and N13 read the assets by regex, not with an SVG parser, and do not render them.
 */

const ALLOWED = ["x-trinetra-signature", "trinetra@localhost"] as const;
const OLD_NAME = /trinetra|\bion\s?site|nexus/gi;
const KEPT_LITERALS: readonly string[] = ["nexus", "nexus-soft"];
const KEPT_IDENTIFIERS: readonly string[] = ["nexus", "NEXUS_SOFT_CHART_TYPE"];
const SPELLING = /(?<![\w./-])verve(?![\w/-]|\.\w)/gi;
const NEW_NAME = "Verve";

const INDEX_HTML = "apps/web/index.html";
const REALM_JSON = "infra/keycloak/bms-realm.json";
const FAVICON = "apps/web/public/favicon.svg";
const BRAND_DIR = "docs/brand/verve";
const ICON_LINK = '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />';
const GRADIENT_ASSETS = [
  "verve-logo-light",
  "verve-logo-dark",
  "verve-logo-tagline-light",
  "verve-logo-tagline-dark",
  "verve-mark-light",
  "verve-mark-dark",
  "verve-mark-tile-navy",
  "verve-mark-tile-white",
] as const;
const KEPT_FILES = [
  "apps/api/src/auth/appearance-resolution.ts",
  "apps/web/src/components/appearance/labels.ts",
  "apps/web/src/lib/design.ts",
  "apps/web/src/pages/admin/portal-appearance-page.tsx",
  "apps/web/src/stores/theme-store.ts",
];

/** Repo-relative, forward slashes. */
function rel(full: string): string {
  return relative(repoRoot, full).split("\\").join("/");
}

/** Read once per run: N1, N3, N5 and N8 scan the same files, and a walk per case timed out under load. */
const sources = new Map<string, string>();
function read(file: string): string {
  let src = sources.get(file);
  if (src === undefined) {
    src = readFileSync(join(repoRoot, file), "utf8");
    sources.set(file, src);
  }
  return src;
}

/** Every non-newline character in `[start, end)` becomes a space, so lines hold. */
function blank(src: string, ranges: readonly (readonly [number, number])[]): string {
  const chars = src.split(""); // UTF-16 units: the parser's offsets are code-unit offsets
  for (const [start, end] of ranges) for (let i = start; i < end; i++) if (chars[i] !== "\n") chars[i] = " ";
  return chars.join("");
}

type Range = [number, number];

/**
 * The comment ranges and the kept-token ranges of a TS / TSX source, from the parser rather than
 * a regex. Comments: a `//` or `/*` inside a string, a template or JSX text is not a comment (the
 * shared `blankComments` blanks those too, and hid a real hit); the leading and trailing trivia of
 * every node and token is read, and a range that starts inside JSX text is JSX text. Kept tokens:
 * a string literal (or a template with no substitution) whose whole text is a kept literal, and an
 * identifier that is exactly a kept identifier — never a substring, never JSX text.
 */
function scriptRanges(src: string, file: string): { comments: Range[]; kept: Range[] } {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, false, kind);
  const jsxText: Range[] = [];
  const kept: Range[] = [];
  const found = new Map<number, number>();
  const add = (ranges: ts.CommentRange[] | undefined) => ranges?.forEach((r) => found.set(r.pos, r.end));
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.JsxText) jsxText.push([node.pos, node.end]);
    if (
      ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && KEPT_LITERALS.includes(node.text)) ||
      (ts.isIdentifier(node) && KEPT_IDENTIFIERS.includes(node.text))
    ) {
      kept.push([node.getStart(sf), node.end]);
    }
    add(ts.getLeadingCommentRanges(src, node.pos));
    add(ts.getTrailingCommentRanges(src, node.end));
    node.getChildren(sf).forEach(visit);
  };
  visit(sf);
  const comments = [...found].filter(([pos]) => !jsxText.some(([start, end]) => pos >= start && pos < end));
  return { comments, kept };
}

/**
 * Comments blanked, newlines kept so lines hold: CSS `/* *\/`, HTML `<!-- -->` plus each
 * `<script>` body's comments, TS / TSX by the parser. With `kept`, the kept tokens of a TS / TSX
 * file are blanked too.
 */
function strip(src: string, file: string, kept: boolean): string {
  if (file.endsWith(".css")) return src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  if (!file.endsWith(".html")) {
    const ranges = scriptRanges(src, file);
    return blank(src, kept ? [...ranges.comments, ...ranges.kept] : ranges.comments);
  }
  const html = src.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, " "));
  return html.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (_m, open: string, body: string, close: string) =>
    open + blank(body, scriptRanges(body, "script.ts").comments) + close,
  );
}

/** Stripped once per file and mode per run (N1, N3, N5, N5b and N8 read the same files); fixtures are not cached. */
const stripped = new Map<string, string>();
function withoutComments(src: string, file: string, kept = false): string {
  // Blanking only removes matches, so a file that spells no name needs no parse — which keeps
  // the ~700-file walk inside the default timeout.
  if (!/trinetra|\bion\s?site|nexus|verve/i.test(src)) return src;
  if (!sources.has(file)) return strip(src, file, kept);
  const key = `${kept ? "kept" : "all"}:${file}`;
  let text = stripped.get(key);
  if (text === undefined) {
    text = strip(src, file, kept);
    stripped.set(key, text);
  }
  return text;
}

/** A scanned file's text with its comments blanked. */
function live(file: string): string {
  return withoutComments(read(file), file);
}

/** `file:line` of every old-name match in `src` outside comments, the allowed literals and (unless `kept` is false) the kept tokens. */
function nameHits(src: string, file: string, allow: readonly string[] = ALLOWED, kept = true): string[] {
  let text = withoutComments(src, file, kept);
  for (const literal of allow) text = text.split(literal).join(" ".repeat(literal.length));
  return [...text.matchAll(OLD_NAME)].map((m) => `${file}:${text.slice(0, m.index).split("\n").length}`);
}

let webList: string[] | undefined;
let apiList: string[] | undefined;

/** Every web source file the gate scans, repo-relative; walked once per run. */
function webFiles(): string[] {
  webList ??= webColourSourceFiles().map(rel);
  return webList;
}

/**
 * Every api source file the gate scans, repo-relative; walked once per run. The `*-writes.ts`
 * contracts are included: the API's write bodies moved there (F3.85), and their refusal messages
 * reach the screen in a 400. So is `metric-catalog-params.ts`: F4.317 moved `sourceBindingWriteSchema` there,
 * with its 400 message and its OpenAPI `.describe()` text. The rest of `packages/shared` is not, since
 * ADR 0083 keeps the internal name there.
 */
function apiFiles(): string[] {
  apiList ??= [
    ...walk(join(repoRoot, "apps/api/src")).filter(
      (f) => /\.ts$/.test(f) && !/\.(spec|test)\.ts$/.test(f) && !/[\\/]src[\\/]testing[\\/]/.test(f),
    ),
    ...walk(join(repoRoot, "packages/shared/src/contracts")).filter(
      (f) => /[\\/][^\\/]+-writes\.ts$/.test(f) || /[\\/]metric-catalog-params\.ts$/.test(f),
    ),
  ].map(rel);
  return apiList;
}

function hitsIn(files: string[], allow: readonly string[] = ALLOWED, kept = true): string[] {
  return files.flatMap((file) => nameHits(read(file), file, allow, kept));
}

/** Every new-name spelling in `text`. */
function spellingsIn(text: string): string[] {
  return [...text.matchAll(SPELLING)].map((m) => m[0]);
}

/** Every new-name spelling in `files`, comments blanked. */
function spellings(files: string[]): string[] {
  return files.flatMap((file) => spellingsIn(withoutComments(read(file), file)));
}

type AssetPath = { d: string; fill: string | undefined; fillRule: string | undefined; fillCount: number };

/** One attribute of one tag; the leading space keeps `d` out of `id` and `fill` out of `fill-rule`. */
function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
}

/** A logo asset read by regex: its view box, its gradients with the first one's axis and stops, and its paths in order. */
function assetParts(src: string) {
  const gradients = src.match(/<linearGradient\b[^>]*>/g) ?? [];
  const axis = (name: string) => Number(attr(gradients[0] ?? "", name));
  return {
    viewBox: attr(/<svg\b[^>]*>/.exec(src)?.[0] ?? "", "viewBox"),
    gradientIds: gradients.map((tag) => attr(tag, "id")),
    gradient: { x1: axis("x1"), y1: axis("y1"), x2: axis("x2"), y2: axis("y2") },
    stops: (src.match(/<stop\b[^>]*>/g) ?? []).map((tag) => ({
      offset: Number(attr(tag, "offset")),
      color: attr(tag, "stop-color"),
    })),
    paths: (src.match(/<path\b[^>]*>/g) ?? []).map(
      (tag): AssetPath => ({
        d: attr(tag, "d") ?? "",
        fill: attr(tag, "fill"),
        fillRule: attr(tag, "fill-rule"),
        fillCount: tag.match(/\sfill=/g)?.length ?? 0,
      }),
    ),
  };
}

function asset(name: string): string {
  return read(`${BRAND_DIR}/${name}.svg`);
}

/** What N12 holds for one asset: the pulse path's paint and every gradient reference in the file. */
function pulsePaint(src: string) {
  const parts = assetParts(src);
  return {
    pulseFills: parts.paths[0]?.fillCount,
    pulseFill: parts.paths[0]?.fill,
    gradientReferences: src.match(/url\(\s*#verve-pulse\s*\)|href="#verve-pulse"/g)?.length ?? 0,
    gradientIds: parts.gradientIds,
    hasStroke: /stroke/i.test(src),
    hasCssPaint: /<style\b|\sstyle=/i.test(src),
  };
}

const ONE_GRADIENT_FILL = {
  pulseFills: 1,
  pulseFill: "url(#verve-pulse)",
  gradientReferences: 1,
  gradientIds: ["verve-pulse"],
  hasStroke: false,
  hasCssPaint: false,
};

describe("F3.33 the on-screen name gate", () => {
  it("N1 apps/web/src has no TRINETRA or IONSiTE NEXUS outside comments and the kept tokens", () => {
    expect(hitsIn(webFiles())).toEqual([]);
  });

  it("N2a the index.html <title> is Verve", () => {
    const title = /<title>([^<]*)<\/title>/.exec(withoutComments(read(INDEX_HTML), INDEX_HTML))?.[1];
    expect(title).toBe(NEW_NAME);
  });

  it("N2b apps/web/index.html has no old name outside comments", () => {
    expect(hitsIn([INDEX_HTML])).toEqual([]);
  });

  it("N2c index.html links the SVG favicon, and the favicon is the approved navy tile byte for byte", () => {
    expect(withoutComments(read(INDEX_HTML), INDEX_HTML)).toContain(ICON_LINK);
    expect(existsSync(join(repoRoot, FAVICON))).toBe(true);
    expect(readFileSync(join(repoRoot, FAVICON)).equals(readFileSync(join(repoRoot, BRAND_DIR, "verve-mark-tile-navy.svg")))).toBe(
      true,
    );
  });

  it("N3 apps/api/src has no old name outside comments, the two allowed literals and the kept tokens", () => {
    expect(hitsIn(apiFiles())).toEqual([]);
  });

  it("N4 the realm displayName is Verve", () => {
    expect((JSON.parse(read(REALM_JSON)) as { displayName?: unknown }).displayName).toBe(NEW_NAME);
  });

  it("N5 with no allowlist the api hits are exactly the two allowed sites (the allowlist is live)", () => {
    const files = [...new Set(hitsIn(apiFiles(), []).map((hit) => hit.replace(/:\d+$/, "")))].sort();
    expect(files).toEqual([
      "apps/api/src/notifications/notifications.config.ts",
      "apps/api/src/notifications/webhook.transport.ts",
    ]);
  });

  it("N5b without the kept list the hits are in exactly the five kept files (the kept list is live)", () => {
    const hits = hitsIn([...webFiles(), ...apiFiles()], ALLOWED, false);
    expect([...new Set(hits.map((hit) => hit.replace(/:\d+$/, "")))].sort()).toEqual(KEPT_FILES);
  });

  it("N6 a name inside a comment is not a hit", () => {
    expect(nameHits("// TRINETRA\n/* Trinetra */\n", "x.ts")).toEqual([]);
  });

  it("N6b a // inside a string is not a comment", () => {
    expect(nameHits('const s = "a // TRINETRA";', "x.ts")).toEqual(["x.ts:1"]);
  });

  it("N6c a // inside JSX text is not a comment", () => {
    expect(nameHits("const e = <p>Energy // TRINETRA</p>;", "x.tsx")).toEqual(["x.tsx:1"]);
  });

  it("N6h JSX text that starts with // is not a comment", () => {
    expect(nameHits("const e = <p>// TRINETRA</p>;", "x.tsx")).toEqual(["x.tsx:1"]);
  });

  it("N6d a /* ... */ pair spread over string literals is not a comment", () => {
    expect(nameHits('const a = " /*";\nconst b = "TRINETRA";\nconst c = "*/ ";\n', "x.ts")).toEqual(["x.ts:2"]);
  });

  it("N6e a // inside an HTML attribute is not a comment", () => {
    expect(nameHits('<meta name="application-name" content="Ops // TRINETRA" />', "x.html")).toEqual(["x.html:1"]);
  });

  it("N6f JSX, script and HTML comments are blanked", () => {
    const tsx = "const e = <p>{/* TRINETRA */}ok</p>; // TRINETRA\n";
    const html = "<!-- TRINETRA -->\n<script>\n  // TRINETRA\n  const t = 1; /* TRINETRA */\n</script>\n";
    expect([...nameHits(tsx, "x.tsx"), ...nameHits(html, "x.html")]).toEqual([]);
  });

  it("N6g a name in a script string inside HTML is a hit", () => {
    expect(nameHits('<script>\n  const t = "// TRINETRA";\n</script>\n', "x.html")).toEqual(["x.html:2"]);
  });

  it("N6i a name that is not exactly a kept token is a hit", () => {
    expect(nameHits('const s = "Nexus";', "x.ts")).toEqual(["x.ts:1"]);
    expect(nameHits('const s = "nexus theme";', "x.ts")).toEqual(["x.ts:1"]);
    expect(nameHits("const nexusLabel = 1;", "x.ts")).toEqual(["x.ts:1"]);
    expect(nameHits("const e = <p>nexus</p>;", "x.tsx")).toEqual(["x.tsx:1"]);
  });

  it("N6j the kept keys and the kept symbol are not hits", () => {
    expect(nameHits('const o = { nexus: "nexus", d: "nexus-soft" }; NEXUS_SOFT_CHART_TYPE;', "x.ts")).toEqual([]);
  });

  it("N6k an identifier that only contains 'ion site' is not a hit", () => {
    expect(nameHits("function siteZoneOf() {}", "x.ts")).toEqual([]);
    expect(nameHits("const e = <StationSiteHalves />;", "x.tsx")).toEqual([]);
  });

  it("N7 the match is case-insensitive", () => {
    expect(nameHits('const s = "Trinetra";', "x.ts")).toEqual(["x.ts:1"]);
    expect(nameHits('const s = "ionsite";', "x.ts")).toEqual(["x.ts:1"]);
    expect(nameHits('const s = "Ion Site";', "x.ts")).toEqual(["x.ts:1"]);
  });

  it("N8 every Verve spelling is exact, with at least one in the web and one in the api", () => {
    const web = spellings([...webFiles(), INDEX_HTML]);
    const api = spellings(apiFiles());
    expect(web.length).toBeGreaterThan(0);
    expect(api.length).toBeGreaterThan(0);
    expect([...web, ...api, ...spellings([REALM_JSON])].filter((s) => s !== NEW_NAME)).toEqual([]);
  });

  it("N8b a name that ends a sentence is a spelling; a file name, an import path, an id and a symbol are not", () => {
    expect(spellingsIn("from VERVE. If you")).toEqual(["VERVE"]);
    expect(spellingsIn("Welcome to verve.")).toEqual(["verve"]);
    expect(spellingsIn('"./verve-logo-data" verve.svg docs/brand/verve/x verve-pulse-ID VERVE_LOGO VerveLogoTone')).toEqual([]);
  });

  it("N9 the walkers reach the real web and api trees", () => {
    expect(webFiles().length).toBeGreaterThanOrEqual(300);
    expect(apiFiles()).toContain("apps/api/src/reports/report-render.service.ts");
  });

  it("N9b the api walk reaches the contracts write bodies the API returns refusal text from", () => {
    expect(apiFiles()).toContain("packages/shared/src/contracts/dashboard-writes.ts");
    expect(apiFiles()).toContain("packages/shared/src/contracts/metric-catalog-params.ts");
    expect(
      apiFiles()
        .filter((f) => f.startsWith("packages/"))
        .every((f) => /\/contracts\/([^/]+-writes|metric-catalog-params)\.ts$/.test(f)),
    ).toBe(true);
  });

  it("N10a the OpenAPI document title is Verve Enterprise EMS API", () => {
    expect(live("apps/api/src/openapi/openapi-document.ts")).toContain('.setTitle("Verve Enterprise EMS API")');
  });

  it("N10b the Swagger site title is Verve EMS API", () => {
    expect(live("apps/api/src/main.ts")).toContain('customSiteTitle: "Verve EMS API"');
  });

  it("N11 the TRINETRA logo image is deleted", () => {
    expect(existsSync(join(repoRoot, "apps/web/src/assets/trinetra-logo.jpeg"))).toBe(false);
  });

  it.each(GRADIENT_ASSETS)("N12 %s: the pulse is one filled path with the single gradient and no stroke", (name) => {
    expect(pulsePaint(asset(name))).toEqual(ONE_GRADIENT_FILL);
  });

  it("N12b the paint check is live: a stroke, a second gradient fill, a flat pulse and a CSS paint each fail it", () => {
    const src = asset("verve-logo-dark");
    const pulse = /<path\b[^>]*>/.exec(src)?.[0] ?? "";
    expect(pulsePaint(src.replace("<path ", '<path stroke="#FFFFFF" '))).not.toEqual(ONE_GRADIENT_FILL);
    expect(pulsePaint(src.replace(pulse, pulse + pulse))).not.toEqual(ONE_GRADIENT_FILL);
    expect(pulsePaint(src.replace('fill="url(#verve-pulse)"', 'fill="#38BDF8"'))).not.toEqual(ONE_GRADIENT_FILL);
    expect(pulsePaint(src.replace("<path ", '<path style="fill:#38BDF8" '))).not.toEqual(ONE_GRADIENT_FILL);
    expect(pulsePaint(src.replace("<defs>", "<style>path{fill:#38BDF8}</style><defs>"))).not.toEqual(ONE_GRADIENT_FILL);
  });

  it("N13 the web logo data equals the two approved logo assets", () => {
    const dark = assetParts(asset("verve-logo-dark"));
    const light = assetParts(asset("verve-logo-light"));
    expect(dark.paths).toHaveLength(2);
    expect(dark.stops).toHaveLength(5);
    expect(dark.paths[1]?.fillRule).toBe("evenodd");
    // The two tones are one drawing: only the stop colours and the letter ink differ.
    expect({ ...light, stops: light.stops.map((s) => s.offset), paths: light.paths.map((p) => ({ ...p, fill: "" })) }).toEqual({
      ...dark,
      stops: dark.stops.map((s) => s.offset),
      paths: dark.paths.map((p) => ({ ...p, fill: "" })),
    });
    expect(VERVE_LOGO).toEqual({
      viewBox: dark.viewBox,
      pulse: dark.paths[0]?.d,
      letters: dark.paths[1]?.d,
      gradient: dark.gradient,
      tones: {
        dark: { stops: dark.stops, letters: dark.paths[1]?.fill },
        light: { stops: light.stops, letters: light.paths[1]?.fill },
      },
    });
  });
});
