import { errorFacts, MAX_TOOL_CALLS_PER_TURN, runAgentLoop, TURN_DEADLINE_MS, type AgentLoopResult } from "./agent-loop";
import type { LlmMessage, LlmProvider, LlmReply, LlmToolCall } from "./llm-port";
import type { ToolOutcome } from "./tool-result";

/**
 * The generic agent loop (`F3.85`, ADR 0099). Every case drives it with a
 * scripted provider and a recording `runTool`; nothing here knows onboarding.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** A provider error as the SDKs raise one: a class name, an HTTP status, and a message that must never be recorded. */
class FakeHttpError extends Error {
  readonly status = 503;
}

const SECRET_MESSAGE = "upstream said sk-live-do-not-log";

/**
 * Each `complete` takes the next script step. `"reject"` throws a
 * `FakeHttpError`; `"hang"` waits until the turn's own signal fires and then
 * rejects, as the SDKs do on abort — so the deadline is met **inside** a
 * provider call and reaches the loop's `catch`, never its loop-top check.
 */
class ScriptedProvider implements LlmProvider {
  readonly name = "openrouter" as const;
  calls = 0;
  /** `F4.295`: the messages each call was sent, copied. */
  readonly seen: LlmMessage[][] = [];

  constructor(private readonly script: (LlmReply | "reject" | "hang")[]) {}

  async complete(input: { messages: readonly LlmMessage[]; signal: AbortSignal }): Promise<LlmReply> {
    this.calls += 1;
    this.seen.push(JSON.parse(JSON.stringify(input.messages)) as LlmMessage[]);
    const next = this.script.shift() ?? { kind: "final", text: "default final" };
    if (next === "reject") {
      throw new FakeHttpError(SECRET_MESSAGE);
    }
    if (next === "hang") {
      return new Promise((_, reject) => {
        input.signal.addEventListener("abort", () => reject(new Error("Request was aborted.")), { once: true });
      });
    }
    return next;
  }
}

let nextId = 0;
function call(name: string): LlmToolCall {
  nextId += 1;
  return { id: `call_${nextId}`, name, arguments: "{}" };
}

function toolCalls(...list: LlmToolCall[]): LlmReply {
  return { kind: "tool_calls", calls: list, content: null };
}

const KNOWN = "known_tool";

type Harness = { readonly ran: string[]; run(llm: LlmProvider, deadlineMs?: number): Promise<AgentLoopResult> };

/**
 * A loop with one known tool name; every call succeeds with an action line
 * naming its id. `firstToolDelayMs` makes the first tool call slow, so the
 * deadline fires while a tool runs and not inside a provider call.
 */
function harness(firstToolDelayMs = 0): Harness {
  const ran: string[] = [];
  return {
    ran,
    run: (llm, deadlineMs) =>
      runAgentLoop(
        {
          messages: [{ role: "user", content: "go" }],
          tools: { definitions: [], isToolName: (name) => name === KNOWN },
          runTool: async (c): Promise<ToolOutcome> => {
            ran.push(c.id);
            if (ran.length === 1 && firstToolDelayMs > 0) {
              await new Promise((resolve) => setTimeout(resolve, firstToolDelayMs));
            }
            return { ok: true, content: "{\"ok\":true}", actionLine: `did ${c.id}` };
          },
          llm,
        },
        deadlineMs === undefined ? {} : { deadlineMs },
      ),
  };
}

/** Nine calls in one reply: one more than the cap. */
function nineCalls(): LlmReply {
  return toolCalls(...Array.from({ length: MAX_TOOL_CALLS_PER_TURN + 1 }, () => call(KNOWN)));
}

// (1) a final reply ------------------------------------------------------------

export async function assertAFinalReplyStopsWithFinalAndNoCalls(): Promise<void> {
  const result = await harness().run(new ScriptedProvider([{ kind: "final", text: "  all set  " }]));
  assert(result.stopReason === "final", `stopReason is final: ${result.stopReason}`);
  assert(result.record.toolCalls === 0, `no tool calls recorded: ${result.record.toolCalls}`);
  assert(result.reply === "all set", `the reply is the trimmed text: ${JSON.stringify(result.reply)}`);
}

// (2) the call cap -------------------------------------------------------------

export async function assertTheNinthCallStopsWithCapCalls(): Promise<void> {
  const result = await harness().run(new ScriptedProvider([nineCalls()]));
  assert(result.stopReason === "cap_calls", `the ninth call stops the turn with cap_calls: ${result.stopReason}`);
}

export async function assertTheCapRecordsEightNamesAndRunsEightCalls(): Promise<void> {
  const h = harness();
  const result = await h.run(new ScriptedProvider([nineCalls()]));
  assert(result.record.tools.length === MAX_TOOL_CALLS_PER_TURN, `eight names recorded: ${result.record.tools.length}`);
  assert(h.ran.length === MAX_TOOL_CALLS_PER_TURN, `eight calls run, the ninth not made: ${h.ran.length}`);
}

