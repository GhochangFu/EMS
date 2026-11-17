import { Logger } from "@nestjs/common";
import type { BmsDb } from "@bms/db";
import type { MlFindingsKind, MlFindingsParagraphResponse } from "@bms/shared";
import { mlFindingsParagraphResponseSchema } from "@bms/shared";
import { expect, vi } from "vitest";

import type { CopilotAvailabilityService } from "../copilot/copilot-availability.service";
import type { LlmCompleteInput, LlmProvider, LlmReply } from "../llm/llm-port";
import type { LlmResolver, ResolvedLlm } from "../llm/llm-resolver";
import type { FindingsCardFacts } from "../ml/ml-findings.lines";
import type { MlFindingsService } from "../ml/ml-findings.service";
import {
  UUID_TEXT,
  fixtureSecrets,
  fxaAnomalyCard,
  fxbAnomalyCard,
  fxbForecastCard,
} from "./findings-paragraph.fixture";
import {
  FINDINGS_CALL_TIMEOUT_MS,
  FINDINGS_DAILY_ATTEMPT_CAP,
  FINDINGS_MAX_OUTPUT_TOKENS,
  FindingsParagraphService,
} from "./findings-paragraph.service";
import { startOfUtcDay, type FindingsParagraphStore, type StoredParagraph } from "./findings-paragraph.store";
import { pseudonymiseFacts } from "./findings-pseudonymise";

/**
 * `E1.9c` / ADR 0135 Amendment 8 decisions 4–7 and 11 (plan §4.5, R-m, R-n,
 * R-p, T3.4) — the paragraph flow, with no database and no live LLM: an
 * in-memory store, a fake facts service, and fake `LlmProvider` objects in the
 * `agent-loop.spec.ts` shape. Assertions live here;
 * `findings-paragraph.service.test.ts` is the vitest entry point (ADR 0014).
 */
const SECRET_MESSAGE = "upstream said sk-live-do-not-log";
/** The wall clock: the service stamps a write with `new Date()`, so the request clock must agree with it. */
const NOW = new Date();
const MINUTE_MS = 60_000;

/** A provider error as the SDKs raise one: a class name, an HTTP status, and a message that must never be recorded. */
class FakeHttpError extends Error {
  constructor(readonly status: number) {
    super(SECRET_MESSAGE);
  }
}

type Step = LlmReply | { readonly throwStatus: number } | "hang" | "never";

/** Each `complete` takes the next step; `"hang"` rejects on the call's own signal, `"never"` ignores it. */
class ScriptedProvider implements LlmProvider {
  readonly name = "openrouter" as const;
  readonly seen: LlmCompleteInput[] = [];
  readonly signals: AbortSignal[] = [];
  private readonly releases: Array<(reply: LlmReply) => void> = [];

  constructor(private readonly script: Step[] = []) {}

  get calls(): number {
    return this.seen.length;
  }

  /** Answers every hanging call with `reply`. */
  release(reply: LlmReply = { kind: "final", text: "x" }): void {
    for (const r of this.releases.splice(0)) r(reply);
  }

  async complete(input: LlmCompleteInput): Promise<LlmReply> {
    this.seen.push(JSON.parse(JSON.stringify({ ...input, signal: undefined })) as LlmCompleteInput);
    this.signals.push(input.signal);
    const next = this.script.shift() ?? "hang";
    if (next === "never") return new Promise(() => undefined);
    if (next === "hang") {
      return new Promise((resolve, reject) => {
        this.releases.push(resolve);
        input.signal.addEventListener("abort", () => reject(new Error("Request was aborted.")), { once: true });
      });
    }
    if ("throwStatus" in next) throw new FakeHttpError(next.throwStatus);
    return next;
  }
}

type Row = StoredParagraph & {
  organizationId: string;
  kind: MlFindingsKind;
  factsHash: string;
  provider: string | null;
  model: string | null;
};

/** The in-memory store. Every call checks that its transaction was opened for the organization it names. */
class MemoryStore {
  rows: Row[] = [];
  readonly writes: Parameters<FindingsParagraphStore["writeOutcome"]>[1][] = [];
  readonly wrongTenant: string[] = [];
  private next = 0;

  private check(tx: unknown, organizationId: string, what: string): void {
    const opened = (tx as { org?: string | null }).org;
    if (opened !== organizationId) this.wrongTenant.push(`${what}: tx for ${String(opened)}, row for ${organizationId}`);
  }

