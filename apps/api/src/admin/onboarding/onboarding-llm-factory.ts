import type { AiAssistantTestStatus, LlmProviderName } from "@bms/shared";

import { AnthropicProvider } from "./onboarding-anthropic-provider";
import type { OnboardingLlmProvider } from "./onboarding-llm-port";
import { OPENROUTER_BASE_URL, OpenAiCompatibleProvider } from "./onboarding-openai-provider";

/**
 * The one switch over the three adapters (ADR 0090 Amendment 1 A1). The
 * resolver and the settings Test endpoint both build providers here, so the
 * OpenRouter base URL is set in one place.
 */
export function createLlmProvider(
  name: LlmProviderName,
  options: { readonly apiKey: string; readonly model: string },
): OnboardingLlmProvider {
  switch (name) {
    case "openai":
      return new OpenAiCompatibleProvider("openai", options);
    case "openrouter":
      return new OpenAiCompatibleProvider("openrouter", { ...options, baseURL: OPENROUTER_BASE_URL });
    case "anthropic":
      return new AnthropicProvider(options);
  }
}

function statusOf(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) {
    return undefined;
  }
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function nameOf(err: unknown): string {
  if (typeof err !== "object" || err === null) {
    return "";
  }
  const ctor = (err as { constructor?: { name?: unknown } }).constructor;
  return typeof ctor?.name === "string" ? ctor.name : "";
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "";
}

/**
 * One error class for the settings Test button (Amendment 1 A5). Both SDKs
 * attach the HTTP `status` to their API errors and name the connection error
 * `APIConnectionError` (and its timeout subclass), so the mapping reads those
 * two facts and needs neither SDK loaded.
 *
 * **One message is inspected, and never echoed** (plan ruling 8): OpenRouter
 * answers a model without tool support with a 404 whose text says "No
 * endpoints found that support tool use", and no status or class tells it
 * apart from a wrong model name.
 */
export function classifyProviderError(err: unknown, signal?: AbortSignal): Exclude<AiAssistantTestStatus, "ok"> {
  if (signal?.aborted) {
    return "unreachable";
  }
  const name = nameOf(err);
  if (name === "APIConnectionError" || name === "APIConnectionTimeoutError") {
    return "unreachable";
  }
  const status = statusOf(err);
  if (status === 401) {
    return "invalid_key";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if ((status === 404 || status === 400) && /tool/i.test(messageOf(err))) {
    return "no_tool_support";
  }
  if (status === 404) {
    return "unknown_model";
  }
  return "provider_error";
}
