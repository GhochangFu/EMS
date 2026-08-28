import {
  createNotificationChannelBodySchema,
  setRuleNotificationsBodySchema,
  updateNotificationChannelBodySchema,
} from "./notifications.schema";

/**
 * `E7.1f` — the notification channel bodies refuse an unknown key.
 *
 * Assertions only (§4.6); `notifications.schema.test.ts` owns the runner.
 *
 * ## The defect this file exists for
 *
 * `PATCH {"name":"x","organizationId":"<other-tenant>"}` answered **200 with
 * the tenancy unchanged**. Containment was never in doubt — `ChannelsService.
 * update` reads the organization from `loadExistingForWrite(id)` and never from
 * the body — so this was a **contract** defect, not an authorization gap. A
 * caller that is not `apps/web` reads 200 as *"the move succeeded"*.
 *
 * **The gap was exactly the mixed body.** `{"organizationId":"…"}` on its own
 * already answered 400, because the non-empty `.refine()` runs *after* Zod has
 * stripped the unknown key and therefore saw `{}`. That is why the assertion
 * below sends a valid field alongside the smuggled one: a test that sent only
 * `organizationId` would have passed before this change and proved nothing.
 *
 * ## Why the message is asserted and not only the refusal
 *
 * A 400 that does not say which key was refused sends the caller back to
 * guessing, which is most of what made the silent 200 bad in the first place.
 * Zod's `unrecognized_keys` issue carries an **empty path**, so
 * `err.flatten()` — what `notifications.controller.ts:143-151` returns — puts
 * it in `formErrors` rather than in `fieldErrors`. The key is still named.
 * Pinned here because that placement is surprising enough that a future reader
 * might "fix" it, and because `F4.21` owns the error envelope, not this item.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The reported defect: a mixed body no longer answers 200. */
export function testAMixedPatchBodyIsRefusedAndNamesTheKey(): void {
  const result = updateNotificationChannelBodySchema.safeParse({
    name: "renamed",
    organizationId: "00000000-0000-4000-8000-000000000000",
  });

  assert(
    !result.success,
    "PATCH {name, organizationId} must be refused. This is the E7.1f defect: it answered " +
      "200 with the tenancy unchanged, which a non-browser caller reads as a successful move.",
  );

  const formErrors = result.success ? [] : result.error.flatten().formErrors;
  assert(
    formErrors.some((message) => message.includes("organizationId")),
    "the refusal must name `organizationId`. Zod's unrecognized_keys issue has an empty " +
      `path, so it lands in formErrors, not fieldErrors. Got: ${JSON.stringify(formErrors)}`,
  );
}

/**
 * `code` too, and for the same reason.
 *
 * `E7.1d` closed both fields for the one client that was already correct, by
 * excluding them from `updateNotificationChannel`'s patch **type**
 * (`apps/web/src/lib/notification-channels.ts:256` destructures them out).
 * That fixed `apps/web` and nothing else; this is the server saying it.
 */
export function testAPatchCannotSmuggleTheChannelCode(): void {
  assert(
    !updateNotificationChannelBodySchema.safeParse({ name: "renamed", code: "other" }).success,
    "a channel's `code` is a stable identifier and PATCH does not accept one; sending it " +
      "must be refused rather than silently dropped",
  );
}

/**
 * The empty-PATCH refinement still runs, and still says its own thing.
 *
 * **This is the chain-order regression test.** `.strict()` had to go *before*
 * `.refine()` — `.refine()` returns a `ZodEffects` with no `.strict()` method.
 * Had the two been reordered, or had the refinement been dropped while making
 * room, an empty body would have started answering 200 again. Asserting the
 * message and not merely the failure is what separates "the refinement ran"
 * from "something rejected it".
 */
export function testAnEmptyPatchIsStillRefusedByItsOwnRule(): void {
  const result = updateNotificationChannelBodySchema.safeParse({});
  assert(!result.success, "an empty PATCH is a lost edit, not a no-op, and must be refused");

  const formErrors = result.success ? [] : result.error.flatten().formErrors;
  assert(
    formErrors.some((message) => message.includes("at least one field")),
    "an empty PATCH must fail with the non-empty refinement's own message, not with an " +
      `unrecognized-key message. Got: ${JSON.stringify(formErrors)}`,
  );
}

/** A well-formed PATCH is untouched — the fix must not fire when it should not. */
export function testAValidPatchStillParses(): void {
  const result = updateNotificationChannelBodySchema.safeParse({ name: "renamed" });
  assert(result.success, "a PATCH of one declared field must still be accepted");
}

/** The create body is closed on the same terms. */
export function testCreateRefusesAnUnknownKey(): void {
  assert(
    !createNotificationChannelBodySchema.safeParse({
      code: "ops-email",
      name: "Operations",
      kind: "email",
      nope: 1,
    }).success,
    "POST must refuse an undeclared key rather than drop it",
  );

  assert(
    createNotificationChannelBodySchema.safeParse({
      code: "ops-email",
      name: "Operations",
      kind: "email",
      organizationId: "00000000-0000-4000-8000-000000000000",
    }).success,
    "`organizationId` IS declared on create (ADR 0043 Amendment 5) and must still be " +
      "accepted — .strict() closes undeclared keys, not optional ones",
  );
}

/** The rule-notification join body too. */
export function testSetRuleNotificationsRefusesAnUnknownKey(): void {
  assert(
    !setRuleNotificationsBodySchema.safeParse({ channelIds: [], ruleId: "x" }).success,
    "the join body states the whole set and declares only `channelIds`",
  );
}

/**
 * **`.strict()` does not close `config`, and nothing here should suggest it
 * does.**
 *
 * `config` is `z.record(z.unknown())` by ADR 0041 decision 6: any key is legal
 * inside it, whatever the wrapper says, because a channel's transport
 * configuration is open by design and the real check is
 * `assertWebhookTargetAllowed` at send time. This is asserted rather than left
 * implicit so a reader cannot mistake a strict wrapper for a closed payload —
 * and so that `E7.1f`'s ledger entry for this schema has a test behind it.
 */
export function testStrictDoesNotReachInsideTheConfigRecord(): void {
  const result = createNotificationChannelBodySchema.safeParse({
    code: "ops-webhook",
    name: "Operations",
    kind: "webhook",
    config: { url: "https://example.invalid/hook", anythingAtAll: true },
  });
  assert(
    result.success,
    "an arbitrary key inside `config` must still be accepted — .strict() closes the object, " +
      "never the z.record it contains",
  );
}
