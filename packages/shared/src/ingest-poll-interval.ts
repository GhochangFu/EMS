import { z } from "zod";

/**
 * The poll interval bound (ADR 0141 decision 10, `F1.2`).
 *
 * One schema for every reader: the ingest host when it resolves an endpoint's
 * interval, both API bodies that write one (the RTU's Modbus settings and the
 * organization default), the migration's static test that pins the CHECK
 * bounds to these constants, and the web forms. A leaf module: it imports
 * nothing from this package, so `ingest-modbus.ts` and the host can read it
 * without an import cycle.
 *
 * The floor is one second: a meter polled faster than that loads a shared
 * gateway for no reading anyone reads. The ceiling is one hour (plan P4 kept
 * it; both forms warn above 360 s, where the freshness window caps at 900 s).
 */

export const POLL_INTERVAL_MIN_MS = 1_000;
export const POLL_INTERVAL_MAX_MS = 3_600_000;

/** An integer number of milliseconds inside the bounds. No string, no null. */
export const pollIntervalMsSchema = z.number().int().min(POLL_INTERVAL_MIN_MS).max(POLL_INTERVAL_MAX_MS);

export type PollIntervalMs = z.infer<typeof pollIntervalMsSchema>;
