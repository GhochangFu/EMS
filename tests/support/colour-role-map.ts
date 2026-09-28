/*
 * `F3.65a` — the shade-to-role mapping table (plan `docs/plans/f3.65a-colour-tokens.md` §2.3, U5).
 *
 * `SHADE_ROLES` is the 76 distinct shades of `apps/web/src/**\/*.tsx` (§2.1) plus `violet-700`
 * (`lib/value-provenance.ts`, `.ts`, Fix A) — 77 rows — each carrying the
 * role its uses were folded into. `kind: "exact"` means the role's *light* token value is
 * Tailwind's resolved value for that shade; `kind: "merged"` means the shade was folded into the
 * nearest role of its purpose, and `deltaE` records the CIEDE2000 colour difference between the
 * shade's own hex and the role's light hex (`tests/f3.65a-colour-mapping-table.test.ts` M3).
 * `altRoles` records a second purpose the same shade serves under a different utility (`white` is
 * a `surface` background and an `on-dark` / `on-accent` foreground) — `roleFor` still returns one
 * role per class; the alternative is resolved through `CLASS_OVERRIDES`, not `altRoles`.
 *
 * `CLASS_OVERRIDES` is the class-level split: some shades resolve to a *different* role depending
 * on which Tailwind utility carries them (`text-white` → `on-dark`, not the shade's default
 * `surface`). Keys are the class with any `/NN` or `/[…]` opacity modifier stripped — the same
 * role serves every opacity step **except** the `bg-white` family (Fix B, §2.3's white row):
 * `bg-white`/`fill-white` stay `surface`, but `text-white`/`border-white`/`ring-white`/`bg-white/NN`
 * are `on-dark` regardless of whether an opacity step is present — a translucent layer on chrome
 * reads differently from an opaque white panel.
 *
 * `text-violet-700` is not one of §2.3's 76 `.tsx` rows (§2.1 scopes that table to `.tsx`;
 * `lib/value-provenance.ts` is `.ts`) — it is `SHADE_ROLES`' 77th row, added so `roleFor` covers
 * the whole tree `webColourSourceFiles()` walks (M4). Until Fix A (owner ruling 2026-09-28) it was
 * a `CLASS_OVERRIDES` entry mapped to `ink-faint`, the same weight as the `nameplate` /
 * `configuration` markers it sits beside (`slate-500` / `sky-700`). The owner ruled it keeps its
 * own colour instead, as the 41st role `simulated-ink` — light Tailwind violet-700 `#6D28D9`
 * exact; dark `#A67DE8`, D3-derived (hue/sat kept, lightness raised in 0.5% steps) to clear 4.5:1
 * on sheet, paper and `well` (5.13 / 5.54 / 4.59) — `value-provenance.ts` itself is untouched
 * (`F3.65b` migrates it to the class).
 */

export type ShadeKind = "exact" | "merged";

export type ShadeRoleRow = {
  shade: string;
  hex: string;
  role: string;
  kind: ShadeKind;
  deltaE?: number;
  altRoles?: string[];
  /**
   * The hex a merged row's `deltaE` is measured against, when it is not the role's plain light
   * value. `green-200`, `emerald-300` and `emerald-200` are used only as `<role>/20` opacity
   * classes (§2.3's `` `accent/20` `` role text): their ΔE is against `accent` composited at 20%
   * over `surface`, the colour actually rendered, not flat `accent`.
   */
  compareHex?: string;
};

