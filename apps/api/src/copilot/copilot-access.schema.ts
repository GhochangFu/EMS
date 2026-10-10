import { z } from "zod";

/**
 * Request bodies and query of the administrator copilot's availability routes
 * (`F3.85` PR 3, ADR 0099 decision 5).
 *
 * `PUT /api/v1/admin/organizations/:orgId/copilot-access` takes any subset of
 * the three settings, `.strict()`, so a field the setting does not take — the
 * response's own `organizationId`, `overrides` — is a 400 rather than dropped.
 * One exception per request, because each names one user the service checks.
 */
export const putCopilotAccessBodySchema = z
  .object({
    enabled: z.boolean().optional(),
    roles: z
      .object({
        location_admin: z.boolean().optional(),
        asset_group_admin: z.boolean().optional(),
      })
      .strict()
      .optional(),
    override: z
      .object({
        userId: z.string().uuid(),
        allow: z.boolean().nullable(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.enabled !== undefined ||
      body.override !== undefined ||
      (body.roles !== undefined && Object.keys(body.roles).length > 0),
    { message: "Send at least one setting: enabled, a role switch, or an override" },
  )
  .describe(
    "`enabled` is the organization switch (global admin only). `roles` sets the two role switches. " +
      "`override.allow` sets a named-user exception; `null` removes it.",
  );

export type PutCopilotAccessBody = z.infer<typeof putCopilotAccessBodySchema>;

/** `GET /api/v1/copilot/status?organizationId=` — omitted means the user's own organization (the global admin: none). */
export const copilotStatusQuerySchema = z
  .object({
    organizationId: z.string().uuid().optional(),
  })
  .strict();
