import { Link } from "react-router-dom";

/** One step of a breadcrumb trail; the last step is the current page and is never a link. */
export type BreadcrumbStep = { readonly label: string; readonly to?: string };

/**
 * `F4.341` PR 7 (ADR 0118 Amendment 1 A6, plan D8 / R6) — the one breadcrumb: a real
 * `<nav aria-label="Breadcrumb">` with an ordered list, the current page marked `aria-current`.
 * Its type, weight and case come from the design tokens (the `text-xs` and `font-semibold`
 * utilities read them), so `nexus-soft` keeps its look and the other design systems set A6's.
 * `AdminBreadcrumb` and `ControlRoomBreadcrumb` render through it. Renders nothing for one step
 * or none: a one-step trail names only the page the user is already on.
 */
export function Breadcrumb({ steps }: { steps: readonly BreadcrumbStep[] }) {
  if (steps.length <= 1) {
    return null;
  }
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-xs text-ink-muted">
        {steps.map((step, index) => {
          const last = index === steps.length - 1;
          return (
            <li key={`${step.label}-${index}`} className="flex items-center gap-1">
              {index > 0 ? <span aria-hidden="true">/</span> : null}
              {step.to && !last ? (
                <Link to={step.to} className="font-semibold text-accent-strong hover:underline">
                  {step.label}
                </Link>
              ) : (
                <span className="font-semibold text-ink" aria-current={last ? "page" : undefined}>
                  {step.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