export const SHADE_ROLES: ShadeRoleRow[] = [
  { shade: "bms-muted", hex: "#4A5464", role: "ink-muted", kind: "exact" },
  { shade: "gray-200", hex: "#E5E7EB", role: "line", kind: "exact" },
  { shade: "bms-ink", hex: "#1A2230", role: "ink", kind: "exact" },
  { shade: "white", hex: "#FFFFFF", role: "surface", kind: "exact", altRoles: ["on-dark", "on-accent"] },
  { shade: "bms-green", hex: "#00A651", role: "accent", kind: "exact", altRoles: ["focus"] },
  { shade: "gray-100", hex: "#F3F4F6", role: "well-deep", kind: "exact", altRoles: ["on-dark"] },
  { shade: "gray-300", hex: "#D1D5DB", role: "line-strong", kind: "exact" },
  { shade: "red-700", hex: "#B91C1C", role: "critical-ink", kind: "exact" },
  { shade: "red-200", hex: "#FECACA", role: "critical-line", kind: "exact" },
  { shade: "gray-50", hex: "#F9FAFB", role: "well", kind: "exact" },
  { shade: "red-50", hex: "#FEF2F2", role: "critical-wash", kind: "exact" },
  { shade: "red-800", hex: "#991B1B", role: "critical-ink-strong", kind: "exact" },
  { shade: "amber-900", hex: "#78350F", role: "warning-ink", kind: "exact" },
  { shade: "red-600", hex: "#DC2626", role: "critical", kind: "exact", altRoles: ["critical-ink-soft"] },
  { shade: "amber-200", hex: "#FDE68A", role: "warning-line", kind: "exact" },
  { shade: "amber-50", hex: "#FFFBEB", role: "warning-wash", kind: "exact" },
  { shade: "black", hex: "#000000", role: "scrim", kind: "exact" },
  { shade: "red-100", hex: "#FEE2E2", role: "critical-wash-strong", kind: "exact" },
  { shade: "gray-400", hex: "#9CA3AF", role: "ink-hint", kind: "exact" },
  { shade: "amber-100", hex: "#FEF3C7", role: "warning-wash-strong", kind: "exact" },
  { shade: "gray-700", hex: "#374151", role: "neutral-ink", kind: "exact" },
  { shade: "emerald-900", hex: "#064E3B", role: "ok-ink", kind: "exact" },
  { shade: "sky-200", hex: "#BAE6FD", role: "info-line", kind: "exact" },
  { shade: "bms-canvas", hex: "#F2F4F7", role: "canvas", kind: "exact" },
  { shade: "amber-500", hex: "#F59E0B", role: "warning", kind: "exact" },
  { shade: "slate-500", hex: "#64748B", role: "ink-faint", kind: "exact" },
  { shade: "sky-50", hex: "#F0F9FF", role: "info-wash", kind: "exact" },
  { shade: "red-300", hex: "#FCA5A5", role: "critical-line-strong", kind: "exact" },
  { shade: "bms-green-dark", hex: "#007C3C", role: "accent-strong", kind: "exact", altRoles: ["chrome-nav"] },
  { shade: "emerald-50", hex: "#ECFDF5", role: "ok-wash", kind: "exact" },
  { shade: "gray-600", hex: "#4B5563", role: "ink-muted", kind: "merged", deltaE: 1.1 },
  { shade: "amber-700", hex: "#B45309", role: "warning-ink", kind: "merged", deltaE: 15.21 },
  { shade: "emerald-100", hex: "#D1FAE5", role: "ok-wash", kind: "merged", deltaE: 8.6 },
  { shade: "gray-500", hex: "#6B7280", role: "ink-faint", kind: "merged", deltaE: 4.14 },
  { shade: "sky-900", hex: "#0C4A6E", role: "info-ink", kind: "merged", deltaE: 5.24 },
  { shade: "amber-800", hex: "#92400E", role: "warning-ink", kind: "merged", deltaE: 6.15 },
  { shade: "amber-400", hex: "#FBBF24", role: "warning-on-dark", kind: "exact", altRoles: ["warning"] },
  { shade: "amber-300", hex: "#FCD34D", role: "warning-line", kind: "merged", deltaE: 7.64, altRoles: ["warning"] },
  { shade: "slate-100", hex: "#F1F5F9", role: "canvas", kind: "merged", deltaE: 0.94 },
  { shade: "sky-500", hex: "#0EA5E9", role: "info", kind: "exact" },
  { shade: "sky-800", hex: "#075985", role: "info-ink", kind: "exact" },
  { shade: "red-400", hex: "#F87171", role: "critical-on-dark", kind: "exact" },
  { shade: "bms-header", hex: "#1D2430", role: "chrome", kind: "exact" },
  { shade: "slate-700", hex: "#334155", role: "neutral-ink", kind: "merged", deltaE: 1.85 },
  { shade: "orange-200", hex: "#FED7AA", role: "warning-line", kind: "merged", deltaE: 12.2 },
  { shade: "sky-700", hex: "#0369A1", role: "info-ink", kind: "merged", deltaE: 5.97 },
  { shade: "slate-300", hex: "#CBD5E1", role: "line-strong", kind: "merged", deltaE: 3.11 },
  { shade: "orange-500", hex: "#F97316", role: "warning", kind: "merged", deltaE: 15.7 },
  { shade: "emerald-800", hex: "#065F46", role: "ok-ink", kind: "merged", deltaE: 5.62 },
  { shade: "emerald-700", hex: "#047857", role: "ok-ink", kind: "merged", deltaE: 14.01 },
  { shade: "orange-100", hex: "#FFEDD5", role: "warning-wash-strong", kind: "merged", deltaE: 7.82 },
  { shade: "orange-800", hex: "#9A3412", role: "warning-ink", kind: "merged", deltaE: 7.7 },
  { shade: "gray-950", hex: "#030712", role: "chrome", kind: "merged", deltaE: 7.95 },
  { shade: "sky-100", hex: "#E0F2FE", role: "info-wash", kind: "merged", deltaE: 3.93 },
  { shade: "slate-200", hex: "#E2E8F0", role: "line", kind: "merged", deltaE: 2.23 },
  { shade: "green-200", hex: "#BBF7D0", role: "accent", kind: "merged", deltaE: 8.1, compareHex: "#CCEDDC" },
  { shade: "green-50", hex: "#F0FDF4", role: "ok-wash", kind: "merged", deltaE: 1.48 },
  { shade: "green-900", hex: "#14532D", role: "ok-ink", kind: "merged", deltaE: 6.67 },
  { shade: "red-900", hex: "#7F1D1D", role: "critical-ink-strong", kind: "merged", deltaE: 5.44 },
  { shade: "blue-900", hex: "#1E3A8A", role: "info-ink", kind: "merged", deltaE: 13.17 },
  { shade: "cyan-800", hex: "#155E75", role: "info-ink", kind: "merged", deltaE: 7.88 },
  { shade: "purple-900", hex: "#581C87", role: "ink", kind: "merged", deltaE: 20.04 },
  { shade: "cyan-600", hex: "#0891B2", role: "info", kind: "merged", deltaE: 11.35 },
  { shade: "slate-600", hex: "#475569", role: "ink-muted", kind: "merged", deltaE: 1.85 },
  { shade: "emerald-300", hex: "#6EE7B7", role: "accent", kind: "merged", deltaE: 14.54, compareHex: "#CCEDDC" },
  { shade: "orange-50", hex: "#FFF7ED", role: "warning-wash", kind: "merged", deltaE: 3.78 },
  { shade: "orange-700", hex: "#C2410C", role: "warning-ink", kind: "merged", deltaE: 15.63 },
  { shade: "slate-50", hex: "#F8FAFC", role: "well", kind: "merged", deltaE: 0.61 },
  { shade: "gray-900", hex: "#111827", role: "chrome", kind: "merged", deltaE: 4.35 },
  { shade: "slate-400", hex: "#94A3B8", role: "ink-hint", kind: "merged", deltaE: 3.95 },
  { shade: "red-500", hex: "#EF4444", role: "critical", kind: "merged", deltaE: 7.64 },
  // §2.3 prints "≈ 2" for this row (its only inexact figure); computed CIEDE2000 is 1.96.
  { shade: "gray-800", hex: "#1F2937", role: "chrome", kind: "merged", deltaE: 1.96 },
  { shade: "emerald-200", hex: "#A7F3D0", role: "accent", kind: "merged", deltaE: 9.14, compareHex: "#CCEDDC" },
  { shade: "indigo-200", hex: "#C7D2FE", role: "info-line", kind: "merged", deltaE: 14.0 },
  { shade: "indigo-100", hex: "#E0E7FF", role: "info-wash", kind: "merged", deltaE: 8.83 },
  { shade: "indigo-800", hex: "#3730A3", role: "info-ink", kind: "merged", deltaE: 17.73 },
  // Fix A (owner ruling 2026-09-28): not one of §2.3's 76 `.tsx` shades — `lib/value-provenance.ts`
  // is `.ts` (§2.1 scopes that table to `.tsx`). See the file docblock.
  { shade: "violet-700", hex: "#6D28D9", role: "simulated-ink", kind: "exact" },
];

