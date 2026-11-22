import { z } from "zod";

import { pollIntervalMsSchema } from "../ingest-poll-interval";

/**
 * `F1.2` (ADR 0141 decision 10, Amendment 1 (c), plan T7.1) — the body of `PUT
 * /admin/organizations/:id/poll-interval`, the only writer of
 * `bms.organizations.default_poll_interval_ms`. The shared 1 s to 1 h bound, or `null` to fall
 * through to each adapter's default. `.strict()`: an extra key is a 400. The ingest host applies
 * the value at its next binding reload.
 */
export const setOrganizationPollIntervalBodySchema = z
  .object({ defaultPollIntervalMs: pollIntervalMsSchema.nullable() })
  .strict();

/** `F1.2` — `{ defaultPollIntervalMs }`. Exported from here: `src/index.ts` sits at the 1000-line cap. */
export type SetOrganizationPollIntervalBody = z.infer<typeof setOrganizationPollIntervalBodySchema>;
