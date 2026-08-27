import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const apiSrc = join(repoRoot, "apps", "api", "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.ts$/.test(entry) && !/\.(spec|test)\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

type Site = { file: string; index: number; window: string };

/**
 * Every occurrence of `needle` in `content`, paired with a bounded window of
 * the text that follows it. Bounded to the next occurrence of `needle` itself
 * (or 600 characters, whichever comes first) — the same reason
 * `tests/adr-0043-tenant-columns.test.ts` and
 * `tests/adr-0043-amendment-5-with-check.test.ts` bound their regexes with
 * `[^;]*`: an unbounded scan could let one call site's `organizationId` field
 * satisfy the assertion for a DIFFERENT, actually-missing call site right
 * below it.
 */
function occurrencesOf(content: string, needle: string): Array<{ index: number; window: string }> {
  const hits: Array<{ index: number; window: string }> = [];
  let from = 0;
  for (;;) {
    const at = content.indexOf(needle, from);
    if (at === -1) break;
    const next = content.indexOf(needle, at + needle.length);
    const end = next === -1 ? at + 600 : Math.min(next, at + 600);
    hits.push({ index: at, window: content.slice(at, end) });
    from = at + needle.length;
  }
  return hits;
}

function findSites(needle: string): Site[] {
  const sites: Site[] = [];
  for (const file of walk(apiSrc)) {
    const content = readFileSync(file, "utf8");
    for (const hit of occurrencesOf(content, needle)) {
      sites.push({ file: relative(repoRoot, file).replace(/\\/g, "/"), index: hit.index, window: hit.window });
    }
  }
  return sites;
}

/**
 * `E7.1c` (item D) — every `bms.audit_log` write must stamp a considered
 * `organizationId` (real, for a tenant-scoped action; `null`, for a genuine
 * platform/fleet event) rather than silently inheriting a stale default.
 * Amendment 5 role-scopes `audit_log`'s `NULL` `WITH CHECK` branch `TO
 * bms_fleet` in `0048`, so a write that forgets this either 500s (a real id
 * on the wrong pool) or 500s differently (a forgotten `null` on the tenant
 * pool). This is the one thing that catches a call site added AFTER this
 * item — not a per-site unit test (55 of those would be noise), a structural
 * scan that fails the moment a new `insert(auditLog)` or `MasterDataAuditService.write`
 * call site omits the field.
 *
 * No longer excludes `apps/api/src/notifications/channels.service.ts`: commit
 * `410ee78` on this branch (E7.1c, item G) wired a real `organizationId`
 * parameter through the private `audit()` helper, so the exclusion this
 * comment used to document is stale — leaving the filter in place would have
 * hidden a reverted stamp from the one invariant built to catch it, since
 * `audit()` writes on `fleetDb` (BYPASSRLS) and a wrong or missing
 * `organizationId` there is silently admitted, not refused.
 */
describe("E7.1c (item D) — every audit_log write names an organizationId", () => {
  it("every direct insert(auditLog).values({...}) names organizationId", () => {
    const sites = findSites("insert(auditLog).values(");
    expect(sites.length, "expected at least the known direct insert(auditLog) sites").toBeGreaterThanOrEqual(14);
    const missing = sites.filter((s) => !/organizationId/.test(s.window));
    expect(
      missing.map((s) => `${s.file}:${s.index}`),
      "insert(auditLog) call sites with no organizationId field in view",
    ).toEqual([]);
  });

  it("every MasterDataAuditService.write(...) call names organizationId", () => {
    const sites = findSites(".audit.write(");
    expect(sites.length, "expected at least the known funnel call sites").toBeGreaterThanOrEqual(30);
    const missing = sites.filter((s) => !/organizationId/.test(s.window));
    expect(
      missing.map((s) => `${s.file}:${s.index}`),
      "audit.write(...) call sites with no organizationId field in view",
    ).toEqual([]);
  });

  it("AuditInput.organizationId is required, not optional", () => {
    const source = readFileSync(
      join(apiSrc, "admin", "master-data-audit.service.ts"),
      "utf8",
    );
    // Not `organizationId?:` — E7.1c makes this the forcing function: every
    // caller must be touched and reasoned about, rather than silently
    // inheriting a default that is wrong on the plain tenant pool either way
    // (see the docstring on `write` for why there is no safe default post-0048).
    expect(source).toMatch(/organizationId: string \| null;/);
    expect(source).not.toMatch(/organizationId\?:\s*string \| null/);
  });
});