  plant(row: Partial<Row> & Pick<Row, "organizationId" | "kind" | "factsHash" | "status">): void {
    this.next += 1;
    this.rows.push({ id: `row-${this.next}`, paragraph: null, reason: null, attempts: 1, createdAt: NOW, provider: null, model: null, ...row });
  }

  readonly store: FindingsParagraphStore = {
    readParagraph: async (tx, organizationId, kind, factsHash) => {
      this.check(tx, organizationId, "read");
      return this.rows.find((r) => r.organizationId === organizationId && r.kind === kind && r.factsHash === factsHash) ?? null;
    },
    attemptsToday: async (tx, organizationId, now) => {
      this.check(tx, organizationId, "cap");
      const since = startOfUtcDay(now).getTime();
      return this.rows
        .filter((r) => r.organizationId === organizationId && r.createdAt.getTime() >= since)
        .reduce((sum, r) => sum + r.attempts, 0);
    },
    writeOutcome: async (tx, input) => {
      this.check(tx, input.organizationId, "write");
      this.writes.push(input);
      if (input.retryOf !== null) this.rows = this.rows.filter((r) => r.id !== input.retryOf?.id || r.status !== "failed");
      this.rows = this.rows.filter((r) => r.organizationId !== input.organizationId || r.createdAt >= input.retainAfter);
      const clash = this.rows.some(
        (r) => r.organizationId === input.organizationId && r.kind === input.kind && r.factsHash === input.factsHash,
      );
      if (clash) return;
      const sameDay = input.retryOf !== null && startOfUtcDay(input.retryOf.createdAt).getTime() === startOfUtcDay(input.now).getTime();
      this.plant({
        organizationId: input.organizationId,
        kind: input.kind,
        factsHash: input.factsHash,
        status: input.outcome.status,
        paragraph: input.outcome.paragraph,
        reason: input.outcome.reason,
        provider: input.provider,
        model: input.model,
        attempts: sameDay && input.retryOf ? input.retryOf.attempts + 1 : 1,
        createdAt: input.now,
      });
    },
  };
}

/** A tenant pool whose transaction records the organization `withTenant` set. */
function fakeTenantDb(): BmsDb {
  return {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx: { org: string | null; execute: (q: unknown) => Promise<void> } = {
        org: null,
        execute: async (q) => {
          const chunks = (q as { queryChunks?: unknown[] }).queryChunks ?? [];
          tx.org = (chunks.find((c) => typeof c === "string") as string | undefined) ?? null;
        },
      };
      return fn(tx);
    },
  } as unknown as BmsDb;
}

type HarnessOptions = {
  cards?: FindingsCardFacts[];
  kind?: MlFindingsKind;
  provider?: ScriptedProvider;
  switchOn?: (organizationId: string) => boolean;
  resolved?: "ready" | "guided";
};

function harness(options: HarnessOptions = {}) {
  const provider = options.provider ?? new ScriptedProvider();
  const memory = new MemoryStore();
  const cards = options.cards ?? [fxbAnomalyCard()];
  const factsCalls: Array<{ kind: MlFindingsKind; assetIds: string[] | null }> = [];
  const findings = {
    forecastFacts: async (assetIds: string[] | null) => {
      factsCalls.push({ kind: "forecasts", assetIds });
      return { asOf: NOW.toISOString(), cards };
    },
    anomalyFacts: async (assetIds: string[] | null) => {
      factsCalls.push({ kind: "anomalies", assetIds });
      return { asOf: NOW.toISOString(), cards };
    },
  } as unknown as MlFindingsService;
  const resolvedFor: string[] = [];
  const llm = {
    resolveForFindings: async (organizationId: string): Promise<ResolvedLlm> => {
      resolvedFor.push(organizationId);
      return options.resolved === "guided"
        ? { kind: "guided", reason: "platform_off" }
        : { kind: "ready", provider, source: "platform", vision: false, model: "small/open-model" };
    },
  } as unknown as LlmResolver;
  const switchCalls: string[] = [];
  const availability = {
    organizationSwitchOn: async (organizationId: string) => {
      switchCalls.push(organizationId);
      return options.switchOn?.(organizationId) ?? true;
    },
  } as unknown as CopilotAvailabilityService;
  const service = new FindingsParagraphService(fakeTenantDb(), findings, llm, availability);
  service.store = memory.store;
  const get = (assetIds: string[] | null = ["asset-1"]) => service.get(options.kind ?? "anomalies", assetIds, false, NOW);
  return { service, provider, memory, get, factsCalls, resolvedFor, switchCalls };
}

