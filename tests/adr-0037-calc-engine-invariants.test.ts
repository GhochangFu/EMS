import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const calcDir = join(repoRoot, "apps/api/src/calc");
const apiSrcDir = join(repoRoot, "apps/api/src");

const files = readdirSync(calcDir)
  .filter((name) => name.endsWith(".ts") && !name.includes(".spec.") && !name.includes(".test."))
  .map((name) => join(calcDir, name));

const BLOCK_COMMENT = new RegExp(["/", "\\*", "[\\s\\S]*?", "\\*", "/"].join(""), "g");
const LINE_COMMENT = /\/\/.*$/gm;

/** Strips block and line comments so a scan for code, not documentation
 * that explains what the code deliberately does not do, doesn't flag its
 * own explanation. Not a full parser — good enough for this repo's style,
 * where none of these strings appear split across a comment boundary inside
 * a real string literal. */
function stripComments(source: string): string {
  return source.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "");
}

describe("ADR 0037 — calc engine invariants", () => {
  it("found the calc engine's source modules, so the scans below are not silently empty", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  /**
   * Decision 7: the scheduled host is one self-scheduling `await` loop —
   * `for (;;) { sweep; await sleep(...); }` — never `setInterval`, which
   * would let a slow sweep overlap the next tick. A behavioural test proves
   * the loop doesn't overlap (`calc-scheduler.spec.ts`); this is what stops
   * a later "simplification" from reintroducing the timer that caused the
   * bug this decision exists to avoid.
   */
  it.each(files)("%s never uses setInterval", (file) => {
    const code = stripComments(readFileSync(file, "utf8"));
    expect(code, `${file} must never call setInterval — decision 7`).not.toContain("setInterval");
  });

  /**
   * Decision 10: the calc engine writes through `CalcWriteService`, never
   * `TelemetryWriteService` — because that path calls
   * `MasterDataAuditService` and writes a `bms.audit_log` row per batch, and
   * auditing every machine-generated sample would flood the audit log
   * `F4.14`'s read API exists to make useful. `calc-write.integration.spec.ts`
   * proves this behaviourally (a real write, no new audit_log row); this
   * guards the higher-value case a well-meaning "reuse the write path"
   * refactor would otherwise pass unnoticed — routing calc writes back
   * through the human write path would silently reintroduce the flood, and
   * no behavioural test in the tree would catch that on its own.
   *
   * Checked directly against the comment-stripped `code` string, not by
   * re-splitting into lines and matching only a line that itself starts with
   * `import ` — this repo's own dominant style (see e.g.
   * `calc-definition.ts`'s named-import block) wraps an import across
   * several lines, and only the first of those starts with `import `, so a
   * line-prefix check walks straight past every wrapped import undetected.
   * `stripComments` already keeps this from flagging `calc-write.service.ts`'s
   * own doc comment, which names both symbols while explaining why they are
   * absent.
   */
  it.each(files)("%s never imports MasterDataAuditService/TelemetryWriteService or writes bms.audit_log", (file) => {
    const code = stripComments(readFileSync(file, "utf8"));
    expect(code, `${file} must never import MasterDataAuditService — decision 10`).not.toContain(
      "MasterDataAuditService",
    );
    expect(
      code,
      `${file} must never import TelemetryWriteService — its write path calls MasterDataAuditService, decision 10`,
    ).not.toContain("TelemetryWriteService");
    expect(code, `${file} must never reference the bms.audit_log table — decision 10`).not.toContain(
      "bms.audit_log",
    );
  });

  /**
   * Three one-line wiring points that a green test suite otherwise never
   * touches: `CalcModule` in `app.module.ts`'s imports, `CalcStreamingService`
   * actually subscribing to the readings hub, and `CalcSchedulerService`
   * actually starting the sweep loop. Every calc unit test constructs its own
   * deps directly (`CalcStreamingDeps`/`CalcSchedulerLoopDeps`), so deleting
   * any one of these three lines would leave the rest of the suite green and
   * ratcheted coverage met, while the calc engine silently never runs against
   * the real API process. These are static string checks, not behavioural
   * ones — the live-stack demo in `calc.module.ts`'s own doc comment is what
   * proves the wiring genuinely works end to end; this only proves the wiring
   * is still present in the source.
   */
  it("app.module.ts still imports CalcModule", () => {
    const code = stripComments(readFileSync(join(apiSrcDir, "app.module.ts"), "utf8"));
    expect(code, "app.module.ts must import CalcModule for the calc engine to start with the API process").toMatch(
      /import\s*\{\s*CalcModule\s*\}\s*from\s*["']\.\/calc\/calc\.module["']/,
    );
    expect(code, "app.module.ts's @Module imports array must still list CalcModule").toMatch(
      /imports:\s*\[[^\]]*\bCalcModule\b/,
    );
  });

  it("CalcStreamingService.onModuleInit still subscribes to the readings hub", () => {
    const code = stripComments(readFileSync(join(calcDir, "calc-streaming.service.ts"), "utf8"));
    expect(
      code,
      'CalcStreamingService must call hub.on("readings", ...) in onModuleInit, or the streaming host never runs',
    ).toMatch(/hub\.on\(\s*["']readings["']/);
  });

  it("CalcSchedulerService.onModuleInit still starts runSchedulerLoop", () => {
    const code = stripComments(readFileSync(join(calcDir, "calc-scheduler.service.ts"), "utf8"));
    // Anchored to the call site ("void runSchedulerLoop(..."), not just the
    // name — a bare /runSchedulerLoop\(/ also matches the exported function's
    // own declaration ("export async function runSchedulerLoop("), so it
    // would stay green even with the onModuleInit call site deleted.
    expect(
      code,
      "CalcSchedulerService must call runSchedulerLoop(...) in onModuleInit, or the scheduled host never runs",
    ).toMatch(/void\s+runSchedulerLoop\(/);
  });
});
