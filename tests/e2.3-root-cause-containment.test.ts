import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `E2.3` / ADR 0136 (plan §6 T1.3) — what only a scan can hold for the
 * root-cause suggestions: the order of the guards in the handler and the
 * service, the reads' handle and verbs, every `bms` alias's hand-written
 * organization predicate (Q2: row security is the backstop, the predicate the
 * second control), R4's `OFFSET 0` (the `E1.2` lesson: an `EXPLAIN` case alone
 * is not a reliable mutation gate), and the copilot boundary (decision 11).
 * The behaviour is asserted in `alarm-root-cause.controller.spec.ts`,
 * `alarm-root-cause.service.spec.ts` and `alarm-root-cause.integration.spec.ts`.
 *
 * Test and fixture files are skipped. Assertions inline (§4.6, top-level `tests/`).
 */
const ALARMS_DIR = "apps/api/src/alarms";
const CONTROLLER_REL = `${ALARMS_DIR}/alarm-root-cause.controller.ts`;
const SERVICE_REL = `${ALARMS_DIR}/alarm-root-cause.service.ts`;
const READS_REL = `${ALARMS_DIR}/alarm-root-cause.reads.ts`;
const COPILOT_DIR = "apps/api/src/copilot";

/** Comments stripped: these files explain the rules they follow (the f3.1a lesson). */
const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** Every non-test `alarm-root-cause.*` source, so a new one is in scope by default. */
const rootCauseSources = (): string[] =>
  readdirSync(join(repoRoot, ALARMS_DIR))
    .filter((name) => name.startsWith("alarm-root-cause.") && name.endsWith(".ts"))
    .filter((name) => !name.includes(".spec.") && !name.includes(".test."))
    .map((name) => `${ALARMS_DIR}/${name}`);

const walk = (rel: string): string[] =>
  readdirSync(join(repoRoot, rel)).flatMap((name) => {
    const child = `${rel}/${name}`;
    return statSync(join(repoRoot, child)).isDirectory() ? walk(child) : [child];
  });

/** Index of `needle` in `haystack`, failing loudly when absent so an order check cannot pass on `-1`. */
function at(haystack: string, needle: string | RegExp, what: string): number {
  const index = typeof needle === "string" ? haystack.indexOf(needle) : haystack.search(needle);
  expect(index, `${what} not found`).toBeGreaterThanOrEqual(0);
  return index;
}

/** The body of the method that carries `@Get(":id/root-cause-suggestions")`, up to the next decorator or the class end. */
function handlerBody(controller: string): string {
  const start = at(controller, '@Get(":id/root-cause-suggestions")', "the root-cause GET handler");
  return controller.slice(start);
}

/** The order the handler must keep: the id parse, then `readableAssetIds(`, then the service call. */
function handlerOrderHolds(body: string): boolean {
  const parse = body.indexOf("idParamSchema.parse(");
  const scope = body.indexOf("readableAssetIds(");
  const call = body.indexOf("this.service.get(");
  return parse >= 0 && scope > parse && call > scope;
}

const EVIDENCE_READS = [
  "readSubjectAsset(",
  "readCoveringWindows(",
  "readLocationAncestorIds(",
  "readRelatedAlarms(",
  "readPastRootCauses(",
  "readAssetAnomalies(",
  "withTenant(",
];

/** `this.details.get(alarmId, assetIds)` precedes every evidence read and the transaction. */
function gateComesFirst(service: string): boolean {
  const body = service.slice(service.indexOf("async get("));
  const gate = body.indexOf("this.details.get(alarmId, assetIds)");
  if (gate < 0) return false;
  return EVIDENCE_READS.every((read) => {
    const first = body.indexOf(read);
    return first < 0 || first > gate;
  });
}

/** Each `sql\`…\`` statement of a file. */
function statements(source: string): string[] {
  return [...source.matchAll(/sql`([\s\S]*?)`;/g)].map((m) => m[1] as string).filter((s) => /\bbms\.\w+/.test(s));
}

