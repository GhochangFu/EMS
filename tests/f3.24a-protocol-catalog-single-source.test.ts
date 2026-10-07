import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const ONBOARDING = "apps/api/src/admin/onboarding";

/**
 * `F3.24a` (ADR 0093 decision 5) - the protocol catalog is code, the MQTT
 * schemas have one home, and the validator and the tools read one draft schema.
 */

/** Code lines only: a docblock or `//` line that spells the needle does not count. */
function codeLines(file: string): string[] {
  return readFileSync(join(repoRoot, file), "utf8")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line));
}

describe("the protocol catalog has one source (F3.24a, ADR 0093)", () => {
  it("the Drizzle schema declares no protocol_catalog table", () => {
    const hits = codeLines("packages/db/src/schema/bms-schema.ts").filter((l) => l.includes("protocol_catalog"));
    expect(hits).toEqual([]);
  });

  it("the ingest MQTT adapter declares no config or device schema of its own", () => {
    const hits = codeLines("apps/ingest/src/adapters/mqtt.ts").filter((l) => /export const mqtt(Config|Device)Schema/.test(l));
    expect(hits).toEqual([]);
  });

  it("the ingest MQTT adapter imports the config schema from @bms/shared/ingest", () => {
    const hits = codeLines("apps/ingest/src/adapters/mqtt.ts").filter(
      (l) => /^\s*import\b/.test(l) && l.includes('from "@bms/shared/ingest"') && l.includes("mqttConfigSchema"),
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it.each([`${ONBOARDING}/onboarding-validate.service.ts`, `${ONBOARDING}/onboarding-agent-tools.ts`])(
    "%s parses a config with the catalog's draft schema",
    (file) => {
      const hits = codeLines(file).filter((l) => l.includes("draftConfigSchema.safeParse"));
      expect(hits.length).toBeGreaterThanOrEqual(1);
    },
  );
});
