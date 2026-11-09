import { expect } from "vitest";

import { effectiveAppearanceSchema } from "@bms/shared";

import { resolveAppearance, type AppearanceLevels } from "./appearance-resolution";

/**
 * `F4.341` (ADR 0118 decision 8) — the precedence table: each of the design system and the colour
 * profile resolves user > home organization > portal on its own, and reports the level it came from.
 * A stored value outside its closed list (a CHECK forbids it) is treated as empty, never as a 500.
 */

const PORTAL = { designSystem: "swiss-grid", colourProfile: "ocean" } as const;

type Row = { name: string; levels: AppearanceLevels; want: [string, string, string, string] };

const TABLE: Row[] = [
  { name: "nothing chosen → portal for both", levels: { user: null, organization: null, portal: PORTAL }, want: ["swiss-grid", "portal", "ocean", "portal"] },
  {
    name: "a user row with NULLs falls through",
    levels: { user: { designSystem: null, colourProfile: null }, organization: null, portal: PORTAL },
    want: ["swiss-grid", "portal", "ocean", "portal"],
  },
  {
    name: "the organization wins over the portal",
    levels: { user: null, organization: { designSystem: "bento-ops", colourProfile: "forest" }, portal: PORTAL },
    want: ["bento-ops", "organization", "forest", "organization"],
  },
  {
    name: "the user wins over the organization",
    levels: {
      user: { designSystem: "control-room-dark", colourProfile: "navy-pop" },
      organization: { designSystem: "bento-ops", colourProfile: "forest" },
      portal: PORTAL,
    },
    want: ["control-room-dark", "user", "navy-pop", "user"],
  },
  {
    name: "each choice resolves on its own (user design, organization profile)",
    levels: {
      user: { designSystem: "enterprise-flat", colourProfile: null },
      organization: { designSystem: null, colourProfile: "sand" },
      portal: PORTAL,
    },
    want: ["enterprise-flat", "user", "sand", "organization"],
  },
  {
    name: "a global admin with no home organization falls from user to portal",
    levels: { user: { designSystem: null, colourProfile: "graphite" }, organization: null, portal: PORTAL },
    want: ["swiss-grid", "portal", "graphite", "user"],
  },
  {
    name: "an out-of-list stored value is empty, not an error",
    levels: {
      user: { designSystem: "glass-showcase", colourProfile: "teal" },
      organization: { designSystem: "Bento-Ops", colourProfile: "lagoon" },
      portal: PORTAL,
    },
    want: ["swiss-grid", "portal", "lagoon", "organization"],
  },
  {
    name: "an out-of-list portal value falls to today's look",
    levels: { user: null, organization: null, portal: { designSystem: "x", colourProfile: "y" } },
    want: ["nexus-soft", "portal", "nexus", "portal"],
  },
];

export function runThePrecedenceTable(): void {
  for (const { name, levels, want } of TABLE) {
    const got = resolveAppearance(levels);
    expect([got.designSystem.value, got.designSystem.from, got.colourProfile.value, got.colourProfile.from], name).toEqual(want);
    expect(effectiveAppearanceSchema.safeParse(got).success, name).toBe(true);
  }
}
