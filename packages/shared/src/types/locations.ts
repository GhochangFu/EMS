import type { z } from "zod";

import type * as A from "../contracts/admin";

/** `F2.10` (ADR 0098) — derived from the schemas, never written by hand (ADR 0030). */
export type LocationWriteRefusalReason = z.infer<typeof A.locationWriteRefusalReasonSchema>;

/** The `{ message, reason }` body of a refused location tree write. */
export type LocationWriteRefusal = z.infer<typeof A.locationWriteRefusalSchema>;
