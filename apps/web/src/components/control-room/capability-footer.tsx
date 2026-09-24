/**
 * The `/cr-overview` capability footer ribbon (`F3.28` task 3.7), verbatim
 * from the client reference layout
 * (`docs/ux/ion-exchange-reference-alignment.md:104`). Static — no read, no
 * state — so it is one component rather than a slice of the page.
 */
const CAPABILITY_ITEMS = [
  "Real-time Monitoring",
  "Intelligent Alerts",
  "Predictive Maintenance",
  "Automated Workflows",
  "Energy & Water Optimization",
  "Sustainability Insights",
  "Mobile Ready",
] as const;

export function CapabilityFooter() {
  return (
    <div
      aria-label="Capability footer"
      className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 rounded border border-gray-200 bg-white px-4 py-3 text-xs font-medium text-bms-muted"
    >
      {CAPABILITY_ITEMS.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </div>
  );
}
