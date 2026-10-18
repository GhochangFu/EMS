import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import type { BmsTx } from "../database/tenant-context";
import { DiscoveryJobStore, type StoredDiscovery } from "./discovery-job-store";

/**
 * `F3.24b` (ADR 0103 decisions 6 and 9) — the store's two writes, against a
 * recording transaction: the draft write replaces `_discovery` only, and the
 * audit row carries the organization, no actor and the payload as given.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const STORED: StoredDiscovery = {
  discoveryId: "33333333-3333-4333-8333-333333333333",
  rtuCode: "R1",
  topicFilter: "p/#",
  windowSeconds: 60,
  status: "running",
  queuedAt: "2026-10-18T00:00:00.000Z",
  startedAt: "2026-10-18T00:00:01.000Z",
  finishedAt: null,
  truncated: false,
  devices: [],
  messages: 0,
  skipped: 0,
};

function recordingTx() {
  const sets: Record<string, unknown>[] = [];
  const values: Record<string, unknown>[] = [];
  const chain = {
    set: (v: Record<string, unknown>) => {
      sets.push(v);
      return chain;
    },
    where: () => Promise.resolve(undefined),
    values: (v: Record<string, unknown>) => {
      values.push(v);
      return Promise.resolve(undefined);
    },
  };
  const tx = { update: () => chain, insert: () => chain } as unknown as BmsTx;
  return { tx, sets, values };
}

const store = new DiscoveryJobStore({} as never);

export async function assertDraftWriteReplacesOnlyDiscovery(): Promise<void> {
  const { tx, sets } = recordingTx();
  await store.writeDiscovery(tx, "s-1", STORED);
  const keys = Object.keys(sets[0] ?? {});
  const query = new PgDialect().sqlToQuery(sets[0]?.draft as SQL);
  assert(keys.join() === "draft", `the write must set the draft column only; got ${keys.join()}`);
  assert(/jsonb_set\(.*'\{_discovery\}'/.test(query.sql), `the write must jsonb_set {_discovery}; got ${query.sql}`);
  assert(query.params.includes(JSON.stringify(STORED)), "the stored discovery must be the bound JSON parameter");
}

export async function assertAuditRowShape(): Promise<void> {
  const { tx, values } = recordingTx();
  await store.audit(tx, {
    organizationId: "11111111-1111-4111-8111-111111111111",
    sessionId: "s-1",
    action: "onboarding.discovery.finish",
    payload: { status: "done" },
  });
  const row = values[0];
  assert(
    row?.organizationId === "11111111-1111-4111-8111-111111111111" && row.actorId === null &&
      row.entityType === "onboarding_session" && row.entityId === "s-1" &&
      row.action === "onboarding.discovery.finish" && JSON.stringify(row.payload) === '{"status":"done"}',
    `unexpected audit row: ${JSON.stringify(row)}`,
  );
}