const states = (r: MlFindingsParagraphResponse): string[] => r.cards.map((c) => c.state);
const hashOf = (kind: MlFindingsKind, card: FindingsCardFacts): string => {
  const p = pseudonymiseFacts(kind, card);
  if (!p.sendable) throw new Error("not sendable");
  return p.hash;
};

/** A card of the `FXB` shape under another organization id: a distinct cache key per organization. */
const cardFor = (organizationId: string): FindingsCardFacts => ({ ...fxbAnomalyCard(), organizationId });

const GOOD =
  "[A1] carries the strongest signal, with 1 hour marked by both methods and 2 unusual hours in all, last at [T1]. " +
  "In the last 7 days there were 6 unusual hours on 4 of 19 scored assets; marks from the Baseline method alone are a weak signal.";

/** Captures `Logger.prototype.log` and `.warn` for the duration of `fn`. */
async function logsOf(fn: () => Promise<void>): Promise<unknown[][]> {
  const lines: unknown[][] = [];
  const log = vi.spyOn(Logger.prototype, "log").mockImplementation((...args: unknown[]) => void lines.push(args));
  const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation((...args: unknown[]) => void lines.push(args));
  try {
    await fn();
  } finally {
    log.mockRestore();
    warn.mockRestore();
  }
  return lines;
}

export async function aGoodReplyIsStoredOkAndServedWithItsAssetReference(): Promise<void> {
  const h = harness({ provider: new ScriptedProvider([{ kind: "final", text: GOOD }]) });
  const first = await h.get();
  expect(states(first)).toEqual(["pending"]);
  await h.service.settled();
  expect(h.memory.rows).toHaveLength(1);
  const row = h.memory.rows[0]!;
  expect(row).toMatchObject({ status: "ok", paragraph: GOOD, reason: null, provider: "openrouter", model: "small/open-model" });
  expect(row.organizationId).toBe(fxbAnomalyCard().organizationId);
  expect(row.factsHash).toBe(hashOf("anomalies", fxbAnomalyCard()));
  const second = await h.get();
  expect(states(second)).toEqual(["ok"]);
  expect(second.cards[0]!.segments[0]).toEqual({ assetRef: "A1" });
  expect(JSON.stringify(second.cards[0]!.segments)).toContain("17 Nov");
  expect(mlFindingsParagraphResponseSchema.safeParse(second).success).toBe(true);
  expect(h.provider.calls, "a cached row makes no second call").toBe(1);
  expect(h.memory.wrongTenant).toEqual([]);
}

export async function aRefusedReplyIsRejectedWithItsReason(): Promise<void> {
  for (const [reply, reason] of [
    [{ kind: "final", text: "[A1] had 99 unusual hours." }, "number_not_in_facts"],
    [{ kind: "tool_calls", calls: [{ id: "c1", name: "x", arguments: "{}" }], content: null }, "tool_calls"],
  ] as const) {
    const h = harness({ provider: new ScriptedProvider([reply]) });
    await h.get();
    await h.service.settled();
    expect(h.memory.rows.map((r) => [r.status, r.reason, r.paragraph])).toEqual([["rejected", reason, null]]);
    expect(states(await h.get())).toEqual(["none"]);
    expect(h.provider.calls, "a rejected row is never tried again").toBe(1);
  }
}

export async function aThrowIsFailedWithTheReasonOfItsStatus(): Promise<void> {
  for (const [status, reason] of [
    [401, "provider_auth"],
    [403, "provider_auth"],
    [402, "provider_quota"],
    [429, "provider_quota"],
    [503, "provider_error"],
  ] as const) {
    const h = harness({ provider: new ScriptedProvider([{ throwStatus: status }]) });
    const lines = await logsOf(async () => {
      await h.get();
      await h.service.settled();
    });
    expect(h.memory.rows.map((r) => [r.status, r.reason])).toEqual([["failed", reason]]);
    expect(JSON.stringify(h.memory.rows)).not.toContain("sk-live-do-not-log");
    expect(JSON.stringify(lines)).not.toContain("sk-live-do-not-log");
    expect(states(await h.get()), "a fresh failed row is none").toEqual(["none"]);
  }
}

