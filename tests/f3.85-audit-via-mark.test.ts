import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const apiSrc = join(repoRoot, "apps/api/src");
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

type Route = { method: string; path: string };

/** `@bms/shared/copilot` through `createRequire` (it reads `packages/shared/dist`; rebuild it after a catalog edit). */
const require_ = createRequire(import.meta.url);
const { COPILOT_CATALOG, EXCLUDED_ROUTES } = require_("@bms/shared/copilot") as {
  COPILOT_CATALOG: readonly Route[];
  EXCLUDED_ROUTES: readonly Route[];
};

/**
 * `F3.85` PR 4 / ADR 0099 decision 4.5, drafter choice 4 — a confirmed
 * copilot change is visible in the audit log only because
 * `MasterDataAuditService` adds `via: "copilot"` and the change id. A catalog
 * write that inserted into `bms.audit_log` itself would lose the mark.
 *
 * So: every catalog write service (release 1, and release 2 since `F3.86` PR 2) audits through
 * `MasterDataAuditService` (a positive control — a renamed or moved file turns
 * this red rather than passing by absence), no file in a catalog directory
 * inserts into the audit log directly, and both of the service's inserts
 * apply the mark.
 *
 * PR 8: the catalog (`@bms/shared/copilot`) names routes, not files, so the
 * writers stay named here by file — every service a catalog entry's handler
 * reaches. `apply-to-sites` and the site arm of `instantiate` write through
 * `SiteLayoutService` in `control-room/`, so that file and directory join
 * the lists.
 */
const CATALOG_WRITERS = [
  "apps/api/src/dashboard-builder/dashboards.service.ts",
  "apps/api/src/admin/dashboard-templates/dashboard-templates.service.ts",
  "apps/api/src/admin/dashboard-templates/dashboard-templates-instantiate.service.ts",
  "apps/api/src/admin/dashboard-templates/dashboard-templates-stock.service.ts",
  // `F4.254` PR 2: `assetTemplate.create`, `.archive`, `.draft` and `.importStock` write through
  // these two. `asset-templates-stock.service.ts` is deliberately NOT listed: it holds no
  // `MasterDataAuditService` import (the import writes through `AssetTemplatesAdminService.create`),
  // so the per-file check below would turn red on it.
  "apps/api/src/admin/asset-templates/asset-templates.service.ts",
  "apps/api/src/admin/asset-templates/asset-templates-write-core.ts",
  "apps/api/src/admin/asset-templates/asset-templates-instantiate-core.ts",
  // `F4.254` PR 3: `assetTemplate.instantiate`'s handler reaches the core through this service.
  "apps/api/src/admin/asset-templates/asset-templates-instantiate.service.ts",
  "apps/api/src/admin/calc-parameters/calc-parameters.service.ts",
  "apps/api/src/admin/asset-points/asset-point-calc-override.service.ts",
  "apps/api/src/control-room/site-layout.service.ts",
  // `F3.86` PR 2 (plan §4.7): every service a release-2 entry's handler reaches.
  "apps/api/src/admin/locations/locations.service.ts",
  "apps/api/src/admin/rtus/rtus.service.ts",
  "apps/api/src/admin/assets/assets.service.ts",
  "apps/api/src/admin/asset-groups/asset-groups.service.ts",
  "apps/api/src/admin/point-keys/point-keys.service.ts",
  "apps/api/src/admin/asset-points/asset-points.service.ts",
  "apps/api/src/admin/users/users.service.ts",
  "apps/api/src/admin/users/user-grants.service.ts",
  "apps/api/src/admin/onboarding/onboarding-commit.service.ts",
  // `F3.24b` (ADR 0103): the `onboarding.discovery` handler audits start and refuse rows here.
  "apps/api/src/admin/onboarding/onboarding-discovery.service.ts",
  "apps/api/src/control-room/site-control-room-view.service.ts",
  // `F3.87` PR 2 (plan §4.7): every service a release-3 entry's handler reaches.
  "apps/api/src/mimic-layouts/mimic-layouts.service.ts",
  "apps/api/src/mimic-symbol-libraries/mimic-symbol-libraries.service.ts",
  "apps/api/src/admin/vocabularies/asset-roles/asset-roles.service.ts",
  // `F4.282` (Amendment 8): the location-type vocabulary, every route an entry.
  "apps/api/src/admin/vocabularies/location-types.service.ts",
  // `F4.278` (Amendment 8): every alarm-rule write entry's handler reaches this service.
  "apps/api/src/rules/rules.service.ts",
  // `F4.279` (Amendment 8): the channel writes (and `PUT /rules/:id/notifications`) and the
  // escalation profiles and defaults. `channels.service.ts` is deliberately NOT listed: it
  // holds only the reads the worker loads and no longer references the funnel.
  "apps/api/src/notifications/channel-writes.service.ts",
  "apps/api/src/notifications/escalation-profiles.service.ts",
  // F4.280 (Amendment 8): the report schedule writes and the on-demand file save.
  "apps/api/src/reports/report-schedules.service.ts",
  "apps/api/src/reports/report-files.service.ts",
  // F4.281 (Amendment 8): the maintenance schedule create and the two direction entries.
  "apps/api/src/maintenance/maintenance.service.ts",
] as const;

