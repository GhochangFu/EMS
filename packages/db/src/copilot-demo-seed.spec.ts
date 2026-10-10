import { expect } from "vitest";

import { COPILOT_DEMO_SQL, seedCopilotDemo } from "./copilot-demo-seed";
import type { SeedQueryable } from "./seed-tenant";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000000";

function recordingPool(): SeedQueryable & { calls: Array<{ text: string; values?: unknown[] }> } {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  return {
    calls,
    options: { max: 1 },
    query: async (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 };
    },
  };
}

/**
 * Plan Q5: every compose boot and every AWS deploy runs `db:seed`, so an upsert
 * would switch the demo organization back on after an administrator turned it
 * off. Mutation: `DO NOTHING` → `DO UPDATE SET enabled = true` reddens this.
 */
export function assertTheSwitchIsInsertedIfAbsentAndNeverUpdated(): void {
  expect(COPILOT_DEMO_SQL).toMatch(/ON CONFLICT \(organization_id\) DO NOTHING/);
  expect(COPILOT_DEMO_SQL).not.toMatch(/DO UPDATE/i);
  expect(COPILOT_DEMO_SQL).toMatch(/INSERT INTO bms\.copilot_org_settings \(organization_id, enabled\)/);
  expect(COPILOT_DEMO_SQL).toMatch(/VALUES \(\$1, true\)/);
}

/** One statement, bound to the one organization the caller's bracket names. */
export async function assertTheSeedWritesOneRowForTheGivenOrganization(): Promise<void> {
  const pool = recordingPool();
  await seedCopilotDemo(pool, ORGANIZATION_ID);
  expect(pool.calls).toHaveLength(1);
  expect(pool.calls[0]?.text).toBe(COPILOT_DEMO_SQL);
  expect(pool.calls[0]?.values).toEqual([ORGANIZATION_ID]);
}
