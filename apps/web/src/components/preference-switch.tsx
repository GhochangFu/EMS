/**
 * `F3.71` — a two-button preference switch on the `chrome` header, extracted from `F3.65c`'s
 * `ThemeSwitch` so the Light / Dark and the Neumorphic / Flat switches are one control (ADR 0085
 * decision 1). Native buttons in a named group; `aria-pressed` carries the state, so Tab, Enter
 * and Space work with no key handler. Each button shows a glyph and no word: its accessible name
 * comes from `aria-label`, `title` gives the hover tooltip, and the glyph is `aria-hidden`.
 *
 * It sits on the `chrome` header, dark in both themes and flat in both surface styles, so it
 * paints with `on-dark` shapes only, each declared in `tests/f3.65a-colour-contrast.test.ts`:
 * idle `text-on-dark/85` (the Logout button's shape), pressed `text-on-dark` on a
 * `bg-on-dark/15` wash, the focus ring `ring-on-dark/80`. The class strings are whole literals
 * so Tailwind's scanner sees them.
 */

export type PreferenceOption<T extends string> = {
  value: T;
  label: string;
  title: string;
  icon: string;
  path: string;
};

type PreferenceSwitchProps<T extends string> = {
  label: string;
  options: readonly PreferenceOption<T>[];
  value: T;
  onChange: (value: T) => void;
};

const BASE = "grid place-items-center px-2 py-1.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-on-dark/80";
const PRESSED = "bg-on-dark/15 text-on-dark";
const IDLE = "text-on-dark/85 hover:bg-on-dark/10";

export function PreferenceSwitch<T extends string>({ label, options, value, onChange }: PreferenceSwitchProps<T>) {
  return (
    <div role="group" aria-label={label} className="flex overflow-hidden rounded border border-on-dark/20">
      {options.map((option) => {
        const pressed = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            aria-label={option.label}
            title={option.title}
            className={`${BASE} ${pressed ? PRESSED : IDLE}`}
            onClick={() => onChange(option.value)}
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
