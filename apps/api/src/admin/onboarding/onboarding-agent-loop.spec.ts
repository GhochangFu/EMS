import type { OnboardingChatMessage, OnboardingDraft } from "@bms/shared";

import {
  MAX_HISTORY_MESSAGE_CHARS,
  MAX_HISTORY_MESSAGES,
  MAX_TOOL_CALLS_PER_TURN,
  STOPPED_EARLY_CALLS_REPLY,
  STOPPED_EARLY_TIME_REPLY,
  TURN_DEADLINE_MS,
  runAgentTurn,
} from "./onboarding-agent-loop";
import { TOOL_RESULT_MAX_CHARS, type ToolContext } from "./onboarding-agent-tools";
import type { LlmMessage, LlmReply, LlmToolCall, OnboardingLlmProvider } from "./onboarding-llm-port";
import { OnboardingValidateService } from "./onboarding-validate.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * A scripted provider: each `complete` takes the next reply. `"reject"` throws
 * as an SDK rejection would; `"hang"` waits until the turn's signal fires and
 * then rejects, as the SDKs do on abort. Every `messages` array is recorded.
 */
export class FakeLlmProvider implements OnboardingLlmProvider {
  readonly name = "openrouter" as const;
  readonly seen: LlmMessage[][] = [];

  constructor(private readonly script: (LlmReply | "reject" | "hang")[]) {}

  get calls(): number {
    return this.seen.length;
  }

  async complete(input: { messages: readonly LlmMessage[]; signal: AbortSignal }): Promise<LlmReply> {
    this.seen.push(JSON.parse(JSON.stringify(input.messages)) as LlmMessage[]);
    const next = this.script.shift() ?? { kind: "final", text: "done" };
    if (next === "reject") {
      throw new Error("503 upstream unavailable");
    }
    if (next === "hang") {
      return new Promise((_, reject) => {
        input.signal.addEventListener("abort", () => reject(new Error("Request was aborted.")), { once: true });
      });
    }
    return next;
  }
}

let callId = 0;
export function toolCall(name: string, args: unknown): LlmToolCall {
  callId += 1;
  return { id: `call_${callId}`, name, arguments: JSON.stringify(args) };
}

export function calls(...list: LlmToolCall[]): LlmReply {
  return { kind: "tool_calls", calls: list, content: null };
}

export const PLAIN_RTU = { code: "RTU-1", displayName: "RTU-1", protocol: "mqtt" as const, config: { host: "broker", port: 8883, tls: true, topic: "a/b" } };

export function toolContext(): ToolContext {
  return {
    organizationId: "org-1",
    activeTypes: [{ code: "smoc_campus", label: "SMOC campus" }],
    catalog: { listPointKeys: async () => [] },
    protocols: { getContextForOrganization: async () => ({ catalog: [], orgExamples: [] }), formatForAssistant: () => "MQTT" },
    validator: new OnboardingValidateService(),
  };
}

export function readyDraft(): OnboardingDraft {
  return {
    location: { name: "Berhampur", slug: "berhampur", code: "BERHAMPUR", latitude: 20.1, longitude: 85.1, type: "smoc_campus" },
    rtus: [{ ...PLAIN_RTU, credentialsSet: false, ingestEnabled: false }],
    pointKeys: [{ code: "kw", name: "Active Power", domain: "electrical", unit: "kW" }],
    assets: [{ rtuIndex: 0, code: "BERHAMPUR-ASSET-1", name: "Meter", siteName: "Berhampur", domain: "electrical" }],
    assetPoints: [{ assetIndex: 0, pointKey: "kw", sourceDataKey: "s01", unit: "kW" }],
  } as OnboardingDraft;
}

function turn(llm: FakeLlmProvider, extra: { draft?: OnboardingDraft; history?: OnboardingChatMessage[]; message?: string } = {}) {
  return {
    message: extra.message ?? "add an MQTT RTU",
    draft: extra.draft ?? {},
    phase: "rtu" as const,
    orgName: "Ion Exchange",
    history: extra.history ?? [],
    llm,
    tools: toolContext(),
  };
}

