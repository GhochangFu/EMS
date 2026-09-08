import { BadRequestException } from "@nestjs/common";

import { MAX_ONBOARDING_RTUS } from "@bms/shared";
import type { JwtPayload, OnboardingDraft } from "@bms/shared";

import { CredentialCryptoService } from "../../security/credential-crypto.service";
import { OnboardingChatService } from "./onboarding-chat.service";
import { OnboardingService } from "./onboarding.service";
import { OnboardingValidateService } from "./onboarding-validate.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function times<T>(count: number, build: (index: number) => T): T[] {
  return Array.from({ length: count }, (_unused, index) => build(index));
}

const JWT: JwtPayload = {
  sub: "u-1",
  email: "someone@bms.local",
  name: "someone",
  role: "admin",
};

/**
 * The turn that appends. `handleRuleBasedTurn` reaches its RTU branch on
 * `phase === "rtu"`, and the message text only picks the protocol — it is not
 * what decides whether an RTU is added.
 */
const APPEND_TURN = "Add another RTU";

/** One draft RTU, each with a distinct code so nothing is folded on the way in. */
function rtuAt(index: number): NonNullable<OnboardingDraft["rtus"]>[number] {
  return {
    code: `RTU-${index + 1}`,
    displayName: `RTU ${index + 1}`,
    protocol: "mqtt",
    config: { host: "broker", port: 8883, tls: true, topic: "" },
    credentialsSet: false,
    ingestEnabled: true,
  };
}

function sessionRow(rtuCount: number) {
  return {
    id: "s-1",
    organizationId: "org-1",
    status: "draft",
    currentPhase: "rtu",
    draft: {
      location: { name: "Berhampur", slug: "berhampur", code: "BERHAMPUR", type: "smoc_campus" },
      rtus: times(rtuCount, rtuAt),
    },
    messages: [],
    createdAt: new Date("2026-09-08T00:00:00Z"),
    updatedAt: new Date("2026-09-08T00:00:00Z"),
    committedAt: null,
    result: null,
  };
}

/** Everything the fake database was asked to do, so a write can be measured absent. */
type Recorder = {
  /** The `set({...})` payload of every `update`, in call order. */
  readonly updates: Record<string, unknown>[];
  /** How many transactions `withTenant` opened. */
  transactions: number;
};

/**
 * Drizzle stand-in in the shape `onboarding-credentials.spec.ts` established:
 * each terminal call shifts the next queued result, so a case states exactly
 * what the database answers and in what order. `transaction` runs the callback
 * against this same object — `withTenant`'s `SET LOCAL` is real-RLS plumbing
 * with no policy to enforce here — and both it and `update` are counted, because
 * the claim under test is that **nothing is written**.
 */
function fakeDb(results: unknown[][], record: Recorder) {
  const queue = [...results];
  const next = () => queue.shift() ?? [];
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: () => Promise.resolve(next()),
  };
  const updateChain = {
    set: (values: Record<string, unknown>) => {
      record.updates.push(values);
      return updateChain;
    },
    where: () => updateChain,
    returning: () => Promise.resolve(next()),
  };
  const db = {
    select: () => selectChain,
    update: () => updateChain,
    insert: () => updateChain,
    execute: () => Promise.resolve(undefined),
    transaction: (fn: (tx: unknown) => Promise<unknown>) => {
      record.transactions += 1;
      return fn(db);
    },
  };
  return db as never;
}

const ORG = [{ code: "ESKOM", name: "Eskom" }];

/**
 * `OnboardingService.chat` wired to the **real** `OnboardingChatService` and the
 * **real** `OnboardingValidateService`.
 *
 * Both are real on purpose. The producer under test is
 * `handleRuleBasedTurn`, and a stubbed chat service would assert the guard
 * against a patch the test itself wrote — which proves nothing about whether the
 * rule-based branch grows the array. `protocolService` and `catalogService` are
 * `{} as never`: `APPEND_TURN` names no protocol question and no existing-keys
 * phrase, so reaching either of them is itself a failure.
 */
function buildService(opts: { rtuCount: number; results?: unknown[][] }) {
  const record: Recorder = { updates: [], transactions: 0 };
  const session = sessionRow(opts.rtuCount);
  const db = fakeDb(opts.results ?? [[session], ORG], record);
  const accessControl = {
    requireMasterDataUser: () => Promise.resolve({ id: "u-1", role: "admin" }),
    canManageOrganization: () => Promise.resolve(true),
  } as never;
  const chatService = new OnboardingChatService(
    new OnboardingValidateService(),
    new CredentialCryptoService(),
    {} as never,
    {} as never,
  );
  const service = new OnboardingService(
    db,
    db,
    accessControl,
    chatService,
    new OnboardingValidateService(),
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, record, session };
}

/** Runs `fn` with no OpenAI key, which is what `.env.example` ships. */
async function withoutOpenAi<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    return await fn();
  } finally {
    if (previous !== undefined) {
      process.env.OPENAI_API_KEY = previous;
    }
  }
}

/**
 * The error a call refused with, or a failure that says **what was written**
 * instead. Before the guard this case's diagnosis is the persisted draft, not
 * the missing exception, so the failure names it.
 */
async function rejectionOf(run: Promise<unknown>, record: Recorder): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  const written = record.updates[0]?.draft as OnboardingDraft | undefined;
  throw new Error(
    "chat accepted the turn and persisted the over-cap draft: " +
      `${written?.rtus?.length ?? 0} RTUs written, cap is ${MAX_ONBOARDING_RTUS}`,
  );
}

function messageOf(error: unknown): string {
  return String((error as { message?: unknown }).message);
}

