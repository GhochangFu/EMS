import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";
import { catalogEntry, proposeToolName } from "@bms/shared/copilot";

import { alreadyPinnedMessage } from "../admin/asset-templates/asset-templates-adopt-messages";
import type { ResolvedIdentity } from "../auth/identity-resolver";
import { runToolCall } from "../llm/tool-registry";
import type { CopilotOpenWizard } from "@bms/shared";

import { adoptMalformedIdMessage } from "./copilot-adopt-targets";
import { checkOpenWizards } from "./copilot-open-wizards";
import { access, queuedDb } from "./copilot-adopt-targets.spec";
import type { NewPendingChange } from "./copilot-pending-changes.service";
import { createCopilotProposeTools, PROPOSE_TARGET_ERROR } from "./copilot-propose-tools";
import type { CopilotToolContext, CopilotToolResult } from "./copilot-read-tools";
import { CopilotTargetResolver } from "./copilot-target-resolver";
import { COPILOT_TOOL_GUARDS } from "./copilot-turn.service";

/**
 * `F4.315` PR A (ADR 0099 Amendment 14 decision 2) — `assetTemplate.adopt`
 * end to end through the propose tool and the real `CopilotTargetResolver`
 * (over the `copilot-adopt-targets.spec.ts` fakes): a pinned asset in scope
 * answers the tool's `error` with the route's pinned sentence and stores no
 * change, and the failure names the organizations whose records the sentence
 * holds (the turn's provenance, ADR 0099 decision 10); an asset found nowhere
 * keeps the general sentence; a non-UUID version or asset id is decision 3's
 * malformed sentence, before any read.
 *
 * Mutations, each applied once and seen red: drop the refusal's
 * `organizationIds` in the propose tool ({@link aPinnedRefusalNamesTheVersionsOrganization});
 * restore `uuidParam` in the adopt guard schema ({@link aMalformedVersionIdAnswersTheMalformedSentence});
 * build the definition the model is shown from the loosened params
 * ({@link theDefinitionKeepsTheUuidFormat}).
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const ORG_B = "55555555-5555-4555-8555-555555555555";
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
function harness(results: unknown[][], reads: { count: number } = { count: 0 }, allowed: string[] = [ORG]) {
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
    allowedOrganizationIds: allowed,
    turnKind: "user",
    now: new Date("2026-11-06T06:00:00Z"),
  };
  let last: CopilotToolResult | null = null;
  const call = (id: string, assetIds: string[] = [ASSET]) =>
    runToolCall(
      tools.registry,
      { id: "c1", name: proposeToolName(ENTRY), arguments: JSON.stringify({ id, body: { assetIds } }) },
      async (name, args) => {
        const out = await tools.dispatch(name, args, ctx);
        last = out;
        return out.ok ? { ok: true, content: JSON.stringify(out.result) } : { ok: false, content: out.error, error: out.error };
      },
      COPILOT_TOOL_GUARDS,
    );
  return { call, stored, last: () => last, tools };
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

/** Decision 10: the pinned refusal's failure names the version's organization, whose records the sentence holds. */
export async function aPinnedRefusalNamesTheVersionsOrganization(): Promise<void> {
  const h = harness([VERSION, [asset({ templateId: TEMPLATE })]]);
  await h.call(TEMPLATE);
  expect(h.last()).toEqual({ ok: false, error: expect.any(String), organizationIds: [ORG] });
}

/** Decision 10: an organization refusal names the version's organization and the asset's. */
export async function anOrganizationRefusalNamesBothOrganizations(): Promise<void> {
  const h = harness([VERSION, [], [asset({ organizationId: ORG_B })]], undefined, [ORG, ORG_B]);
  await h.call(TEMPLATE);
  expect(h.last()).toEqual({ ok: false, error: expect.any(String), organizationIds: [ORG, ORG_B] });
}

/** Decision 3: a non-UUID version id answers the malformed sentence, reading nothing and storing nothing. */
export async function aMalformedVersionIdAnswersTheMalformedSentence(): Promise<void> {
  const reads = { count: 0 };
  const { call, stored } = harness([VERSION, [asset()]], reads);
  const outcome = await call("PUMP-M");
  expect([outcome.error, reads.count, stored]).toEqual([adoptMalformedIdMessage("PUMP-M"), 0, []]);
}

/** Decision 3: a non-UUID asset id answers the malformed sentence, reading nothing and storing nothing. */
export async function aMalformedAssetIdAnswersTheMalformedSentence(): Promise<void> {
  const reads = { count: 0 };
  const { call, stored } = harness([VERSION, [asset()]], reads);
  const outcome = await call(TEMPLATE, [ASSET, "PHE-MFM-000000003"]);
  expect([outcome.error, reads.count, stored]).toEqual([adoptMalformedIdMessage("PHE-MFM-000000003"), 0, []]);
}

/** The guard still refuses what is not a string id at all (an empty id), as the registry always did. */
export async function anEmptyVersionIdIsStillAnArgumentError(): Promise<void> {
  const { call } = harness([VERSION, [asset()]]);
  expect((await call("")).error?.startsWith("Invalid arguments")).toBe(true);
}

/** The loosening is the guard's only: the definition the model is shown keeps the catalog's `format: uuid` on `id`. */
export function theDefinitionKeepsTheUuidFormat(): void {
  const { tools } = harness([]);
  const definition = tools.registry.definitions.find((d) => d.name === proposeToolName(ENTRY));
  expect((definition?.parameters as { properties: Record<string, { format?: string }> }).properties.id?.format).toBe("uuid");
}

/** An open wizard's adopt record still takes the catalog's `uuidParam`: a non-UUID id is refused. */
export function anOpenWizardWithANonUuidAdoptIdIsRefused(): void {
  expect(() => checkOpenWizards([{ catalogId: ENTRY.id, params: { id: "PUMP-M" } } as unknown as CopilotOpenWizard])).toThrow();
}

/** The allowed twin: an open wizard's adopt record with a UUID id is admitted. */
export function anOpenWizardWithAUuidAdoptIdIsAdmitted(): void {
  const wizard = { catalogId: ENTRY.id, params: { id: TEMPLATE } } as unknown as CopilotOpenWizard;
  expect(checkOpenWizards([wizard])).toEqual([wizard]);
}