/** Every alias of a `bms.<table> <alias>` in a statement. */
function bmsAliases(statement: string): string[] {
  return [...statement.matchAll(/\bbms\.\w+\s+([a-z]\w*)\b/g)]
    .map((m) => m[1] as string)
    .filter((alias) => !["ON", "WHERE", "JOIN", "LEFT", "CROSS", "ORDER", "LIMIT"].includes(alias.toUpperCase()));
}

/** The aliases in a statement that name no `<alias>.organization_id = ` line. */
function aliasesWithoutAPredicate(statement: string): string[] {
  return bmsAliases(statement).filter((alias) => !new RegExp(`\\b${alias}\\.organization_id = `).test(statement));
}

/** R4's lateral, up to its closing `) al`. */
function r4Lateral(reads: string): string {
  const start = reads.indexOf("CROSS JOIN LATERAL (");
  if (start < 0) return "";
  const end = reads.indexOf(") al", start);
  return end < 0 ? "" : reads.slice(start, end);
}

const IMPORTS_LLM_OR_COPILOT = /from\s+["'](\.\.\/)+(llm|copilot)(\/[^"']*)?["']/;
const NAMES_ANOMALY_SCORES = /anomaly_scores/;
const HOLDS_THE_LINE = /\b0\.99\b/;
const POOL_NAMES = /\b(FLEET_DRIZZLE|TENANT_DRIZZLE|FLEET_POOL|TENANT_POOL|fleetDb|tenantDb|BmsDb)\b/;
const WRITE_VERBS = /\b(INSERT|UPDATE|DELETE|TRUNCATE|MERGE)\b|\.(insert|update|delete)\(/;

describe("E2.3 — the root-cause handler keeps its guard order (plan §6 T1.3)", () => {
  const controller = codeOnly(read(CONTROLLER_REL));

  it("parses the id, then reads readableAssetIds, then calls the service", () => {
    expect(handlerOrderHolds(handlerBody(controller))).toBe(true);
  });

  it("applies no write-role check: a viewer reads it", () => {
    expect(controller).not.toMatch(/assertOperationsWriteRole|assertMasterDataRole|isMasterDataRole|mayAcknowledge/);
    expect(controller).toMatch(/@UseGuards\(JwtAuthGuard\)/);
  });

  it("positive control: a swapped order is refused", () => {
    expect(
      handlerOrderHolds(
        "const assetIds = await this.accessControl.readableAssetIds(user); const alarmId = idParamSchema.parse(id); this.service.get(alarmId, assetIds)",
      ),
    ).toBe(false);
    expect(
      handlerOrderHolds("const alarmId = idParamSchema.parse(id); this.service.get(alarmId, null); readableAssetIds(user)"),
    ).toBe(false);
  });
});

describe("E2.3 — the service gates on AlarmDetailsService.get before any evidence read (R-a)", () => {
  const service = codeOnly(read(SERVICE_REL));

  it("calls this.details.get(alarmId, assetIds) before every evidence read and the transaction", () => {
    expect(gateComesFirst(service)).toBe(true);
    // Every read the list names is really called, so the order check is not vacuous.
    for (const name of EVIDENCE_READS) expect(service, name).toContain(name);
  });

  it("positive control: a read before the gate, or the gate without the caller's ids, is refused", () => {
    expect(gateComesFirst("async get() { await readCoveringWindows(tx); await this.details.get(alarmId, assetIds); }")).toBe(false);
    expect(gateComesFirst("async get() { await this.details.get(alarmId, null); await readRelatedAlarms(tx); }")).toBe(false);
  });
});

describe("E2.3 — the evidence reads (alarm-root-cause.reads.ts)", () => {
  const reads = codeOnly(read(READS_REL));

  it("every exported read takes the tx it is handed", () => {
    const signatures = [...reads.matchAll(/export async function (\w+)\(\s*([^)]*)\)/g)];
    expect(signatures.length).toBeGreaterThanOrEqual(5);
    for (const [, name, params] of signatures) expect(params, name).toMatch(/^tx: BmsTx\b/);
  });

  it("names no pool and no write verb", () => {
    expect(reads).not.toMatch(POOL_NAMES);
    expect(reads).not.toMatch(WRITE_VERBS);
  });

  it("every bms alias of every statement has its own organization_id predicate", () => {
    const all = statements(reads);
    expect(all.length).toBe(4);
    const aliases = new Set(all.flatMap(bmsAliases));
    // The aliases the plan names, so a statement the regex cannot read is not silently clean.
    expect([...aliases].sort()).toEqual(["a0", "al", "e", "l", "r", "t", "w", "x"]);
    for (const statement of all) expect(aliasesWithoutAPredicate(statement)).toEqual([]);
  });

  it("R4's lateral keeps OFFSET 0", () => {
    const lateral = r4Lateral(reads);
    expect(lateral).toContain("FROM bms.alarms a0");
    expect(lateral).toMatch(/\bOFFSET 0\b/);
  });

  it("positive controls: a dropped predicate, a pool name, a write verb and a missing OFFSET 0 are caught", () => {
    expect(
      aliasesWithoutAPredicate(
        "FROM bms.alarms al LEFT JOIN bms.assets x ON x.id = al.asset_id AND x.organization_id = $1 WHERE al.id = $2",
      ),
    ).toEqual(["al"]);
    expect("constructor(@Inject(FLEET_DRIZZLE) db)").toMatch(POOL_NAMES);
    expect("DELETE FROM bms.alarms").toMatch(WRITE_VERBS);
    expect("await tx.update(alarms)").toMatch(WRITE_VERBS);
    expect(r4Lateral("CROSS JOIN LATERAL ( SELECT a0.id FROM bms.alarms a0 WHERE a0.id = e.alarm_id ) al")).not.toMatch(
      /\bOFFSET 0\b/,
    );
  });
});

