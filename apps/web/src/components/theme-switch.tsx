import type { Theme } from "../lib/theme";
import { useTheme, useThemeStore } from "../stores/theme-store";

const OPTIONS: readonly { theme: Theme; label: string }[] = [
  { theme: "light", label: "Light" },
  { theme: "dark", label: "Dark" },
];

const BASE = "px-2.5 py-1.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-on-dark/80";
const PRESSED = "bg-on-dark/15 text-on-dark";
const IDLE = "text-on-dark/85 hover:bg-on-dark/10";

/**
 * `F3.65c` — the user's Light / Dark switch (ADR 0078 decision 4, plan U10). Two native buttons in
 * a group named "Theme"; `aria-pressed` carries the state, so Tab, Enter and Space work with no
 * key handler. A click calls the store's `setTheme`, which flips `data-theme` on `<html>` and
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
      className="flex overflow-hidden rounded border border-on-dark/20 text-xs font-semibold"
    >
      {OPTIONS.map((option) => {
        const pressed = option.theme === theme;
        return (
          <button
            key={option.theme}
            type="button"
            aria-pressed={pressed}
            className={`${BASE} ${pressed ? PRESSED : IDLE}`}
            onClick={() => setTheme(option.theme)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