// (3) the deadline, met inside a provider call ---------------------------------

export async function assertADeadlineInsideAProviderCallIsCapTime(): Promise<void> {
  const provider = new ScriptedProvider([toolCalls(call(KNOWN)), "hang"]);
  const result = await harness().run(provider, 30);
  assert(provider.calls === 2, `the deadline fired during the second provider call: ${provider.calls} calls`);
  assert(result.stopReason === "cap_time", `an abort rejection in the catch is cap_time, not provider_error: ${result.stopReason}`);
}

export async function assertCapTimeKeepsTheCompletedActionLines(): Promise<void> {
  const h = harness();
  const result = await h.run(new ScriptedProvider([toolCalls(call(KNOWN)), "hang"]), 30);
  assert(
    result.actionLines.length === 1 && result.actionLines[0] === `did ${h.ran[0]}`,
    `the first tool's action line is kept: ${JSON.stringify(result.actionLines)}`,
  );
}

// (3b) the deadline, met while a tool runs ---------------------------------------

/**
 * Gates the per-call check: the deadline fires during the first of two calls in
 * one reply, so the second call must not run. Without the check the second
 * call runs and the loop-top check stops the turn one call too late.
 */
export async function assertADeadlineDuringAToolSkipsTheNextCallInTheReply(): Promise<void> {
  const h = harness(40);
  const provider = new ScriptedProvider([toolCalls(call(KNOWN), call(KNOWN))]);
  const result = await h.run(provider, 20);
  assert(result.stopReason === "cap_time", `a deadline during a tool is cap_time: ${result.stopReason}`);
  assert(h.ran.length === 1, `the second call in the reply is not run: ${h.ran.length} ran`);
  assert(provider.calls === 1, `no further provider call is made: ${provider.calls} calls`);
}

/**
 * Gates the loop-top check: the deadline fires during the last call of a round,
 * and the provider would answer the next round at once (it ignores the signal).
 * The loop must stop with cap_time before it calls the provider again.
 */
export async function assertADeadlineDuringTheLastToolOfARoundMakesNoFurtherProviderCall(): Promise<void> {
  const h = harness(40);
  const provider = new ScriptedProvider([toolCalls(call(KNOWN)), { kind: "final", text: "late final" }]);
  const result = await h.run(provider, 20);
  assert(provider.calls === 1, `no provider call after the deadline: ${provider.calls} calls`);
  assert(result.stopReason === "cap_time", `the round's end after the deadline is cap_time: ${result.stopReason}`);
}

// (4) a provider error ---------------------------------------------------------

export async function assertAProviderErrorRecordsClassAndStatus(): Promise<void> {
  const result = await harness().run(new ScriptedProvider(["reject"]));
  assert(result.stopReason === "provider_error", `a thrown provider error is provider_error: ${result.stopReason}`);
  assert(result.record.errorClass === "FakeHttpError", `the class name is recorded: ${result.record.errorClass}`);
  assert(result.record.errorStatus === 503, `the HTTP status is recorded: ${result.record.errorStatus}`);
}

export async function assertAProviderErrorRecordsNoMessageText(): Promise<void> {
  const result = await harness().run(new ScriptedProvider(["reject"]));
  const text = JSON.stringify(result.record);
  assert(!text.includes("sk-live"), `the record carries no message text: ${text}`);
}

export function assertErrorFactsHoldsOnlyClassAndStatus(): void {
  const keys = Object.keys(errorFacts(new FakeHttpError(SECRET_MESSAGE))).sort().join(",");
  assert(keys === "errorClass,errorStatus", `errorFacts names class and status only: ${keys}`);
}

// (5) a made-up tool name ------------------------------------------------------

export async function assertAMadeUpNameIsRecordedAsUnknown(): Promise<void> {
  const result = await harness().run(new ScriptedProvider([toolCalls(call("drop_all_tables"), call(KNOWN))]));
  assert(
    JSON.stringify(result.record.tools) === JSON.stringify(["unknown", KNOWN]),
    `a made-up name is recorded as unknown, a known one by name: ${JSON.stringify(result.record.tools)}`,
  );
}

// (6) `F4.295`: the one correction of a final text -----------------------------

const CORRECTION = "[check] call the tool";

/** A loop whose `correctFinal` answers `answer` for every text it is asked about, and records each text. */
function correctedRun(llm: LlmProvider, answer: string | null, deadlineMs?: number): { asked: string[]; result: Promise<AgentLoopResult> } {
  const asked: string[] = [];
  const result = runAgentLoop({
    messages: [{ role: "user", content: "go" }],
    tools: { definitions: [], isToolName: (name) => name === KNOWN },
    runTool: async (): Promise<ToolOutcome> => ({ ok: true, content: "{\"ok\":true}" }),
    llm,
    correctFinal: (text) => {
      asked.push(text);
      return answer;
    },
  }, deadlineMs === undefined ? {} : { deadlineMs });
  return { asked, result };
}

