import { BadRequestException } from "@nestjs/common";

import { MAX_ONBOARDING_POINT_KEYS, MAX_ONBOARDING_RTUS } from "@bms/shared";
import type { JwtPayload, OnboardingDraft } from "@bms/shared";

import { CredentialCryptoService } from "../../security/credential-crypto.service";
import { OnboardingChatService } from "./onboarding-chat.service";
import { guidedCapRefusal } from "./onboarding-guided-writes";
import { OnboardingService } from "./onboarding.service";
import { OnboardingValidateService } from "./onboarding-validate.service";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function times<T>(count: number, build: (index: number) => T): T[] {
  return Array.from({ length: count }, (_unused, index) => build(index));
}

export const JWT: JwtPayload = {
  sub: "u-1",
  email: "someone@bms.local",
  name: "someone",
  role: "admin",
};

/**
 * The turn that appends an RTU. `handleRuleBasedTurn` reaches its RTU branch on
 * `phase === "rtu"`, and the message text only picks the protocol — it is not
 * what decides whether an RTU is added.
 */
const APPEND_TURN = "Add another RTU";

/**
 * The turn that appends a point key. It reaches the `point_keys` branch on the
 * phase alone; the branch above it is skipped because the draft already has a
 * location and an RTU, and `"add point key kw"` matches neither the
 * existing-keys phrase nor the commit phrase.
 */
const POINT_KEY_TURN = "Add point key kw";

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

/** One draft point key, each with a distinct code. */
function pointKeyAt(index: number): NonNullable<OnboardingDraft["pointKeys"]>[number] {
  return {
    code: `pk_${index + 1}`,
    name: `Point ${index + 1}`,
    domain: "electrical",
    unit: "kW",
  };
}

const LOCATION: NonNullable<OnboardingDraft["location"]> = {
  name: "Berhampur",
  slug: "berhampur",
  code: "BERHAMPUR",
  type: "smoc_campus",
  latitude: -25.7,
  longitude: 28.2,
};

export function sessionRow(draft: OnboardingDraft, currentPhase: string) {
  return {
    id: "s-1",
    organizationId: "org-1",
    status: "draft",
    currentPhase,
    draft,
    messages: [],
    createdAt: new Date("2026-09-08T00:00:00Z"),
    updatedAt: new Date("2026-09-08T00:00:00Z"),
    committedAt: null,
    result: null,
  };
}

/** A session in the RTU phase holding `rtuCount` RTUs — the appending branch. */
function rtuSession(rtuCount: number) {
  return sessionRow({ location: LOCATION, rtus: times(rtuCount, rtuAt) }, "rtu");
}

/**
 * A session in the point-keys phase. It carries a location and one RTU so the
 * two branches above the point-keys branch fall through rather than answering.
 */
function pointKeySession(pointKeyCount: number) {
  return sessionRow(
    {
      location: LOCATION,
      rtus: [rtuAt(0)],
      pointKeys: times(pointKeyCount, pointKeyAt),
    },
    "point_keys",
  );
}