function stored(role: OnboardingChatMessage["role"], content: string, i: number): OnboardingChatMessage {
  return { id: `m${i}`, role, content, createdAt: "2026-10-03T00:00:00.000Z" };
}

export async function assertAFinalReplyWithNoToolsEndsTheTurn(): Promise<void> {
  const llm = new FakeLlmProvider([{ kind: "final", text: "Which location?" }]);
  const result = await runAgentTurn(turn(llm));
  assert(result.stopReason === "final" && result.reply === "Which location?", "a final reply ends the turn");
  assert(llm.calls === 1, "one provider call");
  assert(Object.keys(result.draftPatch).length === 0 && result.actionLines.length === 0, "no edits");
}

export async function assertToolCallsAreRunAndResultsReturnedToTheModel(): Promise<void> {
  const call = toolCall("add_rtu", PLAIN_RTU);
  const llm = new FakeLlmProvider([calls(call), { kind: "final", text: "Added." }]);
  const result = await runAgentTurn(turn(llm));
  const second = llm.seen[1] ?? [];
  const assistant = second[second.length - 2] as { role: string; toolCalls?: LlmToolCall[] };
  const tool = second[second.length - 1] as { role: string; toolCallId?: string; content?: string; isError?: boolean };
  assert(assistant.role === "assistant" && assistant.toolCalls?.[0]?.id === call.id, "the assistant's tool call is replayed");
  assert(tool.role === "tool" && tool.toolCallId === call.id && tool.isError === false, "the result answers that call id");
  assert((JSON.parse(tool.content ?? "{}") as { ok: boolean }).ok === true, "the result is ok");
  assert(result.draftPatch.rtus?.length === 1, "the RTU is in the patch");
  assert(result.actionLines.length === 1 && result.actionLines[0] === "Added RTU RTU-1 (mqtt)", "one action line");
}

export async function assertAToolErrorGoesBackAsAResultNotAThrow(): Promise<void> {
  const llm = new FakeLlmProvider([
    calls(toolCall("add_rtu", { ...PLAIN_RTU, config: { password: "x" } })),
    { kind: "final", text: "I cannot store credentials here." },
  ]);
  const result = await runAgentTurn(turn(llm));
  const tool = llm.seen[1]?.at(-1) as { role: string; isError?: boolean; content?: string };
  assert(tool.role === "tool" && tool.isError === true, "the refused call goes back as an error result");
  assert((JSON.parse(tool.content ?? "{}") as { ok: boolean }).ok === false, "with ok false");
  assert(result.stopReason === "final" && result.actionLines.length === 0, "the loop carries on to the final reply");
}

/** Eight single-call replies, then a ninth: exactly eight tool runs. */
export async function assertTheNinthToolCallIsNotMade(): Promise<void> {
  const script: LlmReply[] = Array.from({ length: 9 }, (_, i) =>
    calls(toolCall("add_point_key", { code: `key_${i}`, name: `Key ${i}` })),
  );
  const llm = new FakeLlmProvider(script);
  const result = await runAgentTurn(turn(llm));
  assert(result.record.toolCalls === 8, `exactly eight tool calls run, got ${result.record.toolCalls}`);
}

export async function assertTheCallCapStopsWithItsReplyAndKeepsTheEdits(): Promise<void> {
  const script: LlmReply[] = Array.from({ length: 9 }, (_, i) =>
    calls(toolCall("add_point_key", { code: `key_${i}`, name: `Key ${i}` })),
  );
  const llm = new FakeLlmProvider(script);
  const result = await runAgentTurn(turn(llm));
  assert(result.stopReason === "cap_calls" && result.reply === STOPPED_EARLY_CALLS_REPLY, "the cap stops the turn");
  assert(result.draftPatch.pointKeys?.length === 8 && result.actionLines.length === 8, "the eight edits are kept");
  assert(llm.calls === 9, `the provider is called nine times, got ${llm.calls}`);
}

