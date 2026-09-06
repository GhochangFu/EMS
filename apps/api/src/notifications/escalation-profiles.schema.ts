import { z } from "zod";

/**
 * `F3.10` escalation-profile request bodies (ADR 0057 decision 7, plan D8/D15).
 *
 * These are the objects the handlers `.parse()`, and the same objects
 * `openapi-registry.ts` points at — one description of each payload, not two
 * (ADR 0029 decision 1).
 *
 * **Every body here is `.strict()`, and so is every object nested inside one**
 * (plan D15). `.strict()` does not descend, so the step object and the
 * severity-map item carry their own; `strict-body-ledger.spec.ts` walks each
 * node and would otherwise ask for a recorded reason to leave it open. There is
 * exactly one producer — the `/admin/escalation-profiles` page (U11) — so ADR
 * 0029 Amendment 3's "how many producers share this object?" question has one
 * answer, and a key outside the set is a caller error rather than a second
 * client's legitimate extension.
 */

/**
 * The profile code — the same restriction `createNotificationChannelBodySchema`
 * puts on a channel code, and for the same reason: it is half of the
 * `(organization_id, code)` identity, it appears in audit payloads and warn
 * lines, and a space or a slash there reads as a delimiter.
 */
const escalationProfileCodeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "code must be lowercase letters, digits and hyphens");

/**
 * One step of the ladder.
 *
 * **`step_no` is not here.** It is the position in the array, assigned 1..n by
 * the server on every write, so a client cannot submit a gap, a duplicate or a
 * zero — the `(profile_id, step_no)` unique key never has to refuse one.
 *
 * `channelIds` is `.min(1)` by ruling Q4: a step with no channel escalates to
 * nobody, which reads on screen as "configured" and behaves as "silent". The
 * profile itself may hold zero steps — an operator creates it and adds the
 * ladder afterwards, and mapping an empty profile to a severity is a harmless
 * no-op.
 *
 * `afterMinutes` is bounded 1..10 080 (a week) by ruling Q2. Zod owns the
 * bound; there is no `CHECK` on the column (`0062`'s precedent).
 */
const escalationStepSchema = z
  .object({
    afterMinutes: z.number().int().min(1).max(10_080),
    channelIds: z
      .array(z.string().uuid())
      .min(1, "a step with no channel escalates to nobody"),
  })
  .strict();

/**
 * The ladder, on both the create and the update body — one description of the
 * ordering rule rather than two that can drift (AGENTS.md §4.4).
 *
 * Ten steps maximum, and `afterMinutes` strictly increasing (ruling Q2). Equal
 * values are refused as well as descending ones: two steps due at the same
 * minute are two messages in the same tick, which is the storm the ladder
 * exists to avoid.
 */
const escalationStepsSchema = z
  .array(escalationStepSchema)
  .max(10)
  .refine(
    (steps) =>
      steps.every(
        (step, index) => index === 0 || step.afterMinutes > (steps[index - 1] as { afterMinutes: number }).afterMinutes,
      ),
    { message: "steps must be ordered by afterMinutes, strictly increasing" },
  )
  .describe(
    "Escalation steps in ladder order, at most ten. `afterMinutes` must increase strictly " +
      "from one step to the next; the step number is the 1-based position and is assigned by " +
      "the server. Each step must name at least one channel.",
  );

export const createEscalationProfileBodySchema = z
  .object({
    /**
     * Optional in the same sense `createNotificationChannelBodySchema`'s is —
     * an `organization_admin` with exactly one grant need not name their own
     * organization — but with one difference that matters:
     * `alarm_escalation_profiles.organization_id` is `NOT NULL`, so there is no
     * fleet-wide profile to fall back to. An `admin` who omits it is answered
     * 400, not given a global row (service `resolveTargetOrg`).
     */
    organizationId: z.string().uuid().optional(),
    code: escalationProfileCodeSchema,
    name: z.string().min(1).max(128),
    /** Absent means "no ladder yet" — ruling Q4 allows a profile with no steps. */
    steps: escalationStepsSchema.default([]),
  })
  .strict()
  .describe(
    "Creates an escalation profile for one organization. Step numbers are the 1-based " +
      "positions of `steps` and are assigned by the server.",
  );

export const updateEscalationProfileBodySchema = z
  .object({
    name: z.string().min(1).max(128).optional(),
    /** Replace-all, like `setRuleChannels`: a ladder is a set, and "these are
     * the steps" survives a lost request in a way "add this one" does not. */
    steps: escalationStepsSchema.optional(),
  })
  // `.strict()` must precede `.refine` — a `ZodEffects` has no `.strict()`.
  // Nothing may separate `.refine(...)` from its `.describe(...)` below.
  .strict()
  // An empty PATCH is a mistake, not a no-op — the shape of a lost edit.
  .refine((body) => Object.keys(body).length > 0, {
    message: "a PATCH must change at least one field",
  })
  // AFTER the refinement, deliberately: zod-to-json-schema emits nothing for a
  // refine, so placed before it the description lands on the inner object and
  // is discarded, and the document would call an empty body valid (ADR 0029
  // Amendment 1).
  .describe(
    "Partial update of an escalation profile. At least one field must be present; an empty " +
      "body is rejected. `code` is not editable — it is half of the profile's identity. " +
      "Supplying `steps` replaces the whole ladder.",
  );

export const setEscalationDefaultsBodySchema = z
  .object({
    /** Same resolution as the create body's, and the same 400 for an `admin`
     * who omits it: the map is per organization by ADR 0057 decision 7. */
    organizationId: z.string().uuid().optional(),
    /**
     * The whole map, not a delta — `setRuleNotificationsBodySchema`'s reason.
     * A severity absent from `items` is unmapped, which is how an operator
     * turns escalation off for it.
     *
     * `severity` is a shape check only. The authority is
     * `alarm_severities.code` and the foreign key enforces it at write time
     * (plan D11), which is what keeps `NotificationsModule` free of a
     * `VocabulariesModule` import and the module edge acyclic.
     */
    items: z
      .array(
        z
          .object({
            severity: z.string().min(1).max(64),
            profileId: z.string().uuid(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict()
  .refine((body) => new Set(body.items.map((item) => item.severity)).size === body.items.length, {
    message: "each severity may appear at most once",
  })
  .describe(
    "Replaces one organization's severity → escalation profile map. A severity absent from " +
      "`items` is left unmapped and never escalates.",
  );

/**
 * `GET /admin/escalation-defaults?organizationId=…`.
 *
 * Left permissive, matching its sibling `listDeliveriesQuerySchema` in this
 * module: D15 governs request *bodies*, and the 2026-08-28 owner ruling
 * recorded in `strict-body-ledger.spec.ts` keeps query schemas outside the
 * strictness audit.
 */
export const escalationDefaultsQuerySchema = z.object({
  organizationId: z.string().uuid().optional(),
});

export type CreateEscalationProfileBody = z.infer<typeof createEscalationProfileBodySchema>;
export type UpdateEscalationProfileBody = z.infer<typeof updateEscalationProfileBodySchema>;
export type SetEscalationDefaultsBody = z.infer<typeof setEscalationDefaultsBodySchema>;
export type EscalationDefaultsQuery = z.infer<typeof escalationDefaultsQuerySchema>;
