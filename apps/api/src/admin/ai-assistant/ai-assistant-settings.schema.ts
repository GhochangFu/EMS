import { z } from "zod";

// `@bms/shared` and not `@bms/shared/contracts` — apps/api compiles with
// moduleResolution "node" and ignores the exports map (ADR 0030 Amendment 2).
import { aiAssistantProviderChoiceSchema, llmProviderNameSchema } from "@bms/shared";

/**
 * Request bodies of `/api/v1/admin/organizations/:orgId/ai-assistant`
 * (`F3.21`, ADR 0090 Amendment 1 A5).
 *
 * Both are `.strict()`: a caller sending a field this setting does not take —
 * `keyLast4`, `source`, `platform`, the response's own fields — gets a 400
 * rather than having it dropped.
 */

const model = z.string().trim().min(1).max(200);
const apiKey = z.string().trim().min(8).max(512);

export const putAiAssistantSettingsBodySchema = z
  .object({
    provider: aiAssistantProviderChoiceSchema,
    model: model.optional(),
    apiKey: apiKey.optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.provider !== "off" && body.model === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["model"], message: "A model is required unless the provider is off" });
    }
    // Plan ruling 14: an off setting has nothing that uses a key.
    if (body.provider === "off" && body.apiKey !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["apiKey"], message: "An off setting stores no key" });
    }
  })
  .describe(
    "`model` is required unless `provider` is `off`, and `apiKey` is refused when it is. An omitted " +
      "`apiKey` keeps the stored key for the same provider; a new provider without one clears it.",
  );

export type PutAiAssistantSettingsBody = z.infer<typeof putAiAssistantSettingsBodySchema>;

export const testAiAssistantBodySchema = z
  .object({
    provider: llmProviderNameSchema,
    model,
    apiKey: apiKey.optional(),
  })
  .strict();

export type TestAiAssistantBody = z.infer<typeof testAiAssistantBodySchema>;