export async function assertTheDeadlineKeepsCompletedEdits(): Promise<void> {
  const llm = new FakeLlmProvider([calls(toolCall("add_rtu", PLAIN_RTU)), "hang"]);
  const result = await runAgentTurn(turn(llm), { deadlineMs: 20 });
  assert(result.stopReason === "cap_time" && result.reply === STOPPED_EARLY_TIME_REPLY, "the deadline stops the turn");
  assert(result.draftPatch.rtus?.length === 1 && result.actionLines.length === 1, "the completed edit is kept");
  assert(result.fallback === false, "the guided mode does not run");
}

export async function assertAProviderRejectionDiscardsTheTurn(): Promise<void> {
  const llm = new FakeLlmProvider([calls(toolCall("add_rtu", PLAIN_RTU)), "reject"]);
  const result = await runAgentTurn(turn(llm));
  assert(result.stopReason === "provider_error" && result.fallback === true, "a rejection is a provider error with fallback");
  assert(Object.keys(result.draftPatch).length === 0 && result.actionLines.length === 0, "every edit of the turn is discarded");
}

export async function assertHistoryIsTheLastTwentyCutToTwoThousand(): Promise<void> {
  const long = `${"x".repeat(MAX_HISTORY_MESSAGE_CHARS - 1)}${String.fromCharCode(0xd83d, 0xde00)}tail`;
  const history = Array.from({ length: 25 }, (_, i) => stored("user", i === 24 ? long : `${i}:${"y".repeat(3_000)}`, i));
  const llm = new FakeLlmProvider([{ kind: "final", text: "ok" }]);
  await runAgentTurn(turn(llm, { history }));
  const sent = llm.seen[0] ?? [];
  assert(sent.length === 1 + 20 + 1, `system + 20 history + the turn, got ${sent.length}`);
  const historyPart = sent.slice(1, -1) as { content: string }[];
  assert(historyPart[0].content.startsWith("5:"), "the oldest kept message is the sixth stored one");
  assert(historyPart.slice(0, -1).every((m) => m.content.length === MAX_HISTORY_MESSAGE_CHARS), "each is cut to 2,000");
  const last = historyPart[historyPart.length - 1].content;
  assert(last.length === MAX_HISTORY_MESSAGE_CHARS - 1, "a cut never splits a surrogate pair");
}

export async function assertActionMessagesReachTheModelAsAssistantText(): Promise<void> {
  const history = [
    stored("system", "internal", 0),
    stored("assistant", "Welcome", 1),
    stored("user", "add RTU", 2),
    stored("action", "Added RTU RTU-1 (mqtt)", 3),
  ];
  const llm = new FakeLlmProvider([{ kind: "final", text: "ok" }]);
  await runAgentTurn(turn(llm, { history }));
  const sent = (llm.seen[0] ?? []) as { role: string; content: string }[];
  assert(!sent.slice(1).some((m) => m.content === "internal"), "a stored system row is not sent");
  assert(sent[1].role === "user" && sent[1].content === "add RTU", "a leading assistant turn is dropped; history starts with the user");
  assert(sent[2].role === "assistant" && sent[2].content === "Added RTU RTU-1 (mqtt)", "an action row goes as assistant text");
}

export async function assertHistoryCarriesNoProviderContent(): Promise<void> {
  const history = [stored("user", "hi", 0), stored("assistant", "hello", 1)];
  const llm = new FakeLlmProvider([{ kind: "final", text: "ok" }]);
  await runAgentTurn(turn(llm, { history }));
  assert(!(llm.seen[0] ?? []).some((m) => "providerContent" in m || "toolCalls" in m), "history is plain text");
}