/**
 * `F4.257` — the second list of the two-list ledger. A NOT row is a service under {@link CATALOG_DIRS}
 * that references `MasterDataAuditService` and whose audit write is reached **only from the handler of
 * one catalog-EXCLUDED route** (so a confirmed copilot change can never produce it). The class may still
 * be reached from a catalog entry for work that writes no audit row: `asset-dashboards-instantiate`'s
 * `instantiateForAssets` runs inside the `assetTemplate.instantiate` entry (through
 * `asset-templates-instantiate-core.ts`), but its only audit write is in `backfill`, which only the
 * excluded `default-dashboards` handler calls.
 *
 * - `route` — the excluded route; the cases below require it in `EXCLUDED_ROUTES`, not a catalog
 *   entry, and served by exactly one controller handler that calls this file's class.
 * - `auditMethods` — the class's methods on the path from that handler to the audit write: the method
 *   the handler calls and any private helper that holds the write (`commit` → `applyPlan`). Every audit
 *   call site in the file must lie in one of them, and nothing but the row's handler may call them.
 *
 * A new service must join one list or the other — it cannot be added to neither.
 */
const NOT_CATALOG_WRITERS: readonly { readonly file: string; readonly route: Route; readonly auditMethods: readonly string[] }[] = [
  {
    file: "apps/api/src/admin/asset-points/mapping-sheet.service.ts",
    route: { method: "POST", path: "/admin/asset-points/mapping-sheet/commit" }, // multipart
    auditMethods: ["commit", "applyPlan"],
  },
  {
    file: "apps/api/src/admin/asset-templates/asset-templates-migrate.service.ts",
    route: { method: "POST", path: "/admin/asset-templates/:id/migrate" },
    auditMethods: ["migrate"],
  },
  {
    file: "apps/api/src/admin/asset-templates/asset-templates-seeded-rules.service.ts",
    route: { method: "POST", path: "/admin/asset-templates/:id/seeded-rules/reapply" },
    auditMethods: ["reapply"],
  },
  {
    file: "apps/api/src/admin/asset-templates/asset-dashboards-instantiate.service.ts",
    route: { method: "POST", path: "/admin/asset-templates/:id/default-dashboards" },
    auditMethods: ["backfill"],
  },
];

/** Directories whose write routes the release-1 catalog covers; no file in them may insert into the audit log itself. */
const CATALOG_DIRS = [
  "dashboard-builder",
  "admin/dashboard-templates",
  "admin/asset-templates",
  "admin/calc-parameters",
  "admin/asset-points",
  "calc",
  "control-room",
  "admin/locations",
  "admin/rtus",
  "admin/assets",
  "admin/asset-groups",
  "admin/point-keys",
  "admin/users",
  "admin/onboarding",
  "mimic-layouts",
  "mimic-symbol-libraries",
  // `F4.282` (Amendment 8): the whole vocabulary directory — both services back catalog entries.
  "admin/vocabularies",
  // `F4.278` (Amendment 8): the alarm rules — the old direct `insert(auditLog)` helper is gone.
  "rules",
  // `F4.279` (Amendment 8): notifications and escalation — the two direct helpers are gone.
  "notifications",
  // F4.280 (Amendment 8): the report schedules and files — both write services already audit through the funnel.
  "reports",
  // F4.281 (Amendment 8): the maintenance schedules — the three direct audit inserts are gone.
  "maintenance",
] as const;

