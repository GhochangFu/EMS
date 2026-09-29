/**
 * `F3.33` (ADR 0083 decision 2) — the `IONSiTE NEXUS` text wordmark. "IONSiTE" is bold in `on-dark`,
 * "NEXUS" is in `accent`; two lines in the SOW lettering. Colours are ADR 0078 role classes only
 * (`{ on-dark on chrome }` and `{ accent on chrome }` are already declared contrast pairs). A real
 * logo is a later amendment (C22b).
 */
export const WORDMARK_NAME = "IONSiTE NEXUS";

const SIZES = {
  header: "text-base leading-none",
  hero: "text-5xl leading-none sm:text-6xl",
} as const;

/** The product name as a two-line text logo, announced once as "IONSiTE NEXUS"; `header` or `hero` size. */
export function Wordmark({ variant }: { variant: keyof typeof SIZES }) {
  return (
    <span
      role="img"
      aria-label={WORDMARK_NAME}
      className={`inline-flex flex-col font-condensed tracking-tight ${SIZES[variant]}`}
    >
      <span className="font-bold text-on-dark">IONSiTE</span>{" "}
      <span className="text-accent">NEXUS</span>
    </span>
  );
}
