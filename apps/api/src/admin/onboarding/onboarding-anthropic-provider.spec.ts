import { ANTHROPIC_FALLBACK_BETA, AnthropicProvider } from "./onboarding-anthropic-provider";
import { LlmProviderError, type LlmMessage, type LlmToolDefinition } from "./onboarding-llm-port";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** What the `.test.ts` wrapper's `vi.mock("@anthropic-ai/sdk")` records. */
export type AnthropicCapture = {
  constructed: Record<string, unknown>[];
  requests: { body: Record<string, unknown>; options: Record<string, unknown> }[];
  reply: unknown;
};

const TOOL: LlmToolDefinition = {
  name: "add_rtu",
  description: "Adds an RTU.",
  parameters: { type: "object", properties: { code: { type: "string" } } },
};

function reset(capture: AnthropicCapture, reply: unknown): void {
  capture.constructed.length = 0;
  capture.requests.length = 0;
  capture.reply = reply;
}

function provider(): AnthropicProvider {
  return new AnthropicProvider({ apiKey: "org-key", model: "claude-sonnet-5-5" });
}

function message(content: unknown[], stopReason = "end_turn"): Record<string, unknown> {
  return { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content, stop_reason: stopReason };
}

const signal = (): AbortSignal => new AbortController().signal;

export async function assertTheCallShapeIsTheAmendmentsOne(capture: AnthropicCapture): Promise<void> {
  reset(capture, message([{ type: "text", text: "ok" }]));
  const controller = new AbortController();
  await provider().complete({
    messages: [
      { role: "system", content: "You are the onboarding assistant." },
      { role: "user", content: "hi" },
    ],
    tools: [TOOL],
    signal: controller.signal,
  });
  const body = capture.requests[0]?.body ?? {};
  assert(capture.constructed[0]?.apiKey === "org-key", "the client gets the constructor's key");
  assert(ANTHROPIC_FALLBACK_BETA === "server-side-fallback-2026-07-01", "the scalar fallback form's beta is pinned");
  assert(
    JSON.stringify(body.betas) === JSON.stringify(["server-side-fallback-2026-07-01"]) && body.fallbacks === "default",
    "the scalar fallbacks form goes with its own beta header",
  );
  assert(body.max_tokens === 16_000, "max_tokens is 16,000");
  assert(body.model === "claude-sonnet-5-5", "the constructor's model is sent");
  assert(JSON.stringify(body.tool_choice) === JSON.stringify({ type: "auto" }), "tool_choice is auto");
  assert(JSON.stringify(body.output_config) === JSON.stringify({ effort: "medium" }), "effort is medium");
  assert(!("thinking" in body), "thinking stays at the model default");
  assert(body.system === "You are the onboarding assistant.", "the system message is the system parameter");
  const messages = body.messages as { role: string }[];
  assert(messages.length === 1 && messages[0].role === "user", "no system turn is sent as a message");
  const tools = body.tools as Record<string, unknown>[];
  assert(tools[0].name === "add_rtu" && tools[0].input_schema === TOOL.parameters, "a tool goes out with input_schema");
  assert(capture.requests[0]?.options.signal === controller.signal, "the turn's signal reaches the SDK");
}

export async function assertToolUseBlocksBecomeToolCallsWithStringifiedInput(capture: AnthropicCapture): Promise<void> {
  reset(
    capture,
    message(
      [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: "Adding it." },
        { type: "tool_use", id: "toolu_1", name: "add_rtu", input: { code: "R1" } },
      ],
      "tool_use",
    ),
  );
  const reply = await provider().complete({ messages: [{ role: "user", content: "add" }], tools: [TOOL], signal: signal() });
  assert(reply.kind === "tool_calls", "a tool_use block makes a tool_calls reply");
  if (reply.kind === "tool_calls") {
    assert(reply.calls[0].id === "toolu_1" && reply.calls[0].arguments === '{"code":"R1"}', "input is stringified");
    assert(reply.content === "Adding it.", "the text blocks are the content");
    assert(Array.isArray(reply.providerContent) && (reply.providerContent as unknown[]).length === 3, "the whole content is kept");
  }
}

export async function assertProviderContentIsEchoedBackUnchanged(capture: AnthropicCapture): Promise<void> {
  reset(capture, message([{ type: "text", text: "done" }]));
  const providerContent = [
    { type: "thinking", thinking: "", signature: "sig-1" },
    { type: "tool_use", id: "toolu_1", name: "add_rtu", input: { code: "R1" } },
  ];
  const messages: LlmMessage[] = [
    { role: "user", content: "add" },
    { role: "assistant", content: null, toolCalls: [{ id: "toolu_1", name: "add_rtu", arguments: '{"code":"R1"}' }], providerContent },
    { role: "tool", toolCallId: "toolu_1", content: '{"ok":true}', isError: false },
  ];
  await provider().complete({ messages, tools: [TOOL], signal: signal() });
  const sent = capture.requests[0]?.body.messages as { role: string; content: unknown }[];
  assert(sent[1].role === "assistant", "the assistant turn is sent");
  assert(
    JSON.stringify(sent[1].content) === JSON.stringify(providerContent),
    "the assistant turn is the provider content as returned, thinking block included",
  );
}

export async function assertConsecutiveToolResultsAreOneUserMessage(capture: AnthropicCapture): Promise<void> {
  reset(capture, message([{ type: "text", text: "done" }]));
  await provider().complete({
    messages: [
      { role: "user", content: "add two" },
      {
        role: "assistant",
        content: null,
        toolCalls: [
          { id: "a", name: "add_rtu", arguments: "{}" },
          { id: "b", name: "add_rtu", arguments: "{}" },
        ],
      },
      { role: "tool", toolCallId: "a", content: '{"ok":true}', isError: false },
      { role: "tool", toolCallId: "b", content: '{"ok":false}', isError: true },
    ],
    tools: [TOOL],
    signal: signal(),
  });
  const sent = capture.requests[0]?.body.messages as { role: string; content: { type: string; tool_use_id: string; is_error?: boolean }[] }[];
  assert(sent.length === 3, `three turns are sent, not four (${sent.length})`);
  const results = sent[2];
  assert(results.role === "user" && results.content.length === 2, "two tool results go in one user message");
  assert(results.content[0].tool_use_id === "a" && results.content[0].is_error === undefined, "a success carries no is_error");
  assert(results.content[1].tool_use_id === "b" && results.content[1].is_error === true, "a failure carries is_error");
}

async function rejects(capture: AnthropicCapture, stopReason: string): Promise<unknown> {
  reset(capture, message([{ type: "text", text: "partial" }], stopReason));
  try {
    await provider().complete({ messages: [{ role: "user", content: "hi" }], tools: [], signal: signal() });
  } catch (err) {
    return err;
  }
  return undefined;
}

export async function assertARefusalIsAProviderError(capture: AnthropicCapture): Promise<void> {
  assert((await rejects(capture, "refusal")) instanceof LlmProviderError, "a final refusal is a provider error");
}

export async function assertMaxTokensIsAProviderError(capture: AnthropicCapture): Promise<void> {
  assert((await rejects(capture, "max_tokens")) instanceof LlmProviderError, "a reply cut at max_tokens is a provider error");
}

export async function assertTextOnlyIsFinal(capture: AnthropicCapture): Promise<void> {
  reset(capture, message([{ type: "text", text: "All set." }]));
  const reply = await provider().complete({ messages: [{ role: "user", content: "hi" }], tools: [], signal: signal() });
  assert(reply.kind === "final" && reply.text === "All set.", "text only is a final reply");
}