/** One corrected turn: a first final text, sent back, and a second one. */
async function oneCorrection(): Promise<{ llm: ScriptedProvider; result: AgentLoopResult }> {
  const llm = new ScriptedProvider([{ kind: "final", text: " first " }, { kind: "final", text: "second" }]);
  return { llm, result: await correctedRun(llm, CORRECTION).result };
}

export async function assertACorrectionAsksTheModelAgain(): Promise<void> {
  const { llm } = await oneCorrection();
  assert(llm.calls === 2, `the model is asked again: ${llm.calls} calls`);
}

export async function assertACorrectionSendsTheTextAndTheMessageBack(): Promise<void> {
  const { llm } = await oneCorrection();
  const tail = JSON.stringify(llm.seen[1]?.slice(-2));
  const expected = JSON.stringify([
    { role: "assistant", content: "first" },
    { role: "user", content: CORRECTION },
  ]);
  assert(tail === expected, `the second call ends with the first text and the correction: ${tail}`);
}

export async function assertTheSecondTextIsTheReply(): Promise<void> {
  const { result } = await oneCorrection();
  assert(result.reply === "second", `the reply is the second text, never the first: ${JSON.stringify(result.reply)}`);
}

export async function assertTheRecordSaysTheCorrectionRan(): Promise<void> {
  const { result } = await oneCorrection();
  assert(result.record.corrected === true, `the record says the correction ran: ${JSON.stringify(result.record)}`);
}

export async function assertACorrectionRunsOnceATurn(): Promise<void> {
  const llm = new ScriptedProvider([
    { kind: "final", text: "first" },
    { kind: "final", text: "second" },
    { kind: "final", text: "third" },
  ]);
  const run = correctedRun(llm, CORRECTION);
  const result = await run.result;
  assert(llm.calls === 2, `one correction only: ${llm.calls} calls`);
  assert(JSON.stringify(run.asked) === JSON.stringify(["first"]), `asked once: ${JSON.stringify(run.asked)}`);
  assert(result.stopReason === "final" && result.reply === "second", `the second text is the reply: ${result.reply}`);
}

export async function assertANullCorrectionAcceptsTheText(): Promise<void> {
  const llm = new ScriptedProvider([{ kind: "final", text: "only" }]);
  const result = await correctedRun(llm, null).result;
  assert(llm.calls === 1, `no second call: ${llm.calls}`);
  assert(result.reply === "only", `the text is the reply: ${result.reply}`);
  assert(!("corrected" in result.record), `no corrected key: ${JSON.stringify(result.record)}`);
}

/** A deadline after the correction ends the turn final with the first text, and the record names the stop. */
export async function assertADeadlineAfterACorrectionFallsBackToTheFirstText(): Promise<void> {
  const result = await correctedRun(new ScriptedProvider([{ kind: "final", text: "first" }, "hang"]), CORRECTION, 50).result;
  const got = JSON.stringify([result.stopReason, result.reply, result.record.stopReason, result.record.correctionFailed]);
  assert(got === JSON.stringify(["final", "first", "final", "cap_time"]), `the first text is the reply: ${got}`);
}

/** A provider error after the correction ends the turn final with the first text, and the record names the stop. */
export async function assertAProviderErrorAfterACorrectionFallsBackToTheFirstText(): Promise<void> {
  const result = await correctedRun(new ScriptedProvider([{ kind: "final", text: "first" }, "reject"]), CORRECTION).result;
  const got = JSON.stringify([result.stopReason, result.reply, result.record.correctionFailed]);
  assert(got === JSON.stringify(["final", "first", "provider_error"]), `the first text is the reply: ${got}`);
}

/** A turn with no correction never names a correction stop. */
export async function assertACapWithNoCorrectionStaysACap(): Promise<void> {
  const result = await correctedRun(new ScriptedProvider(["reject"]), CORRECTION).result;
  const got = JSON.stringify([result.stopReason, result.reply, "correctionFailed" in result.record]);
  assert(got === JSON.stringify(["provider_error", "", false]), `a plain failure is unchanged: ${got}`);
}

/** The correction shares the turn's call cap: tools after it still count against the same eight, and the cap falls back. */
export async function assertACorrectionSharesTheCallCap(): Promise<void> {
  const seven = toolCalls(...Array.from({ length: 7 }, () => call(KNOWN)));
  const llm = new ScriptedProvider([seven, { kind: "final", text: "first" }, toolCalls(call(KNOWN), call(KNOWN))]);
  const result = await correctedRun(llm, CORRECTION).result;
  assert(result.record.correctionFailed === "cap_calls", `the ninth call after the correction is the cap: ${JSON.stringify(result.record)}`);
}

// the constants ----------------------------------------------------------------

export function assertTheCapsArePinned(): void {
  assert(MAX_TOOL_CALLS_PER_TURN === 8, "8 tool calls per turn");
  assert(TURN_DEADLINE_MS === 45_000, "45 s per turn");
}
