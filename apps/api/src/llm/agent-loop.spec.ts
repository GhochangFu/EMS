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

  constructor(private readonly script: (LlmReply | "reject" | "hang")[]) {}

  async complete(input: { messages: readonly LlmMessage[]; signal: AbortSignal }): Promise<LlmReply> {
    this.calls += 1;
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

/** A loop with one known tool name; every call succeeds with an action line naming its id. */
function harness(): Harness {
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

// the constants ----------------------------------------------------------------

export function assertTheCapsArePinned(): void {
  assert(MAX_TOOL_CALLS_PER_TURN === 8, "8 tool calls per turn");
  assert(TURN_DEADLINE_MS === 45_000, "45 s per turn");
}
