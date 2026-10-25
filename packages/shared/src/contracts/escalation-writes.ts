import { z } from "zod";

/**
 * `F4.279` (ADR 0099 Amendment 8, ADR 0030) — the request bodies of the
 * escalation write routes (`apps/api/src/notifications/escalation-profiles.controller.ts`),
 * moved here from `apps/api/src/notifications/escalation-profiles.schema.ts` so
 * the copilot catalog entries carry the route's own body by identity.
 * `escalation-profiles.schema.ts` keeps the defaults query.
 *
 * `F3.10` (ADR 0057 decision 7, plan D8/D15): these are the objects the
 * handlers `.parse()`, and the same objects `openapi-registry.ts` points at —
 * one description of each payload, not two (ADR 0029 decision 1).
 *
 * **Every body here is `.strict()`, and so is every object nested inside one**
 * (plan D15). `.strict()` does not descend, so the step object and the
 * severity-map item carry their own; `strict-body-ledger.spec.ts` walks each
 * node and would otherwise ask for a recorded reason to leave it open. The
 * producers are the `/admin/escalation-profiles` page (U11) and, since `F4.279`,
 * the copilot's Confirm of the same catalog entry — one body, so ADR 0029
 * Amendment 3's "how many producers share this object?" question still has one
 * answer, and a key outside the set is a caller error.
 *
 * Plain `z.object`s from shared `shape` constants (the `rule-writes.ts`
 * pattern): no `.merge()`, no `.omit().extend()`, no `.readonly()`.
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
      .min(1, "a step with no channel escalates to nobody")
      // Security L3: bounded like every sibling array here (ruling Q2) — each id is resolved through `loadById`.
      .max(50),
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

/** The fields of a profile create, shared by the route's body and the copilot's model body. */
const profileCreateShape = {
  code: escalationProfileCodeSchema,
  name: z.string().min(1).max(128),
  /** Absent means "no ladder yet" — ruling Q4 allows a profile with no steps. */
  steps: escalationStepsSchema.default([]),
};

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
    ...profileCreateShape,
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

/**
 * One severity → profile pair. `severity` is a shape check only. The
 * authority is `alarm_severities.code` and the foreign key enforces it at write
 * time (plan D11), which is what keeps `NotificationsModule` free of a
 * `VocabulariesModule` import and the module edge acyclic.
 */
const escalationDefaultItemSchema = z
  .object({
    severity: z.string().min(1).max(64),
    profileId: z.string().uuid(),
  })
  .strict();

/** Each severity at most once — the primary key is `(organization_id, severity)`. */
const eachSeverityOnce = (body: { items: readonly { severity: string }[] }): boolean =>
  new Set(body.items.map((item) => item.severity)).size === body.items.length;

export const setEscalationDefaultsBodySchema = z
  .object({
    /** Same resolution as the create body's, and the same 400 for an `admin`
     * who omits it: the map is per organization by ADR 0057 decision 7. */
    organizationId: z.string().uuid().optional(),
    /**
     * The whole map, not a delta — `setRuleNotificationsBodySchema`'s reason.
     * A severity absent from `items` is unmapped, which is how an operator
     * turns escalation off for it.
     */
    items: z.array(escalationDefaultItemSchema).max(50),
  })
  .strict()
  .refine(eachSeverityOnce, {
    message: "each severity may appear at most once",
  })
  .describe(
    "Replaces one organization's severity → escalation profile map. A severity absent from " +
      "`items` is left unmapped and never escalates.",
  );

/** `F4.279` — the copilot's model body for `escalationProfile.create`: the organization is required. */
export const copilotCreateEscalationProfileModelBodySchema = z
  .object({
    organizationId: z.string().uuid(),
    ...profileCreateShape,
  })
  .strict();

/**
 * `F4.279` (Amendment 8 D3) — the copilot's model body for `escalationDefaults.set`:
 * the organization is required and the map holds at least one pair. An empty
 * map silences every severity, which is the red `escalationDefaults.clear` card.
 */
export const copilotSetEscalationDefaultsModelBodySchema = z
  .object({
    organizationId: z.string().uuid(),
    items: z.array(escalationDefaultItemSchema).min(1).max(50),
  })
  .strict()
  .refine(eachSeverityOnce, {
    message: "each severity may appear at most once",
  })
  .describe("Replaces one organization's severity → escalation profile map with at least one pair.");

/**
 * `F4.279` (Amendment 8 D3) — the copilot's model body for `escalationDefaults.clear`: the empty map.
 * An array capped at zero, not `z.tuple([])`: a tuple emits an array-valued `items`, which a JSON
 * Schema 2020-12 tool-input validator refuses, and this body is inlined in its propose tool.
 */
export const copilotClearEscalationDefaultsModelBodySchema = z
  .object({
    organizationId: z.string().uuid(),
    items: z.array(escalationDefaultItemSchema).max(0),
  })
  .strict();

export type CreateEscalationProfileBody = z.infer<typeof createEscalationProfileBodySchema>;
export type UpdateEscalationProfileBody = z.infer<typeof updateEscalationProfileBodySchema>;
export type SetEscalationDefaultsBody = z.infer<typeof setEscalationDefaultsBodySchema>;
