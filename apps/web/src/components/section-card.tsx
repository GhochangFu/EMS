import type { ReactNode } from "react";

type SectionCardProps = {
  title?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
};

/** Shared card shell for charts, tables, SVGs, and operational panels. */
export function SectionCard({
  title,
  subtitle,
  actions,
  children,
  className = "",
  bodyClassName = "p-4",
}: SectionCardProps) {
  return (
    <section className={`rounded-lg border border-gray-200 bg-white shadow-sm ${className}`}>
      {title || subtitle || actions ? (
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div>
            {title ? (
              <h2 className="font-condensed text-sm font-bold text-bms-ink">
                {title}
              </h2>
            ) : null}
            {subtitle ? <p className="text-[11px] text-bms-muted">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
