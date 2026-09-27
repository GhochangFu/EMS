import { BadRequestException } from "@nestjs/common";

import type { JwtPayload, OnboardingDraft } from "@bms/shared";

import { OnboardingCommitService } from "./onboarding-commit.service";

/**
 * `F4.157` K1 (ADR 0077, plan D4) — the onboarding commit asks
 * `VocabulariesService.assertLocationType` about the draft's location type
 * before the transaction opens.
 *
 * One event log records both the vocabulary call and the transaction opening,
 * so the order is what the cases read: removing the call reddens them, and so
 * does moving it inside `withTenant`. A count alone would pass the second
 * mutation.
 *
 * The harness reaches the transaction and fails the first insert with a
 * sentinel, the `onboarding-commit-conflict.spec.ts` shape: nothing past the
 * location insert is under test here.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const JWT: JwtPayload = {
  sub: "u-1",
  email: "someone@bms.local",
  name: "someone",
  role: "admin",
};

/** Thrown by the location insert, so the commit stops once the transaction is open. */
const INSERT_REACHED = new Error("the location insert was reached");

function draftWithType(type: string | undefined): OnboardingDraft {
  return {
    location: {
      code: "LT-1",
      slug: "lt-1",
      name: "Lotapata",
      ...(type === undefined ? {} : { type }),
      latitude: 26.1,
      longitude: 89.4,
    },
  };
}

type Harness = { service: OnboardingCommitService; events: string[] };

function buildService(draft: OnboardingDraft, opts: { liveTypes: readonly string[] }): Harness {
  const events: string[] = [];
  const session = { id: "s-1", organizationId: "org-1", status: "draft", draft };
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve([session]),
  };
  const fleetDb = { select: () => chain } as never;

  const tx = {
    execute: () => Promise.resolve(),
    insert: () => ({ values: () => ({ returning: () => Promise.reject(INSERT_REACHED) }) }),
  };
  const tenantDb = {
    transaction: (fn: (inner: unknown) => Promise<unknown>) => {
      events.push("transaction");
      return fn(tx);
    },
  } as never;

  const accessControl = {
    requireMasterDataUser: () => Promise.resolve({ id: "u-1", role: "admin" }),
    canManageOrganization: () => Promise.resolve(true),
  } as never;

  // `validate` is stubbed ready: what is under test is the commit's own
  // check, including the fail-closed `""` for a draft `validate` let through.
  const validateService = {
    validate: () => ({ valid: true, errors: [], readyToCommit: true, suggestedPhase: "review" }),
  } as never;

  const vocabularies = {
    assertAssetDomain: () => Promise.resolve(),
    // F4.162 (plan D9): the commit reads the active codes for `validate`, which
    // is stubbed here, so the list is not read; no event is recorded for it.
    listLocationTypes: () => Promise.resolve([]),
    assertLocationType: (code: string) => {
      events.push(`assertLocationType:${code}`);
      return opts.liveTypes.includes(code)
        ? Promise.resolve()
        : Promise.reject(new BadRequestException(`location type "${code}" is not a live value.`));
    },
  } as never;

  const service = new OnboardingCommitService(
    fleetDb,
    tenantDb,
    accessControl,
    {} as never,
    validateService,
    vocabularies,
  );
  return { service, events };
}

async function settle(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (err) {
    return err;
  }
  return null;
}

/**
 * K1 — the draft's type is asserted, and the assert precedes the
 * transaction. The trailing `"transaction"` is also the positive control for
 * K1b: with a live type the transaction does open.
 */
export async function assertTheCommitAssertsTheLocationTypeBeforeTheTransaction(): Promise<void> {
  const { service, events } = buildService(draftWithType("pump_station"), {
    liveTypes: ["pump_station"],
  });
  await settle(service.commit(JWT, "s-1"));
  assert(
    JSON.stringify(events) === JSON.stringify(["assertLocationType:pump_station", "transaction"]),
    `expected the type asserted and then the transaction opened, got ${JSON.stringify(events)}`,
  );
}

/** K1b — a refused type stops the commit before the transaction opens. */
export async function assertARefusedLocationTypeNeverOpensTheTransaction(): Promise<void> {
  const { service, events } = buildService(draftWithType("nope"), { liveTypes: ["pump_station"] });
  const err = await settle(service.commit(JWT, "s-1"));
  assert(
    err instanceof BadRequestException,
    `expected the vocabulary's 400, got ${String(err)}`,
  );
  assert(
    !events.includes("transaction"),
    `the transaction must not open for a refused type, got ${JSON.stringify(events)}`,
  );
}

/** K1c — a draft with no type fails closed: `""` is handed to the assert. */
export async function assertADraftWithoutATypeIsAssertedAsEmpty(): Promise<void> {
  const { service, events } = buildService(draftWithType(undefined), {
    liveTypes: ["pump_station"],
  });
  await settle(service.commit(JWT, "s-1"));
  assert(
    JSON.stringify(events) === JSON.stringify(["assertLocationType:"]),
    `expected "" asserted and refused, with no transaction, got ${JSON.stringify(events)}`,
  );
}
