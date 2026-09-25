/**
 * `F3.66` OQ1 — the seven SMOC Control Room pages, label and path, in the
 * order the shell's *Control Room 2D* group lists them. The site page's
 * `builtin` body (`pages/control-room/site-page.tsx`) lists these, filtered by
 * `canAccessControlRoomPath`; `U6` deletes the shell's copy, and `F3.70`
 * replaces the links with tabs.
 */
export const SMOC_PAGES = [
  { label: "CR · Main Dashboard", path: "/cr-overview" },
  { label: "CR · Electrical SLD", path: "/cr-sld" },
  { label: "CR · UPS Monitoring", path: "/cr-ups" },
  { label: "CR · Battery Bank", path: "/cr-battery" },
  { label: "CR · HVAC System", path: "/cr-hvac" },
  { label: "CR · Environment", path: "/cr-env" },
  { label: "CR · IT & Rack Load", path: "/cr-it" },
] as const;
