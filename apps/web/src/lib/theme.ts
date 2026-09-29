/**
 * `F3.65c` — the one role resolver (ADR 0078 decision 5, plan
 * `docs/plans/f3.65c-charts-schematics-switch.md` D1).
 *
 * JSX-owned markup paints with role classes (`fill-accent`, `stroke-ink-hint`). A surface a
 * library paints — ECharts, Leaflet, the CodeMirror theme — cannot take a class, so it reads the
 * 41 roles here, as `rgb(r, g, b)` strings resolved from the `--role` custom properties on
 * `<html>`. That read happens in this file only (`tests/f3.65c-theme-gates.test.ts` G3), and the
 * role list is `index.css`'s light block exactly (G1).
 *
 * Pure apart from the two `read*FromDocument` functions; the source is injected so a spec can
 * resolve either theme from the token file without a document.
 */

/** The `localStorage` key the boot script in `index.html` reads (G2). */
export const THEME_STORAGE_KEY = "bms.theme";

/** The 41 roles of `index.css`, in its order. */
export const ROLE_NAMES = [
  "canvas",
  "surface",
  "well",
  "well-deep",
  "line",
  "line-strong",
  "ink",
  "ink-muted",
  "ink-faint",
  "ink-hint",
  "neutral-ink",
  "accent",
  "accent-strong",
  "chrome",
  "chrome-nav",
  "on-dark",
  "on-accent",
  "focus",
  "scrim",
  "critical",
  "critical-ink-soft",
  "critical-ink",
  "critical-ink-strong",
  "critical-wash",
  "critical-wash-strong",
  "critical-line",
  "critical-line-strong",
  "critical-on-dark",
  "warning",
  "warning-ink",
  "warning-wash",
  "warning-wash-strong",
  "warning-line",
  "warning-on-dark",
  "ok-ink",
  "ok-wash",
  "info",
  "info-ink",
  "info-wash",
  "info-line",
  "simulated-ink",
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

/** Every role as `rgb(r, g, b)`, keyed by its token name (`roles["ink-muted"]`). */
export type Roles = Readonly<Record<RoleName, string>>;

export type Theme = "light" | "dark";

const CHANNELS = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/;
const RGB = /^rgb\((\d{1,3}), (\d{1,3}), (\d{1,3})\)$/;

/**
 * Every role from `read` (which returns the custom property's `"R G B"` text). **Throws naming the
 * role** on an empty, malformed or out-of-range value — fail closed: a chart that silently fell
 * back to a library default would paint a light-theme grey on a dark card, which is the defect
 * this resolver exists to remove.
 */
export function resolveRoles(read: (role: RoleName) => string): Roles {
  const out = {} as Record<RoleName, string>;
  for (const role of ROLE_NAMES) {
    const raw = read(role).trim();
    const m = CHANNELS.exec(raw);
    const channels = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [];
    if (channels.length !== 3 || channels.some((c) => c > 255)) {
      throw new Error(`colour role "${role}" resolved to "${raw}"; expected "R G B" (0–255 each)`);
    }
    const [r, g, b] = channels;
    out[role] = `rgb(${r}, ${g}, ${b})`;
  }
  return out;
}

/** A resolved `rgb(r, g, b)` role at `alpha`, as `rgba(r, g, b, alpha)`. Throws on any other string. */
export function withAlpha(rgb: string, alpha: number): string {
  const m = RGB.exec(rgb);
  if (!m) throw new Error(`withAlpha expects a resolved role "rgb(r, g, b)", got "${rgb}"`);
  return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})`;
}

/** One role's custom property on `<html>`, as the browser computes it for the current theme. */
export function readRoleFromDocument(role: RoleName): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${role}`);
}

/**
 * The theme `<html>` carries: `"dark"` only for exactly `data-theme="dark"`, otherwise
 * `"light"`. It never re-reads `localStorage` — the boot script is the one reader of the stored
 * value, so its "only `dark` gives dark" rule cannot drift from a second parser here.
 */
export function readDocumentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}
