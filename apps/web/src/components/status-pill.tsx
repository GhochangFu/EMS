type StatusPillProps = {
  label: string;
  tone?: "ok" | "warning" | "critical" | "offline" | "info";
};

/** Compact status pill matching the mockup status palette. */
export function StatusPill({ label, tone = "ok" }: StatusPillProps) {
  const cls =
    tone === "critical"
      ? "border-red-200 bg-red-100 text-red-800"
      : tone === "warning"
        ? "border-amber-200 bg-amber-100 text-amber-900"
        : tone === "offline"
          ? "border-gray-200 bg-gray-100 text-gray-700"
          : tone === "info"
            ? "border-sky-200 bg-sky-100 text-sky-800"
            : "border-bms-green/20 bg-bms-green/10 text-bms-green";

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold uppercase ${cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
