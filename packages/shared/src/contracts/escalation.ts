/**
 * Alarm escalation profiles (`F3.10`, ADR 0057 decision 7).
 *
 * Plain `z.object`s with plain keys — no `.merge()`, no `.extend()`, no
 * `z.intersection`. None of these DTOs is built by widening another schema,
 * and none is all-readonly, so ADR 0030 Amendment 1's flattening combinators
 * do not apply here and `.readonly()` does not either. Recorded explicitly
 * because `tests/adr-0030-contract-derivation.test.ts:152` scans this
 * directory for exactly those combinators, and a flattened schema still
 * typechecks — the point of that test is that nothing else would notice.
 */
import { z } from "zod";

import { alarmSeverityCodeSchema } from "./operations";

/** One escalation step: after N minutes unacknowledged, notify these channels. */
export const escalationStepDtoSchema = z.object({
  stepNo: z.number().int(),
  afterMinutes: z.number().int(),
  channelIds: z.array(z.string()),
});

/** One organisation's named escalation profile — an ordered list of steps. */
export const escalationProfileDtoSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  code: z.string(),
  name: z.string(),
  steps: z.array(escalationStepDtoSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Which profile an organisation maps a given alarm severity to. */
export const escalationDefaultDtoSchema = z.object({
  severity: alarmSeverityCodeSchema,
  profileId: z.string(),
  profileCode: z.string(),
});