export async function assertProviderContentIsKeptOnTheInTurnAssistantMessage(): Promise<void> {
  const providerContent = [{ type: "thinking", thinking: "", signature: "s" }];
  const llm = new FakeLlmProvider([
    { kind: "tool_calls", calls: [toolCall("get_draft", {})], content: null, providerContent },
    { kind: "final", text: "ok" },
  ]);
  await runAgentTurn(turn(llm));
  const assistant = (llm.seen[1] ?? []).find((m) => "toolCalls" in m) as { providerContent?: unknown } | undefined;
  assert(JSON.stringify(assistant?.providerContent) === JSON.stringify(providerContent), "the in-turn assistant keeps its content");
}

export async function assertALaterWriteDropsThePendingProposal(): Promise<void> {
  const proposeThenWrite = new FakeLlmProvider([
    calls(toolCall("propose_commit", {})),
    calls(toolCall("add_point_key", { code: "kvar", name: "Reactive" })),
    { kind: "final", text: "ok" },
  ]);
  const dropped = await runAgentTurn(turn(proposeThenWrite, { draft: readyDraft() }));
  assert(dropped.commitProposal === undefined, "a write after the proposal drops it");
  const writeThenPropose = new FakeLlmProvider([
    calls(toolCall("add_point_key", { code: "kvar", name: "Reactive" })),
    calls(toolCall("propose_commit", {})),
    { kind: "final", text: "ok" },
  ]);
  const kept = await runAgentTurn(turn(writeThenPropose, { draft: readyDraft() }));
  assert(kept.commitProposal !== undefined, "a proposal after the last write stands");
}

export async function assertTheTurnRecordIsTextFree(): Promise<void> {
  const secretish = "user-message-text-xyz";
  const llm = new FakeLlmProvider([calls(toolCall("add_point_key", { code: "kw", name: "argument-text-abc" })), { kind: "final", text: "ok" }]);
  const result = await runAgentTurn(turn(llm, { message: secretish }));
  const keys = Object.keys(result.record).sort().join(",");
  assert(keys === "durationMs,stopReason,toolCalls,tools", `the record has exactly four keys: ${keys}`);
  const text = JSON.stringify(result.record);
  assert(!text.includes(secretish) && !text.includes("argument-text-abc"), "no message or argument text");
  assert(JSON.stringify(result.record.tools) === '["add_point_key"]', "tool names only");
}

export function assertCapsArePinned(): void {
  assert(MAX_TOOL_CALLS_PER_TURN === 8, "8 tool calls per turn");
  assert(TURN_DEADLINE_MS === 45_000, "45 s per turn");
  assert(MAX_HISTORY_MESSAGES === 20, "20 history messages");
  assert(MAX_HISTORY_MESSAGE_CHARS === 2_000, "2,000 characters per history message");
  assert(TOOL_RESULT_MAX_CHARS === 8_000, "8,000 characters per tool result");
}

/** Security review L3: a tool name the model made up never reaches the log record. */
export async function assertAnUnknownToolNameIsRecordedAsUnknown(): Promise<void> {
  const made = "drop_database_and_then_some_long_text";
  const llm = new FakeLlmProvider([calls(toolCall(made, {})), { kind: "final", text: "ok" }]);
  const result = await runAgentTurn(turn(llm));
  assert(JSON.stringify(result.record.tools) === '["unknown"]', `got ${JSON.stringify(result.record.tools)}`);
  assert(!JSON.stringify(result.record).includes(made), "the made-up name is not in the record");
}

/** Code review #5: a provider error records its class and status, never its message. */
export async function assertAProviderErrorRecordsItsClassAndStatus(): Promise<void> {
  class AuthenticationError extends Error {
    readonly status = 401;
  }
  const llm: OnboardingLlmProvider = {
    name: "openrouter",
    complete: async () => {
      throw new AuthenticationError("401 bad key sk-or-secret-1234");
    },
  };
  const result = await runAgentTurn({ ...turn(new FakeLlmProvider([])), llm });
  assert(result.record.errorClass === "AuthenticationError" && result.record.errorStatus === 401, "class and status");
  assert(!JSON.stringify(result.record).includes("sk-or-secret"), "never the message");
}
