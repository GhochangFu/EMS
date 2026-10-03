import type {
  AiAssistantProviderChoice,
  AiAssistantSettingsDto,
  AiAssistantTestStatus,
} from "@bms/shared";

import type { AiAssistantPutBody, AiAssistantTestBody } from "../api/admin/ai-assistant";

/**
 * Pure rules of the AI assistant page (`F3.21`, ADR 0090 Amendment 1 A6).
 *
 * The page offers one more choice than the API stores: **Platform default**,
 * which is not a provider but the absence of an organization row, so saving it
 * is a `DELETE`. Every request body is built here, so the rules that decide
 * what crosses the wire — a blank key omitted, Off with no key (owner ruling
 * 14), the platform default tested exactly as configured — are covered by the
 * lib spec rather than by the page alone.
 */

/** What the provider control can select. */
export type AiAssistantChoice = "platform" | AiAssistantProviderChoice;

/** The providers the agent can call, i.e. a choice that takes a model and a key. */
type LlmProvider = AiAssistantTestBody["provider"];

const CHOICE_LABELS: Record<AiAssistantChoice, string> = {
  platform: "Platform default",
  off: "Off",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  anthropic: "Anthropic",
};

/** The control's options, in display order. */
export const AI_ASSISTANT_CHOICES: readonly AiAssistantChoice[] = [
  "platform",
  "off",
  "openai",
  "openrouter",
  "anthropic",
];

/** Each provider's default model; OpenRouter has none and needs one typed. */
const DEFAULT_MODELS: Record<LlmProvider, string | null> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-5-5",
  openrouter: null,
};

const TEST_STATUS_SENTENCES: Record<AiAssistantTestStatus, string> = {
  ok: "The connection works: the provider answered and can call tools.",
  invalid_key: "The provider refused the key. Check the key and try again.",
  unknown_model: "The provider does not know this model. Check the model name.",
  no_tool_support: "This model cannot call tools. Choose a model that supports tool calling.",
  rate_limited: "The provider is limiting requests for this key. Try again later.",
  unreachable: "The provider did not answer in time. Try again later.",
  provider_error: "The provider answered with an error. Try again later.",
};

/** A body, or the sentence that says why there is none. */
export type BodyResult<T> = { ok: true; body: T } | { ok: false; message: string };

function isProvider(choice: AiAssistantChoice): choice is LlmProvider {
  return choice !== "platform" && choice !== "off";
}

/** The label a choice is shown with. */
export function providerLabel(choice: AiAssistantChoice): string {
  return CHOICE_LABELS[choice];
}

/** The model field's placeholder: the provider's default model, or why there is none. */
export function defaultModelPlaceholder(choice: AiAssistantChoice): string {
  if (!isProvider(choice)) {
    return "";
  }
  return DEFAULT_MODELS[choice] ?? "required — no default";
}

/** The model a request carries: the typed one, trimmed, else the provider's default. */
export function effectiveModel(provider: LlmProvider, typed: string): string | null {
  const model = typed.trim();
  return model !== "" ? model : DEFAULT_MODELS[provider];
}

/** "Key set, ends in …abcd, saved 2026-10-03", or "No key set". Never more of the key. */
export function keySetLine(
  dto: Pick<AiAssistantSettingsDto, "keySet" | "keyLast4" | "updatedAt">,
): string {
  if (!dto.keySet) {
    return "No key set";
  }
  if (dto.keyLast4 === null) {
    return "Key set";
  }
  // The ISO date, not a locale string: the same on every machine and runner.
  const saved = dto.updatedAt ? `, saved ${dto.updatedAt.slice(0, 10)}` : "";
  return `Key set, ends in …${dto.keyLast4}${saved}`;
}

/** Platform default removes the organization row; every other choice writes it. */
export function saveAction(choice: AiAssistantChoice): "delete" | "put" {
  return choice === "platform" ? "delete" : "put";
}

/** One plain sentence for a test status. */
export function testStatusSentence(status: AiAssistantTestStatus): string {
  return TEST_STATUS_SENTENCES[status];
}

/** Whether the key field takes input: never for Off (ruling 14) or the platform default. */
export function keyFieldEnabled(choice: AiAssistantChoice): boolean {
  return isProvider(choice);
}

/** Whether Test has a provider to call. */
export function testAvailable(
  choice: AiAssistantChoice,
  platformProvider: AiAssistantProviderChoice,
): boolean {
  return choice === "platform" ? platformProvider !== "off" : isProvider(choice);
}

/** What the platform default is: provider, model and whether a key is set — never a key. */
export function platformSummaryLine(platform: AiAssistantSettingsDto["platform"]): string {
  if (platform.provider === "off") {
    return "The platform default is Off: the guided mode answers.";
  }
  const model = platform.model ?? "not set";
  const key = platform.keySet ? "key set" : "no key set";
  return `The platform default is ${providerLabel(platform.provider)}, model ${model}, ${key}.`;
}

function missingModel(provider: LlmProvider): string {
  return `Enter a model: ${providerLabel(provider)} has no default model.`;
}

/**
 * The `PUT` body for a choice other than Platform default. Off carries the
 * provider alone (the server refuses a key with it); a blank key is omitted, so
 * the stored key for the same provider is kept.
 */
export function buildPutBody(
  choice: AiAssistantProviderChoice,
  typedModel: string,
  typedKey: string,
): BodyResult<AiAssistantPutBody> {
  if (choice === "off") {
    return { ok: true, body: { provider: "off" } };
  }
  const model = effectiveModel(choice, typedModel);
  if (model === null) {
    return { ok: false, message: missingModel(choice) };
  }
  const apiKey = typedKey.trim();
  return { ok: true, body: apiKey !== "" ? { provider: choice, model, apiKey } : { provider: choice, model } };
}

/**
 * The `POST …/test` body. Platform default is tested exactly as configured —
 * the server answers 400 for any other provider or model without a key of the
 * organization's own — so it never carries a typed key or model.
 */
export function buildTestBody(
  choice: AiAssistantChoice,
  platform: AiAssistantSettingsDto["platform"],
  typedModel: string,
  typedKey: string,
): BodyResult<AiAssistantTestBody> {
  if (choice === "platform") {
    if (platform.provider === "off" || platform.model === null) {
      return { ok: false, message: "The platform default has no provider and model to test." };
    }
    return { ok: true, body: { provider: platform.provider, model: platform.model } };
  }
  if (choice === "off") {
    return { ok: false, message: "Off calls no provider, so there is nothing to test." };
  }
  const model = effectiveModel(choice, typedModel);
  if (model === null) {
    return { ok: false, message: missingModel(choice) };
  }
  const apiKey = typedKey.trim();
  return { ok: true, body: apiKey !== "" ? { provider: choice, model, apiKey } : { provider: choice, model } };
}