describe("E2.3 — the copilot boundary and zero weight (decisions 3 and 11)", () => {
  it("no alarm-root-cause source imports from ../llm or ../copilot, names anomaly_scores or holds 0.99", () => {
    const sources = rootCauseSources();
    expect(sources.sort()).toEqual(
      ["controller", "pure", "reads", "service"].map((part) => `${ALARMS_DIR}/alarm-root-cause.${part}.ts`).sort(),
    );
    for (const rel of sources) {
      const code = codeOnly(read(rel));
      expect(code, rel).not.toMatch(IMPORTS_LLM_OR_COPILOT);
      expect(code, rel).not.toMatch(NAMES_ANOMALY_SCORES);
      expect(code, rel).not.toMatch(HOLDS_THE_LINE);
    }
  });

  it("no file under apps/api/src/copilot names alarm-root-cause", () => {
    const files = walk(COPILOT_DIR).filter((rel) => /\.tsx?$/.test(rel));
    expect(files.length).toBeGreaterThan(10);
    for (const rel of files) expect(read(rel), rel).not.toMatch(/alarm-root-cause|AlarmRootCause/);
  });

  it("positive controls: each pattern matches the shape it forbids", () => {
    expect('import { LlmService } from "../llm/llm.service";').toMatch(IMPORTS_LLM_OR_COPILOT);
    expect('import { x } from "../../copilot";').toMatch(IMPORTS_LLM_OR_COPILOT);
    expect('import { x } from "../ml/ml-anomalies.reads";').not.toMatch(IMPORTS_LLM_OR_COPILOT);
    expect("FROM ml.anomaly_scores s").toMatch(NAMES_ANOMALY_SCORES);
    expect("score >= 0.99").toMatch(HOLDS_THE_LINE);
    expect("score >= 0.995").not.toMatch(HOLDS_THE_LINE);
  });
});
