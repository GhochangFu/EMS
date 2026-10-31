import { channelSecretSchema, copilotWebhookUrlSchema } from "@bms/shared/contracts";
import { type CatalogEntry, objectShapeOf } from "@bms/shared/copilot";

import { fieldLabel } from "./copilot-diff";

/** A Zod schema, named through the shared helper (`apps/web` does not depend on `zod` itself). */
type Schema = Parameters<typeof objectShapeOf>[0];

/** One box the Confirm card may show for a `clientOnly` path. */
export type ClientOnlyField = {
  /** A top-level key (`secret`) or a dotted path (`config.url`). */
  readonly path: string;
  readonly label: string;
  /** The rule the typed value must pass; `undefined` (a body without the field) never passes. */
  readonly schema: Schema | undefined;
  /** A required box must parse before Confirm; an optional one may stay blank (and is then not sent). */
  readonly required: boolean;
  /** Whether this change shows the box at all. */
  readonly shown: boolean;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The schema of one top-level `clientOnly` field, from the entry's body (the first object shape that has it). */
function topLevelSchema(body: Schema, field: string): Schema | undefined {
  return objectShapeOf(body).find((shape) => Object.prototype.hasOwnProperty.call(shape, field))?.[field];
}

/**
 * The channel kind a notification change writes: the body's `kind`, else the
 * kind the server's check stored in the card-only `recipients` (the channel as
 * it is), else the record now.
 */
function channelKindOf(body: Readonly<Record<string, unknown>>, current: Readonly<Record<string, unknown>> | null): string | undefined {
  if (typeof body.kind === "string") return body.kind;
  const first = Array.isArray(body.recipients) ? body.recipients[0] : undefined;
  if (isObject(first) && typeof first.kind === "string") return first.kind;
  return typeof current?.kind === "string" ? current.kind : undefined;
}

/**
 * `F4.279` (ADR 0099 Amendment 8 Q11, Q12; owner ruling Q10) — the boxes a
 * Confirm card shows for a change's `clientOnly` paths.
 *
 * A notification channel's two paths are shown for a webhook only. The
 * `secret` box is optional: blank omits the field, so a PATCH keeps the stored
 * secret (its rule is the route's own, at least eight characters). The
 * `config.url` box is required on a webhook create and on an update whose body
 * replaces `config` (the PATCH replaces the whole `config`, so a URL left out
 * would be lost). Every other entry's `clientOnly` field is shown and required
 * with its body's own rule, as before (a temporary password).
 *
 * `F4.289` (ADR 0099 Amendment 9 E3): a rule batch's `excludedRows` has no box —
 * the card's row checkboxes are its control, and an empty set is a valid Confirm.
 */
export function clientOnlyFieldsFor(
  entry: Pick<CatalogEntry, "id" | "body" | "clientOnly">,
  body: Readonly<Record<string, unknown>>,
  current: Readonly<Record<string, unknown>> | null,
): ClientOnlyField[] {
  const webhook = channelKindOf(body, current) === "webhook";
  return entry.clientOnly.flatMap((path): ClientOnlyField[] => {
    if (path === "secret" && entry.id.startsWith("notificationChannel.")) {
      return [{ path, label: "Webhook secret", schema: channelSecretSchema.unwrap() as Schema, required: false, shown: webhook }];
    }
    if (path === "excludedRows" && entry.id === "rule.createBatch") {
      return [{ path, label: "Excluded rows", schema: undefined, required: false, shown: false }];
    }
    if (path === "config.url") {
      const replacesConfig = entry.id === "notificationChannel.create" || isObject(body.config);
      return [{ path, label: "Webhook URL", schema: copilotWebhookUrlSchema as Schema, required: true, shown: webhook && replacesConfig }];
    }
    return [{ path, label: fieldLabel(path), schema: topLevelSchema(entry.body, path), required: true, shown: true }];
  });
}
