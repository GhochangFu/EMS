import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { webColourSourceFiles } from "./support/colour-scan";
import { blankComments } from "./support/pending-button-scan";
import { repoRoot, walk } from "./support/source-scan";

/**
 * `F3.33` — the on-screen name gate (ADR 0083 decision 6, plan
 * `docs/plans/f3.33-ionsite-nexus-rebrand.md` U1). `IONSiTE NEXUS` replaces `TRINETRA` wherever a
 * user reads the product name (decision 1); this file fails when the old name comes back.
 *
 * **Scanned** (decision 4, OQ5), comments blanked first (`blankComments`; an `.html` file has its
 * `<!-- -->` comments blanked too), every `/trinetra/gi` match reported as `file:line`:
 *  - every `.ts` / `.tsx` / `.css` file under `apps/web/src`, minus specs, tests and
 *    `test-setup.ts` (`webColourSourceFiles()`) — N1;
 *  - `apps/web/index.html` — N2b, and its `<title>` text — N2a;
 *  - every `.ts` file under `apps/api/src`, minus `*.spec.ts`, `*.test.ts` and `src/testing/` — N3;
 *  - `infra/keycloak/bms-realm.json` — its parsed `displayName` only (N4);
 *  - the OpenAPI title and the Swagger site title as exact literals (N10a, N10b), because the
 *    OpenAPI document needs a Nest app and is not unit-testable here (§4.6, `F4.20`);
 *  - the logo image is gone (N11).
 *
 * **Allowlisted** (decision 5): exactly two literals, blanked before the scan —
 * `x-trinetra-signature` (the webhook header a receiver verifies) and `trinetra@localhost` (the
 * `SMTP_FROM` development default). N5 proves the allowlist is the only thing hiding them.
 *
 * **Spelling** (N8): every `/ion\s?site\s*nexus/gi` match in the scanned sources is exactly
 * `IONSiTE NEXUS`, and there is at least one.
 *
 * **Liveness** of the scanner itself: N5 (the regex finds the two allowlisted sites), N6 (comments
 * do not count), N7 (the match is case-insensitive), N9 (the walkers reach the real trees).
 *
 * **Not covered.**
 *  - The realm JSON is not text-scanned as a whole; only `displayName` is checked.
 *  - A name built at runtime or by concatenation (`"TRI" + "NETRA"`) is invisible.
 *  - Everything outside decision 4: `apps/sim`, `apps/ingest`, `packages/*`, seeds, specs, tests,
 *    `apps/api/src/testing/`, and repository documents (decision 5).
 *  - A Keycloak realm that is already imported keeps "TRINETRA" until an admin edits it (OQ8).
 *  - The scan matches text, not meaning: a code identifier or file name spelling the old name
 *    inside the scanned sources counts as a hit, though decision 5 keeps such names elsewhere.
 */

const ALLOWED = ["x-trinetra-signature", "trinetra@localhost"] as const;
const OLD_NAME = /trinetra/gi;
const SPELLING = /ion\s?site\s*nexus/gi;
const NEW_NAME = "IONSiTE NEXUS";

const INDEX_HTML = "apps/web/index.html";
const REALM_JSON = "infra/keycloak/bms-realm.json";

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

/** `<!-- -->` blanked for `.html`, then JS comments blanked; newlines kept so lines hold. */
function withoutComments(src: string, file: string): string {
  const html = file.endsWith(".html") ? src.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, " ")) : src;
  return blankComments(html);
}

/** `file:line` of every old-name match in `src` outside comments and the allowed literals. */
function nameHits(src: string, file: string, allow: readonly string[] = ALLOWED): string[] {
  let text = withoutComments(src, file);
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

/** Every api source file the gate scans, repo-relative; walked once per run. */
function apiFiles(): string[] {
  apiList ??= walk(join(repoRoot, "apps/api/src"))
    .filter((f) => /\.ts$/.test(f) && !/\.(spec|test)\.ts$/.test(f) && !/[\\/]src[\\/]testing[\\/]/.test(f))
    .map(rel);
  return apiList;
}

function hitsIn(files: string[], allow: readonly string[] = ALLOWED): string[] {
  return files.flatMap((file) => nameHits(read(file), file, allow));
}

/** Every new-name spelling in `files`, comments blanked. */
function spellings(files: string[]): string[] {
  return files.flatMap((file) => [...withoutComments(read(file), file).matchAll(SPELLING)].map((m) => m[0]));
}

describe("F3.33 the on-screen name gate", () => {
  it("N1 apps/web/src has no TRINETRA outside comments", () => {
    expect(hitsIn(webFiles())).toEqual([]);
  });

  it("N2a the index.html <title> is IONSiTE NEXUS", () => {
    const title = /<title>([^<]*)<\/title>/.exec(withoutComments(read(INDEX_HTML), INDEX_HTML))?.[1];
    expect(title).toBe(NEW_NAME);
  });

  it("N2b apps/web/index.html has no TRINETRA outside comments", () => {
    expect(hitsIn([INDEX_HTML])).toEqual([]);
  });

  it("N3 apps/api/src has no TRINETRA outside comments and the two allowed literals", () => {
    expect(hitsIn(apiFiles())).toEqual([]);
  });

  it("N4 the realm displayName is IONSiTE NEXUS", () => {
    expect((JSON.parse(read(REALM_JSON)) as { displayName?: unknown }).displayName).toBe(NEW_NAME);
  });

  it("N5 with no allowlist the api hits are exactly the two allowed sites (the allowlist is live)", () => {
    const files = [...new Set(hitsIn(apiFiles(), []).map((hit) => hit.replace(/:\d+$/, "")))].sort();
    expect(files).toEqual([
      "apps/api/src/notifications/notifications.config.ts",
      "apps/api/src/notifications/webhook.transport.ts",
    ]);
  });

  it("N6 a name inside a comment is not a hit", () => {
    expect(nameHits("// TRINETRA\n/* Trinetra */\n", "x.ts")).toEqual([]);
  });

  it("N7 the match is case-insensitive", () => {
    expect(nameHits('const s = "Trinetra";', "x.ts")).toEqual(["x.ts:1"]);
  });

  it("N8 every IONSiTE NEXUS spelling is exact, and there is at least one", () => {
    const found = spellings([...webFiles(), INDEX_HTML, ...apiFiles(), REALM_JSON]);
    expect(found.length).toBeGreaterThan(0);
    expect(found.filter((s) => s !== NEW_NAME)).toEqual([]);
  });

  it("N9 the walkers reach the real web and api trees", () => {
    expect(webFiles().length).toBeGreaterThanOrEqual(300);
    expect(apiFiles()).toContain("apps/api/src/reports/report-render.service.ts");
  });

  it("N10a the OpenAPI document title is IONSiTE NEXUS Enterprise EMS API", () => {
    expect(read("apps/api/src/openapi/openapi-document.ts")).toContain('.setTitle("IONSiTE NEXUS Enterprise EMS API")');
  });

  it("N10b the Swagger site title is IONSiTE NEXUS EMS API", () => {
    expect(read("apps/api/src/main.ts")).toContain('customSiteTitle: "IONSiTE NEXUS EMS API"');
  });

  it("N11 the TRINETRA logo image is deleted", () => {
    expect(existsSync(join(repoRoot, "apps/web/src/assets/trinetra-logo.jpeg"))).toBe(false);
  });
});