export async function aProviderThatNeverAnswersTimesOutAt15Seconds(): Promise<void> {
  vi.useFakeTimers({ now: NOW });
  try {
    for (const step of ["never", "hang"] as const) {
      const h = harness({ provider: new ScriptedProvider([step]) });
      expect(states(await h.get())).toEqual(["pending"]);
      await vi.advanceTimersByTimeAsync(FINDINGS_CALL_TIMEOUT_MS - 1);
      expect(h.memory.rows, `${step}: nothing is stored before 15 s`).toHaveLength(0);
      expect(h.provider.signals[0]!.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await h.service.settled();
      expect(h.provider.signals[0]!.aborted, `${step}: the signal aborts at 15 s`).toBe(true);
      expect(h.memory.rows.map((r) => [r.status, r.reason])).toEqual([["failed", "timeout"]]);
    }
  } finally {
    vi.useRealTimers();
  }
}

export async function theGatesAnswerNoneWithNoCallAndNoRow(): Promise<void> {
  const off = harness({ switchOn: () => false });
  expect(states(await off.get())).toEqual(["none"]);
  const guided = harness({ resolved: "guided" });
  expect(states(await guided.get())).toEqual(["none"]);
  const capped = harness();
  capped.memory.plant({
    organizationId: fxbAnomalyCard().organizationId,
    kind: "forecasts",
    factsHash: "f".repeat(64),
    status: "failed",
    reason: "timeout",
    attempts: FINDINGS_DAILY_ATTEMPT_CAP,
  });
  expect(states(await capped.get())).toEqual(["none"]);
  for (const h of [off, guided, capped]) {
    await h.service.settled();
    expect(h.provider.calls, "the provider is never called").toBe(0);
    expect(h.memory.writes, "no row is written").toHaveLength(0);
  }
  expect(off.resolvedFor, "the switch is read before the resolver").toEqual([]);
  // One under the cap still calls; yesterday's attempts do not count.
  const under = harness();
  under.memory.plant({
    organizationId: fxbAnomalyCard().organizationId,
    kind: "forecasts",
    factsHash: "f".repeat(64),
    status: "failed",
    reason: "timeout",
    attempts: FINDINGS_DAILY_ATTEMPT_CAP - 1,
  });
  under.memory.plant({
    organizationId: fxbAnomalyCard().organizationId,
    kind: "forecasts",
    factsHash: "e".repeat(64),
    status: "failed",
    reason: "timeout",
    attempts: FINDINGS_DAILY_ATTEMPT_CAP,
    createdAt: new Date(startOfUtcDay(NOW).getTime() - 1),
  });
  expect(states(await under.get())).toEqual(["pending"]);
  expect(under.provider.calls).toBe(1);
}

export async function aFailedRowIsRetriedOnlyAfter30Minutes(): Promise<void> {
  const card = fxbAnomalyCard();
  const plantFailed = (h: ReturnType<typeof harness>, ageMinutes: number) =>
    h.memory.plant({
      organizationId: card.organizationId,
      kind: "anomalies",
      factsHash: hashOf("anomalies", card),
      status: "failed",
      reason: "timeout",
      attempts: 3,
      createdAt: new Date(NOW.getTime() - ageMinutes * MINUTE_MS),
    });
  const young = harness({ provider: new ScriptedProvider([{ kind: "final", text: GOOD }]) });
  plantFailed(young, 29);
  expect(states(await young.get())).toEqual(["none"]);
  expect(young.provider.calls).toBe(0);
  const old = harness({ provider: new ScriptedProvider([{ kind: "final", text: GOOD }]) });
  plantFailed(old, 31);
  expect(states(await old.get())).toEqual(["pending"]);
  await old.service.settled();
  expect(old.provider.calls).toBe(1);
  expect(old.memory.writes[0]?.retryOf?.attempts).toBe(3);
  // attempts + 1 on the same UTC day (Q3 (a)); a run in the half hour after 00:00 UTC starts again at 1.
  const sameDay = startOfUtcDay(new Date(NOW.getTime() - 31 * MINUTE_MS)).getTime() === startOfUtcDay(new Date()).getTime();
  expect(old.memory.rows.map((r) => [r.status, r.attempts])).toEqual([["ok", sameDay ? 4 : 1]]);
}

export async function oneKeyMakesOneCallWhileItHangs(): Promise<void> {
  const h = harness();
  const [a, b] = await Promise.all([h.get(), h.get()]);
  const c = await h.get();
  expect([...states(a), ...states(b), ...states(c)]).toEqual(["pending", "pending", "pending"]);
  expect(h.provider.calls, "one complete call for one key").toBe(1);
  h.provider.release();
  await h.service.settled();
}

export async function aFifthKeyWithFourInFlightIsPendingWithNoCall(): Promise<void> {
  const ids = [1, 2, 3, 4, 5].map((n) => `0f0f0f0f-0000-4000-8000-${n.toString(16).padStart(12, "0")}`);
  const h = harness({ cards: ids.map(cardFor) });
  expect(states(await h.get())).toEqual(["pending", "pending", "pending", "pending", "pending"]);
  expect(h.provider.calls, "four calls in flight, the fifth waits").toBe(4);
  h.provider.release();
  await h.service.settled();
  // With the slots free, a later request starts the fifth.
  await h.get();
  expect(h.provider.calls).toBe(5);
  h.provider.release();
  await h.service.settled();
}

export async function twoOrganizationsMakeTwoCallsEachWithItsOwnFacts(): Promise<void> {
  const fxa = fxaAnomalyCard();
  const fxb = fxbAnomalyCard();
  const h = harness({ cards: [fxa, fxb] });
  await h.get(null);
  expect(h.provider.calls).toBe(2);
  const prompts = h.provider.seen.map((input) => JSON.stringify(input.messages));
  expect(prompts[0]).toContain("21 unusual hours in the last 7 days");
  expect(prompts[0]).not.toContain("6 unusual hours in the last 7 days");
  expect(prompts[1]).toContain("6 unusual hours in the last 7 days");
  expect(prompts[1]).not.toContain("21 unusual hours in the last 7 days");
  expect(h.resolvedFor).toEqual([fxa.organizationId, fxb.organizationId]);
  expect(h.switchCalls).toEqual([fxa.organizationId, fxb.organizationId]);
  h.provider.release({ kind: "final", text: "[A1] x." });
  await h.service.settled();
  expect(h.memory.rows.map((r) => r.organizationId).sort()).toEqual([fxa.organizationId, fxb.organizationId].sort());
  expect(h.memory.wrongTenant, "each row is read and written under its card's organization").toEqual([]);
  expect(h.factsCalls, "narrow's value reaches the facts service unchanged").toEqual([{ kind: "anomalies", assetIds: null }]);
}

export async function aCardWithNothingToSayIsNoneWithNoCall(): Promise<void> {
  const h = harness({ kind: "forecasts", cards: [fxbForecastCard()] });
  expect(states(await h.get())).toEqual(["none"]);
  expect(h.provider.calls).toBe(0);
  expect(h.switchCalls).toEqual([]);
}

export async function theCallSendsNoToolsTwoMessagesAndNoName(): Promise<void> {
  const h = harness({ cards: [fxaAnomalyCard(), fxbAnomalyCard()] });
  await h.get();
  for (const input of h.provider.seen) {
    expect(input.tools).toEqual([]);
    expect(input.maxOutputTokens).toBe(FINDINGS_MAX_OUTPUT_TOKENS);
    expect(input.messages.map((m) => m.role)).toEqual(["system", "user"]);
    const text = JSON.stringify(input.messages);
    for (const secret of fixtureSecrets()) expect(text, secret).not.toContain(secret);
    expect(text).not.toMatch(UUID_TEXT);
  }
  h.provider.release();
  await h.service.settled();
}

export async function theLogLineHoldsTheReasonKindAndOrganizationOnly(): Promise<void> {
  const h = harness({ provider: new ScriptedProvider([{ kind: "final", text: "[A1] had 99 unusual hours." }]) });
  const lines = await logsOf(async () => {
    await h.get();
    await h.service.settled();
  });
  expect(lines).toHaveLength(1);
  const [meta, message] = lines[0] as [Record<string, unknown>, string];
  expect(Object.keys(meta).sort()).toEqual(["kind", "organizationId", "reason"]);
  expect(meta).toEqual({ organizationId: fxbAnomalyCard().organizationId, kind: "anomalies", reason: "number_not_in_facts" });
  expect(message).toBe("ml findings paragraph outcome");
  const all = JSON.stringify(lines);
  expect(all).not.toContain("99 unusual hours");
  expect(all).not.toContain("unusual hours in the last 7 days");
}

export async function aStoreFailureNeverReachesTheRequest(): Promise<void> {
  const h = harness({ provider: new ScriptedProvider([{ kind: "final", text: GOOD }]) });
  h.service.store = {
    ...h.memory.store,
    writeOutcome: async () => {
      throw new Error(`database said ${SECRET_MESSAGE}`);
    },
  };
  const lines = await logsOf(async () => {
    expect(states(await h.get())).toEqual(["pending"]);
    await h.service.settled();
  });
  expect(JSON.stringify(lines)).not.toContain("sk-live-do-not-log");
  expect(lines).toHaveLength(1);
}
