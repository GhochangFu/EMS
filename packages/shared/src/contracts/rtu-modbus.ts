import { z } from "zod";

import { modbusConfigSchema, modbusUnitIdSchema } from "../ingest-modbus";
import { pollIntervalMsSchema } from "../ingest-poll-interval";

/**
 * `F1.2` (ADR 0141 decisions 5, 6, 10 and 15, plan T7.1, builder call C10) — `PUT
 * /admin/rtus/:id/modbus`, the route that binds an RTU to a device profile and sets its Modbus
 * connection. Plain `z.object`, `.strict()`, no `.merge()`, no `z.intersection`, no `.readonly()`
 * (C12): a later change must keep to that.
 *
 * The body names the profile by id and **never carries registers**: the server copies them from
 * the profile row (decision 15), so `.strict()` makes a `registers` or `device` key a 400 rather
 * than a list quietly dropped. Each connection field is the ingest schema's own field, so what
 * the API accepts is what the adapter accepts. `pollIntervalMs` is required: `null` removes the
 * endpoint's own value, which then inherits the organization default (decision 10).
 */
export const setRtuModbusBodySchema = z
  .object({
    // The host's refinement is described where it is defined (`ingest-modbus.ts`); the unit id's
    // here, after the refinement (ADR 0029 Amendment 1 fact F).
    host: modbusConfigSchema.shape.host,
    port: modbusConfigSchema.shape.port.optional(),
    timeoutMs: modbusConfigSchema.shape.timeoutMs.optional(),
    interRequestDelayMs: modbusConfigSchema.shape.interRequestDelayMs.optional(),
    pollIntervalMs: pollIntervalMsSchema.nullable(),
    unitId: modbusUnitIdSchema.describe("0 to 247, or 255 for a device addressed directly over TCP"),
    profileId: z.string().uuid(),
  })
  .strict();

/** `F1.2` — the bind body. Exported from here: `src/index.ts` sits at the 1000-line cap. */
export type SetRtuModbusBody = z.infer<typeof setRtuModbusBodySchema>;

/**
 * `F1.2` (plan T7.1) — the `modbus` field of the admin RTU row: what the RTU's `modbus_tcp`
 * connection row holds, read leniently (a row onboarding stored before a bind has no unit id in
 * `device`, no profile and no registers). Never the register list, only its length. Response
 * side, so **not strict** (AGENTS.md §4.8).
 *
 * `timeoutMs` and `interRequestDelayMs` are here beside the plan's six fields so the bind dialog
 * can send back what is stored; `null` = the adapter default.
 */
export const rtuModbusDtoSchema = z.object({
  host: z.string(),
  port: z.number().int(),
  unitId: z.number().int().nullable(),
  timeoutMs: z.number().int().nullable(),
  interRequestDelayMs: z.number().int().nullable(),
  /** The endpoint's own interval; `null` inherits the organization default, then the adapter's. */
  pollIntervalMs: z.number().int().nullable(),
  /** Provenance only (decision 6): the profile version the registers were copied from. */
  profile: z.object({ code: z.string(), version: z.number().int() }).nullable(),
  registerCount: z.number().int().min(0),
});

export type RtuModbusDto = z.infer<typeof rtuModbusDtoSchema>;
