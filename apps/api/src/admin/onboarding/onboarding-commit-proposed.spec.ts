import type { JwtPayload, OnboardingDraft } from "@bms/shared";

import { draftHash } from "./onboarding-commit-proposal";
import { OnboardingCommitService, PROPOSED_DRAFT_CHANGED } from "./onboarding-commit.service";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const JWT: JwtPayload = { sub: "u-1", email: "someone@bms.local", name: "someone", role: "admin" };

/** Thrown by the location insert: reaching it means the commit went past every check. */
const INSERT_REACHED = new Error("the location insert was reached");

function draft(name: string): OnboardingDraft {
  return { location: { code: "LT-1", slug: "lt-1", name, type: "pump_station", latitude: 26.1, longitude: 89.4 } };
}

/**
 * The commit service over fakes: `read` is the draft its first read sees, and
 * `locked` the draft the `FOR UPDATE` read inside the transaction sees — the
 * two differ when a writer lands between them. `events` records the
 * transaction, the lock and the insert.
 */
function harness(read: OnboardingDraft, locked: OnboardingDraft) {
  const events: string[] = [];
  const session = { id: "s-1", organizationId: "org-1", status: "draft", draft: read };
  const first = { from: () => first, where: () => first, limit: () => Promise.resolve([session]) };
  const lockChain = {
    from: () => lockChain,
    where: () => lockChain,
    for: (mode: string) => {
      events.push(`lock:${mode}`);
      return Promise.resolve([{ draft: locked, status: "draft" }]);
    },
  };
  const tx = {
    execute: () => Promise.resolve(),
    select: () => lockChain,
    insert: () => ({
      values: () => ({
        returning: () => {
          events.push("insert");
          return Promise.reject(INSERT_REACHED);
        },
      }),
    }),
  };
  const service = new OnboardingCommitService(
    { select: () => first } as never,
    {
      transaction: (fn: (inner: unknown) => Promise<unknown>) => {
        events.push("transaction");
        return fn(tx);
      },
    } as never,
    {
      requireMasterDataUser: () => Promise.resolve({ id: "u-1", role: "admin" }),
      canManageOrganization: () => Promise.resolve(true),
    } as never,
    {} as never,
    { validate: () => ({ valid: true, errors: [], readyToCommit: true, suggestedPhase: "review" }) } as never,
    {
      assertAssetDomain: () => Promise.resolve(),
      listLocationTypes: () => Promise.resolve([]),
      assertLocationType: () => Promise.resolve(),
    } as never,
    { context: async () => EMPTY_TEMPLATE_CONTEXT } as never,
    // F3.22: the three template services; this draft holds no template, so none is called.
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, events };
}

async function settle(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  return null;
}

export async function assertADraftChangedBeforeTheReadIsRefusedWithoutATransaction(): Promise<void> {
  const proposed = draft("Lotapata");
  const { service, events } = harness(draft("Changed"), draft("Changed"));
  const error = await settle(service.commitProposed(JWT, "s-1", draftHash(proposed)!));
  assert(error instanceof Error && error.message === PROPOSED_DRAFT_CHANGED, `refused: ${String(error)}`);
  assert(!events.includes("transaction"), "no transaction is opened");
}

export async function assertADraftChangedAfterTheReadIsRefusedUnderTheLock(): Promise<void> {
  const proposed = draft("Lotapata");
  const { service, events } = harness(proposed, draft("Changed"));
  const error = await settle(service.commitProposed(JWT, "s-1", draftHash(proposed)!));
  assert(error instanceof Error && error.message === PROPOSED_DRAFT_CHANGED, `refused: ${String(error)}`);
  assert(events.includes("lock:update"), "the session row is locked FOR UPDATE");
  assert(!events.includes("insert"), "nothing is inserted");
}

export async function assertAnUnchangedDraftProceedsPastTheLock(): Promise<void> {
  const proposed = draft("Lotapata");
  const { service, events } = harness(proposed, proposed);
  const error = await settle(service.commitProposed(JWT, "s-1", draftHash(proposed)!));
  assert(error === INSERT_REACHED, "positive control: the commit goes on to the inserts");
  assert(JSON.stringify(events) === '["transaction","lock:update","insert"]', `in that order: ${JSON.stringify(events)}`);
}

export async function assertTheButtonPathTakesNoLock(): Promise<void> {
  const { service, events } = harness(draft("Lotapata"), draft("Changed"));
  const error = await settle(service.commit(JWT, "s-1"));
  assert(error === INSERT_REACHED, "the Commit button commits the stored draft as before");
  assert(!events.some((event) => event.startsWith("lock:")), "and takes no proposal lock");
}
