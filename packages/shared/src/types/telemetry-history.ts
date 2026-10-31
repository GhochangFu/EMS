import type { z } from "zod";

import type * as E from "../contracts/envelopes";
import type * as Q from "../contracts/telemetry-queries";

/** `F4.297` (ADR 0108 decision 1) — derived from the schemas, never written by hand (ADR 0030). */
export type PointAggregateQuery = z.infer<typeof Q.pointAggregateQuerySchema>;

/** The raw-records read's query (`GET /telemetry/points/:pointRef/raw`). */
export type PointRawQuery = z.infer<typeof Q.pointRawQuerySchema>;

/** One stored sample in {@link PointRawRecordsResponse}. */
export type PointRawRecord = z.infer<typeof E.pointRawRecordSchema>;

/** A newest-first page of raw records with its `before` cursor. */
export type PointRawRecordsResponse = z.infer<typeof E.pointRawRecordsResponseSchema>;