/** The drizzle form and the raw-SQL form. */
const DIRECT_INSERT = /\binsert\(\s*auditLog\s*\)|\binsert\s+into\s+(bms\.)?audit_log\b/i;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (name.endsWith(".ts") && !name.endsWith(".spec.ts") && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

const toRel = (full: string): string => relative(repoRoot, full).replaceAll("\\", "/");

/** A line that opens or continues a comment (`//`, `/*`, ` * `). */
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

/** A file's lines with every comment-only line blanked, so line indices still match the file. */
const codeLines = (source: string): string[] => source.split(/\r?\n/).map((line) => (COMMENT_LINE.test(line) ? "" : line));

/** The identifier `MasterDataAuditService`, as a whole word. */
const REFERENCES_AUDIT = /\bMasterDataAuditService\b/;

/** The one definition of "references" for the ledger cases: the name on a code line, not in a comment. */
const referencesAudit = (source: string): boolean => REFERENCES_AUDIT.test(codeLines(source).join("\n"));

/**
 * Production candidates for the ledger: `.ts`/`.tsx` under a catalog dir, minus spec/test files
 * (assertions, not writers) and `*.module.ts` (a Nest module only lists the provider; it holds no write).
 * The exclusion is by suffix only, so a real `*.service.ts` or `*-core.ts` is never skipped.
 */
function ledgerCandidates(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (
        /\.tsx?$/.test(name) &&
        !/\.(spec|test)\.tsx?$/.test(name) &&
        !/\.module\.ts$/.test(name) &&
        referencesAudit(readFileSync(full, "utf8"))
      ) {
        out.push(toRel(full));
      }
    }
  };
  for (const dir of CATALOG_DIRS) walk(join(apiSrc, dir));
  return out;
}

const routeKey = (route: Route): string => `${route.method} ${route.path}`;

// ---------------------------------------------------------------------------
// The controller walk (`F4.257`, cases e–g). The parse of
// `f3.85-catalog-coverage.test.ts`, copied rather than imported (an import
// would run that file's `describe` here), widened to every `*.controller.ts`
// under `apps/api/src`, every route verb, and one class at a time.
// ---------------------------------------------------------------------------

