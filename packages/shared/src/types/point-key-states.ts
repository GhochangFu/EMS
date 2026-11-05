/**
 * `F3.74` / ADR 0088 plan D3 — the fleet-wide point-key state map (`bms.point_key_states`), and
 * `F4.309` / ADR 0088 Amendment 3 — its admin rows, write bodies and the `/vocabularies` switching
 * states. Each `z.infer`red from its schema in `../contracts/` (ADR 0030 decision 2); re-exported by
 * `index.ts` (§4.8: that file is at the cap, so the three `F3.74` lines moved here).
 */
import type { z } from "zod";

import type * as PKS from "../contracts/point-key-states";
import type * as PKSW from "../contracts/point-key-state-writes";

export type PointKeyStateTone = z.infer<typeof PKS.pointKeyStateToneSchema>;
export type PointKeyStateDto = z.infer<typeof PKS.pointKeyStateSchema>;
export type PointKeyStateMapDto = z.infer<typeof PKS.pointKeyStateMapSchema>;

/** `F4.309` — one row of the admin list; `seeded` marks a `POINT_KEY_STATE_SEED` pair. */
export type AdminPointKeyStateDto = z.infer<typeof PKS.adminPointKeyStateDtoSchema>;
export type AdminPointKeyStatesListResponse = z.infer<typeof PKS.adminPointKeyStatesListResponseSchema>;
/** `F4.309` — one switching state on `GET /vocabularies`. */
export type SwitchingStateDto = z.infer<typeof PKS.switchingStateDtoSchema>;

export type CreatePointKeyStateBody = z.infer<typeof PKSW.createPointKeyStateBodySchema>;
export type UpdatePointKeyStateBody = z.infer<typeof PKSW.updatePointKeyStateBodySchema>;
