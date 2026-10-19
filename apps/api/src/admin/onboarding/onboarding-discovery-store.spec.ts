import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { expect } from "vitest";

import { OnboardingDiscoveryStore, discoveryLockKey } from "./onboarding-discovery-store";

/**
 * `F3.24b` U3 — the discovery route's database half, over a recording
 * transaction. The lock placement against real Postgres is the step-6 check;
 * this pins the statements. Vitest entry point: the sibling `.test.ts`.
 */

const ORG = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const dialect = new PgDialect();

function recordingTx() {
  const executed: SQL[] = [];
  const sets: Record<string, unknown>[] = [];
  const chain = {
    from: () => chain,
    where: () => Promise.resolve([{ discovery: { status: "queued" } }, { discovery: { status: "running" } }]),
  };
  const update = {
    set: (values: Record<string, unknown>) => (sets.push(values), update),
    where: () => Promise.resolve(undefined),
  };
  const tx = {
    execute: async (query: SQL) => {
      executed.push(query);
    },
    select: () => chain,
    update: () => update,
  };
  return { tx: tx as never, executed, sets };
}

export function theLockKeyNamesTheOrganization(): void {
  expect(discoveryLockKey(ORG)).toBe(`onboarding_discovery:${ORG}`);
}

export async function theOrganizationLockIsATransactionAdvisoryLockOnThatKey(): Promise<void> {
  const { tx, executed } = recordingTx();
  await new OnboardingDiscoveryStore({} as never).lockOrganization(tx, ORG);
  const query = dialect.sqlToQuery(executed[0] as SQL);
  expect({ sql: query.sql, params: query.params }).toEqual({
    sql: "select pg_advisory_xact_lock(hashtextextended($1, 0))",
    params: [`onboarding_discovery:${ORG}`],
  });
}

export async function theOtherSessionsBlobsAreReturnedRaw(): Promise<void> {
  const { tx } = recordingTx();
  const blobs = await new OnboardingDiscoveryStore({} as never).activeDiscoveriesElsewhere(tx, ORG, SESSION_ID);
  expect(blobs).toEqual([{ status: "queued" }, { status: "running" }]);
}

export async function theWriteReplacesOnlyTheDiscoveryKey(): Promise<void> {
  const { tx, sets } = recordingTx();
  const stored = { discoveryId: SESSION_ID, status: "queued" } as never;
  await new OnboardingDiscoveryStore({} as never).writeDiscovery(tx, SESSION_ID, stored);
  const query = dialect.sqlToQuery(sets[0]?.draft as SQL);
  expect(query.sql).toContain("jsonb_set(");
  expect(query.sql).toContain("'{_discovery}'");
}
