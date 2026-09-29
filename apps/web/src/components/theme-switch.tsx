import type { Theme } from "../lib/theme";
import { useTheme, useThemeStore } from "../stores/theme-store";

// Material Symbols "light_mode" and "dark_mode" (Apache-2.0), the glyph family `widget-icon.tsx`
// already draws from; `fill="currentColor"` makes each follow the button's `on-dark` ink.
const SUN_PATH =
  "M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0 .39-.39.39-1.03 0-1.41l-1.06-1.06zm1.06-10.96c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z";
const MOON_PATH =
  "M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z";

const OPTIONS: readonly { theme: Theme; label: string; icon: "sun" | "moon"; path: string }[] = [
  { theme: "light", label: "Light", icon: "sun", path: SUN_PATH },
  { theme: "dark", label: "Dark", icon: "moon", path: MOON_PATH },
];

const BASE = "grid place-items-center px-2 py-1.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-on-dark/80";
const PRESSED = "bg-on-dark/15 text-on-dark";
const IDLE = "text-on-dark/85 hover:bg-on-dark/10";

/**
 * `F3.65c` — the user's Light / Dark switch (ADR 0078 decision 4, plan U10). Two native buttons in
 * a group named "Theme"; `aria-pressed` carries the state, so Tab, Enter and Space work with no
 * key handler. Each button shows a glyph (sun, moon) and no word: its accessible name comes from
 * `aria-label` ("Light", "Dark"), `title` gives the hover tooltip, and the glyph is `aria-hidden`. A click calls the store's `setTheme`, which flips `data-theme` on `<html>` and
 * writes `bms.theme` — `"light"` or `"dark"`, the one format the boot script in `index.html`
 * reads. There is no "System" choice and no `matchMedia` (decision 4).
 *
 * It sits on the `chrome` header, dark in both themes, so it paints with `on-dark` shapes only,
 * each declared in `tests/f3.65a-colour-contrast.test.ts`: idle `text-on-dark/85` (the Logout
 * button's shape), pressed `text-on-dark` on a `bg-on-dark/15` wash, the focus ring
 * `ring-on-dark/80`. The class strings are whole literals so Tailwind's scanner sees them.
 */
export function ThemeSwitch() {
  const theme = useTheme();
  const setTheme = useThemeStore((s) => s.setTheme);
  return (
    <div
      role="group"
      aria-label="Theme"
      className="flex overflow-hidden rounded border border-on-dark/20"
    >
      {OPTIONS.map((option) => {
        const pressed = option.theme === theme;
        return (
          <button
            key={option.theme}
            type="button"
            aria-pressed={pressed}
            aria-label={option.label}
            title={`${option.label} theme`}
            className={`${BASE} ${pressed ? PRESSED : IDLE}`}
            onClick={() => setTheme(option.theme)}
          >
            <svg
              data-icon={option.icon}
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d={option.path} />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
