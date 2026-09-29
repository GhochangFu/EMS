type StatusPillProps = {
  label: string;
  tone?: "ok" | "warning" | "critical" | "offline" | "info";
};

/** Compact status pill matching the mockup status palette. */
export function StatusPill({ label, tone = "ok" }: StatusPillProps) {
  const cls =
    tone === "critical"
      ? "border-critical-line bg-critical-wash-strong text-critical-ink-strong"
      : tone === "warning"
        ? "border-warning-line bg-warning-wash-strong text-warning-ink"
        : tone === "offline"
          ? "border-line bg-well-deep text-neutral-ink"
          : tone === "info"
            ? "border-info-line bg-info-wash text-info-ink"
            : "border-accent/20 bg-accent/10 text-ok-ink";

  return (
    <span className={`surface-pill inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold uppercase ${cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
