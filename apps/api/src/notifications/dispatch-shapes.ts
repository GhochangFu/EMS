import type { DispatchOutcome } from "./dispatch-policy";
import type { DeliveryResult, NotificationChannelRow } from "./notification-transport";
import type { DispatchInput } from "./notifications.service";

/**
 * `F3.52` — the three helpers that shape what one dispatch RETURNS or SENDS,
 * as opposed to what it decides.
 *
 * **A move, not a design.** `notifications.service.ts` reached 999 of
 * AGENTS.md §4.5's 1000-line cap when `F3.52` added the `skipped_stale` exit.
 * One line is legal and is not headroom: it leaves the file untouchable for the
 * next row. Every line below is byte-identical to its version at `94af51d8`
 * apart from the `export` keyword on the three the service still calls — the
 * commit's gate is that diff, not a green suite. `ledger-text.ts` and
 * `dispatch-policy.ts` beside this file are the precedent, carved out of the
 * same class for the same reason.
 *
 * **The split against `dispatch-policy.ts` is decision versus shape.** That
 * module answers questions — is this key blocked, which budget does this
 * dispatch charge. This one answers none: {@link subjectFor} composes a string,
 * {@link notRecorded} builds an outcome for an exit that wrote no row by
 * design, and {@link sendTestResult} narrows four fields to the two
 * `sendTest` declares.
 *
 * **`DispatchInput` is imported as a TYPE only**, so the emitted JavaScript
 * holds no edge back to the service and there is no runtime cycle — the same
 * arrangement `alarm-lifecycle-phases.ts` has with its own service. The type
 * stays declared beside the class it describes.
 */

/**
 * `sendTest`'s two-field answer, narrowed from `record()`'s outcome at the
 * source (`F3.51` review).
 *
 * `sendTest` declares two fields and `record()` now returns four. TypeScript
 * accepts that — a returned value is not a fresh object literal, so no
 * excess-property check fires — and the two extra keys would ride out at
 * RUNTIME to whatever the caller does with them. `notifications.controller.ts`
 * happens to rebuild its response field by field today, so nothing reached the
 * wire; that is the controller's shape, not a promise, and `rowLost` is an
 * internal ledger fact with no business on an API response either way. Narrowed
 * here so the declared type and the object agree.
 */
export function sendTestResult(outcome: DispatchOutcome): {
  status: DeliveryResult["status"];
  error: string | null;
} {
  return { status: outcome.status, error: outcome.error };
}

/**
 * An outcome for an exit that wrote no row **by design** — a deduped answer, or
 * one of `offeredAgainWithoutAsking`'s three conserved refusals (that function
 * lives in `dispatch-policy.ts`; named in prose rather than `{@link}`ed,
 * because this module does not import it).
 *
 * `rowLost` is `false` here and that is not a white lie: nothing was lost. The
 * flag means "an insert was attempted and threw", so that the raise retry stops
 * offering a triple the ledger can never record — and a ceiling-refused
 * re-offer, which writes nothing so the NEXT tick can ask again, must go on
 * being offered (`F3.48` ruling Q1; `alarm-lifecycle.integration.spec.ts` I2).
 */
export function notRecorded(channel: NotificationChannelRow, result: DeliveryResult): DispatchOutcome {
  return { ...result, channelId: channel.id, rowLost: false };
}

/**
 * The subject line, by event (plan D14): a raise is `severity: RULE`, a step
 * is `escalation n · severity: RULE`, a clear is `cleared · severity: RULE`.
 * String composition, no template — the body stays the caller's message.
 */
export function subjectFor(input: DispatchInput): string {
  const base = `${input.severity ?? "alarm"}: ${input.ruleCode}`;
  if (input.event === undefined) return base;
  return input.event.kind === "escalation"
    ? `escalation ${input.event.step} · ${base}`
    : `cleared · ${base}`;
}
