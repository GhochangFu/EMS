import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";
import { catalogEntry, proposeToolName } from "@bms/shared/copilot";

import { alreadyPinnedMessage } from "../admin/asset-templates/asset-templates-adopt-messages";
import type { ResolvedIdentity } from "../auth/identity-resolver";
import { runToolCall } from "../llm/tool-registry";
import { access, queuedDb } from "./copilot-adopt-targets.spec";
import type { NewPendingChange } from "./copilot-pending-changes.service";
import { createCopilotProposeTools, PROPOSE_TARGET_ERROR } from "./copilot-propose-tools";
import type { CopilotToolContext } from "./copilot-read-tools";
import { CopilotTargetResolver } from "./copilot-target-resolver";
import { COPILOT_TOOL_GUARDS } from "./copilot-turn.service";

/**
 * `F4.315` PR A (ADR 0099 Amendment 14 decision 2) — `assetTemplate.adopt`
 * end to end through the propose tool and the real `CopilotTargetResolver`
 * (over the `copilot-adopt-targets.spec.ts` fakes): a pinned asset in scope
 * answers the tool's `error` with the route's pinned sentence and stores no
 * change; an asset found nowhere keeps the general sentence; a non-UUID
 * version id is refused by the argument guard before any read.
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const ASSET = "22222222-2222-4222-8222-222222222222";
const TEMPLATE = "44444444-4444-4444-8444-444444444444";
const USER = "77777777-7777-4777-8777-777777777777";
const ENTRY = catalogEntry("assetTemplate.adopt")!;

const asset = (over: Record<string, unknown> = {}) => ({
  id: ASSET,
  code: "PHE-MFM-000000003",
  organizationId: ORG,
  domain: "electrical",
  templateId: null,
  locationId: null,
  ...over,
});

/** The propose tool over the real resolver, a database answering `results` in order, and a pending store that records. */
function harness(results: unknown[][], reads: { count: number } = { count: 0 }) {
  const stored: NewPendingChange[] = [];
  const tools = createCopilotProposeTools(
    {
      targets: new CopilotTargetResolver(queuedDb(results, reads), access([]), {} as never, {} as never),
      pending: {
        hasOpen: async () => false,
        propose: async (_userId, change) => {
          stored.push(change);
          return null;
        },
      },
    },
    [ENTRY],
    { AUTH_MODE: "oidc" },
  );
  const ctx: CopilotToolContext = {
    identity: { id: USER, role: "admin", organizationId: null } as ResolvedIdentity,
    user: { sub: USER, role: "admin" } as JwtPayload,
    conversationId: "33333333-3333-4333-8333-333333333333",
    conversationOrganizationId: ORG,
    allowedOrganizationIds: [ORG],
    turnKind: "user",
    now: new Date("2026-11-06T06:00:00Z"),
  };
  const call = (id: string) =>
    runToolCall(
      tools.registry,
      { id: "c1", name: proposeToolName(ENTRY), arguments: JSON.stringify({ id, body: { assetIds: [ASSET] } }) },
      async (name, args) => {
        const out = await tools.dispatch(name, args, ctx);
        return out.ok ? { ok: true, content: JSON.stringify(out.result) } : { ok: false, content: out.error, error: out.error };
      },
      COPILOT_TOOL_GUARDS,
    );
  return { call, stored };
}

const VERSION = [{ name: "Pump", code: "PUMP-M", version: 1, domain: "electrical", status: "published" }];

/** A pinned asset in scope: the tool's error is the route's pinned sentence. */
export async function aPinnedAssetAnswersThePinnedSentence(): Promise<void> {
  const { call } = harness([VERSION, [asset({ templateId: TEMPLATE })]]);
  expect((await call(TEMPLATE)).error).toBe(alreadyPinnedMessage({ code: "PHE-MFM-000000003" }, { code: "PUMP-M", version: 1 }));
}

/** A pinned asset in scope stores no change row. */
export async function aPinnedAssetStoresNoChange(): Promise<void> {
  const { call, stored } = harness([VERSION, [asset({ templateId: TEMPLATE })]]);
  await call(TEMPLATE);
  expect(stored).toEqual([]);
}

/** An asset found nowhere keeps the general sentence (decision 3). */
export async function anAssetFoundNowhereAnswersTheGeneralSentence(): Promise<void> {
  const { call } = harness([VERSION, []]);
  expect((await call(TEMPLATE)).error).toBe(PROPOSE_TARGET_ERROR);
}

/**
 * Measured at build: through the propose tool a non-UUID version id never reaches the resolver —
 * the catalog's `uuidParam` makes the registry's argument guard refuse it, with no read. The
 * resolver's own malformed sentence (`copilot-adopt-targets.spec.ts`) is the second line.
 */
export async function aMalformedVersionIdIsRefusedByTheArgumentGuard(): Promise<void> {
  const reads = { count: 0 };
  const { call, stored } = harness([VERSION, [asset()]], reads);
  const outcome = await call("PUMP-M");
  expect([outcome.error, reads.count, stored]).toEqual(["Invalid arguments: id: Invalid uuid", 0, []]);
}
