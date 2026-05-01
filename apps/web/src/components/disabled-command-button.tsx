import type { ReactNode } from "react";

/** Standard disabled command affordance for out-of-scope controls. */
export function DisabledCommandButton({ children }: { children: ReactNode }) {
  return (
    <button
      className="cursor-not-allowed rounded border border-gray-300 bg-gray-100 px-3 py-1.5 text-xs font-semibold text-bms-muted opacity-70"
      disabled
      type="button"
    >
      {children}
    </button>
  );
}