/** Everything the fake database was asked to do, so a write can be measured absent. */
export type Recorder = {
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
export function fakeDb(results: unknown[][], record: Recorder) {
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

export const ORG = [{ code: "ESKOM", name: "Eskom" }];

/**
 * `OnboardingService.chat` wired to the **real** `OnboardingChatService` and the
 * **real** `OnboardingValidateService`.
 *
 * Both are real on purpose. The producer under test is
 * `handleRuleBasedTurn`, and a stubbed chat service would assert the guard
 * against a patch the test itself wrote — which proves nothing about whether the
 * rule-based branch grows the array. `protocolService` and `catalogService` are
 * `{} as never`: neither turn below names a protocol question or the
 * existing-keys phrase, so reaching either of them is itself a failure.
 */
export function buildService(opts: { session: ReturnType<typeof sessionRow>; results?: unknown[][] }) {
  const record: Recorder = { updates: [], transactions: 0 };
  const db = fakeDb(opts.results ?? [[opts.session], ORG], record);
  const accessControl = {
    requireMasterDataUser: () => Promise.resolve({ id: "u-1", role: "admin" }),
    canManageOrganization: () => Promise.resolve(true),
  } as never;
  const chatService = new OnboardingChatService(
    new OnboardingValidateService(),
    new CredentialCryptoService(),
    {} as never,
    {} as never,
    // F4.162 (plan D9): `handleTurn` reads the active location types on every
    // turn. `smoc_campus` is the fixture location's type, so it stays set.
    { listLocationTypes: async () => [{ code: "smoc_campus", label: "SMOC campus" }] } as never,
    // F3.21: the platform has no provider, so the guided (rule-based) mode
    // answers — the producer these cases are about.
    { resolveForOrganization: async () => ({ kind: "guided", reason: "platform_off" }) } as never,
    { context: async () => EMPTY_TEMPLATE_CONTEXT } as never,
    { listExisting: async () => ({ rows: [], total: 0 }) } as never,
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
    {} as never,
    { context: async () => EMPTY_TEMPLATE_CONTEXT } as never,
  );
  return { service, record };
}

/** Runs `fn` with no OpenAI key, which is what `.env.example` ships. */
export async function withoutOpenAi<T>(fn: () => Promise<T>): Promise<T> {
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
      `${written?.rtus?.length ?? 0} RTUs (cap ${MAX_ONBOARDING_RTUS}) and ` +
      `${written?.pointKeys?.length ?? 0} point keys (cap ${MAX_ONBOARDING_POINT_KEYS}) written`,
  );
}

function messageOf(error: unknown): string {
  return String((error as { message?: unknown }).message);
}

/**
 * `F4.103` — the **fourth** draft producer, and the one the first pass missed.
 *
 * `handleRuleBasedTurn` (`onboarding-chat-rule-based.ts`) is not a fallback. `.env.example`
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
      session: rtuSession(MAX_ONBOARDING_RTUS - 1),
      results: [
        [rtuSession(MAX_ONBOARDING_RTUS - 1)],
        ORG,
        [rtuSession(MAX_ONBOARDING_RTUS)],
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
 * The stored draft of the one update a turn wrote, compared as JSON: `mergeDraft`
 * adds keys set to `undefined`, which a JSON comparison drops and a deep-strict
 * one would count.
 */
function writtenDraftJson(record: Recorder): string {
  return JSON.stringify(record.updates[0]?.draft);
}

/**
 * `F4.103`, F3.27 (ADR 0090 Amendment 2 B4, B5) — a chat turn that would carry
 * the draft past a cap is refused **in the reply**, and the draft is not
 * changed.
 *
 * Since F3.27 the guided RTU step writes through the registry's `add_rtu`
 * (`guidedWrite`), which checks `draftCountProblem` on the merged draft as the
 * agent path does. So an at-cap session answers 200 with `I did not change the
 * draft.`, the guided cap sentence (`guidedCapRefusal`, not the registry's
 * model-facing count) and the step prompt.
 * The turn and its reply are stored; the draft is stored as it was.
 */
export async function assertAnAtCapChatTurnIsRefusedInTheReply(): Promise<void> {
  await withoutOpenAi(async () => {
    const { service, record } = buildService({
      session: rtuSession(MAX_ONBOARDING_RTUS),
      results: [
        [rtuSession(MAX_ONBOARDING_RTUS)],
        ORG,
        [rtuSession(MAX_ONBOARDING_RTUS)],
        ORG,
      ],
    });
    const response = await service.chat(JWT, "s-1", APPEND_TURN);

    const expected = guidedCapRefusal("RTUs", MAX_ONBOARDING_RTUS);
    assert(
      response.assistantMessage.startsWith(`I did not change the draft. ${expected} `),
      `the reply carries the cap sentence, got "${response.assistantMessage}"`,
    );
    assert(
      !response.assistantMessage.includes(`${MAX_ONBOARDING_RTUS + 1}`),
      `the reply names no count the draft does not hold, got "${response.assistantMessage}"`,
    );
    assert(record.updates.length === 1, `the turn is stored once, got ${record.updates.length} update(s)`);
    assert(
      writtenDraftJson(record) === JSON.stringify(rtuSession(MAX_ONBOARDING_RTUS).draft),
      `the stored draft is unchanged, got ${(record.updates[0]?.draft as OnboardingDraft | undefined)?.rtus?.length} RTUs`,
    );
  });
}

/**
 * `F4.103`, F3.27 — the **second** appending branch, and a different cap.
 *
 * `pointKeys` is the other array the guided mode appends to, with a different
 * cap and a different label, so this exercises `draftCountProblem`'s loop
 * rather than its first iteration. Its write is `add_point_key`.
 */
export async function assertAnAtCapPointKeyTurnIsRefusedInTheReply(): Promise<void> {
  await withoutOpenAi(async () => {
    const { service, record } = buildService({
      session: pointKeySession(MAX_ONBOARDING_POINT_KEYS),
      results: [
        [pointKeySession(MAX_ONBOARDING_POINT_KEYS)],
        ORG,
        [pointKeySession(MAX_ONBOARDING_POINT_KEYS)],
        ORG,
      ],
    });
    const response = await service.chat(JWT, "s-1", POINT_KEY_TURN);

    const expected = guidedCapRefusal("point keys", MAX_ONBOARDING_POINT_KEYS);
    assert(
      response.assistantMessage.startsWith(`I did not change the draft. ${expected} `),
      `the reply names the point-key cap, not the RTU one, got "${response.assistantMessage}"`,
    );
    assert(record.updates.length === 1, `the turn is stored once, got ${record.updates.length} update(s)`);
    assert(
      writtenDraftJson(record) === JSON.stringify(pointKeySession(MAX_ONBOARDING_POINT_KEYS).draft),
      `the stored draft is unchanged, got ${(record.updates[0]?.draft as OnboardingDraft | undefined)?.pointKeys?.length} point keys`,
    );
  });
}

/**
 * `F4.103` — the defence in depth. A session that is somehow **already over** a
 * cap refuses every turn with a 400, and **nothing is written**: the guided
 * write refuses, its empty patch merges to the same over-cap draft, and
 * `OnboardingService.chat` counts the merged draft before the `withTenant`
 * update. `PATCH :id/draft` replaces the arrays wholesale and is the way back
 * out. Unreachable today: `bms.onboarding_sessions` measured `(0 rows)` on
 * 2026-09-08.
 */
export async function assertAnOverCapSessionStillRefusesTheTurn(): Promise<void> {
  await withoutOpenAi(async () => {
    const { service, record } = buildService({
      session: pointKeySession(MAX_ONBOARDING_POINT_KEYS + 1),
      results: [
        [pointKeySession(MAX_ONBOARDING_POINT_KEYS + 1)],
        ORG,
        [pointKeySession(MAX_ONBOARDING_POINT_KEYS + 1)],
        ORG,
      ],
    });
    const error = await rejectionOf(service.chat(JWT, "s-1", POINT_KEY_TURN), record);
    assert(
      error instanceof BadRequestException,
      `an over-cap session's turn is a bad request, got ${String(error)}`,
    );
    const message = messageOf(error);
    const expected =
      `The draft holds ${MAX_ONBOARDING_POINT_KEYS + 1} point keys, more than the ` +
      `${MAX_ONBOARDING_POINT_KEYS} one onboarding session may commit; remove some and commit ` +
      "the rest in a second session";
    assert(message === expected, `the 400 names the session's own count, got "${message}"`);
    assert(
      record.updates.length === 0 && record.transactions === 0,
      `a refused turn writes nothing, got ${record.updates.length} update(s)`,
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
    const { service, record } = buildService({ session: rtuSession(MAX_ONBOARDING_RTUS) });
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
