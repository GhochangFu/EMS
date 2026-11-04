/**
 * `F4.311` / ADR 0109 — the standalone calculated-point body and response
 * types, each `z.infer`red from its schema in `../contracts/calc-point-writes`
 * (ADR 0030 decision 2). Re-exported by `index.ts` (§4.8: that file is at the
 * cap).
 */
import type { z } from "zod";

import type * as CP from "../contracts/calc-point-writes";

export type CalcPointSetBody = z.infer<typeof CP.calcPointSetBodySchema>;
export type CalcPointBatchBody = z.infer<typeof CP.calcPointBatchBodySchema>;
export type CalcPointBatchResponse = z.infer<typeof CP.calcPointBatchResponseSchema>;
export type CalcPointRefusal = z.infer<typeof CP.calcPointRefusalSchema>;
export type CalcPointBatchRefusedResponse = z.infer<typeof CP.calcPointBatchRefusedResponseSchema>;
