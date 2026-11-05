import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";
import { catalogEntry } from "@bms/shared/copilot";

import { CopilotTargetResolver } from "./copilot-target-resolver";
import { CopilotTargetRefusal } from "./copilot-telemetry-targets";

/**
 * `F4.309` PR 3 (ADR 0099 Amendment 13 decisions 1 and 4, ruling Q2; plan T14) — the
 * `pointKeyState` target and the seeded refusal of `pointKeyState.create`, with fakes. The read
 * of a real row on the tenant pool is the integration spec's
 * (`copilot-point-key-state-targets.integration.spec.ts`, Postgres).
 *
 * Mutation, applied once and seen red: drop the `mode === "propose"` throw in `seededAtPropose`
 * ({@link aSeededRowIsRefusedWithItsOwnSentence}).
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const JWT = { sub: "f4309-resolver-unit", role: "admin" } as JwtPayload;
const ORG_ROW = [{ name: "Org Seven" }];
const CUSTOM = [{ pointKey: "isolator_pos", value: 2.5, label: "EARTHED" }];
const SEEDED = [{ pointKey: "breaker_main", value: 1, label: "CLOSED" }];

/** A database that answers each read (`… limit`) with the next result of `results`, in order. */
function queuedDb(results: unknown[][], reads: string[] = []): never {
  const next = async () => {
    reads.push("read");
    return results.shift() ?? [];
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    from: () => chain,
    where: () => ({ limit: next }),
  };
  return chain as never;
}

/** The fleet gate's two calls (`mayManageFleet`): a master-data user, then the global admin. */
function access(globalAdmin: boolean, asked: string[] = []): never {
  return {
    requireMasterDataUser: async () => {
      asked.push("requireMasterDataUser");
    },
    isGlobalAdmin: async () => {
      asked.push("isGlobalAdmin");
      return globalAdmin;
    },
  } as never;
}

function resolver(results: unknown[][], globalAdmin = true, asked: string[] = []): CopilotTargetResolver {
  return new CopilotTargetResolver(queuedDb(results), access(globalAdmin, asked), {} as never, {} as never);
}

/** The edit of an admin row resolves in the bound organization, named "`<key>` = `<value>` (`<label>`)". */
export async function anAdminRowResolvesByItsKeyValueAndLabel(): Promise<void> {
  const asked: string[] = [];
  const resolved = await resolver([ORG_ROW, CUSTOM, ORG_ROW], true, asked).resolve(
    catalogEntry("pointKeyState.update")!,
    { id: ID },
    { label: "EARTH" },
    [ORG],
    JWT,
    ORG,
  );
  expect([resolved?.organizationId, resolved?.organizationName, resolved?.targetName]).toEqual([ORG, "Org Seven", "isolator_pos = 2.5 (EARTHED)"]);
  expect(asked).toEqual(["requireMasterDataUser", "isGlobalAdmin"]);
}

/** An id with no row is refused (the one `null`). */
export async function anUnknownIdIsRefused(): Promise<void> {
  const out = await resolver([ORG_ROW, []]).resolve(catalogEntry("pointKeyState.update")!, { id: ID }, {}, [ORG], JWT, ORG);
  expect(out).toBeNull();
}

/** The global admin alone: an `organization_admin` is refused, and never learns that a row is seeded. */
export async function aCallerWhoIsNotTheGlobalAdminIsRefused(): Promise<void> {
  const entry = catalogEntry("pointKeyState.update")!;
  expect(await resolver([ORG_ROW, CUSTOM], false).resolve(entry, { id: ID }, {}, [ORG], JWT, ORG)).toBeNull();
  // The seeded row answers the same `null` to them — the refusal sentence is the global admin's alone.
  expect(await resolver([ORG_ROW, SEEDED], false).resolve(entry, { id: ID }, {}, [ORG], JWT, ORG)).toBeNull();
  const create = catalogEntry("pointKeyState.create")!;
  const seededPair = { pointKey: "breaker_main", value: 1, label: "SHUT", tone: "open" };
  expect(await resolver([ORG_ROW], false).resolve(create, {}, seededPair, [ORG], JWT, ORG)).toBeNull();
}

/** Ruling Q2: an edit of a seeded row is refused at propose with its own sentence, so no card is stored. */
export async function aSeededRowIsRefusedWithItsOwnSentence(): Promise<void> {
  const call = resolver([ORG_ROW, SEEDED]).resolve(catalogEntry("pointKeyState.update")!, { id: ID }, { label: "X" }, [ORG], JWT, ORG);
  await expect(call).rejects.toBeInstanceOf(CopilotTargetRefusal);
  await expect(
    resolver([ORG_ROW, SEEDED]).resolve(catalogEntry("pointKeyState.update")!, { id: ID }, { label: "X" }, [ORG], JWT, ORG),
  ).rejects.toThrow("The state label breaker_main = 1 is seeded and read-only");
}

/** An open wizard's record (`"record"` mode) on a seeded row is simply not found: nothing throws there. */
export async function aSeededRowIsNoOpenWizardRecord(): Promise<void> {
  const out = await resolver([ORG_ROW, SEEDED]).resolve(catalogEntry("pointKeyState.update")!, { id: ID }, {}, [ORG], JWT, ORG, "record");
  expect(out).toBeNull();
  // The allowed twin: an admin row is the record, by its name.
  const custom = await resolver([ORG_ROW, CUSTOM, ORG_ROW]).resolve(catalogEntry("pointKeyState.update")!, { id: ID }, {}, [ORG], JWT, ORG, "record");
  expect(custom?.targetName).toBe("isolator_pos = 2.5 (EARTHED)");
}

/** Ruling Q2: a create of a seeded pair is refused at propose; any other pair resolves to the bound organization. */
export async function aCreateOfASeededPairIsRefused(): Promise<void> {
  const create = catalogEntry("pointKeyState.create")!;
  await expect(
    resolver([ORG_ROW]).resolve(create, {}, { pointKey: "breaker_main", value: 1, label: "SHUT", tone: "open" }, [ORG], JWT, ORG),
  ).rejects.toThrow("The state label breaker_main = 1 is seeded and read-only");
  const fresh = await resolver([ORG_ROW, ORG_ROW]).resolve(
    create,
    {},
    { pointKey: "breaker_main", value: 2, label: "RACKED OUT", tone: "open" },
    [ORG],
    JWT,
    ORG,
  );
  expect([fresh?.organizationId, fresh?.targetName]).toEqual([ORG, "Org Seven"]);
}

/** A conversation bound to no organization is refused before any read (`F3.86` ruling Q1). */
export async function anUnboundConversationIsRefused(): Promise<void> {
  const reads: string[] = [];
  const db = queuedDb([ORG_ROW, CUSTOM], reads);
  const out = await new CopilotTargetResolver(db, access(true), {} as never, {} as never).resolve(
    catalogEntry("pointKeyState.update")!,
    { id: ID },
    {},
    [ORG],
    JWT,
    null,
  );
  expect([out, reads]).toEqual([null, []]);
}
