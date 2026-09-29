import type { ReactNode } from "react";

/** Standard disabled command affordance for out-of-scope controls. */
export function DisabledCommandButton({ children }: { children: ReactNode }) {
  return (
    <button
      className="surface-button-locked cursor-not-allowed px-3 py-1.5 text-xs font-semibold"
      disabled
      type="button"
    >
      {children}
    </button>
  );
}
