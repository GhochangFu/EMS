import { createLlmProvider } from "./onboarding-llm-factory";
import { LlmProviderError, type LlmToolDefinition, type OnboardingLlmProvider } from "./onboarding-llm-port";
import { OPENAI_BASE_URL, OPENROUTER_BASE_URL, OpenAiCompatibleProvider } from "./onboarding-openai-provider";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * What the `.test.ts` wrapper's `vi.mock("openai")` records: every client
 * constructor's options, every `create` call's two arguments, and the reply the
 * next `create` resolves with.
 */
export type OpenAiCapture = {
  constructed: Record<string, unknown>[];
  requests: { body: Record<string, unknown>; options: Record<string, unknown> }[];
  reply: unknown;
};

const TOOL: LlmToolDefinition = {
  name: "add_rtu",
  description: "Adds an RTU.",
  parameters: { type: "object", properties: { code: { type: "string" } } },
};

function reset(capture: OpenAiCapture, reply: unknown): void {
  capture.constructed.length = 0;
  capture.requests.length = 0;
  capture.reply = reply;
}

/**
 * OpenRouter is built through the factory, not the constructor, so the base URL
 * the factory supplies is what the assertion sees (a constructor call would
 * hand the URL in itself and could not catch the factory dropping it).
 */
function provider(name: "openai" | "openrouter" = "openai"): OnboardingLlmProvider {
  return name === "openrouter"
    ? createLlmProvider("openrouter", { apiKey: "ctor-key", model: "z-ai/glm-5.3-flash" })
    : new OpenAiCompatibleProvider("openai", { apiKey: "ctor-key", model: "gpt-4o-mini" });
}

const finalReply = { choices: [{ message: { content: "done" } }] };

export async function assertToolsAreForwardedAsFunctionTools(capture: OpenAiCapture): Promise<void> {
  reset(capture, finalReply);
  await provider().complete({ messages: [{ role: "user", content: "hi" }], tools: [TOOL], signal: new AbortController().signal });
  const body = capture.requests[0]?.body;
  assert(body?.tool_choice === "auto", "tool_choice is auto");
  const tools = body?.tools as { type: string; function: Record<string, unknown> }[];
  assert(
    tools?.length === 1 &&
      tools[0].type === "function" &&
      tools[0].function.name === "add_rtu" &&
      tools[0].function.description === "Adds an RTU." &&
      tools[0].function.parameters === TOOL.parameters,
    "each tool goes out as a function tool with its name, description and JSON Schema",
  );
  assert(body?.model === "gpt-4o-mini", "the constructor's model is sent");
}

export async function assertToolMessagesCarryTheCallId(capture: OpenAiCapture): Promise<void> {
  reset(capture, finalReply);
  await provider().complete({
    messages: [
      { role: "user", content: "add one" },
      { role: "assistant", content: null, toolCalls: [{ id: "c1", name: "add_rtu", arguments: '{"code":"R1"}' }] },
      { role: "tool", toolCallId: "c1", content: '{"ok":true}', isError: false },
    ],
    tools: [TOOL],
    signal: new AbortController().signal,
  });
  const messages = capture.requests[0]?.body.messages as Record<string, unknown>[];
  const assistant = messages[1] as { tool_calls: { id: string; type: string; function: { name: string; arguments: string } }[] };
  assert(
    assistant.tool_calls[0].id === "c1" &&
      assistant.tool_calls[0].type === "function" &&
      assistant.tool_calls[0].function.arguments === '{"code":"R1"}',
    "the assistant's tool call goes back with its id and raw arguments",
  );
  assert(messages[2].role === "tool" && messages[2].tool_call_id === "c1", "the tool result carries tool_call_id");
}

export async function assertTheSignalReachesTheSdk(capture: OpenAiCapture): Promise<void> {
  reset(capture, finalReply);
  const controller = new AbortController();
  await provider().complete({ messages: [{ role: "user", content: "hi" }], tools: [], signal: controller.signal });
  assert(capture.requests[0]?.options.signal === controller.signal, "the turn's AbortSignal is the SDK request's signal");
}

