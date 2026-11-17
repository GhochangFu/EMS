/**
 * The `ESKOM_SMOC.html` `#aiFab` bot mark, decorative: the control or label beside it carries the
 * words. Moved here from `copilot/copilot-dock-parts.tsx` (`E1.9g`, plan R-c) so the ML findings
 * card can draw the same AI mark without importing the copilot store.
 */
export function BotIcon({ size }: { size: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
    </svg>
  );
}