/**
 * `F4.103` — the **fourth** draft producer, and the one the first pass missed.
 *
 * `OnboardingChatService.handleRuleBasedTurn` is not a fallback. `.env.example`
 * ships `OPENAI_API_KEY=` empty, so it is the branch that runs by default, and
 * it builds its patch in code without ever reaching
 * `onboardingDraftSchema.safeParse` — that call guards the *model* branch alone.
 * Two of its branches concatenate: `patch.rtus = [...(draft.rtus ?? []), …]` and
 * the same shape for `pointKeys`. (`assets` and `assetPoints` assign a
 * single-element array, so those two replace and cannot grow.)
 *
 * **Why `mergeDraft` does not save it.** `mergeDraft` takes `patch.rtus ??
 * base.rtus`, which replaces the stored array wholesale — true, and the reason a
 * `PATCH :id/draft` body cannot accumulate. But here the concatenation has
 * already happened *upstream, in the patch builder*, so `mergeDraft` faithfully
 * stores an array that is one longer than the one it replaced. The first case
 * below measures exactly that growth rather than assuming it.
 */
export async function assertAChatTurnGrowsTheDraftByOne(): Promise<void> {
  await withoutOpenAi(async () => {
    const { service, record } = buildService({
      rtuCount: MAX_ONBOARDING_RTUS - 1,
      results: [
        [sessionRow(MAX_ONBOARDING_RTUS - 1)],
        ORG,
        [sessionRow(MAX_ONBOARDING_RTUS)],
        ORG,
      ],
    });
    await service.chat(JWT, "s-1", APPEND_TURN);

    assert(
      record.updates.length === 1,
      `an under-cap turn is written, got ${record.updates.length} update(s)`,
    );
    const written = record.updates[0]?.draft as OnboardingDraft;
    assert(
      written.rtus?.length === MAX_ONBOARDING_RTUS,
      `one chat turn appends one RTU to the stored draft — ${MAX_ONBOARDING_RTUS - 1} became ` +
        `${written.rtus?.length}, so the patch builder concatenates and mergeDraft stores the ` +
        "already-grown array",
    );
    assert(
      written.rtus?.[MAX_ONBOARDING_RTUS - 1]?.code === `RTU-${MAX_ONBOARDING_RTUS}`,
      `the appended RTU is the new one, got ${JSON.stringify(written.rtus?.at(-1))}`,
    );
  });
}

/**
 * `F4.103` — a chat turn that would carry the draft past a cap is refused, and
 * **nothing is written**.
 *
 * Refused rather than truncated, which is the answer `parseUpload` and `commit`
 * already give and the answer both siblings give. The refusal is thrown before
 * the `withTenant` update, so the operator's existing draft, its phase and its
 * message history are exactly as they were: the turn is lost, the session is
 * not. They simply cannot add a 101st RTU by chat.
 *
 * The check runs on the **merged** draft, so a session that is somehow already
 * over a cap refuses every turn, innocuous ones included — the RTU branch
 * appends whatever the message says. `PATCH :id/draft` replaces the arrays
 * wholesale and is the way back out. Unreachable today: `bms.onboarding_sessions`
 * measured `(0 rows)` on 2026-09-08.
 */
export async function assertAnOverCapChatTurnIsRefusedAndWritesNothing(): Promise<void> {
  await withoutOpenAi(async () => {
    // The full four-answer queue the happy path consumes, so that without the
    // guard this turn *succeeds* and the failure below is the persisted draft
    // rather than a database stub running out of rows.
    const { service, record } = buildService({
      rtuCount: MAX_ONBOARDING_RTUS,
      results: [
        [sessionRow(MAX_ONBOARDING_RTUS)],
        ORG,
        [sessionRow(MAX_ONBOARDING_RTUS)],
        ORG,
      ],
    });
    const error = await rejectionOf(service.chat(JWT, "s-1", APPEND_TURN), record);
    assert(
      error instanceof BadRequestException,
      `an over-cap chat turn is a bad request, got ${String(error)}`,
    );

    const message = messageOf(error);
    const expected =
      `The draft holds ${MAX_ONBOARDING_RTUS + 1} RTUs, more than the ${MAX_ONBOARDING_RTUS} ` +
      "one onboarding session may commit; remove some and commit the rest in a second session";
    assert(
      message === expected,
      `the chat refusal is the same sentence the upload and the commit give, got "${message}"`,
    );

    // The session is untouched: no `update`, and no transaction opened at all.
    assert(
      record.updates.length === 0,
      `a refused turn writes nothing, got ${record.updates.length} update(s): ` +
        JSON.stringify(record.updates.map((update) => Object.keys(update))),
    );
    assert(
      record.transactions === 0,
      `a refused turn opens no transaction, got ${record.transactions}`,
    );
  });
}

/**
 * `F4.103` — the refusal sits **below** the ADR 0022 decision 2 credential
 * check, which answers with a normal chat response rather than a 400.
 *
 * Order matters here in one direction only: a turn that looks like it carries a
 * credential must still be told where the credentials field is, even on a
 * session that is already at a cap. Answering it with the count sentence would
 * drop that guidance, and the count sentence is not the repair that turn needs.
 */
export async function assertTheCredentialNudgeStillAnswersFirst(): Promise<void> {
  await withoutOpenAi(async () => {
    const { service, record } = buildService({
      rtuCount: MAX_ONBOARDING_RTUS,
      results: [[sessionRow(MAX_ONBOARDING_RTUS)], ORG],
    });
    const response = await service.chat(JWT, "s-1", "the password is hunter2");
    assert(
      response.assistantMessage.includes("Credentials never go through this chat"),
      `the credential nudge answers first, got "${response.assistantMessage}"`,
    );
    assert(
      !response.assistantMessage.includes("one onboarding session may commit"),
      "the count sentence is not the repair a credential turn needs",
    );
    assert(record.updates.length === 0, "the credential branch writes nothing either");
  });
}