const CONTROLLER_DECORATOR = /^@Controller\(\s*"([^"]*)"\s*\)/;
const ROUTE_DECORATOR = /^\s*@(Get|Post|Put|Patch|Delete)\(\s*(?:"([^"]*)")?\s*\)/;
const ANY_ROUTE = /^\s*@(Get|Post|Put|Patch|Delete)\(/;
const CLASS_DECL = /^export class (\w+)/;
/** A class member signature at two-space indent: `  [modifiers] name(` or `  name<` (a getter or setter too). */
const MEMBER_SIGNATURE = /^  (?:(?:private|public|protected|static|async|readonly|get|set)\s+)*([A-Za-z_$][\w$]*)\s*[(<]/;

type Handler = Route & {
  file: string;
  /** 0-based line range of the handler in its file, decorator to closing brace (inclusive). */
  start: number;
  end: number;
  /** The handler's code lines (comments blanked). */
  body: string;
  /** Constructor parameter name → type name, for the handler's own class. */
  props: ReadonlyMap<string, string>;
};

/** `name: Type` pairs on the given code lines (constructor parameters, interface fields, declarations). */
function typedNames(lines: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of lines.join("\n").matchAll(/\b(\w+)\??\s*:\s*([A-Z]\w*)\b/g)) out.set(match[1] as string, match[2] as string);
  return out;
}

/** Every name declared `: <type>` on the given code lines (all of them, so a reused name hides none). */
const namesTyped = (lines: readonly string[], type: string): string[] =>
  [...lines.join("\n").matchAll(/\b(\w+)\??\s*:\s*([A-Z]\w*)\b/g)].filter((m) => m[2] === type).map((m) => m[1] as string);

/**
 * Every route handler of one controller file. The prefix is the last `@Controller` above the route (a
 * file may hold two controllers); the constructor map is the handler's own class's. A handler ends at its
 * closing brace at class indent, the next route or member decorator, or the class's closing `}` — so a
 * trailing private helper is not counted as the last route's body.
 */
function walkController(file: string): Handler[] {
  const lines = codeLines(readFileSync(join(repoRoot, file), "utf8"));
  const out: Handler[] = [];
  let prefix: string | undefined;
  let props = new Map<string, string>();
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] as string;
    const controller = CONTROLLER_DECORATOR.exec(line);
    if (controller) {
      prefix = controller[1];
      continue;
    }
    if (CLASS_DECL.test(line)) {
      props = new Map();
      continue;
    }
    if (/^  constructor\(/.test(line)) {
      let close = index;
      while (close < lines.length && !/\)\s*\{\s*\}?\s*$/.test(lines[close] as string)) close++;
      props = typedNames(lines.slice(index, close + 1));
      continue;
    }
    if (!ANY_ROUTE.test(line)) continue;
    const match = ROUTE_DECORATOR.exec(line);
    if (!match) throw new Error(`${file}:${index + 1}: a route decorator this walk cannot read — ${line.trim()}`);
    if (prefix === undefined) throw new Error(`${file}:${index + 1}: a route above any @Controller`);
    // The method signature below the decorator stack, then its body.
    let signature = index + 1;
    while (signature < lines.length && !MEMBER_SIGNATURE.test(lines[signature] as string)) signature++;
    let end = signature + 1;
    while (end < lines.length) {
      const next = lines[end] as string;
      if (/^  \}\s*$/.test(next)) break; // the handler's own closing brace (inclusive)
      if (/^}/.test(next) || /^  @/.test(next) || MEMBER_SIGNATURE.test(next)) {
        end--; // the class's end or the next member: exclusive
        break;
      }
      end++;
    }
    const sub = match[2] ?? "";
    out.push({
      file,
      method: (match[1] as string).toUpperCase(),
      path: `/${prefix}${sub ? `/${sub}` : ""}`,
      start: index,
      end,
      body: lines.slice(index, end + 1).join("\n"),
      props,
    });
  }
  return out;
}

/** Every handler of every non-test `*.controller.ts` under `apps/api/src` — the walk is not a hand list. */
let handlerCache: Handler[] | undefined;
const allHandlers = (): Handler[] =>
  (handlerCache ??= sourceFiles(apiSrc)
    .filter((full) => full.endsWith(".controller.ts"))
    .flatMap((full) => walkController(toRel(full))));

/** The handlers serving one route (catalog paths are `/admin/...`, no `/api/v1`). */
const handlersFor = (handlers: readonly Handler[], route: Route): Handler[] =>
  handlers.filter((handler) => routeKey(handler) === routeKey(route));

/** The one class a file exports; fails loudly on none or several. */
function exportedClass(file: string): string {
  const names = codeLines(read(file)).flatMap((line) => {
    const match = CLASS_DECL.exec(line);
    return match ? [match[1] as string] : [];
  });
  if (names.length !== 1) throw new Error(`${file}: expected exactly one exported class, found ${names.length} (${names.join(", ")})`);
  return names[0] as string;
}

/** Whether a handler calls `this.<prop>.<anything>` for a constructor parameter typed as `className`. */
const callsClass = (handler: Handler, className: string): boolean =>
  [...handler.props].some(([prop, type]) => type === className && new RegExp(`\\bthis\\.${prop}\\.\\w+`).test(handler.body));

// ---------------------------------------------------------------------------
// The audit-method check (`F4.257`, cases h). See the cases for what it does
// and does not see.
// ---------------------------------------------------------------------------