export type ClassOverride = { role: string; kind: ShadeKind; altRoles?: string[] };

/**
 * The class-level splits (§2.3 D1): a shade whose role depends on which utility carries it. Keys
 * are the class with its opacity modifier stripped.
 */
export const CLASS_OVERRIDES: Record<string, ClassOverride> = {
  "text-white": { role: "on-dark", kind: "exact", altRoles: ["on-accent"] },
  "border-white": { role: "on-dark", kind: "exact" },
  "ring-white": { role: "on-dark", kind: "exact" },
  "bg-white": { role: "surface", kind: "exact" },
  "fill-white": { role: "surface", kind: "exact" },
  "text-red-600": { role: "critical-ink-soft", kind: "exact" },
  "text-gray-100": { role: "on-dark", kind: "merged" },
  "bg-bms-green-dark": { role: "accent-strong", kind: "exact", altRoles: ["chrome-nav"] },
  "ring-bms-green": { role: "focus", kind: "exact" },
  "text-amber-400": { role: "warning-on-dark", kind: "exact" },
  "bg-amber-400": { role: "warning-on-dark", kind: "exact" },
  "ring-amber-400": { role: "warning", kind: "merged" },
  "to-amber-400": { role: "warning", kind: "merged" },
  "border-amber-300": { role: "warning-line", kind: "merged" },
  "to-amber-300": { role: "warning", kind: "merged" },
};

