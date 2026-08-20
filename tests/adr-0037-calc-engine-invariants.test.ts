import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const calcDir = join(repoRoot, "apps/api/src/calc");

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
   * Checks actual `import` statements and schema-qualified `bms.audit_log`
   * references, not the bare word — `calc-write.service.ts`'s own doc
   * comment names both while explaining why they are absent, and a raw
   * substring scan would flag its own explanation.
   */
  it.each(files)("%s never imports MasterDataAuditService or writes bms.audit_log", (file) => {
    const source = readFileSync(file, "utf8");
    const code = stripComments(source);
    const importLines = code.split("\n").filter((line) => line.trim().startsWith("import "));
    expect(
      importLines.some((line) => line.includes("MasterDataAuditService")),
      `${file} must never import MasterDataAuditService — decision 10`,
    ).toBe(false);
    expect(code, `${file} must never reference the bms.audit_log table — decision 10`).not.toContain(
      "bms.audit_log",
    );
  });
});
