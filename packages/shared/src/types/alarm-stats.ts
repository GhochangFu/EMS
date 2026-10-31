import type { z } from "zod";

import type * as S from "../contracts/alarm-stats";

/** `F4.291` (ADR 0099 Amendment 9 E5(b)) — derived from the schemas, never written by hand (ADR 0030). */
export type AlarmStats = z.infer<typeof S.alarmStatsSchema>;

/** One severity's counts in {@link AlarmStats}. */
export type AlarmStatsSeverityRow = z.infer<typeof S.alarmStatsSeverityRowSchema>;

/** One location's counts in {@link AlarmStats}. */
export type AlarmStatsLocationRow = z.infer<typeof S.alarmStatsLocationRowSchema>;

/** One of the top assets in {@link AlarmStats}. */
export type AlarmStatsAssetRow = z.infer<typeof S.alarmStatsAssetRowSchema>;