/** Any class member's first line: two-space indent, then an identifier (a field arrow as well as a method). */
const MEMBER_START = /^  [A-Za-z_$#]/;

/**
 * The name of the class member whose body holds line `index`: the nearest member start above it, named only
 * when it is a method signature. A member of any other shape (a field arrow, `sneak = async () => {`)
 * answers `null`, which the cases count as stray — it fails closed rather than crediting the write to the
 * method above it. A multi-line signature's closing `  ): Promise<…> {` is not a member start.
 */
function enclosingMember(lines: readonly string[], index: number): string | null {
  for (let i = index; i >= 0; i--) {
    const line = lines[i] as string;
    if (/^}/.test(line) && i !== index) return null;
    if (MEMBER_START.test(line)) return MEMBER_SIGNATURE.exec(line)?.[1] ?? null;
  }
  return null;
}

/** 0-based indices of the code lines matching `pattern`. */
const linesMatching = (lines: readonly string[], pattern: RegExp): number[] =>
  lines.flatMap((line, index) => (pattern.test(line) ? [index] : []));

describe("F3.85 — every catalog write is audited through the copilot mark (ADR 0099 decision 4.5)", () => {
  it.each(CATALOG_WRITERS)("%s audits through MasterDataAuditService", (rel) => {
    expect(existsSync(join(repoRoot, rel)), `${rel} not found — update the list`).toBe(true);
    const source = read(rel);
    expect(referencesAudit(source), `${rel} names MasterDataAuditService on no code line`).toBe(true);
    expect(source).not.toMatch(DIRECT_INSERT);
  });

  it("finds the direct audit-log inserts that exist, and none is in a catalog directory", () => {
    const direct = sourceFiles(apiSrc)
      .filter((file) => DIRECT_INSERT.test(readFileSync(file, "utf8")))
      .map((file) => relative(apiSrc, file).replaceAll("\\", "/"));
    // Positive control: the scan sees the known writers, so an empty result cannot mean a broken regex.
    expect(direct).toContain("admin/master-data-audit.service.ts");
    expect(direct).toContain("work-orders/work-orders.service.ts");
    const inCatalog = direct.filter((file) => CATALOG_DIRS.some((dir) => file.startsWith(`${dir}/`)));
    expect(inCatalog, "a catalog write inserting into bms.audit_log itself loses the copilot mark").toEqual([]);
  });

  it("marks both of MasterDataAuditService's inserts", () => {
    // Code lines only: `writeMany`'s comment quotes the insert call it explains.
    const source = read("apps/api/src/admin/master-data-audit.service.ts")
      .split(/\r?\n/)
      .filter((line) => !COMMENT_LINE.test(line))
      .join("\n");
    const inserts = source.split("insert(auditLog).values(").slice(1);
    expect(inserts).toHaveLength(2);
    for (const block of inserts) {
      expect(block.slice(0, 600)).toContain("payload: withCopilotMark(input.payload) ?? null");
    }
  });

  it("every service in a catalog directory that references MasterDataAuditService is in one of the two ledger lists", () => {
    const known = new Set<string>([...CATALOG_WRITERS, ...NOT_CATALOG_WRITERS.map((row) => row.file)]);
    const found = ledgerCandidates();
    // Positive control: the walk sees the listed writers, so an empty result cannot mean a broken walk.
    expect(found).toContain("apps/api/src/admin/asset-templates/asset-templates-instantiate.service.ts");
    const unclassified = found.filter((file) => !known.has(file));
    expect(
      unclassified,
      `add each to CATALOG_WRITERS (it backs a catalog entry) or NOT_CATALOG_WRITERS (it serves an excluded route): ${unclassified.join(", ")}`,
    ).toEqual([]);
  });

  it("no file is in both ledger lists", () => {
    const writers = new Set<string>(CATALOG_WRITERS);
    const both = NOT_CATALOG_WRITERS.map((row) => row.file).filter((file) => writers.has(file));
    expect(both).toEqual([]);
  });

  it("every NOT_CATALOG_WRITERS route is a catalog-excluded route", () => {
    const excluded = new Set(EXCLUDED_ROUTES.map(routeKey));
    expect(excluded.size).toBeGreaterThan(0); // positive control
    const missing = NOT_CATALOG_WRITERS.map((row) => routeKey(row.route)).filter((key) => !excluded.has(key));
    expect(missing, "the route is not in EXCLUDED_ROUTES").toEqual([]);
  });

  it("no NOT_CATALOG_WRITERS route is a catalog entry", () => {
    const entries = new Set(COPILOT_CATALOG.map(routeKey));
    expect(entries.size).toBeGreaterThan(0); // positive control
    const asEntry = NOT_CATALOG_WRITERS.map((row) => routeKey(row.route)).filter((key) => entries.has(key));
    expect(asEntry, "the route is a catalog entry — the file belongs in CATALOG_WRITERS").toEqual([]);
  });

  it("every NOT_CATALOG_WRITERS file exists, references MasterDataAuditService, and is a ledger candidate", () => {
    const candidates = new Set(ledgerCandidates());
    for (const { file } of NOT_CATALOG_WRITERS) {
      expect(existsSync(join(repoRoot, file)), `${file} not found — update the list`).toBe(true);
      expect(referencesAudit(read(file)), `${file} no longer references MasterDataAuditService on a code line`).toBe(true);
      // So a row cannot name a module file, or a file outside CATALOG_DIRS that the ledger never walks.
      expect(candidates.has(file), `${file} is not a ledger candidate (a *.module.ts, or outside CATALOG_DIRS)`).toBe(true);
    }
  });

  it("serves each NOT_CATALOG_WRITERS route from exactly one handler, which calls the row's class", () => {
    const handlers = allHandlers();
    for (const { file, route } of NOT_CATALOG_WRITERS) {
      const serving = handlersFor(handlers, route);
      expect(
        serving.map((h) => `${h.file}:${h.start + 1}`),
        `${routeKey(route)} must be served by exactly one handler`,
      ).toHaveLength(1);
      const className = exportedClass(file);
      expect(callsClass(serving[0] as Handler, className), `${routeKey(route)}'s handler never calls this.<${className}>`).toBe(true);
    }
  });

  it("no catalog entry's handler calls a NOT_CATALOG_WRITERS class", () => {
    const handlers = allHandlers();
    const entryHandlers = COPILOT_CATALOG.flatMap((entry) => handlersFor(handlers, entry));
    // Size control: one handler per entry, so a parser that finds none cannot pass by absence.
    expect(COPILOT_CATALOG.length).toBeGreaterThan(0);
    expect(entryHandlers).toHaveLength(COPILOT_CATALOG.length);
    // Known pair: the asset-template instantiate entry calls its instantiation service.
    const instantiate = handlersFor(handlers, { method: "POST", path: "/admin/asset-templates/:id/instantiate" })[0];
    expect(instantiate !== undefined && callsClass(instantiate, "AssetTemplateInstantiationService")).toBe(true);
    const notClasses = NOT_CATALOG_WRITERS.map((row) => exportedClass(row.file));
    const offenders = entryHandlers.flatMap((handler) =>
      notClasses.filter((className) => callsClass(handler, className)).map((className) => `${routeKey(handler)} -> ${className}`),
    );
    expect(offenders, "a catalog entry reaches a NOT_CATALOG_WRITERS service — move it to CATALOG_WRITERS").toEqual([]);
  });

  it("every controller serving a catalog entry lies under a CATALOG_DIRS directory", () => {
    const handlers = allHandlers();
    const files = new Set(COPILOT_CATALOG.flatMap((entry) => handlersFor(handlers, entry)).map((h) => h.file));
    expect(files.size).toBeGreaterThan(1); // positive control
    const outside = [...files].filter((file) => !CATALOG_DIRS.some((dir) => file.startsWith(`apps/api/src/${dir}/`)));
    expect(outside, "a new catalog area escapes the direct-insert scan and the ledger — add it to CATALOG_DIRS").toEqual([]);
  });

  /**
   * Cases h (two claims, two `it()`s). What they check, by text on code lines:
   * - every `this.<audit>` mention in a NOT file (a call, or the service passed into a core or helper),
   *   where `<audit>` is a name typed `MasterDataAuditService` in that file, lies inside a method named in
   *   the row's `auditMethods`; a member that is not a method signature (a field arrow) counts as outside;
   * - a NOT file calls `this.<auditMethod>(` only from inside an `auditMethods` method, and every other
   *   non-test file under `apps/api/src` calls `<name>.<auditMethod>(` — where `<name>` is declared
   *   `: <RowClass>` in that file — only inside the row's own handler (the one case e finds).
   * What they do not see: an alias or destructured method (`const { backfill } = svc`), a service fetched
   * untyped (`moduleRef.get`), a call through an `any`, an optional call (`svc?.backfill(`), a method
   * reached by a computed name, or a call outside `apps/api/src`. (A trailing comment that quotes a call
   * is read as code, so it fails closed.)
   */
  it("every audit call site in a NOT_CATALOG_WRITERS file lies inside one of the row's auditMethods", () => {
    for (const { file, auditMethods } of NOT_CATALOG_WRITERS) {
      const lines = codeLines(read(file));
      const auditNames = namesTyped(lines, "MasterDataAuditService");
      expect(auditNames.length, `${file}: no name typed MasterDataAuditService`).toBeGreaterThan(0);
      const members = new Set(lines.flatMap((line) => MEMBER_SIGNATURE.exec(line)?.[1] ?? []));
      expect(auditMethods.filter((method) => !members.has(method)), `${file}: auditMethods names a missing method`).toEqual([]);
      // Every mention of the audit service, not only `this.audit.write(`: passing `this.audit` into a core
      // or a helper, or aliasing it, writes through it just the same.
      const sites = linesMatching(lines, new RegExp(`\\bthis\\.(?:${auditNames.join("|")})\\b`));
      expect(sites.length, `${file}: no audit call site (positive control)`).toBeGreaterThan(0);
      const stray = sites
        .map((index) => ({ index, member: enclosingMember(lines, index) }))
        .filter(({ member }) => member === null || !auditMethods.includes(member))
        .map(({ index, member }) => `${file}:${index + 1} in ${member ?? "?"}`);
      expect(stray, `${file}: an audit write outside auditMethods [${auditMethods.join(", ")}]`).toEqual([]);
    }
  });

  it("nothing but the row's own handler calls into a NOT_CATALOG_WRITERS row's auditMethods", () => {
    const handlers = allHandlers();
    const files = sourceFiles(apiSrc).map(toRel);
    for (const { file, route, auditMethods } of NOT_CATALOG_WRITERS) {
      const methods = auditMethods.join("|");
      // In the file itself: `this.<auditMethod>(` only from inside an audit method.
      const own = codeLines(read(file));
      const inFile = linesMatching(own, new RegExp(`\\bthis\\.(?:${methods})\\(`))
        .map((index) => ({ index, member: enclosingMember(own, index) }))
        .filter(({ member }) => member === null || !auditMethods.includes(member))
        .map(({ index, member }) => `${file}:${index + 1} in ${member ?? "?"}`);
      expect(inFile, `${file}: a non-audit method calls into auditMethods`).toEqual([]);
      // Everywhere else: a call through a name typed as the row's class, only inside the row's handler.
      const className = exportedClass(file);
      const serving = handlersFor(handlers, route);
      if (serving.length !== 1) throw new Error(`${routeKey(route)}: ${serving.length} handlers serve it, expected exactly one (see the handler case)`);
      const handler = serving[0] as Handler;
      const callers = files
        .filter((other) => other !== file)
        .flatMap((other) => {
          const lines = codeLines(read(other));
          const names = namesTyped(lines, className);
          if (names.length === 0) return [];
          return linesMatching(lines, new RegExp(`\\b(?:${names.join("|")})\\.(?:${methods})\\(`)).map((index) => ({ other, index }));
        });
      const inHandler = ({ other, index }: { other: string; index: number }): boolean =>
        other === handler.file && index >= handler.start && index <= handler.end;
      expect(callers.some(inHandler), `${routeKey(route)}'s handler calls none of [${auditMethods.join(", ")}] (positive control)`).toBe(true);
      const elsewhere = callers.filter((call) => !inHandler(call)).map(({ other, index }) => `${other}:${index + 1}`);
      expect(elsewhere, `${className}'s audit methods are reached from outside ${routeKey(route)}'s handler`).toEqual([]);
    }
  });
});
