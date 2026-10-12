/**
 * `F3.86` PR 3a (plan §5.2) — the Metadata step of the location and RTU
 * wizards: no form on these pages edits `meta`. A copilot `fill_step` may
 * carry it; the step then shows what will be sent.
 */
export function MetadataStep({ meta, what }: { meta: Record<string, unknown> | undefined; what: string }) {
  if (meta === undefined) {
    return (
      <p className="text-xs text-ink-muted">
        This form sets no metadata: a new {what} starts with none, and an edit keeps the stored metadata.
      </p>
    );
  }
  return (
    <>
      <p className="text-xs text-ink-muted">The copilot filled this metadata; it is sent as shown.</p>
      <pre className="overflow-x-auto surface-field px-3 py-2 font-mono text-xs">{JSON.stringify(meta, null, 2)}</pre>
    </>
  );
}
