import { BREAKER_DEMO_BREAKER_CODES, seedBreakerDemo } from "./breaker-demo-seed";

/**
 * `F3.74` plan D11 — step 1's read-back of `seedBreakerDemo`, on a fake pool: the role write skips
 * an administrator's role and so changes no row, which leaves the row count silent; the read-back
 * of the twelve roles is what fails a step that left a role NULL or `mcc`. Assertions live here;
 * `breaker-demo-seed.test.ts` is the Vitest entry point (ADR 0014). The database half is
 * `tests/f3.74-breaker-demo-seed.integration.test.ts`.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** A pool that answers step 1's reads, the read-back with `roleOf(code)`, and fails every later read. */
function fakePool(roleOf: (code: string) => string | null) {
  return {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM bms.asset_groups")) return { rows: [{ id: "g1" }], rowCount: 1 };
      if (sql.includes("SELECT id, code, domain FROM bms.assets")) {
        const codes = params[2] as string[];
        return { rows: codes.map((code) => ({ id: `a-${code}`, code, domain: "electrical" })), rowCount: codes.length };
      }
      if (sql.includes("INSERT INTO bms.asset_group_members") && sql.includes("DO UPDATE")) return { rows: [], rowCount: 0 };
      if (sql.includes("SELECT a.code, agm.role")) {
        const rows = BREAKER_DEMO_BREAKER_CODES.map((code) => ({ code, role: roleOf(code) }));
        return { rows, rowCount: rows.length };
      }
      throw new Error(`fake pool: step 1 passed, then ${sql.trim().slice(0, 40)}`);
    },
  } as unknown as Parameters<typeof seedBreakerDemo>[0];
}

async function messageOf(roleOf: (code: string) => string | null): Promise<string> {
  try {
    await seedBreakerDemo(fakePool(roleOf), "org-1", "loc-1", () => undefined);
    return "no throw";
  } catch (error) {
    return (error as Error).message;
  }
}

/** A breaker still `mcc` after step 1 throws, naming it. Mutation: drop the `mcc` term → red. */
export async function aRoleStillMccAfterStepOneThrowsNamingIt(): Promise<void> {
  const message = await messageOf((code) => (code === "CR-Q9" ? "mcc" : "load-feeder-breaker"));
  assert(message.includes("1 still NULL or mcc (CR-Q9)"), message);
}

/** A breaker with no role after step 1 throws, naming it. Mutation: drop the NULL term → red. */
export async function aRoleStillNullAfterStepOneThrowsNamingIt(): Promise<void> {
  const message = await messageOf((code) => (code === "CR-Q2" ? null : "ups-input-breaker"));
  assert(message.includes("1 still NULL or mcc (CR-Q2)"), message);
}

/** The control: twelve non-mcc roles, an administrator's among them, pass step 1. */
export async function twelveSetRolesPassStepOne(): Promise<void> {
  const message = await messageOf((code) => (code === "CR-Q9" ? "mains-feeder-breaker" : "load-feeder-breaker"));
  assert(message.startsWith("fake pool: step 1 passed"), message);
}
