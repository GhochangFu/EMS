import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  subtitle?: ReactNode;
  eyebrow?: string;
  actions?: ReactNode;
};

/** Shared page header aligned with the ESKOM_SMOC.html `.ph` pattern. */
export function PageHeader({ title, subtitle, eyebrow, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-3 border-b border-gray-200 bg-white px-5 py-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? (
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-bms-green">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="font-condensed text-xl font-bold text-bms-ink sm:text-2xl">
          {title}
        </h1>
        {subtitle ? <p className="mt-1 text-sm text-bms-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
