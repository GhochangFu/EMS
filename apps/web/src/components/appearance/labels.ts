import type { ColourProfile, DesignSystem } from "@bms/shared";

/** `F4.310` (ADR 0110 Q7) — each profile's name and character, in the contract's order. Moved here from `colour-profile-dialog.tsx` (retired by `F4.341` PR 12). */
export const COLOUR_PROFILE_LABELS: Readonly<Record<ColourProfile, { label: string; description: string }>> = {
  nexus: { label: "Nexus (default)", description: "Today's colours: the IONSiTE NEXUS green." },
  ocean: { label: "Ocean", description: "A blue accent on cool blue-grey neutrals." },
  lagoon: { label: "Lagoon", description: "A teal accent." },
  indigo: { label: "Indigo", description: "A deep indigo-navy accent on cool neutrals." },
  graphite: { label: "Graphite", description: "A slate-grey accent: the least colour, for a quiet screen." },
  "high-contrast": { label: "High contrast", description: "Darker inks, stronger lines and focus: for control rooms and walls." },
  forest: { label: "Forest", description: "A pine accent on warm beige neutrals." },
  sand: { label: "Sand", description: "A blue accent on charcoal and sand neutrals." },
  "navy-pop": { label: "Navy pop", description: "A magenta accent on navy and white." },
};

/** `F4.341` (ADR 0118 decision 1) — each design system's name and use, in the contract's order. */
export const DESIGN_SYSTEM_LABELS: Readonly<Record<DesignSystem, { label: string; description: string }>> = {
  "nexus-soft": { label: "Nexus Soft (default)", description: "Today's look: soft raised cards and the left sidebar." },
  "enterprise-flat": { label: "Enterprise Flat", description: "Plain cards with a thin edge: for admin work, forms and tables." },
  "swiss-grid": { label: "Swiss Grid", description: "Strong rules and large figures, with a top tab bar: for reports and review." },
  "bento-ops": { label: "Bento Ops", description: "Rounded tiles and pill tabs, alarms in the large tile: for overviews and lobby screens." },
  "control-room-dark": { label: "Control Room Dark", description: "A dense grid with a labelled rail: for walls and night shifts. Best in dark." },
};
