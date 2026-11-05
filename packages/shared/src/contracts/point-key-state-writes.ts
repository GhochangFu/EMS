import { z } from "zod";

import { CATALOG_CODE_MESSAGE, CATALOG_CODE_PATTERN } from "../constants";
import { pointKeyStateToneSchema } from "./point-key-states";

/**
 * `F4.309` / ADR 0088 Amendment 3 decision 4 — the state-label write bodies
 * (`POST` and `PATCH /api/v1/admin/point-key-states`).
 *
 * A row names a `bms.point_keys` code (the service checks it exists and is active), a finite
 * `value` (owner ruling Q7 (a): any finite number), a `label` trimmed to 1–32 characters and one of
 * the five closed tones. Both bodies are `.strict()` (ADR 0029), and no `.refine`, so the copilot
 * catalog can read their shape (ADR 0099 Amendment 13).
 */
export const createPointKeyStateBodySchema = z
  .object({
    pointKey: z.string().min(1).max(128).regex(CATALOG_CODE_PATTERN, CATALOG_CODE_MESSAGE),
    // `z.number()` already refuses NaN; `.finite()` refuses ±Infinity.
    value: z.number().finite(),
    label: z.string().trim().min(1).max(32),
    tone: pointKeyStateToneSchema,
  })
  .strict();

/**
 * Decision 4: a key and a value cannot change on `PATCH` — delete and create instead — so a
 * `pointKey` or a `value` here is a 400, never dropped. An empty body parses; the service answers
 * 400 for it (plan C9).
 */
export const updatePointKeyStateBodySchema = z
  .object({
    label: z.string().trim().min(1).max(32).optional(),
    tone: pointKeyStateToneSchema.optional(),
  })
  .strict();
