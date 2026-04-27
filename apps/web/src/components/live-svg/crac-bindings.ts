/** Primary precision-cooling unit (detail panel, mockup `R.crac`). */
export const CRAC_PRIMARY_CODE = "CH-CRAC-101";

/** All CRAC units on the DH101 hall loop (Sprint 7 seed). */
export const CRAC_ZONE_CODES = [
  "CH-CRAC-101",
  "CH-CRAC-102",
  "CH-CRAC-103",
  "CH-CRAC-104",
] as const;

export const CRAC_TRACKED_CODES: string[] = [...CRAC_ZONE_CODES];
