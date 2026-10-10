import { AnthropicProvider } from "./anthropic-provider";
import { classifyProviderError, createLlmProvider } from "./llm-factory";
import { OpenAiCompatibleProvider } from "./openai-provider";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertEachNameBuildsItsAdapter(): void {
  const options = { apiKey: "k", model: "m" };
  const openai = createLlmProvider("openai", options);
  const openrouter = createLlmProvider("openrouter", options);
  const anthropic = createLlmProvider("anthropic", options);
  assert(openai instanceof OpenAiCompatibleProvider && openai.name === "openai", "openai builds the OpenAI-compatible adapter");
  assert(
    openrouter instanceof OpenAiCompatibleProvider && openrouter.name === "openrouter",
    "openrouter builds the OpenAI-compatible adapter",
  );
  assert(anthropic instanceof AnthropicProvider && anthropic.name === "anthropic", "anthropic builds the Anthropic adapter");
}

class APIConnectionError extends Error {}

function apiError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

export function assertClassifyProviderErrorMapsTheTypedClasses(): void {
  const cases: [unknown, string][] = [
    [apiError(401, "invalid x-api-key"), "invalid_key"],
    [apiError(429, "rate limited"), "rate_limited"],
    [new APIConnectionError("connect ECONNREFUSED"), "unreachable"],
    [apiError(404, "No endpoints found that support tool use. Try disabling tools."), "no_tool_support"],
    [apiError(400, "This model does not support tool use"), "no_tool_support"],
    [apiError(404, "model: claude-nonexistent"), "unknown_model"],
    [apiError(403, "insufficient credits"), "provider_error"],
    [apiError(500, "overloaded"), "provider_error"],
    [new Error("boom"), "provider_error"],
    ["not an error", "provider_error"],
  ];
  for (const [err, expected] of cases) {
    const got = classifyProviderError(err);
    assert(got === expected, `${String((err as Error)?.message ?? err)} → ${expected}, got ${got}`);
  }
  const aborted = new AbortController();
  aborted.abort();
  assert(classifyProviderError(apiError(500, "x"), aborted.signal) === "unreachable", "an aborted test call is unreachable");
}