export async function assertFunctionToolCallsBecomeToolCalls(capture: OpenAiCapture): Promise<void> {
  reset(capture, {
    choices: [
      {
        message: {
          content: "working",
          tool_calls: [
            { id: "a", type: "function", function: { name: "get_draft", arguments: "{}" } },
            { id: "x", type: "custom", custom: { name: "other", input: "" } },
            { id: "b", type: "function", function: { name: "add_rtu", arguments: '{"code":"R1"}' } },
          ],
        },
      },
    ],
  });
  const reply = await provider().complete({ messages: [{ role: "user", content: "hi" }], tools: [TOOL], signal: new AbortController().signal });
  assert(reply.kind === "tool_calls", "function tool calls make a tool_calls reply");
  if (reply.kind === "tool_calls") {
    assert(
      reply.calls.map((c) => c.id).join(",") === "a,b" && reply.calls[1].arguments === '{"code":"R1"}',
      "function calls keep their order and raw arguments; a custom call is ignored",
    );
    assert(reply.content === "working", "the text beside the calls is kept");
  }
}

export async function assertNoToolCallsIsFinalText(capture: OpenAiCapture): Promise<void> {
  reset(capture, finalReply);
  const reply = await provider().complete({ messages: [{ role: "user", content: "hi" }], tools: [], signal: new AbortController().signal });
  assert(reply.kind === "final" && reply.text === "done", "a reply without tool calls is final text");
}

export async function assertAMissingChoiceIsAProviderError(capture: OpenAiCapture): Promise<void> {
  reset(capture, { choices: [] });
  let thrown: unknown;
  try {
    await provider().complete({ messages: [{ role: "user", content: "hi" }], tools: [], signal: new AbortController().signal });
  } catch (err) {
    thrown = err;
  }
  assert(thrown instanceof LlmProviderError, "an empty choice list is an LlmProviderError");
}

export async function assertOpenRouterUsesTheOpenRouterBaseUrlAndTheGivenKey(capture: OpenAiCapture): Promise<void> {
  reset(capture, finalReply);
  await provider("openrouter").complete({ messages: [{ role: "user", content: "hi" }], tools: [], signal: new AbortController().signal });
  assert(OPENROUTER_BASE_URL === "https://openrouter.ai/api/v1", "the OpenRouter base URL is pinned");
  assert(capture.constructed[0]?.baseURL === OPENROUTER_BASE_URL, "the OpenRouter client is built at the OpenRouter base URL");
  assert(capture.constructed[0]?.apiKey === "ctor-key", "with the given key");
  assert(capture.requests[0]?.body.model === "z-ai/glm-5.3-flash", "and the given model");
}

export async function assertOpenAiPinsItsBaseUrlAndNoOrgHeaders(capture: OpenAiCapture): Promise<void> {
  reset(capture, finalReply);
  await provider("openai").complete({ messages: [{ role: "user", content: "hi" }], tools: [], signal: new AbortController().signal });
  const options = capture.constructed[0] ?? {};
  assert(options.baseURL === OPENAI_BASE_URL && OPENAI_BASE_URL === "https://api.openai.com/v1", "the OpenAI base URL is explicit");
  assert(options.organization === null && options.project === null, "no OPENAI_ORG_ID or OPENAI_PROJECT_ID header can ride along");
}

export async function assertTheAdapterReadsNoEnv(capture: OpenAiCapture): Promise<void> {
  reset(capture, finalReply);
  const saved = { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL };
  process.env.OPENAI_API_KEY = "env-key";
  process.env.OPENAI_MODEL = "env-model";
  try {
    await provider().complete({ messages: [{ role: "user", content: "hi" }], tools: [], signal: new AbortController().signal });
  } finally {
    if (saved.key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved.key;
    if (saved.model === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = saved.model;
  }
  assert(capture.constructed[0]?.apiKey === "ctor-key", "the constructor's key wins over OPENAI_API_KEY");
  assert(capture.requests[0]?.body.model === "gpt-4o-mini", "the constructor's model wins over OPENAI_MODEL");
}