const COLOUR_UTILITY_PREFIX =
  /^(?:bg|text|border(?:-[xytblrse])?|ring(?:-offset)?|divide|outline|fill|stroke|from|via|to|shadow|accent|caret|decoration|placeholder)-(.+)$/;

/** Strip a trailing `/NN` or `/[…]` opacity modifier, once. */
function stripOpacity(className: string): string {
  return className.replace(/\/(?:\d{1,3}|\[[^\]]*\])$/, "");
}

/**
 * Resolve a palette class (`bg-red-600`, `text-white/70`, `hover:bg-bms-green-dark` with the
 * variant already stripped by `paletteClasses`) to the role and kind it carries. Throws if the
 * class does not parse as a colour utility, or if its shade has no row in `SHADE_ROLES` and no
 * `CLASS_OVERRIDES` entry.
 */
export function roleFor(className: string): { role: string; kind: ShadeKind } {
  const stripped = stripOpacity(className);
  // `bg-white/NN` (a translucent layer on chrome, e.g. `layouts/app-shell.tsx`'s hover states) is
  // not the same thing `bg-white` (an opaque panel) is — Fix B, §2.3's white row. The opacity is
  // visible only before stripping, so this check has to run before the stripped-key lookup below.
  if (stripped === "bg-white" && stripped !== className) return { role: "on-dark", kind: "exact" };
  const override = CLASS_OVERRIDES[stripped];
  if (override) return { role: override.role, kind: override.kind };
  const m = COLOUR_UTILITY_PREFIX.exec(stripped);
  if (!m) throw new Error(`cannot parse palette class "${className}" as a colour utility`);
  const shade = m[1];
  const row = SHADE_ROLES.find((r) => r.shade === shade);
  if (!row) throw new Error(`no role mapping for shade "${shade}" (class "${className}")`);
  return { role: row.role, kind: row.kind };
}
