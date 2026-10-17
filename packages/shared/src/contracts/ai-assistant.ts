/**
 * AI assistant settings contracts (F3.21, ADR 0090 Amendment 1, A5 and A7).
 *
 * **The response DTO is deliberately `.strict()`** (owner ruling 12): a key
 * field that leaks into a response — `apiKey`, `keyCiphertext`, anything — must
 * fail the parse rather than be stripped silently. The DTO carries `keySet` and
 * the last four characters only; the secret never crosses the wire outbound.
 *
 * These are flat `z.object`s with no `z.intersection` and no `.readonly()`, so
 * the AGENTS.md §4.8 encoding rules do not apply to them.
 */
import { z } from "zod";

/** A provider the agent loop can call. */
export const llmProviderNameSchema = z.enum(["openai", "openrouter", "anthropic"]);

/** What a settings row can select: a provider, or `off` to disable the agent. */
export const aiAssistantProviderChoiceSchema = z.enum([
  "off",
  "openai",
  "openrouter",
  "anthropic",
]);

/** Outcome of a settings "test connection" call. */
export const aiAssistantTestStatusSchema = z.enum([
  "ok",
  "invalid_key",
  "unknown_model",
  "no_tool_support",
  "rate_limited",
  "unreachable",
  "provider_error",
  /** F4.267 / ADR 0090 Amendment 3 C2: the model cannot read an image. */
  "no_image_support",
]);

export const aiAssistantTestResultDtoSchema = z
  .object({
    status: aiAssistantTestStatusSchema,
    /** F4.267 / ADR 0090 Amendment 3 C4: the vision model's own check, present only when one was tested. */
    visionStatus: aiAssistantTestStatusSchema.optional(),
  })
  .strict();

export const aiAssistantSettingsDtoSchema = z
  .object({
    /** Which layer answered: the organization's own row, or the platform default. */
    source: z.enum(["organization", "platform"]),
    provider: aiAssistantProviderChoiceSchema,
    model: z.string().nullable(),
    /** F4.267 / ADR 0090 Amendment 3 C4: the model an image turn uses; null sends it to `model`. */
    visionModel: z.string().nullable(),
    keySet: z.boolean(),
    keyLast4: z.string().length(4).nullable(),
    updatedAt: z.string().nullable(),
    platform: z
      .object({
        provider: aiAssistantProviderChoiceSchema,
        model: z.string().nullable(),
        /** `LLM_VISION_MODEL`, or null when it is empty. */
        visionModel: z.string().nullable(),
        keySet: z.boolean(),
      })
      .strict(),
  })
  .strict();
